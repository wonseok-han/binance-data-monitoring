import type { Candle, ConnectionStatus } from '@binance-monitoring/shared';

export const SYMBOLS = ['BTCUSDT', 'ETHUSDT'] as const;
export const RANGE_OPTIONS = [1, 6, 24] as const;
export const MINUTE_MS = 60_000;

export type MarketSymbol = (typeof SYMBOLS)[number];
export type RangeHours = (typeof RANGE_OPTIONS)[number];

export interface Completeness {
  actual: number;
  expected: number;
  missing: number;
  percentage: number;
}

export function calculateCompleteness(
  candles: Candle[],
  rangeHours: RangeHours,
  now: number,
): Completeness {
  const currentMinute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const start = currentMinute - rangeHours * 60 * MINUTE_MS;
  const end = currentMinute - MINUTE_MS;
  const expected = rangeHours * 60;
  const actual = new Set(
    candles
      .filter((candle) => candle.isClosed && candle.openTime >= start && candle.openTime <= end)
      .map((candle) => candle.openTime),
  ).size;
  const missing = Math.max(0, expected - actual);

  return {
    actual,
    expected,
    missing,
    percentage: expected === 0 ? 0 : (actual / expected) * 100,
  };
}

export function formatPrice(value: string | number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatCompactUsdt(value: string | number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Number(value))} USDT`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatLag(value: number | null): string {
  if (value == null) return '—';
  if (value < 1_000) return '실시간';
  if (value < MINUTE_MS) return `${Math.floor(value / 1_000)}초`;
  return `${Math.floor(value / MINUTE_MS)}분`;
}

export function formatUtcTime(value: number | null): string {
  if (value == null) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

export function formatUtcDateTime(value: number | null): string {
  if (value == null) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

export function formatChartTime(value: number, rangeHours: RangeHours): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: rangeHours === 1 ? '2-digit' : undefined,
    hour12: false,
  }).format(value);
}

export function statusLabel(status: ConnectionStatus): string {
  return {
    connecting: '연결 중',
    live: '정상 수집',
    reconnecting: '재연결 중',
    stale: '데이터 지연',
  }[status];
}
