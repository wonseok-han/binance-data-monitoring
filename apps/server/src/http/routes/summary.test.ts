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
const HOUR_MS = 60 * 60 * 1000;

describe('GET /api/summary', () => {
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

  it('returns 404 NO_DATA when the symbol has no candles yet', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/summary?symbol=${SYMBOL}` });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NO_DATA');
  });

  it('computes current price, 1h change, and 1h quote volume from stored candles', async () => {
    const start = Date.UTC(2024, 2, 1, 0, 0, 0);
    const rows = makeCandleSeries(SYMBOL, start, 61).map((candle, index) => ({
      ...candle,
      close: String(100 + index),
      quoteVolume: '10',
    }));
    upsertCandles(dbHandle.db, rows);

    const response = await app.inject({ method: 'GET', url: `/api/summary?symbol=${SYMBOL}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.currentPrice).toBe('160');
    expect(body.asOf).toBe(start + HOUR_MS);
    expect(body.changePercent1h).toBeCloseTo(60, 5);
    expect(Number(body.quoteVolume1h)).toBe(600);
  });
});
