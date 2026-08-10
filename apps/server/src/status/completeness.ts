import type { DbHandle } from '../db/client.js';
import { countClosedCandlesInRange } from '../db/candles.js';
import { lastCompletedOpenTime } from '../collector/backfill.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

/** Expected count is fixed regardless of chart timeframe selection: raw 1m candles over the trailing 24h window. */
export const EXPECTED_24H_CANDLES = DAY_MS / MINUTE_MS;

export interface Completeness24h {
  expected: number;
  confirmed: number;
  missing: number;
}

export function computeCompleteness24h(db: DbHandle['db'], symbol: string, now: number): Completeness24h {
  const end = lastCompletedOpenTime(now);
  const start = end - DAY_MS + MINUTE_MS;
  const confirmed = countClosedCandlesInRange(db, symbol, start, end);

  return {
    expected: EXPECTED_24H_CANDLES,
    confirmed,
    missing: Math.max(0, EXPECTED_24H_CANDLES - confirmed),
  };
}
