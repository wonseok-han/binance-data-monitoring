import type { FastifyInstance } from 'fastify';
import { buildSummary } from '../summary.js';
import { ApiError } from '../errors.js';
import { parseSymbol } from '../validation.js';
import type { AppDeps } from '../app.js';
import { policy } from '../../config/index.js';

export function registerSummaryRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/summary', async (request) => {
    const query = request.query as Record<string, unknown>;
    const symbol = parseSymbol(query.symbol, policy.symbols);

    const summary = buildSummary(deps.db.db, symbol);
    if (!summary) {
      throw new ApiError(404, 'NO_DATA', `no candle data available yet for ${symbol}`);
    }

    return summary;
  });
}
