import type { Interval } from '@binance-monitoring/shared';

export type { Interval };

const ONE_MINUTE_MS = 60_000;

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': ONE_MINUTE_MS,
  '6h': 6 * 60 * ONE_MINUTE_MS,
  '1d': 24 * 60 * ONE_MINUTE_MS,
};

/** 주어진 open_time이 속한 버킷의 UTC 정렬 시작 시각. */
export function bucketStartTime(openTime: number, interval: Interval): number {
  const size = INTERVAL_MS[interval];
  return Math.floor(openTime / size) * size;
}

/** 이 봉 주기의 버킷이 빠짐없이 채워졌을 때 포함하는 1분봉 개수. */
export function expectedOneMinuteCount(interval: Interval): number {
  return INTERVAL_MS[interval] / ONE_MINUTE_MS;
}
