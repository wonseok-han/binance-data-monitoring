import type { DbHandle } from '../db/client.js';
import { getEarliestCandle, upsertCandles } from '../db/candles.js';
import { createBackfillJob, getLatestBackfillJob, updateBackfillJobProgress } from '../db/backfillJobs.js';
import type { FetchKlines } from '../collector/binanceRest.js';
import { lastCompletedOpenTime } from '../collector/backfill.js';
import { DAY_MS, MINUTE_MS } from '../config/constants.js';

export interface HistoricalBackfillLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: HistoricalBackfillLogger = { info: () => {}, error: () => {} };
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_INTER_PAGE_DELAY_MS = 100;

export interface HistoricalBackfillDeps {
  db: DbHandle['db'];
  fetchKlines: FetchKlines;
  /** 새 DB가 최종적으로 확보할 전체 과거 기간(일). */
  backfillDays: number;
  pageSize?: number;
  interPageDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: HistoricalBackfillLogger;
  /** cursor/status가 바뀔 때마다 호출된다. 상태 스냅샷 발행(SSE 등)은 호출자 책임이다. */
  onProgress?: () => void;
}

export interface HistoricalBackfillWorker {
  /** 진행 중인 페이지 처리를 마치고 cursor를 저장한 뒤 종료한다. */
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
}

/**
 * 종목 하나에 대해 남은 과거 구간(BACKFILL_DAYS까지)을 최신 시각부터
 * 과거 방향으로 채운다. warmup/실시간 수집으로 이미 확보된 가장 오래된
 * 봉 바로 이전 시점을 상한(toTime)으로 삼고, cursor를 페이지마다 DB에
 * 저장해 재시작 시 이어서 처리한다. pending/running 작업만 자동 재개하며,
 * failed 작업은 그대로 두고(재시도/취소 UI는 이번 범위 밖) 다음 실행에서
 * 다시 시도하지 않는다.
 */
export function startHistoricalBackfillWorker(symbol: string, deps: HistoricalBackfillDeps): HistoricalBackfillWorker {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? noopLogger;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const interPageDelayMs = deps.interPageDelayMs ?? DEFAULT_INTER_PAGE_DELAY_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let stopped = false;

  function resolveJob(): ResumableJob | null {
    const nowMs = now();
    const targetFromTime = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS - deps.backfillDays * DAY_MS;
    const existing = getLatestBackfillJob(deps.db, symbol);

    if (existing && (existing.status === 'pending' || existing.status === 'running')) {
      return {
        id: existing.id,
        fromTime: existing.fromTime,
        toTime: existing.toTime,
        cursor: existing.cursor,
        totalCount: existing.totalCount,
        processedCount: existing.processedCount,
      };
    }

    if (existing && existing.status === 'failed') {
      logger.error('historical backfill previously failed; not auto-resuming', { symbol, jobId: existing.id });
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

    return { id, fromTime: targetFromTime, toTime, cursor: toTime, totalCount, processedCount: 0 };
  }

  async function run(): Promise<void> {
    const job = resolveJob();
    if (!job) return;

    let cursor = job.cursor;
    let processedCount = job.processedCount;
    updateBackfillJobProgress(deps.db, job.id, { cursor, processedCount, status: 'running', now: now() });
    deps.onProgress?.();

    while (cursor >= job.fromTime) {
      if (stopped) return;

      const pageStart = Math.max(job.fromTime, cursor - (pageSize - 1) * MINUTE_MS);

      let klines;
      try {
        klines = await deps.fetchKlines({ symbol, startTime: pageStart, endTime: cursor, limit: pageSize });
      } catch (error) {
        logger.error('historical backfill failed', { symbol, jobId: job.id, error: String(error) });
        updateBackfillJobProgress(deps.db, job.id, {
          cursor,
          processedCount,
          status: 'failed',
          lastError: String(error),
          now: now(),
        });
        deps.onProgress?.();
        return;
      }

      if (klines.length === 0) break;

      upsertCandles(deps.db, klines);
      processedCount += klines.length;

      const nextCursor = klines[0]!.openTime - MINUTE_MS;
      updateBackfillJobProgress(deps.db, job.id, { cursor: nextCursor, processedCount, status: 'running', now: now() });
      deps.onProgress?.();

      if (nextCursor >= cursor) break; // 진행되지 않으면 무한 루프 방지를 위해 중단
      cursor = nextCursor;

      if (cursor < job.fromTime) break;
      await sleep(interPageDelayMs);
    }

    updateBackfillJobProgress(deps.db, job.id, { cursor, processedCount, status: 'completed', now: now() });
    deps.onProgress?.();
    logger.info('historical backfill completed', { symbol, jobId: job.id, processedCount });
  }

  const currentRun = run().catch((error: unknown) => {
    logger.error('historical backfill worker crashed', { symbol, error: String(error) });
  });

  return {
    stop: async () => {
      stopped = true;
      await currentRun;
    },
    whenDone: () => currentRun,
  };
}
