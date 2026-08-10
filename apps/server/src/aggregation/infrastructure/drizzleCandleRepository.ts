import type { DbHandle } from '../../db/client.js';
import { getCandlesInRange, queryCandles } from '../../db/candles.js';
import type { CandleRepositoryPort } from '../domain/ports.js';

export function createDrizzleCandleRepository(db: DbHandle['db']): CandleRepositoryPort {
  return {
    getRecentOneMinuteCandles({ symbol, from, to, limit }) {
      return queryCandles(db, symbol, { from, to, limit });
    },
    getOneMinuteCandlesInRange(symbol, from, to) {
      return getCandlesInRange(db, symbol, from, to);
    },
  };
}
