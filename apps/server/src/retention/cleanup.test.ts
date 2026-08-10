import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbHandle } from '../db/client.js';
import { countCandles, upsertCandles } from '../db/candles.js';
import { createTestDb } from '../../test/helpers/db.js';
import { makeCandleSeries } from '../../test/fixtures/candles.js';
import { startRetentionCleanup } from './cleanup.js';

const SYMBOL_A = 'BTCUSDT';
const SYMBOL_B = 'ETHUSDT';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('startRetentionCleanup', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
    vi.useRealTimers();
  });

  it('runOnce deletes candles older than RETENTION_DAYS across every symbol, yielding between batches', async () => {
    const now = 40 * DAY_MS;
    const retentionDays = 30;
    const cutoff = now - retentionDays * DAY_MS;

    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL_A, 0, 100)); // all before cutoff
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL_A, cutoff, 5)); // at/after cutoff, survives
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL_B, 0, 50)); // all before cutoff

    const sleep = vi.fn(() => Promise.resolve());
    const scheduler = startRetentionCleanup({
      db: dbHandle.db,
      symbols: [SYMBOL_A, SYMBOL_B],
      retentionDays,
      cleanupIntervalHours: 6,
      now: () => now,
      batchSize: 30,
      sleep,
    });

    const total = await scheduler.runOnce();

    expect(total).toBe(150);
    expect(countCandles(dbHandle.db, SYMBOL_A)).toBe(5);
    expect(countCandles(dbHandle.db, SYMBOL_B)).toBe(0);
    expect(sleep).toHaveBeenCalled();

    scheduler.stop();
  });

  it('does not delete anything when nothing has expired yet', async () => {
    const now = 10 * DAY_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL_A, 0, 20));

    const scheduler = startRetentionCleanup({
      db: dbHandle.db,
      symbols: [SYMBOL_A],
      retentionDays: 30,
      cleanupIntervalHours: 6,
      now: () => now,
    });

    const total = await scheduler.runOnce();

    expect(total).toBe(0);
    expect(countCandles(dbHandle.db, SYMBOL_A)).toBe(20);

    scheduler.stop();
  });

  it('schedules the first pass after one interval (not immediately) and reschedules after each run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const now = 40 * DAY_MS;
    const cutoff = now - 30 * DAY_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL_A, 0, 10));
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL_A, cutoff, 3));

    const scheduler = startRetentionCleanup({
      db: dbHandle.db,
      symbols: [SYMBOL_A],
      retentionDays: 30,
      cleanupIntervalHours: 1,
      now: () => now,
    });

    // nothing happens before the first interval elapses
    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(countCandles(dbHandle.db, SYMBOL_A)).toBe(13);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(countCandles(dbHandle.db, SYMBOL_A)).toBe(3);

    scheduler.stop();
  });

  it('stop() prevents further scheduled runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const now = 40 * DAY_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL_A, 0, 10));

    const scheduler = startRetentionCleanup({
      db: dbHandle.db,
      symbols: [SYMBOL_A],
      retentionDays: 30,
      cleanupIntervalHours: 1,
      now: () => now,
    });

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    expect(countCandles(dbHandle.db, SYMBOL_A)).toBe(10);
  });
});
