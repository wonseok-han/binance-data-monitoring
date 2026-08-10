import { describe, expect, it } from 'vitest';
import type { Candle } from '@binance-monitoring/shared';
import { aggregateCandles } from './aggregate.js';
import { INTERVAL_MS } from './interval.js';
import { MINUTE_MS } from '../../config/constants.js';

const SYMBOL = 'BTCUSDT';

function candle(openTime: number, overrides: Partial<Candle> = {}): Candle {
  return {
    symbol: SYMBOL,
    openTime,
    closeTime: openTime + MINUTE_MS - 1,
    open: '100',
    high: '100',
    low: '100',
    close: '100',
    volume: '1',
    quoteVolume: '100',
    tradeCount: 1,
    isClosed: true,
    updatedAt: openTime,
    ...overrides,
  };
}

describe('aggregateCandles: 1m', () => {
  it('returns the input sorted ascending, unchanged', () => {
    const a = candle(120_000);
    const b = candle(60_000);
    expect(aggregateCandles([a, b], '1m')).toEqual([b, a]);
  });
});

describe('aggregateCandles: 6h', () => {
  const bucketOpen = 6 * 60 * 60 * 1000 * 4; // 임의의 UTC 6시간 경계

  it('computes OHLC from first open / max high / min low / last close, and sums volume precisely', () => {
    const candles: Candle[] = [
      candle(bucketOpen, { open: '10', high: '12', low: '9', close: '11', volume: '0.1', quoteVolume: '1.1', tradeCount: 3 }),
      candle(bucketOpen + MINUTE_MS, { open: '11', high: '15', low: '10', close: '14', volume: '0.2', quoteVolume: '2.8', tradeCount: 5 }),
      candle(bucketOpen + 2 * MINUTE_MS, { open: '14', high: '14.5', low: '8', close: '9', volume: '0.05', quoteVolume: '0.45', tradeCount: 2 }),
    ];

    const [bucket] = aggregateCandles(candles, '6h');

    expect(bucket).toMatchObject({
      symbol: SYMBOL,
      openTime: bucketOpen,
      closeTime: bucketOpen + INTERVAL_MS['6h'] - 1,
      open: '10',
      high: '15',
      low: '8',
      close: '9',
      volume: '0.35',
      quoteVolume: '4.35',
      tradeCount: 10,
      isClosed: false, // 기대되는 360개 1분봉 중 3개만 존재함
    });
  });

  it('marks a bucket closed only once every expected 1m candle is present and closed', () => {
    const fullBucket = Array.from({ length: 360 }, (_, i) => candle(bucketOpen + i * MINUTE_MS));

    const closed = aggregateCandles(fullBucket, '6h');
    expect(closed[0]!.isClosed).toBe(true);

    const withOneStillOpen = fullBucket.map((c, i) => (i === 359 ? { ...c, isClosed: false } : c));
    const stillOpen = aggregateCandles(withOneStillOpen, '6h');
    expect(stillOpen[0]!.isClosed).toBe(false);
  });

  it('groups candles into separate UTC-aligned buckets', () => {
    const nextBucketOpen = bucketOpen + INTERVAL_MS['6h'];
    const candles = [candle(bucketOpen), candle(bucketOpen + MINUTE_MS), candle(nextBucketOpen)];

    const result = aggregateCandles(candles, '6h');

    expect(result).toHaveLength(2);
    expect(result.map((b) => b.openTime)).toEqual([bucketOpen, nextBucketOpen]);
  });
});

describe('aggregateCandles: 1d', () => {
  it('aligns bucket boundaries to UTC midnight', () => {
    const dayOpen = Date.UTC(2024, 5, 15, 0, 0, 0);
    const withinDay = dayOpen + 23 * 60 * MINUTE_MS; // 같은 날 UTC 23:00

    const result = aggregateCandles([candle(withinDay)], '1d');

    expect(result[0]!.openTime).toBe(dayOpen);
    expect(result[0]!.closeTime).toBe(dayOpen + INTERVAL_MS['1d'] - 1);
  });
});
