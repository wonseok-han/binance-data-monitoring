import 'dotenv/config';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './http/app.js';
import { createBinanceRestClient } from './collector/binanceRest.js';
import { createWsFactory } from './collector/binanceWs.js';
import { startCollector } from './collector/collector.js';

const config = loadConfig();
const dbHandle = createDb(config.DATABASE_URL);
runMigrations(dbHandle);

const app = buildApp({ db: dbHandle, config });

const restClient = createBinanceRestClient({ baseUrl: config.BINANCE_REST_URL });
const wsFactory = createWsFactory();

config.symbols.forEach((symbol) => {
  startCollector(symbol, {
    db: dbHandle.db,
    fetchKlines: restClient.fetchKlines,
    wsFactory,
    wsBaseUrl: config.BINANCE_WS_URL,
    backfillHours: config.BACKFILL_HOURS,
    staleAfterSeconds: config.STALE_AFTER_SECONDS,
    logger: {
      info: (msg, meta) => app.log.info(meta ?? {}, msg),
      error: (msg, meta) => app.log.error(meta ?? {}, msg),
    },
  });
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });
