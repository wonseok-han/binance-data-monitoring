import type { DbHandle } from '../db/client.js';
import { deleteExpiredCandlesBatch } from '../db/candles.js';

export interface RetentionLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: RetentionLogger = { info: () => {}, error: () => {} };

const DAY_MS = 24 * 60 * 60 * 1000;
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
  /** Runs one cleanup pass immediately; exposed for tests and manual ops triggers. */
  runOnce: () => Promise<number>;
}

/**
 * Periodically deletes 1m candles older than RETENTION_DAYS. Each pass
 * deletes in small batches and yields the event loop between them so a
 * large backlog never starves the collector's WS handling or the HTTP
 * server. The first pass runs after one interval, not immediately at
 * startup, to avoid competing with the initial backfill.
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
