import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const baseEnv = {
  PORT: '3000',
  DATABASE_URL: './data/market.db',
  BINANCE_REST_URL: 'https://api.binance.com',
  BINANCE_WS_URL: 'wss://stream.binance.com:9443',
  SYMBOLS: 'BTCUSDT,ETHUSDT',
  BACKFILL_DAYS: '365',
  BACKFILL_WARMUP_HOURS: '24',
  RETENTION_DAYS: '365',
  STALE_AFTER_SECONDS: '10',
  LOG_LEVEL: 'info',
};

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const config = loadConfig(baseEnv);

    expect(config.PORT).toBe(3000);
    expect(config.BACKFILL_DAYS).toBe(365);
    expect(config.BACKFILL_WARMUP_HOURS).toBe(24);
    expect(config.RETENTION_DAYS).toBe(365);
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
    expect(config.BACKFILL_DAYS).toBe(365);
    expect(config.BACKFILL_WARMUP_HOURS).toBe(24);
    expect(config.RETENTION_DAYS).toBe(365);
    expect(config.RETENTION_CLEANUP_INTERVAL_HOURS).toBe(6);
    expect(config.RECONNECT_BASE_DELAY_MS).toBe(1000);
    expect(config.RECONNECT_MAX_DELAY_MS).toBe(30_000);
    expect(config.BINANCE_REST_MAX_RETRIES).toBe(3);
    expect(config.BINANCE_REST_RETRY_DELAY_MS).toBe(500);
    expect(config.SSE_HEARTBEAT_MS).toBe(15_000);
    expect(config.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('throws when BINANCE_REST_URL is not a valid URL', () => {
    expect(() => loadConfig({ ...baseEnv, BINANCE_REST_URL: 'not-a-url' })).toThrow();
  });

  it('throws when SYMBOLS resolves to an empty list', () => {
    expect(() => loadConfig({ ...baseEnv, SYMBOLS: ' , ,' })).toThrow(/SYMBOLS/);
  });

  describe('RETENTION_DAYS vs BACKFILL_DAYS', () => {
    it('throws when RETENTION_DAYS is shorter than BACKFILL_DAYS', () => {
      expect(() =>
        loadConfig({ ...baseEnv, BACKFILL_DAYS: '365', RETENTION_DAYS: '30' }),
      ).toThrow(/RETENTION_DAYS/);
    });

    it('accepts RETENTION_DAYS equal to BACKFILL_DAYS', () => {
      const config = loadConfig({ ...baseEnv, BACKFILL_DAYS: '30', RETENTION_DAYS: '30' });
      expect(config.RETENTION_DAYS).toBe(30);
    });

    it('accepts RETENTION_DAYS longer than BACKFILL_DAYS', () => {
      const config = loadConfig({ ...baseEnv, BACKFILL_DAYS: '30', RETENTION_DAYS: '365' });
      expect(config.RETENTION_DAYS).toBe(365);
    });
  });

  describe('CORS_ORIGIN', () => {
    it('defaults to allowing any origin', () => {
      const config = loadConfig(baseEnv);
      expect(config.corsOrigin).toBe(true);
    });

    it('parses "*" as allow-any', () => {
      const config = loadConfig({ ...baseEnv, CORS_ORIGIN: '*' });
      expect(config.corsOrigin).toBe(true);
    });

    it('parses a comma-separated list into an explicit allow-list', () => {
      const config = loadConfig({
        ...baseEnv,
        CORS_ORIGIN: 'https://app.example.com, https://staging.example.com',
      });
      expect(config.corsOrigin).toEqual(['https://app.example.com', 'https://staging.example.com']);
    });

    it('throws when CORS_ORIGIN resolves to an empty list', () => {
      expect(() => loadConfig({ ...baseEnv, CORS_ORIGIN: ' , ,' })).toThrow(/CORS_ORIGIN/);
    });
  });
});
