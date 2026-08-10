import { describe, expect, it } from 'vitest';
import {
  completenessPercentage,
  formatChartTime,
  formatLag,
  formatPercent,
  intervalLabel,
} from './market';

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
  });

  it('includes the date on daily chart ticks', () => {
    expect(formatChartTime(Date.UTC(2026, 7, 10), '1d')).toContain('08');
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
