import type { FastifyInstance } from 'fastify';
import { queryCandles } from '../../db/candles.js';
import { ApiError } from '../errors.js';
import { parseLimit, parseSymbol, parseTimestamp } from '../validation.js';
import type { AppDeps } from '../app.js';

export function registerCandlesRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/candles', async (request) => {
    const query = request.query as Record<string, unknown>;
    const symbol = parseSymbol(query.symbol, deps.config.symbols);
    const limit = parseLimit(query.limit);
    const from = parseTimestamp(query.from, 'from');
    const to = parseTimestamp(query.to, 'to');

    if (from !== undefined && to !== undefined && from > to) {
      throw new ApiError(400, 'INVALID_RANGE', 'from must not be greater than to');
    }

    const candles = queryCandles(deps.db.db, symbol, { from, to, limit });
    return { symbol, candles };
  });
}
