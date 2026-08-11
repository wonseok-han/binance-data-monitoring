import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '@binance-monitoring/shared';
import type { CandleRepositoryPort, RecentOneMinuteCandlesQuery } from '../domain/ports.js';
import { INTERVAL_MS } from '../domain/interval.js';
import { MINUTE_MS } from '../../config/index.js';
import { createGetCandlesUseCase } from './getCandles.js';

const SYMBOL = 'BTCUSDT';

function candle(openTime: number): Candle {
  return {
    symbol: SYMBOL,
    openTime,
    closeTime: openTime + MINUTE_MS - 1,
    open: '1',
    high: '1',
    low: '1',
    close: '1',
    volume: '1',
    quoteVolume: '1',
    tradeCount: 1,
    isClosed: true,
    updatedAt: openTime,
  };
}

function fakeRepository(rows: Candle[]): CandleRepositoryPort {
  return {
    getRecentOneMinuteCandles: vi.fn((query: RecentOneMinuteCandlesQuery) => {
      return rows
        .filter((c) => (query.from === undefined || c.openTime >= query.from) && (query.to === undefined || c.openTime <= query.to))
        .sort((a, b) => a.openTime - b.openTime)
        .slice(-query.limit);
    }),
    getOneMinuteCandlesInRange: vi.fn((symbol: string, from: number, to: number) => {
      return rows.filter((c) => c.openTime >= from && c.openTime <= to).sort((a, b) => a.openTime - b.openTime);
    }),
  };
}

describe('createGetCandlesUseCase', () => {
  it('delegates 1m queries to the repository, requesting one extra row to detect hasMore', () => {
    const rows = [candle(0), candle(MINUTE_MS), candle(2 * MINUTE_MS)];
    const repository = fakeRepository(rows);
    const getCandles = createGetCandlesUseCase({ repository, now: () => 3 * MINUTE_MS });

    const result = getCandles({ symbol: SYMBOL, interval: '1m', limit: 2 });

    expect(repository.getRecentOneMinuteCandles).toHaveBeenCalledWith({
      symbol: SYMBOL,
      from: undefined,
      to: undefined,
      limit: 3, // limit + 1
    });
    expect(result.candles).toHaveLength(2);
  });

  it('reports hasMore and nextBefore when more 1m data exists further back', () => {
    const rows = [candle(0), candle(MINUTE_MS), candle(2 * MINUTE_MS)];
    const repository = fakeRepository(rows);
    const getCandles = createGetCandlesUseCase({ repository, now: () => 3 * MINUTE_MS });

    const result = getCandles({ symbol: SYMBOL, interval: '1m', limit: 2 });

    expect(result.candles.map((c) => c.openTime)).toEqual([MINUTE_MS, 2 * MINUTE_MS]);
    expect(result.page).toEqual({ nextBefore: MINUTE_MS - 1, hasMore: true });
  });

  it('reports hasMore=false and the oldest candle boundary when the full range fits', () => {
    const rows = [candle(0), candle(MINUTE_MS)];
    const repository = fakeRepository(rows);
    const getCandles = createGetCandlesUseCase({ repository, now: () => 2 * MINUTE_MS });

    const result = getCandles({ symbol: SYMBOL, interval: '1m', limit: 5 });

    expect(result.candles).toHaveLength(2);
    expect(result.page).toEqual({ nextBefore: -1, hasMore: false });
  });

  it('returns a null nextBefore when there is no data at all', () => {
    const repository = fakeRepository([]);
    const getCandles = createGetCandlesUseCase({ repository, now: () => 0 });

    const result = getCandles({ symbol: SYMBOL, interval: '1m', limit: 5 });

    expect(result.candles).toHaveLength(0);
    expect(result.page).toEqual({ nextBefore: null, hasMore: false });
  });

  it('aggregates 6h buckets from the full underlying range and applies limit after aggregation', () => {
    const bucketMs = INTERVAL_MS['6h'];
    const bucket0 = 0;
    const bucket1 = bucketMs;
    const bucket2 = 2 * bucketMs;

    const rows = [
      ...Array.from({ length: 360 }, (_, i) => candle(bucket0 + i * MINUTE_MS)),
      ...Array.from({ length: 360 }, (_, i) => candle(bucket1 + i * MINUTE_MS)),
      ...Array.from({ length: 360 }, (_, i) => candle(bucket2 + i * MINUTE_MS)),
    ];
    const repository = fakeRepository(rows);
    const getCandles = createGetCandlesUseCase({ repository, now: () => 3 * bucketMs });

    const result = getCandles({ symbol: SYMBOL, interval: '6h', from: bucket0, to: bucket2 + bucketMs - 1, limit: 2 });

    expect(result.candles.map((b) => b.openTime)).toEqual([bucket1, bucket2]);
    expect(result.candles.every((b) => b.isClosed)).toBe(true);
    expect(result.page).toEqual({ nextBefore: bucket1 - 1, hasMore: true }); // bucket0 exists but was trimmed
  });

  it('derives a default range from now and limit when from/to are omitted', () => {
    const bucketMs = INTERVAL_MS['1d'];
    const now = 10 * bucketMs;
    const rows = Array.from({ length: 5 }, (_, i) => candle(i * bucketMs)).flatMap((c) =>
      Array.from({ length: 1440 }, (_, m) => candle(c.openTime + m * MINUTE_MS)),
    );
    const repository = fakeRepository(rows);
    const getCandles = createGetCandlesUseCase({ repository, now: () => now });

    const result = getCandles({ symbol: SYMBOL, interval: '1d', limit: 3 });

    expect(repository.getOneMinuteCandlesInRange).toHaveBeenCalled();
    expect(result.candles.length).toBeLessThanOrEqual(3);
  });
});
