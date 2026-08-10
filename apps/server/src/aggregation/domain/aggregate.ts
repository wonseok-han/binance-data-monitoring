import type { Candle } from '@binance-monitoring/shared';
import { INTERVAL_MS, bucketStartTime, expectedOneMinuteCount, type Interval } from './interval.js';
import { addDecimalStrings } from './decimal.js';

/**
 * 1분봉을 UTC 정렬 OHLCV 봉으로 버킷화한다. OHLC는 버킷 내 첫 시가,
 * 최고가, 최저가, 마지막 종가를 사용하고 거래량/거래대금/체결 수는
 * 합산한다. 버킷은 해당 구간에 기대되는 1분봉이 모두 존재하고 각각
 * 확정되었을 때만 확정으로 표시한다 — 갭(장애, 백필 진행 중)이 있으면
 * 시간상 이미 지난 구간이라도 집계 봉을 미확정 상태로 유지한다.
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
