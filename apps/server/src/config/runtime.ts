import { z } from 'zod';

const runtimeSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('./data/market.db'),
  BINANCE_REST_URL: z.string().url().default('https://api.binance.com'),
  BINANCE_WS_URL: z.string().url().default('wss://stream.binance.com:9443'),
  CORS_ORIGIN: z.string().min(1).default('*'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface RuntimeConfig {
  PORT: number;
  DATABASE_URL: string;
  BINANCE_REST_URL: string;
  BINANCE_WS_URL: string;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  /** `true`면 모든 origin을 허용한다(`CORS_ORIGIN=*`); 그 외에는 정확한 허용 목록. */
  corsOrigin: true | string[];
}

/**
 * 배포 환경에 따라 달라지는 인프라 설정만 환경변수에서 읽는다. 종목,
 * 백필·보존 기간, 재시도·재연결 정책처럼 배포와 무관한 제품 정책은
 * `policy.ts`를 본다.
 */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = runtimeSchema.parse(env);

  const corsOrigin =
    parsed.CORS_ORIGIN === '*'
      ? (true as const)
      : parsed.CORS_ORIGIN.split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);

  if (corsOrigin !== true && corsOrigin.length === 0) {
    throw new Error('CORS_ORIGIN must be "*" or a comma-separated list of origins');
  }

  return {
    PORT: parsed.PORT,
    DATABASE_URL: parsed.DATABASE_URL,
    BINANCE_REST_URL: parsed.BINANCE_REST_URL,
    BINANCE_WS_URL: parsed.BINANCE_WS_URL,
    LOG_LEVEL: parsed.LOG_LEVEL,
    corsOrigin,
  };
}
