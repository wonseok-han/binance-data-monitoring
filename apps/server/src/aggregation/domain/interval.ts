import type { Interval } from '@binance-monitoring/shared';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../config/constants.js';

export type { Interval };

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': MINUTE_MS,
  '6h': 6 * HOUR_MS,
  '1d': DAY_MS,
};

/** 주어진 open_time이 속한 버킷의 UTC 정렬 시작 시각. */
export function bucketStartTime(openTime: number, interval: Interval): number {
  const size = INTERVAL_MS[interval];
  return Math.floor(openTime / size) * size;
}

/** 이 봉 주기의 버킷이 빠짐없이 채워졌을 때 포함하는 1분봉 개수. */
export function expectedOneMinuteCount(interval: Interval): number {
  return INTERVAL_MS[interval] / MINUTE_MS;
}
