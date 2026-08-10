import { IntervalSchema, type Interval } from '@binance-monitoring/shared';
import { ApiError } from './errors.js';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const DEFAULT_INTERVAL: Interval = '1m';

export function parseSymbol(raw: unknown, allowedSymbols: string[]): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ApiError(400, 'INVALID_SYMBOL', 'symbol query parameter is required');
  }

  const symbol = raw.trim().toUpperCase();
  if (!allowedSymbols.includes(symbol)) {
    throw new ApiError(400, 'INVALID_SYMBOL', `symbol must be one of: ${allowedSymbols.join(', ')}`);
  }

  return symbol;
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LIMIT;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, 'INVALID_LIMIT', 'limit must be a positive integer');
  }
  if (value > MAX_LIMIT) {
    throw new ApiError(400, 'INVALID_LIMIT', `limit must not exceed ${MAX_LIMIT}`);
  }

  return value;
}

export function parseInterval(raw: unknown): Interval {
  if (raw === undefined) return DEFAULT_INTERVAL;

  const result = IntervalSchema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, 'INVALID_INTERVAL', 'interval must be one of: 1m, 6h, 1d');
  }

  return result.data;
}

export function parseTimestamp(raw: unknown, field: string): number | undefined {
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ApiError(400, 'INVALID_TIMESTAMP', `${field} must be a unix millisecond timestamp`);
  }

  return value;
}
