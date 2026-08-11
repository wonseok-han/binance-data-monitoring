import type { Candle, Interval } from '@binance-monitoring/shared';

const SIX_HOUR_TICK_WIDTH = 120;
const MIN_SIX_HOUR_BARS = 4;
const MAX_SIX_HOUR_BARS = 8;

export interface FinancialCandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumePoint {
  time: number;
  value: number;
  color: string;
}

export function preserveVisibleRangeAfterPrepend(
  range: { from: number; to: number },
  prependedCount: number,
): { from: number; to: number } {
  return {
    from: range.from + prependedCount,
    to: range.to + prependedCount,
  };
}

export function initialVisibleLogicalRange(
  candleCount: number,
  interval: Interval,
  width: number,
): { from: number; to: number } | null {
  if (interval !== '6h' || candleCount <= 1) return null;
  const barsForWidth = Math.floor(width / SIX_HOUR_TICK_WIDTH);
  const visibleBars = Math.min(
    candleCount,
    MAX_SIX_HOUR_BARS,
    Math.max(MIN_SIX_HOUR_BARS, barsForWidth),
  );
  return { from: candleCount - visibleBars, to: candleCount + 2 };
}

export function toFinancialChartData(candles: Candle[]): {
  candlesticks: FinancialCandlePoint[];
  volumes: VolumePoint[];
} {
  const ordered = [...candles].sort((left, right) => left.openTime - right.openTime);
  const candlesticks: FinancialCandlePoint[] = [];
  const volumes: VolumePoint[] = [];

  for (const candle of ordered) {
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.quoteVolume);
    if (![open, high, low, close, volume].every(Number.isFinite)) continue;

    const time = Math.floor(candle.openTime / 1_000);
    candlesticks.push({ time, open, high, low, close });
    volumes.push({
      time,
      value: volume,
      color: close >= open ? 'rgba(55, 201, 155, 0.38)' : 'rgba(255, 107, 120, 0.38)',
    });
  }

  return { candlesticks, volumes };
}
