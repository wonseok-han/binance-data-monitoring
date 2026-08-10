import type { Candle } from '@binance-monitoring/shared';

export interface RecentOneMinuteCandlesQuery {
  symbol: string;
  from?: number;
  to?: number;
  limit: number;
}

/** Boundary the application layer depends on; SQLite/Drizzle stays behind it. */
export interface CandleRepositoryPort {
  /** Most recent `limit` closed-or-open 1m candles within [from, to], ascending. */
  getRecentOneMinuteCandles(query: RecentOneMinuteCandlesQuery): Candle[];
  /** Every 1m candle within [from, to] (inclusive), ascending. Used for aggregation. */
  getOneMinuteCandlesInRange(symbol: string, from: number, to: number): Candle[];
}
