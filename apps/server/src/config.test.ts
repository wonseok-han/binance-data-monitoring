import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const baseEnv = {
  PORT: '3000',
  DATABASE_URL: './data/market.db',
  BINANCE_REST_URL: 'https://api.binance.com',
  BINANCE_WS_URL: 'wss://stream.binance.com:9443',
  SYMBOLS: 'BTCUSDT,ETHUSDT',
  BACKFILL_HOURS: '24',
  STALE_AFTER_SECONDS: '10',
  LOG_LEVEL: 'info',
};

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const config = loadConfig(baseEnv);

    expect(config.PORT).toBe(3000);
    expect(config.BACKFILL_HOURS).toBe(24);
    expect(config.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('normalizes symbols to trimmed, uppercase, de-duplicated values', () => {
    const config = loadConfig({ ...baseEnv, SYMBOLS: ' btcusdt , ETHUSDT,btcusdt ' });

    expect(config.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('applies defaults when optional variables are missing', () => {
    const config = loadConfig({});

    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBe('./data/market.db');
    expect(config.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('throws when BINANCE_REST_URL is not a valid URL', () => {
    expect(() => loadConfig({ ...baseEnv, BINANCE_REST_URL: 'not-a-url' })).toThrow();
  });

  it('throws when SYMBOLS resolves to an empty list', () => {
    expect(() => loadConfig({ ...baseEnv, SYMBOLS: ' , ,' })).toThrow(/SYMBOLS/);
  });
});
