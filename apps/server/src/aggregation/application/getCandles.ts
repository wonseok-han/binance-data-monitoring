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

export interface CandlesPage {
  /** 이 값을 다음 요청의 `to`로 넘기면 더 과거 데이터를 이어서 받는다. 더 없으면 null. */
  nextBefore: number | null;
  hasMore: boolean;
}

export interface GetCandlesResult {
  candles: Candle[];
  page: CandlesPage;
}

export interface GetCandlesUseCaseDeps {
  repository: CandleRepositoryPort;
  now: () => number;
}

export type GetCandlesUseCase = (query: GetCandlesQuery) => GetCandlesResult;

function toPage(rows: Candle[], limit: number): GetCandlesResult {
  const hasMore = rows.length > limit;
  const candles = hasMore ? rows.slice(rows.length - limit) : rows;
  const oldest = candles[0];

  return {
    candles,
    page: {
      nextBefore: oldest ? oldest.openTime - 1 : null,
      hasMore,
    },
  };
}

/**
 * `1m`은 리포지토리의 효율적인 SQL LIMIT 쿼리로 바로 조회한다.
 * 그보다 큰 봉 주기는 (보존 기간으로 범위가 제한된) 전체 1분봉을 가져와
 * 프로세스 내에서 집계한 뒤 limit을 적용한다. 두 경로 모두 `limit + 1`개를
 * 가져와 실제로 더 과거 데이터가 있는지(hasMore)를 정확히 판단하고,
 * 초과분은 잘라낸 뒤 남은 가장 오래된 봉의 직전 시각을 다음 페이지
 * 커서(nextBefore)로 제공한다.
 */
export function createGetCandlesUseCase(deps: GetCandlesUseCaseDeps): GetCandlesUseCase {
  return function getCandles(query: GetCandlesQuery): GetCandlesResult {
    if (query.interval === '1m') {
      const rows = deps.repository.getRecentOneMinuteCandles({
        symbol: query.symbol,
        from: query.from,
        to: query.to,
        limit: query.limit + 1,
      });
      return toPage(rows, query.limit);
    }

    const intervalMs = INTERVAL_MS[query.interval];
    const to = query.to ?? deps.now();
    const from = query.from ?? Math.max(0, to - (query.limit + 1) * intervalMs);
    const bucketAlignedFrom = Math.floor(from / intervalMs) * intervalMs;

    const oneMinuteCandles = deps.repository.getOneMinuteCandlesInRange(query.symbol, bucketAlignedFrom, to);
    const aggregated = aggregateCandles(oneMinuteCandles, query.interval);

    return toPage(aggregated, query.limit);
  };
}
