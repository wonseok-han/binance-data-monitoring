import type { Candle } from '@binance-monitoring/shared';
import { describe, expect, it } from 'vitest';
import { calculateCompleteness, formatLag, formatPercent, MINUTE_MS } from './market';

const NOW = Date.UTC(2026, 7, 10, 12, 30, 30);
const CURRENT_MINUTE = Math.floor(NOW / MINUTE_MS) * MINUTE_MS;

function candle(openTime: number, isClosed = true): Candle {
  return {
    symbol: 'BTCUSDT',
    openTime,
    closeTime: openTime + MINUTE_MS - 1,
    open: '100',
    high: '101',
    low: '99',
    close: '100',
    volume: '1',
    quoteVolume: '100',
    tradeCount: 10,
    isClosed,
    updatedAt: openTime + MINUTE_MS,
  };
}

describe('calculateCompleteness', () => {
  it('counts unique closed candles inside the selected completed range', () => {
    const candles = Array.from({ length: 60 }, (_, index) =>
      candle(CURRENT_MINUTE - (index + 1) * MINUTE_MS),
    );

    expect(calculateCompleteness(candles, 1, NOW)).toEqual({
      actual: 60,
      expected: 60,
      missing: 0,
      percentage: 100,
    });
  });

  it('excludes duplicates, in-progress candles, and candles outside the range', () => {
    const latestClosed = candle(CURRENT_MINUTE - MINUTE_MS);
    const result = calculateCompleteness(
      [
        latestClosed,
        latestClosed,
        candle(CURRENT_MINUTE, false),
        candle(CURRENT_MINUTE - 61 * MINUTE_MS),
      ],
      1,
      NOW,
    );

    expect(result.actual).toBe(1);
    expect(result.missing).toBe(59);
    expect(result.percentage).toBeCloseTo(1.67, 2);
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
});
