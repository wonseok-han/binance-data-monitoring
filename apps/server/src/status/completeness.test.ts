import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../db/client.js';
import { upsertCandles } from '../db/candles.js';
import { createTestDb } from '../../test/helpers/db.js';
import { makeCandleSeries } from '../../test/fixtures/candles.js';
import { lastCompletedOpenTime } from '../collector/backfill.js';
import { computeCompleteness24h, EXPECTED_24H_CANDLES } from './completeness.js';

const SYMBOL = 'BTCUSDT';
const MINUTE_MS = 60_000;
const NOW = Date.UTC(2024, 2, 2, 0, 0, 37, 123);

describe('computeCompleteness24h', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
  });

  it('reports 1440 expected candles for the trailing 24h window', () => {
    const result = computeCompleteness24h(dbHandle.db, SYMBOL, NOW);
    expect(EXPECTED_24H_CANDLES).toBe(1440);
    expect(result.expected).toBe(1440);
  });

  it('reports fully confirmed with zero missing when every candle in the window is present and closed', () => {
    const end = lastCompletedOpenTime(NOW);
    const start = end - 24 * 60 * MINUTE_MS + MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start, 1440));

    const result = computeCompleteness24h(dbHandle.db, SYMBOL, NOW);

    expect(result.confirmed).toBe(1440);
    expect(result.missing).toBe(0);
  });

  it('counts a gap as missing even though its time window has already elapsed', () => {
    const end = lastCompletedOpenTime(NOW);
    const start = end - 24 * 60 * MINUTE_MS + MINUTE_MS;
    // only the first 1400 minutes were backfilled; the last 40 are a gap
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start, 1400));

    const result = computeCompleteness24h(dbHandle.db, SYMBOL, NOW);

    expect(result.confirmed).toBe(1400);
    expect(result.missing).toBe(40);
  });

  it('does not count an in-progress (unclosed) candle toward confirmed', () => {
    const end = lastCompletedOpenTime(NOW);
    const start = end - 24 * 60 * MINUTE_MS + MINUTE_MS;
    const rows = makeCandleSeries(SYMBOL, start, 1440);
    rows[rows.length - 1]!.isClosed = false;
    upsertCandles(dbHandle.db, rows);

    const result = computeCompleteness24h(dbHandle.db, SYMBOL, NOW);

    expect(result.confirmed).toBe(1439);
    expect(result.missing).toBe(1);
  });

  it('ignores candles outside the trailing 24h window', () => {
    const end = lastCompletedOpenTime(NOW);
    const start = end - 24 * 60 * MINUTE_MS + MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start - 10 * MINUTE_MS, 10)); // older than the window
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, start, 1440));

    const result = computeCompleteness24h(dbHandle.db, SYMBOL, NOW);

    expect(result.confirmed).toBe(1440);
  });
});
