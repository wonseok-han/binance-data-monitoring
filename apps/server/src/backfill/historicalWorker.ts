import type { DbHandle } from '../db/client.js';
import { getEarliestCandle, upsertCandles } from '../db/candles.js';
import { createBackfillJob, getLatestBackfillJob, updateBackfillJobProgress } from '../db/backfillJobs.js';
import type { FetchKlines } from '../collector/binanceRest.js';
import { isRetryableBinanceError } from '../collector/binanceRest.js';
import { lastCompletedOpenTime } from '../collector/backfill.js';
import { DAY_MS, MINUTE_MS, policy } from '../config/index.js';
import type { BackfillFailureNotifier } from './notifier.js';
import { createLoggingBackfillFailureNotifier } from './notifier.js';

export interface HistoricalBackfillLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: HistoricalBackfillLogger = { info: () => {}, error: () => {} };

export interface HistoricalBackfillDeps {
  db: DbHandle['db'];
  fetchKlines: FetchKlines;
  /** 새 DB가 최종적으로 확보할 전체 과거 기간(일). */
  backfillDays: number;
  pageSize?: number;
  interPageDelayMs?: number;
  /** 일시적 오류 재시도 지수 백오프의 시작 지연(ms). */
  retryBaseDelayMs?: number;
  /** 일시적 오류 재시도 지수 백오프의 최대 지연 상한(ms). */
  retryMaxDelayMs?: number;
  /** 연속 재시도가 이 횟수를 넘으면 job을 영구 failed로 전환한다. */
  maxRetries?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: HistoricalBackfillLogger;
  /** job이 영구 failed로 전환될 때 알린다. 기본값은 logger를 통한 구조화 로그 어댑터다. */
  notifier?: BackfillFailureNotifier;
  /** cursor/status가 바뀔 때마다 호출된다. 상태 스냅샷 발행(SSE 등)은 호출자 책임이다. */
  onProgress?: () => void;
}

export interface HistoricalBackfillWorker {
  /** 진행 중인 페이지 처리(또는 재시도 대기)를 즉시 중단하고 cursor를 저장한 뒤 종료한다. */
  stop: () => Promise<void>;
  /** stop()을 호출하지 않고 현재 실행(완료/실패까지)이 끝나기를 기다린다. */
  whenDone: () => Promise<void>;
}

interface ResumableJob {
  id: number;
  fromTime: number;
  toTime: number;
  cursor: number;
  totalCount: number;
  processedCount: number;
  retryCount: number;
  nextRetryAt: number | null;
}

/**
 * 종목 하나에 대해 남은 과거 구간(BACKFILL_DAYS까지)을 최신 시각부터
 * 과거 방향으로 채운다. warmup/실시간 수집으로 이미 확보된 가장 오래된
 * 봉 바로 이전 시점을 상한(toTime)으로 삼고, cursor를 페이지마다 DB에
 * 저장해 재시작 시 이어서 처리한다. pending/running/retrying 작업만
 * 자동 재개하며, 영구 오류로 확정된 failed 작업은 다음 실행에서 다시
 * 시도하지 않는다(재시도/취소 UI는 이번 범위 밖).
 *
 * 일시적 오류(네트워크 오류, Binance 429/5xx 등 재시도 가능한 오류)는 job을
 * failed로 만들지 않고 지수 백오프 후 같은 페이지를 재시도한다. 재시도
 * 대기 중에는 status를 `retrying`으로 표시하고 다음 재시도 시각을
 * `nextRetryAt`에 저장하므로, 대기 도중 서버가 재시작돼도 남은 대기 시간만
 * 마저 기다린 뒤 이어서 진행한다. 단, 연속 재시도 횟수가 `maxRetries`를
 * 넘으면 더 기다리지 않고 job을 영구 failed로 전환한다(한 페이지라도
 * 성공하면 연속 횟수는 0으로 초기화된다). 잘못된 요청 등 재시도로 해결되지
 * 않는 영구 오류는 재시도 없이 즉시 failed로 확정한다. 두 경우 모두
 * `notifier`로 실패를 알린다.
 */
export function startHistoricalBackfillWorker(symbol: string, deps: HistoricalBackfillDeps): HistoricalBackfillWorker {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? noopLogger;
  const pageSize = deps.pageSize ?? policy.backfill.pageSize;
  const interPageDelayMs = deps.interPageDelayMs ?? policy.backfill.interPageDelayMs;
  const retryBaseDelayMs = deps.retryBaseDelayMs ?? policy.backfill.retryBaseDelayMs;
  const retryMaxDelayMs = deps.retryMaxDelayMs ?? policy.backfill.retryMaxDelayMs;
  const maxRetries = deps.maxRetries ?? policy.backfill.maxRetries;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const notifier = deps.notifier ?? createLoggingBackfillFailureNotifier(logger);

  let stopped = false;
  let resolveStopSignal!: () => void;
  const stopSignal = new Promise<void>((resolve) => {
    resolveStopSignal = resolve;
  });

  /** stop()이 호출되면 즉시 깨어난다. 백오프 대기가 길어도 graceful shutdown을 지연시키지 않는다. */
  function interruptibleSleep(ms: number): Promise<void> {
    return Promise.race([sleep(ms), stopSignal]);
  }

  function backoffDelay(retryCount: number): number {
    return Math.min(retryBaseDelayMs * 2 ** (retryCount - 1), retryMaxDelayMs);
  }

  function resolveJob(): ResumableJob | null {
    const nowMs = now();
    const targetFromTime = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS - deps.backfillDays * DAY_MS;
    const existing = getLatestBackfillJob(deps.db, symbol);

    if (existing && (existing.status === 'pending' || existing.status === 'running' || existing.status === 'retrying')) {
      return {
        id: existing.id,
        fromTime: existing.fromTime,
        toTime: existing.toTime,
        cursor: existing.cursor,
        totalCount: existing.totalCount,
        processedCount: existing.processedCount,
        retryCount: existing.retryCount,
        nextRetryAt: existing.nextRetryAt,
      };
    }

    if (existing && existing.status === 'failed') {
      logger.error('historical backfill previously failed permanently; not auto-resuming', {
        symbol,
        jobId: existing.id,
      });
      return null;
    }

    // completed: 이미 목표 구간을 채웠으면 할 일이 없다. BACKFILL_DAYS가 늘어나
    // 더 과거까지 채워야 한다면 이전 job의 하한 바로 이전까지 새 job을 만든다.
    const olderBoundary = existing && existing.status === 'completed' ? existing.fromTime - MINUTE_MS : null;
    const earliest = getEarliestCandle(deps.db, symbol);
    const toTime = olderBoundary ?? (earliest ? earliest.openTime - MINUTE_MS : lastCompletedOpenTime(nowMs));

    if (targetFromTime > toTime) return null;

    const totalCount = (toTime - targetFromTime) / MINUTE_MS + 1;
    const { id } = createBackfillJob(deps.db, {
      symbol,
      fromTime: targetFromTime,
      toTime,
      cursor: toTime,
      totalCount,
      now: nowMs,
    });

    return { id, fromTime: targetFromTime, toTime, cursor: toTime, totalCount, processedCount: 0, retryCount: 0, nextRetryAt: null };
  }

  async function run(): Promise<void> {
    const job = resolveJob();
    if (!job) return;

    let cursor = job.cursor;
    let processedCount = job.processedCount;
    let retryCount = job.retryCount;

    if (job.nextRetryAt != null && job.nextRetryAt > now()) {
      const remaining = job.nextRetryAt - now();
      logger.info('resuming historical backfill after restart, waiting out remaining backoff', {
        symbol,
        jobId: job.id,
        remainingMs: remaining,
      });
      await interruptibleSleep(remaining);
      if (stopped) return;
    }

    updateBackfillJobProgress(deps.db, job.id, {
      cursor,
      processedCount,
      status: 'running',
      retryCount,
      lastError: null,
      nextRetryAt: null,
      now: now(),
    });
    deps.onProgress?.();

    while (cursor >= job.fromTime) {
      if (stopped) return;

      const pageStart = Math.max(job.fromTime, cursor - (pageSize - 1) * MINUTE_MS);

      let klines;
      try {
        klines = await deps.fetchKlines({ symbol, startTime: pageStart, endTime: cursor, limit: pageSize });
      } catch (error) {
        if (!isRetryableBinanceError(error)) {
          logger.error('historical backfill failed permanently', { symbol, jobId: job.id, error: String(error) });
          updateBackfillJobProgress(deps.db, job.id, {
            cursor,
            processedCount,
            status: 'failed',
            lastError: String(error),
            retryCount,
            nextRetryAt: null,
            now: now(),
          });
          deps.onProgress?.();
          notifier.notifyFailed({ symbol, jobId: job.id, error: String(error), failedAt: now() });
          return;
        }

        retryCount += 1;

        if (retryCount > maxRetries) {
          logger.error('historical backfill exceeded max retries; marking failed', {
            symbol,
            jobId: job.id,
            retryCount,
            maxRetries,
            error: String(error),
          });
          updateBackfillJobProgress(deps.db, job.id, {
            cursor,
            processedCount,
            status: 'failed',
            lastError: String(error),
            retryCount,
            nextRetryAt: null,
            now: now(),
          });
          deps.onProgress?.();
          notifier.notifyFailed({ symbol, jobId: job.id, error: String(error), failedAt: now() });
          return;
        }

        const delay = backoffDelay(retryCount);
        const nextRetryAt = now() + delay;
        logger.error('historical backfill page failed, retrying with backoff', {
          symbol,
          jobId: job.id,
          retryCount,
          delayMs: delay,
          error: String(error),
        });
        updateBackfillJobProgress(deps.db, job.id, {
          cursor,
          processedCount,
          status: 'retrying',
          lastError: String(error),
          retryCount,
          nextRetryAt,
          now: now(),
        });
        deps.onProgress?.();

        await interruptibleSleep(delay);
        if (stopped) return;

        updateBackfillJobProgress(deps.db, job.id, {
          cursor,
          processedCount,
          status: 'running',
          lastError: null,
          retryCount,
          nextRetryAt: null,
          now: now(),
        });
        deps.onProgress?.();
        continue; // 커서를 그대로 두고 같은 페이지를 다시 시도한다.
      }

      if (retryCount > 0) retryCount = 0; // 성공하면 연속 재시도 횟수를 초기화한다.

      if (klines.length === 0) break;

      upsertCandles(deps.db, klines);
      processedCount += klines.length;

      const nextCursor = klines[0]!.openTime - MINUTE_MS;
      updateBackfillJobProgress(deps.db, job.id, {
        cursor: nextCursor,
        processedCount,
        status: 'running',
        retryCount,
        now: now(),
      });
      deps.onProgress?.();

      if (nextCursor >= cursor) break; // 진행되지 않으면 무한 루프 방지를 위해 중단
      cursor = nextCursor;

      if (cursor < job.fromTime) break;
      await sleep(interPageDelayMs);
    }

    updateBackfillJobProgress(deps.db, job.id, {
      cursor,
      processedCount,
      status: 'completed',
      retryCount: 0,
      nextRetryAt: null,
      now: now(),
    });
    deps.onProgress?.();
    logger.info('historical backfill completed', { symbol, jobId: job.id, processedCount });
  }

  const currentRun = run().catch((error: unknown) => {
    logger.error('historical backfill worker crashed', { symbol, error: String(error) });
  });

  return {
    stop: async () => {
      stopped = true;
      resolveStopSignal();
      await currentRun;
    },
    whenDone: () => currentRun,
  };
}
