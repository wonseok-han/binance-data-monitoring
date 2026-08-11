import type { FastifyInstance } from 'fastify';
import { buildStatus } from '../../status/status.js';
import { policy } from '../../config/index.js';
import type { AppDeps } from '../app.js';

export function registerStatusRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/status', async () => {
    const symbols = buildStatus(deps.db.db, policy.symbols, Date.now());
    return { symbols };
  });
}
