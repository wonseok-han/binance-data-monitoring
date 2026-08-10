import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from './client.js';
import { countCandles, deleteExpiredCandlesBatch, upsertCandles } from './candles.js';
import { createTestDb } from '../../test/helpers/db.js';
import { makeCandleSeries } from '../../test/fixtures/candles.js';

const SYMBOL = 'BTCUSDT';
const OTHER_SYMBOL = 'ETHUSDT';
const MINUTE_MS = 60_000;

describe('deleteExpiredCandlesBatch', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
  });

  it('deletes only candles strictly older than the cutoff', () => {
    const cutoff = 100 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, 0, 100)); // opens 0..99*MINUTE_MS, all < cutoff
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, cutoff, 5)); // opens >= cutoff, must survive

    const deleted = deleteExpiredCandlesBatch(dbHandle.db, SYMBOL, cutoff, 1000);

    expect(deleted).toBe(100);
    expect(countCandles(dbHandle.db, SYMBOL)).toBe(5);
  });

  it('respects batchSize, requiring multiple calls to fully clean a large backlog', () => {
    const cutoff = 100 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, 0, 100));

    const firstBatch = deleteExpiredCandlesBatch(dbHandle.db, SYMBOL, cutoff, 30);
    expect(firstBatch).toBe(30);
    expect(countCandles(dbHandle.db, SYMBOL)).toBe(70);

    const secondBatch = deleteExpiredCandlesBatch(dbHandle.db, SYMBOL, cutoff, 30);
    expect(secondBatch).toBe(30);
    expect(countCandles(dbHandle.db, SYMBOL)).toBe(40);
  });

  it('returns 0 once nothing is left to delete', () => {
    const cutoff = 10 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, 0, 5));

    expect(deleteExpiredCandlesBatch(dbHandle.db, SYMBOL, cutoff, 1000)).toBe(5);
    expect(deleteExpiredCandlesBatch(dbHandle.db, SYMBOL, cutoff, 1000)).toBe(0);
  });

  it('never deletes another symbol’s candles', () => {
    const cutoff = 100 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, 0, 10));
    upsertCandles(dbHandle.db, makeCandleSeries(OTHER_SYMBOL, 0, 10));

    deleteExpiredCandlesBatch(dbHandle.db, SYMBOL, cutoff, 1000);

    expect(countCandles(dbHandle.db, SYMBOL)).toBe(0);
    expect(countCandles(dbHandle.db, OTHER_SYMBOL)).toBe(10);
  });
});
