import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DbHandle } from '../db/client.js';
import type { AppConfig } from '../config.js';
import type { EventBus } from '../events/bus.js';
import { ApiError, sendApiError } from './errors.js';
import { registerCandlesRoute } from './routes/candles.js';
import { registerStatusRoute } from './routes/status.js';
import { registerSummaryRoute } from './routes/summary.js';
import { registerEventsRoute } from './routes/events.js';

export interface AppDeps {
  db: DbHandle;
  config: AppConfig;
  events: EventBus;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: deps.config.LOG_LEVEL } });

  app.register(cors, { origin: deps.config.corsOrigin });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      sendApiError(reply, error);
      return;
    }
    request.log.error(error);
    reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
  });

  // Liveness: the process is up and the event loop is responsive. No DB access,
  // so it never fails just because SQLite is momentarily busy.
  app.get('/health/live', async () => {
    return { status: 'ok' as const };
  });

  // Readiness: the process can actually serve requests (DB reachable).
  app.get('/health/ready', async () => {
    deps.db.sqlite.prepare('SELECT 1').get();
    return { status: 'ok' as const };
  });

  registerCandlesRoute(app, deps);
  registerStatusRoute(app, deps);
  registerSummaryRoute(app, deps);
  registerEventsRoute(app, deps);

  return app;
}
