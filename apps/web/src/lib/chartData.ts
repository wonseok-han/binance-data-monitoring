import type { Candle } from '@binance-monitoring/shared';

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
