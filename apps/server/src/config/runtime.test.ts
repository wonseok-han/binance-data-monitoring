import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from './runtime.js';

const baseEnv = {
  PORT: '3000',
  DATABASE_URL: './data/market.db',
  BINANCE_REST_URL: 'https://api.binance.com',
  BINANCE_WS_URL: 'wss://stream.binance.com:9443',
  LOG_LEVEL: 'info',
};

describe('loadRuntimeConfig', () => {
  it('parses a valid environment', () => {
    const config = loadRuntimeConfig(baseEnv);

    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBe('./data/market.db');
    expect(config.BINANCE_REST_URL).toBe('https://api.binance.com');
    expect(config.BINANCE_WS_URL).toBe('wss://stream.binance.com:9443');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('applies defaults when optional variables are missing', () => {
    const config = loadRuntimeConfig({});

    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBe('./data/market.db');
    expect(config.BINANCE_REST_URL).toBe('https://api.binance.com');
    expect(config.BINANCE_WS_URL).toBe('wss://stream.binance.com:9443');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.corsOrigin).toBe(true);
  });

  it('throws when BINANCE_REST_URL is not a valid URL', () => {
    expect(() => loadRuntimeConfig({ ...baseEnv, BINANCE_REST_URL: 'not-a-url' })).toThrow();
  });

  describe('CORS_ORIGIN', () => {
    it('defaults to allowing any origin', () => {
      const config = loadRuntimeConfig(baseEnv);
      expect(config.corsOrigin).toBe(true);
    });

    it('parses "*" as allow-any', () => {
      const config = loadRuntimeConfig({ ...baseEnv, CORS_ORIGIN: '*' });
      expect(config.corsOrigin).toBe(true);
    });

    it('parses a comma-separated list into an explicit allow-list', () => {
      const config = loadRuntimeConfig({
        ...baseEnv,
        CORS_ORIGIN: 'https://app.example.com, https://staging.example.com',
      });
      expect(config.corsOrigin).toEqual(['https://app.example.com', 'https://staging.example.com']);
    });

    it('throws when CORS_ORIGIN resolves to an empty list', () => {
      expect(() => loadRuntimeConfig({ ...baseEnv, CORS_ORIGIN: ' , ,' })).toThrow(/CORS_ORIGIN/);
    });
  });
});
