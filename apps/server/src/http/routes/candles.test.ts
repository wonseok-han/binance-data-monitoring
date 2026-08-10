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

  it('defaults to the 1m interval and echoes it in the response', async () => {
    const start = Date.UTC(2024, 2, 1, 0, 0, 0);
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start, 2));

    const response = await app.inject({ method: 'GET', url: `/api/candles?symbol=${SYMBOL}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().interval).toBe('1m');
  });

  it('aggregates into a single confirmed 6h bucket once all 360 underlying 1m candles are closed', async () => {
    const bucketOpen = 6 * 60 * 60 * 1000 * 10; // an arbitrary UTC 6h boundary
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, bucketOpen, 360));

    const response = await app.inject({
      method: 'GET',
      url: `/api/candles?symbol=${SYMBOL}&interval=6h&from=${bucketOpen}&to=${bucketOpen + 6 * 60 * 60 * 1000 - 1}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.interval).toBe('6h');
    expect(body.candles).toHaveLength(1);
    expect(body.candles[0]).toMatchObject({ openTime: bucketOpen, isClosed: true });
  });

  it('rejects an unsupported interval', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/candles?symbol=${SYMBOL}&interval=5m` });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_INTERVAL');
  });
});
