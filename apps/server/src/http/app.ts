import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DbHandle } from '../db/client.js';
import type { AppConfig } from '../config.js';

export interface AppDeps {
  db: DbHandle;
  config: AppConfig;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: deps.config.LOG_LEVEL } });

  app.register(cors, { origin: true });

  app.get('/health', async () => {
    deps.db.sqlite.prepare('SELECT 1').get();
    return { status: 'ok' as const };
  });

  return app;
}
