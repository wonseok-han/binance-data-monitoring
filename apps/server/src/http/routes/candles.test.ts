import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../../db/client.js';
import { upsertCandles } from '../../db/candles.js';
import { createTestDb } from '../../../test/helpers/db.js';
import { makeCandleSeries } from '../../../test/fixtures/candles.js';
import { loadConfig } from '../../config.js';
import { createEventBus } from '../../events/bus.js';
import { buildApp } from '../app.js';

const SYMBOL = 'BTCUSDT';
const MINUTE_MS = 60_000;

describe('GET /api/candles', () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;

  beforeEach(() => {
    dbHandle = createTestDb();
    app = buildApp({ db: dbHandle, config: loadConfig({}), events: createEventBus() });
  });

  afterEach(async () => {
    await app.close();
    dbHandle.sqlite.close();
  });

  it('returns the most recent `limit` candles ascending by open_time', async () => {
    const start = Date.UTC(2024, 2, 1, 0, 0, 0);
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start, 5));

    const response = await app.inject({ method: 'GET', url: `/api/candles?symbol=${SYMBOL}&limit=3` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.symbol).toBe(SYMBOL);
    expect(body.candles.map((c: { openTime: number }) => c.openTime)).toEqual([
      start + 2 * MINUTE_MS,
      start + 3 * MINUTE_MS,
      start + 4 * MINUTE_MS,
    ]);
  });

  it('filters by the from/to range', async () => {
    const start = Date.UTC(2024, 2, 1, 0, 0, 0);
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start, 5));

    const response = await app.inject({
      method: 'GET',
      url: `/api/candles?symbol=${SYMBOL}&from=${start + MINUTE_MS}&to=${start + 2 * MINUTE_MS}`,
    });

    const body = response.json();
    expect(body.candles.map((c: { openTime: number }) => c.openTime)).toEqual([
      start + MINUTE_MS,
      start + 2 * MINUTE_MS,
    ]);
  });

  it('rejects a symbol outside the allow-list', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/candles?symbol=DOGEUSDT' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_SYMBOL');
  });

  it('rejects a limit above the 2000 maximum', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/candles?symbol=${SYMBOL}&limit=2001` });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_LIMIT');
  });

  it('rejects a from greater than to', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/candles?symbol=${SYMBOL}&from=200&to=100` });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_RANGE');
  });
});
