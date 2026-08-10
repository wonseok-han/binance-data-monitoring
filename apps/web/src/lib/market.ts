import type { Candle, Completeness24h, ConnectionStatus, Interval } from '@binance-monitoring/shared';

export const MINUTE_MS = 60_000;

export type MarketSymbol = string;

export const INTERVAL_OPTIONS: ReadonlyArray<{ value: Interval; label: string; limit: number }> = [
  { value: '1m', label: '1분', limit: 360 },
  { value: '6h', label: '6시간', limit: 120 },
  { value: '1d', label: '일', limit: 120 },
];

export function mergeCandles(current: Candle[], incoming: Candle[]): Candle[] {
  const byOpenTime = new Map(current.map((candle) => [candle.openTime, candle]));
  for (const candle of incoming) byOpenTime.set(candle.openTime, candle);
  return [...byOpenTime.values()].sort((left, right) => left.openTime - right.openTime);
}

export function intervalLabel(interval: Interval): string {
  return `${INTERVAL_OPTIONS.find((option) => option.value === interval)?.label ?? interval}봉`;
}

export function intervalLimit(interval: Interval): number {
  return INTERVAL_OPTIONS.find((option) => option.value === interval)?.limit ?? 500;
}

export function completenessPercentage(completeness: Completeness24h | undefined): number {
  if (!completeness || completeness.expected === 0) return 0;
  return (completeness.confirmed / completeness.expected) * 100;
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

export function formatChartTime(value: number, interval: Interval): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: interval === '1d' ? '2-digit' : undefined,
    day: interval === '1d' ? '2-digit' : undefined,
    hour: interval === '1d' ? undefined : '2-digit',
    minute: interval === '1m' ? '2-digit' : undefined,
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
