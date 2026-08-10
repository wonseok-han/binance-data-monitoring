import type { DbHandle } from '../db/client.js';
import { countClosedCandlesInRange } from '../db/candles.js';
import { lastCompletedOpenTime } from '../collector/backfill.js';
import { DAY_MS, MINUTE_MS } from '../config/constants.js';

/** 기대 개수는 차트 봉 주기 선택과 무관하게 고정된다: 최근 24시간 원본 1분봉 기준. */
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
