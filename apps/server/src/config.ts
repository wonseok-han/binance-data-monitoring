import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('./data/market.db'),
  BINANCE_REST_URL: z.string().url().default('https://api.binance.com'),
  BINANCE_WS_URL: z.string().url().default('wss://stream.binance.com:9443'),
  SYMBOLS: z.string().min(1).default('BTCUSDT,ETHUSDT'),

  // 백필/보존
  BACKFILL_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().positive().default(6),

  // 수집기 재시도/재연결
  STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(10),
  RECONNECT_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
  RECONNECT_MAX_DELAY_MS: z.coerce.number().int().positive().default(30_000),
  BINANCE_REST_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  BINANCE_REST_RETRY_DELAY_MS: z.coerce.number().int().positive().default(500),

  // HTTP
  SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),
  CORS_ORIGIN: z.string().min(1).default('*'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface AppConfig {
  PORT: number;
  DATABASE_URL: string;
  BINANCE_REST_URL: string;
  BINANCE_WS_URL: string;
  BACKFILL_DAYS: number;
  RETENTION_DAYS: number;
  RETENTION_CLEANUP_INTERVAL_HOURS: number;
  STALE_AFTER_SECONDS: number;
  RECONNECT_BASE_DELAY_MS: number;
  RECONNECT_MAX_DELAY_MS: number;
  BINANCE_REST_MAX_RETRIES: number;
  BINANCE_REST_RETRY_DELAY_MS: number;
  SSE_HEARTBEAT_MS: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  symbols: string[];
  /** `true` allows any origin (CORS_ORIGIN="*"); otherwise the exact allow-list. */
  corsOrigin: true | string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  const symbols = Array.from(
    new Set(
      parsed.SYMBOLS.split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => symbol.length > 0),
    ),
  );

  if (symbols.length === 0) {
    throw new Error('SYMBOLS must contain at least one symbol');
  }

  const corsOrigin =
    parsed.CORS_ORIGIN === '*'
      ? (true as const)
      : parsed.CORS_ORIGIN.split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);

  if (corsOrigin !== true && corsOrigin.length === 0) {
    throw new Error('CORS_ORIGIN must be "*" or a comma-separated list of origins');
  }

  return { ...parsed, symbols, corsOrigin };
}
