import type { DbHandle } from '../db/client.js';
import { getLastClosedCandle, upsertCandles } from '../db/candles.js';
import type { FetchKlines } from './binanceRest.js';

const MINUTE_MS = 60_000;
const DEFAULT_PAGE_SIZE = 1000;

export interface BackfillRange {
  startTime: number;
  endTime: number;
}

/**
 * 백필 종료 경계는 항상 마지막으로 완전히 종료된 1분봉이며,
 * 현재 진행 중인 봉은 절대 포함하지 않는다.
 */
export function lastCompletedOpenTime(now: number): number {
  return Math.floor(now / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
}

export function computeBackfillRange(
  db: DbHandle['db'],
  symbol: string,
  backfillHours: number,
  now: number,
): BackfillRange | null {
  const endTime = lastCompletedOpenTime(now);
  const lastClosed = getLastClosedCandle(db, symbol);

  const startTime = lastClosed
    ? lastClosed.openTime + MINUTE_MS
    : Math.floor(now / MINUTE_MS) * MINUTE_MS - backfillHours * 60 * MINUTE_MS;

  if (startTime > endTime) {
    return null;
  }

  return { startTime, endTime };
}

export interface BackfillDeps {
  db: DbHandle['db'];
  fetchKlines: FetchKlines;
  now?: () => number;
  pageSize?: number;
}

export async function runBackfill(
  deps: BackfillDeps,
  symbol: string,
  backfillHours: number,
): Promise<number> {
  const now = (deps.now ?? Date.now)();
  const range = computeBackfillRange(deps.db, symbol, backfillHours, now);
  if (!range) return 0;

  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const endTimeExclusive = range.endTime + MINUTE_MS;

  let cursor = range.startTime;
  let totalUpserted = 0;

  while (cursor <= range.endTime) {
    const klines = await deps.fetchKlines({
      symbol,
      startTime: cursor,
      endTime: endTimeExclusive - 1,
      limit: pageSize,
    });

    if (klines.length === 0) break;

    upsertCandles(deps.db, klines);
    totalUpserted += klines.length;

    const lastKline = klines[klines.length - 1];
    if (!lastKline) break;

    const nextCursor = lastKline.openTime + MINUTE_MS;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;

    if (klines.length < pageSize) break;
  }

  return totalUpserted;
}
