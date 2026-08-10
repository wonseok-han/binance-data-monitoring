import 'dotenv/config';
import { loadConfig } from './config/env.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './http/app.js';
import { createBinanceRestClient } from './collector/binanceRest.js';
import { createWsFactory } from './collector/binanceWs.js';
import { startCollector } from './collector/collector.js';
import { startHistoricalBackfillWorker } from './backfill/historicalWorker.js';
import type { HistoricalBackfillWorker } from './backfill/historicalWorker.js';
import { createEventBus } from './events/bus.js';
import { startRetentionCleanup } from './retention/cleanup.js';
import { buildSymbolStatus } from './status/status.js';
import { createShutdownHandler } from './shutdown.js';

const config = loadConfig();
const dbHandle = createDb(config.DATABASE_URL);
runMigrations(dbHandle);

const events = createEventBus();
const app = buildApp({ db: dbHandle, config, events });

const restClient = createBinanceRestClient({
  baseUrl: config.BINANCE_REST_URL,
  maxRetries: config.BINANCE_REST_MAX_RETRIES,
  retryDelayMs: config.BINANCE_REST_RETRY_DELAY_MS,
});
const wsFactory = createWsFactory();

const collectorLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => app.log.info(meta ?? {}, msg),
  error: (msg: string, meta?: Record<string, unknown>) => app.log.error(meta ?? {}, msg),
};

// 종목별로 실시간 전환(onFirstLive) 이후 시작되므로, 기동 시점에는 비어 있다가
// 점점 채워진다. graceful shutdown이 그 시점의 전체 목록을 정지시켜야 하므로
// 스냅샷 복사 없이 이 배열 자체를 참조해야 한다.
const historicalWorkers: HistoricalBackfillWorker[] = [];

const collectors = config.symbols.map((symbol) =>
  startCollector(symbol, {
    db: dbHandle.db,
    fetchKlines: restClient.fetchKlines,
    wsFactory,
    wsBaseUrl: config.BINANCE_WS_URL,
    backfillHours: config.BACKFILL_WARMUP_HOURS,
    staleAfterSeconds: config.STALE_AFTER_SECONDS,
    reconnectBaseDelayMs: config.RECONNECT_BASE_DELAY_MS,
    reconnectMaxDelayMs: config.RECONNECT_MAX_DELAY_MS,
    events,
    logger: collectorLogger,
    onFirstLive: () => {
      historicalWorkers.push(
        startHistoricalBackfillWorker(symbol, {
          db: dbHandle.db,
          fetchKlines: restClient.fetchKlines,
          backfillDays: config.BACKFILL_DAYS,
          logger: collectorLogger,
          onProgress: () => {
            events.emitStatus(symbol, buildSymbolStatus(dbHandle.db, symbol, Date.now()));
          },
        }),
      );
    },
  }),
);

const retention = startRetentionCleanup({
  db: dbHandle.db,
  symbols: config.symbols,
  retentionDays: config.RETENTION_DAYS,
  cleanupIntervalHours: config.RETENTION_CLEANUP_INTERVAL_HOURS,
  logger: collectorLogger,
});

const historicalWorkersController = {
  stop: async () => {
    await Promise.all(historicalWorkers.map((worker) => worker.stop()));
  },
};

const shutdown = createShutdownHandler({
  collectors: [...collectors, retention, historicalWorkersController],
  closeApp: () => app.close(),
  closeDb: () => dbHandle.sqlite.close(),
  logger: collectorLogger,
});

const handleSignal = (signal: NodeJS.Signals): void => {
  shutdown(signal)
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      app.log.error({ error: String(error) }, 'shutdown failed');
      process.exit(1);
    });
};

process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGINT', () => handleSignal('SIGINT'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
