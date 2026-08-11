import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from './client.js';
import { countCandles, deleteExpiredCandlesBatch, getEarliestCandle, upsertCandles } from './candles.js';
import { createTestDb } from '../../test/helpers/db.js';
import { makeCandleSeries } from '../../test/fixtures/candles.js';
import { MINUTE_MS } from '../config/index.js';

const SYMBOL = 'BTCUSDT';
const OTHER_SYMBOL = 'ETHUSDT';

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
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, 0, 100)); // open_time이 0..99*MINUTE_MS, 모두 cutoff 미만
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, cutoff, 5)); // open_time이 cutoff 이상, 살아남아야 함

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

describe('getEarliestCandle', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
  });

  it('returns undefined when the symbol has no candles', () => {
    expect(getEarliestCandle(dbHandle.db, SYMBOL)).toBeUndefined();
  });

  it('returns the oldest candle by open_time', () => {
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, 10 * MINUTE_MS, 5));

    expect(getEarliestCandle(dbHandle.db, SYMBOL)?.openTime).toBe(10 * MINUTE_MS);
  });

  it('ignores other symbols', () => {
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, 100 * MINUTE_MS, 1));
    upsertCandles(dbHandle.db, makeCandleSeries(OTHER_SYMBOL, 1 * MINUTE_MS, 1));

    expect(getEarliestCandle(dbHandle.db, SYMBOL)?.openTime).toBe(100 * MINUTE_MS);
  });
});
