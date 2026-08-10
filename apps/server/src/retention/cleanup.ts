import type { DbHandle } from '../db/client.js';
import { deleteExpiredCandlesBatch } from '../db/candles.js';
import { DAY_MS } from '../config/constants.js';

export interface RetentionLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: RetentionLogger = { info: () => {}, error: () => {} };

const DEFAULT_BATCH_SIZE = 1000;

export interface RetentionDeps {
  db: DbHandle['db'];
  symbols: string[];
  retentionDays: number;
  cleanupIntervalHours: number;
  now?: () => number;
  logger?: RetentionLogger;
  batchSize?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RetentionScheduler {
  stop: () => void;
  /** 정리 작업을 즉시 한 번 실행한다. 테스트와 수동 운영 트리거를 위해 노출한다. */
  runOnce: () => Promise<number>;
}

/**
 * RETENTION_DAYS보다 오래된 1분봉을 주기적으로 삭제한다. 매 실행마다
 * 작은 배치 단위로 삭제하고 배치 사이에 이벤트 루프를 양보하므로, 대량의
 * 삭제 대상이 있어도 수집기의 WS 처리나 HTTP 서버가 굶주리지 않는다.
 * 초기 백필과 자원을 다투지 않도록 첫 실행은 기동 직후가 아니라 한
 * 주기가 지난 뒤에 수행한다.
 */
export function startRetentionCleanup(deps: RetentionDeps): RetentionScheduler {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? noopLogger;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function runOnce(): Promise<number> {
    const cutoff = now() - deps.retentionDays * DAY_MS;
    let total = 0;

    for (const symbol of deps.symbols) {
      for (;;) {
        if (stopped) return total;
        const deleted = deleteExpiredCandlesBatch(deps.db, symbol, cutoff, batchSize);
        total += deleted;
        if (deleted === 0) break;
        await sleep(0);
      }
    }

    if (total > 0) {
      logger.info('retention cleanup removed expired candles', { total, cutoffOpenTime: cutoff });
    }

    return total;
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(
      () => {
        runOnce()
          .catch((error: unknown) => logger.error('retention cleanup failed', { error: String(error) }))
          .finally(scheduleNext);
      },
      deps.cleanupIntervalHours * 60 * 60 * 1000,
    );
  }

  scheduleNext();

  return {
    runOnce,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
