import type { RawCandle } from '../../src/collector/binanceRest.js';
import { MINUTE_MS } from '../../src/config/constants.js';

export function makeCandle(symbol: string, openTime: number, overrides: Partial<RawCandle> = {}): RawCandle {
  return {
    symbol,
    openTime,
    closeTime: openTime + MINUTE_MS - 1,
    open: '100.00',
    high: '101.00',
    low: '99.00',
    close: '100.50',
    volume: '10.5',
    quoteVolume: '1050.0',
    tradeCount: 42,
    isClosed: true,
    ...overrides,
  };
}

export function makeCandleSeries(symbol: string, startTime: number, count: number): RawCandle[] {
  return Array.from({ length: count }, (_, index) => makeCandle(symbol, startTime + index * MINUTE_MS));
}

export function createFixtureFetchKlines(all: RawCandle[]) {
  return async ({
    symbol,
    startTime,
    endTime,
    limit,
  }: {
    symbol: string;
    startTime: number;
    endTime: number;
    limit?: number;
  }): Promise<RawCandle[]> => {
    return all
      .filter((candle) => candle.symbol === symbol && candle.openTime >= startTime && candle.openTime <= endTime)
      .sort((a, b) => a.openTime - b.openTime)
      .slice(0, limit ?? all.length);
  };
}
