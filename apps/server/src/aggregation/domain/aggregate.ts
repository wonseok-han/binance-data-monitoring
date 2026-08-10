import type { Candle } from '@binance-monitoring/shared';
import { INTERVAL_MS, bucketStartTime, expectedOneMinuteCount, type Interval } from './interval.js';
import { addDecimalStrings } from './decimal.js';

/**
 * Buckets 1-minute candles into UTC-aligned OHLCV bars. OHLC uses the first
 * open, max high, min low, and last close within the bucket; volume/quote
 * volume/trade count are summed. A bucket is only marked closed once every
 * expected 1-minute candle for its window exists and is itself closed — a
 * gap (outage, in-flight backfill) keeps the aggregated bar open even if its
 * time window has already elapsed.
 */
export function aggregateCandles(oneMinuteCandles: Candle[], interval: Interval): Candle[] {
  if (interval === '1m') {
    return [...oneMinuteCandles].sort((a, b) => a.openTime - b.openTime);
  }

  const intervalMs = INTERVAL_MS[interval];
  const expectedCount = expectedOneMinuteCount(interval);

  const buckets = new Map<number, Candle[]>();
  for (const candle of oneMinuteCandles) {
    const bucketOpen = bucketStartTime(candle.openTime, interval);
    const group = buckets.get(bucketOpen);
    if (group) group.push(candle);
    else buckets.set(bucketOpen, [candle]);
  }

  const result: Candle[] = [];
  for (const [bucketOpen, members] of buckets) {
    const sorted = [...members].sort((a, b) => a.openTime - b.openTime);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const isClosed = sorted.length === expectedCount && sorted.every((candle) => candle.isClosed);

    result.push({
      symbol: first.symbol,
      openTime: bucketOpen,
      closeTime: bucketOpen + intervalMs - 1,
      open: first.open,
      high: sorted.reduce((max, candle) => (Number(candle.high) > Number(max) ? candle.high : max), first.high),
      low: sorted.reduce((min, candle) => (Number(candle.low) < Number(min) ? candle.low : min), first.low),
      close: last.close,
      volume: addDecimalStrings(sorted.map((candle) => candle.volume)),
      quoteVolume: addDecimalStrings(sorted.map((candle) => candle.quoteVolume)),
      tradeCount: sorted.reduce((sum, candle) => sum + candle.tradeCount, 0),
      isClosed,
      updatedAt: sorted.reduce((max, candle) => Math.max(max, candle.updatedAt), first.updatedAt),
    });
  }

  return result.sort((a, b) => a.openTime - b.openTime);
}
