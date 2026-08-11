import { assertPolicyInvariants, loadRuntimeConfig, loadServerEnv, policy } from './config/index.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './http/app.js';
import { createBinanceRestClient } from './collector/binanceRest.js';
import { createWsFactory } from './collector/binanceWs.js';
import { startCollector } from './collector/collector.js';
import { startHistoricalBackfillWorker } from './backfill/historicalWorker.js';
import type { HistoricalBackfillWorker } from './backfill/historicalWorker.js';
import { createLoggingBackfillFailureNotifier } from './backfill/notifier.js';
import { createEventBus } from './events/bus.js';
import { createSseRegistry } from './http/sseRegistry.js';
import { startRetentionCleanup } from './retention/cleanup.js';
import { buildSymbolStatus } from './status/status.js';
import { createShutdownHandler } from './shutdown.js';

loadServerEnv();
assertPolicyInvariants();

const config = loadRuntimeConfig();
const dbHandle = createDb(config.DATABASE_URL);
runMigrations(dbHandle);

const events = createEventBus();
const sse = createSseRegistry();
const app = buildApp({ db: dbHandle, config, events, sse });

const restClient = createBinanceRestClient({ baseUrl: config.BINANCE_REST_URL });
const wsFactory = createWsFactory();

const collectorLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => app.log.info(meta ?? {}, msg),
  error: (msg: string, meta?: Record<string, unknown>) => app.log.error(meta ?? {}, msg),
};
// 실패 알림 어댑터를 이 한 곳에서만 결정한다. Webhook/Sentry/Prometheus 등
// 실제 연동이 필요해지면 여기서 createLoggingBackfillFailureNotifier 대신
// 새 어댑터로 교체하면 되고, historicalWorker는 수정할 필요가 없다.
const backfillFailureNotifier = createLoggingBackfillFailureNotifier(collectorLogger);

// 종목별로 실시간 전환(onFirstLive) 이후 시작되므로, 기동 시점에는 비어 있다가
// 점점 채워진다. graceful shutdown이 그 시점의 전체 목록을 정지시켜야 하므로
// 스냅샷 복사 없이 이 배열 자체를 참조해야 한다.
const historicalWorkers: HistoricalBackfillWorker[] = [];

const collectors = policy.symbols.map((symbol) =>
  startCollector(symbol, {
    db: dbHandle.db,
    fetchKlines: restClient.fetchKlines,
    wsFactory,
    wsBaseUrl: config.BINANCE_WS_URL,
    backfillHours: policy.backfill.warmupHours,
    staleAfterSeconds: policy.collector.staleAfterSeconds,
    events,
    logger: collectorLogger,
    onFirstLive: () => {
      historicalWorkers.push(
        startHistoricalBackfillWorker(symbol, {
          db: dbHandle.db,
          fetchKlines: restClient.fetchKlines,
          backfillDays: policy.backfill.days,
          logger: collectorLogger,
          notifier: backfillFailureNotifier,
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
  symbols: policy.symbols,
  retentionDays: policy.retention.days,
  cleanupIntervalHours: policy.retention.cleanupIntervalHours,
  logger: collectorLogger,
});

const historicalWorkersController = {
  stop: async () => {
    await Promise.all(historicalWorkers.map((worker) => worker.stop()));
  },
};

const shutdown = createShutdownHandler({
  collectors: [...collectors, retention, historicalWorkersController],
  closeSseClients: () => sse.closeAll(),
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
