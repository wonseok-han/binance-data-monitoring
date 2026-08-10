import type { FastifyInstance } from 'fastify';
import { buildStatus } from '../status.js';
import type { AppDeps } from '../app.js';

export function registerStatusRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/status', async () => {
    const symbols = buildStatus(deps.db.db, deps.config.symbols, Date.now());
    return { symbols };
  });
}
