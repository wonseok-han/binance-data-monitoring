import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../../db/client.js';
import { upsertCandles } from '../../db/candles.js';
import { createTestDb } from '../../../test/helpers/db.js';
import { makeCandleSeries } from '../../../test/fixtures/candles.js';
import { loadConfig } from '../../config/env.js';
import { createEventBus } from '../../events/bus.js';
import { MINUTE_MS } from '../../config/constants.js';
import { createSseRegistry } from '../sseRegistry.js';
import { buildApp } from '../app.js';

const SYMBOL = 'BTCUSDT';

describe('GET /api/candles', () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;

  beforeEach(() => {
    dbHandle = createTestDb();
    app = buildApp({ db: dbHandle, config: loadConfig({}), events: createEventBus(), sse: createSseRegistry() });
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
    expect(body.page).toEqual({ nextBefore: start + 2 * MINUTE_MS - 1, hasMore: true });
  });

  it('walks the full history backward via page.nextBefore with no gaps or duplicates', async () => {
    const start = Date.UTC(2024, 2, 1, 0, 0, 0);
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start, 5));

    const firstPage = await app.inject({ method: 'GET', url: `/api/candles?symbol=${SYMBOL}&limit=3` });
    const firstBody = firstPage.json();
    expect(firstBody.page.hasMore).toBe(true);

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/candles?symbol=${SYMBOL}&limit=3&to=${firstBody.page.nextBefore}`,
    });
    const secondBody = secondPage.json();

    expect(secondBody.candles.map((c: { openTime: number }) => c.openTime)).toEqual([start, start + MINUTE_MS]);
    expect(secondBody.page).toEqual({ nextBefore: start - 1, hasMore: false });

    const allOpenTimes = [...secondBody.candles, ...firstBody.candles].map((c: { openTime: number }) => c.openTime);
    expect(new Set(allOpenTimes).size).toBe(5); // no duplicates across pages
  });

  it('reports hasMore=false once the full range fits in one page', async () => {
    const start = Date.UTC(2024, 2, 1, 0, 0, 0);
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start, 2));

    const response = await app.inject({ method: 'GET', url: `/api/candles?symbol=${SYMBOL}&limit=10` });
    const body = response.json();

    expect(body.page).toEqual({ nextBefore: start - 1, hasMore: false });
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
    const bucketOpen = 6 * 60 * 60 * 1000 * 10; // 임의의 UTC 6시간 경계
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
