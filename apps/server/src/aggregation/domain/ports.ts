import type { Candle } from '@binance-monitoring/shared';

export interface RecentOneMinuteCandlesQuery {
  symbol: string;
  from?: number;
  to?: number;
  limit: number;
}

/** application 계층이 의존하는 경계. SQLite/Drizzle은 이 뒤에 숨긴다. */
export interface CandleRepositoryPort {
  /** [from, to] 범위 내 가장 최근 `limit`개의 1분봉(확정/미확정 포함), 오름차순. */
  getRecentOneMinuteCandles(query: RecentOneMinuteCandlesQuery): Candle[];
  /** [from, to] 범위(양끝 포함) 내 모든 1분봉, 오름차순. 집계에 사용한다. */
  getOneMinuteCandlesInRange(symbol: string, from: number, to: number): Candle[];
}
