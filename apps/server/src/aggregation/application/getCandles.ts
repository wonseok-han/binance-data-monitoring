import type { Candle } from '@binance-monitoring/shared';
import { INTERVAL_MS, type Interval } from '../domain/interval.js';
import { aggregateCandles } from '../domain/aggregate.js';
import type { CandleRepositoryPort } from '../domain/ports.js';

export interface GetCandlesQuery {
  symbol: string;
  interval: Interval;
  from?: number;
  to?: number;
  limit: number;
}

export interface GetCandlesUseCaseDeps {
  repository: CandleRepositoryPort;
  now: () => number;
}

export type GetCandlesUseCase = (query: GetCandlesQuery) => Candle[];

/**
 * `1m` is served straight from the repository's efficient SQL-side
 * LIMIT query. Larger intervals fetch the full underlying 1m range (bounded
 * by the retention window) and aggregate in-process before applying limit.
 */
export function createGetCandlesUseCase(deps: GetCandlesUseCaseDeps): GetCandlesUseCase {
  return function getCandles(query: GetCandlesQuery): Candle[] {
    if (query.interval === '1m') {
      return deps.repository.getRecentOneMinuteCandles({
        symbol: query.symbol,
        from: query.from,
        to: query.to,
        limit: query.limit,
      });
    }

    const intervalMs = INTERVAL_MS[query.interval];
    const to = query.to ?? deps.now();
    const from = query.from ?? Math.max(0, to - query.limit * intervalMs);
    const bucketAlignedFrom = Math.floor(from / intervalMs) * intervalMs;

    const oneMinuteCandles = deps.repository.getOneMinuteCandlesInRange(query.symbol, bucketAlignedFrom, to);
    const aggregated = aggregateCandles(oneMinuteCandles, query.interval);

    return aggregated.slice(-query.limit);
  };
}
