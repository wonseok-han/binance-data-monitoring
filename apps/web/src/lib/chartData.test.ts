import type { Candle } from '@binance-monitoring/shared';
import { describe, expect, it } from 'vitest';
import { toFinancialChartData } from './chartData';

function candle(openTime: number, open: string, close: string): Candle {
  return {
    symbol: 'BTCUSDT',
    openTime,
    closeTime: openTime + 59_999,
    open,
    high: '110',
    low: '90',
    close,
    volume: '10',
    quoteVolume: '1000',
    tradeCount: 5,
    isClosed: true,
    updatedAt: openTime + 60_000,
  };
}

describe('toFinancialChartData', () => {
  it('sorts candles and maps milliseconds to chart seconds', () => {
    const result = toFinancialChartData([
      candle(120_000, '100', '95'),
      candle(60_000, '95', '100'),
    ]);

    expect(result.candlesticks.map((point) => point.time)).toEqual([60, 120]);
    expect(result.candlesticks[0]).toMatchObject({ open: 95, high: 110, low: 90, close: 100 });
  });

  it('colors volume by candle direction and ignores invalid values', () => {
    const invalid = { ...candle(180_000, 'invalid', '100') };
    const result = toFinancialChartData([
      candle(60_000, '95', '100'),
      candle(120_000, '100', '95'),
      invalid,
    ]);

    expect(result.volumes).toHaveLength(2);
    expect(result.volumes[0]?.color).toContain('55, 201, 155');
    expect(result.volumes[1]?.color).toContain('255, 107, 120');
  });
});
