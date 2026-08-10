import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';
import { parseInterval, parseLimit, parseSymbol, parseTimestamp } from '../validation.js';
import type { AppDeps } from '../app.js';
import { createGetCandlesUseCase } from '../../aggregation/application/getCandles.js';
import { createDrizzleCandleRepository } from '../../aggregation/infrastructure/drizzleCandleRepository.js';

export function registerCandlesRoute(app: FastifyInstance, deps: AppDeps): void {
  const getCandles = createGetCandlesUseCase({
    repository: createDrizzleCandleRepository(deps.db.db),
    now: Date.now,
  });

  app.get('/api/candles', async (request) => {
    const query = request.query as Record<string, unknown>;
    const symbol = parseSymbol(query.symbol, deps.config.symbols);
    const interval = parseInterval(query.interval);
    const limit = parseLimit(query.limit);
    const from = parseTimestamp(query.from, 'from');
    const to = parseTimestamp(query.to, 'to');

    if (from !== undefined && to !== undefined && from > to) {
      throw new ApiError(400, 'INVALID_RANGE', 'from must not be greater than to');
    }

    const candles = getCandles({ symbol, interval, from, to, limit });
    return { symbol, interval, candles };
  });
}
