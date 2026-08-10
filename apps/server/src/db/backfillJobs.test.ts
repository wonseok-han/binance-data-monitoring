import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from './client.js';
import { createBackfillJob, getLatestBackfillJob, updateBackfillJobProgress } from './backfillJobs.js';
import { createTestDb } from '../../test/helpers/db.js';

const SYMBOL = 'BTCUSDT';

describe('backfill_jobs repository', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
  });

  it('returns undefined when no job exists yet', () => {
    expect(getLatestBackfillJob(dbHandle.db, SYMBOL)).toBeUndefined();
  });

  it('creates a pending job with the given range and zero progress', () => {
    const { id } = createBackfillJob(dbHandle.db, {
      symbol: SYMBOL,
      fromTime: 1000,
      toTime: 2000,
      cursor: 2000,
      totalCount: 42,
      now: 500,
    });

    const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(job).toMatchObject({
      id,
      symbol: SYMBOL,
      fromTime: 1000,
      toTime: 2000,
      cursor: 2000,
      status: 'pending',
      processedCount: 0,
      totalCount: 42,
      lastError: null,
      createdAt: 500,
      updatedAt: 500,
    });
  });

  it('updates progress in place, moving the cursor and bumping updatedAt', () => {
    const { id } = createBackfillJob(dbHandle.db, {
      symbol: SYMBOL,
      fromTime: 0,
      toTime: 1000,
      cursor: 1000,
      totalCount: 100,
      now: 0,
    });

    updateBackfillJobProgress(dbHandle.db, id, {
      cursor: 500,
      processedCount: 40,
      status: 'running',
      now: 999,
    });

    const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(job).toMatchObject({
      cursor: 500,
      processedCount: 40,
      status: 'running',
      updatedAt: 999,
    });
  });

  it('records a failure with its error message', () => {
    const { id } = createBackfillJob(dbHandle.db, {
      symbol: SYMBOL,
      fromTime: 0,
      toTime: 1000,
      cursor: 1000,
      totalCount: 100,
      now: 0,
    });

    updateBackfillJobProgress(dbHandle.db, id, {
      cursor: 700,
      processedCount: 30,
      status: 'failed',
      lastError: 'binance unreachable',
      now: 1,
    });

    expect(getLatestBackfillJob(dbHandle.db, SYMBOL)?.lastError).toBe('binance unreachable');
  });

  it('returns the most recently created job for a symbol', () => {
    createBackfillJob(dbHandle.db, { symbol: SYMBOL, fromTime: 0, toTime: 100, cursor: 100, totalCount: 2, now: 0 });
    const { id: secondId } = createBackfillJob(dbHandle.db, {
      symbol: SYMBOL,
      fromTime: 200,
      toTime: 300,
      cursor: 300,
      totalCount: 2,
      now: 1,
    });

    expect(getLatestBackfillJob(dbHandle.db, SYMBOL)?.id).toBe(secondId);
  });

  it('keeps jobs for different symbols independent', () => {
    createBackfillJob(dbHandle.db, { symbol: 'BTCUSDT', fromTime: 0, toTime: 100, cursor: 100, totalCount: 2, now: 0 });
    createBackfillJob(dbHandle.db, { symbol: 'ETHUSDT', fromTime: 500, toTime: 600, cursor: 600, totalCount: 2, now: 0 });

    expect(getLatestBackfillJob(dbHandle.db, 'BTCUSDT')?.fromTime).toBe(0);
    expect(getLatestBackfillJob(dbHandle.db, 'ETHUSDT')?.fromTime).toBe(500);
  });
});
