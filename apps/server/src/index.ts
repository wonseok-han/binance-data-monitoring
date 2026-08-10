import 'dotenv/config';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './http/app.js';
import { createBinanceRestClient } from './collector/binanceRest.js';
import { createWsFactory } from './collector/binanceWs.js';
import { startCollector } from './collector/collector.js';
import { createEventBus } from './events/bus.js';
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

const collectors = config.symbols.map((symbol) =>
  startCollector(symbol, {
    db: dbHandle.db,
    fetchKlines: restClient.fetchKlines,
    wsFactory,
    wsBaseUrl: config.BINANCE_WS_URL,
    backfillHours: config.BACKFILL_DAYS * 24,
    staleAfterSeconds: config.STALE_AFTER_SECONDS,
    reconnectBaseDelayMs: config.RECONNECT_BASE_DELAY_MS,
    reconnectMaxDelayMs: config.RECONNECT_MAX_DELAY_MS,
    events,
    logger: collectorLogger,
  }),
);

const shutdown = createShutdownHandler({
  collectors,
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
