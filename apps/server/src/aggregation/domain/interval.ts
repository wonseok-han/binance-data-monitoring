import type { Interval } from '@binance-monitoring/shared';

export type { Interval };

const ONE_MINUTE_MS = 60_000;

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': ONE_MINUTE_MS,
  '6h': 6 * 60 * ONE_MINUTE_MS,
  '1d': 24 * 60 * ONE_MINUTE_MS,
};

/** UTC-aligned start of the bucket a given open_time falls into. */
export function bucketStartTime(openTime: number, interval: Interval): number {
  const size = INTERVAL_MS[interval];
  return Math.floor(openTime / size) * size;
}

/** How many 1-minute candles a fully-populated bucket of this interval holds. */
export function expectedOneMinuteCount(interval: Interval): number {
  return INTERVAL_MS[interval] / ONE_MINUTE_MS;
}
