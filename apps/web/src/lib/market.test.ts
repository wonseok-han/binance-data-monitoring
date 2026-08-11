import { describe, expect, it } from 'vitest';
import {
  backfillStatusLabel,
  completenessPercentage,
  formatChartTime,
  formatChartTooltip,
  formatLag,
  formatPercent,
  formatUtcDate,
  intervalLabel,
  intervalLimit,
  mergeCandles,
} from './market';
import type { Candle } from '@binance-monitoring/shared';

function candle(openTime: number, close = String(openTime)): Candle {
  return {
    symbol: 'BTCUSDT',
    openTime,
    closeTime: openTime + 59_999,
    open: '1',
    high: '2',
    low: '0.5',
    close,
    volume: '1',
    quoteVolume: '1',
    tradeCount: 1,
    isClosed: true,
    updatedAt: openTime + 60_000,
  };
}

describe('completenessPercentage', () => {
  it('uses server-confirmed 24 hour counts', () => {
    expect(completenessPercentage({ expected: 1440, confirmed: 1439, missing: 1 })).toBeCloseTo(
      99.93,
      2,
    );
  });

  it('returns zero before status data is available', () => {
    expect(completenessPercentage(undefined)).toBe(0);
  });
});

describe('interval presentation', () => {
  it('provides Korean labels for actual candle intervals', () => {
    expect(intervalLabel('1m')).toBe('1분봉');
    expect(intervalLabel('6h')).toBe('6시간봉');
    expect(intervalLabel('1d')).toBe('일봉');
    expect(intervalLimit('1d')).toBe(120);
  });

  it('includes the date on daily chart ticks', () => {
    expect(formatChartTime(Date.UTC(2026, 7, 10), '1d')).toContain('08');
  });

  it('shows UTC date boundaries and six-hour ticks with a full tooltip', () => {
    expect(formatChartTime(Date.UTC(2026, 7, 10, 0), '6h')).toBe('08.10');
    expect(formatChartTime(Date.UTC(2026, 7, 10, 6), '6h')).toBe('06');
    expect(formatChartTime(Date.UTC(2026, 7, 10, 12), '6h')).toBe('12');
    expect(formatChartTime(Date.UTC(2026, 7, 10, 18), '6h')).toBe('18');
    expect(formatChartTooltip(Date.UTC(2026, 7, 10, 6), '6h')).toBe(
      '2026.08.10 06:00 UTC',
    );
  });
});

describe('mergeCandles', () => {
  it('prepends older candles, removes duplicate open times, and keeps updates', () => {
    const result = mergeCandles(
      [candle(120_000, 'old'), candle(180_000)],
      [candle(60_000), candle(120_000, 'updated')],
    );

    expect(result.map((item) => item.openTime)).toEqual([60_000, 120_000, 180_000]);
    expect(result[1]?.close).toBe('updated');
  });
});

describe('formatters', () => {
  it('formats freshness for realtime, seconds, and minutes', () => {
    expect(formatLag(500)).toBe('실시간');
    expect(formatLag(12_000)).toBe('12초');
    expect(formatLag(125_000)).toBe('2분');
  });

  it('formats signed percentages and missing values', () => {
    expect(formatPercent(1.234)).toBe('+1.23%');
    expect(formatPercent(-0.5)).toBe('-0.50%');
    expect(formatPercent(null)).toBe('—');
  });

  it('formats UTC coverage dates and backfill status labels', () => {
    expect(formatUtcDate(Date.UTC(2026, 7, 10))).toBe('2026.08.10');
    expect(backfillStatusLabel('retrying')).toBe('재시도 대기');
    expect(backfillStatusLabel('failed')).toBe('확인 필요');
  });
});
