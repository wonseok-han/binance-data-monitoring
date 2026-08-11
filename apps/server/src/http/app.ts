import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DbHandle } from '../db/client.js';
import type { RuntimeConfig } from '../config/index.js';
import type { EventBus } from '../events/bus.js';
import type { SseRegistry } from './sseRegistry.js';
import { ApiError, sendApiError } from './errors.js';
import { registerCandlesRoute } from './routes/candles.js';
import { registerStatusRoute } from './routes/status.js';
import { registerSummaryRoute } from './routes/summary.js';
import { registerEventsRoute } from './routes/events.js';

export interface AppDeps {
  db: DbHandle;
  config: RuntimeConfig;
  events: EventBus;
  sse: SseRegistry;
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

  // Liveness: 프로세스가 살아있고 이벤트 루프가 응답하는지만 확인한다. DB에
  // 접근하지 않으므로 SQLite가 일시적으로 바쁘다는 이유로 실패하지 않는다.
  app.get('/health/live', async () => {
    return { status: 'ok' as const };
  });

  // Readiness: 프로세스가 실제로 요청을 처리할 수 있는지(DB 접근 가능) 확인한다.
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
