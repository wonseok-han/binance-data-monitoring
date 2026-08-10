import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('./data/market.db'),
  BINANCE_REST_URL: z.string().url().default('https://api.binance.com'),
  BINANCE_WS_URL: z.string().url().default('wss://stream.binance.com:9443'),
  SYMBOLS: z.string().min(1).default('BTCUSDT,ETHUSDT'),
  BACKFILL_HOURS: z.coerce.number().int().positive().default(24),
  STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface AppConfig {
  PORT: number;
  DATABASE_URL: string;
  BINANCE_REST_URL: string;
  BINANCE_WS_URL: string;
  BACKFILL_HOURS: number;
  STALE_AFTER_SECONDS: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  symbols: string[];
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

  return { ...parsed, symbols };
}
