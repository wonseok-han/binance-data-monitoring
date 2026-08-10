import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbHandle } from '../db/client.js';
import { countCandles, getEarliestCandle, upsertCandles } from '../db/candles.js';
import { getLatestBackfillJob } from '../db/backfillJobs.js';
import { createTestDb } from '../../test/helpers/db.js';
import { createFixtureFetchKlines, makeCandleSeries } from '../../test/fixtures/candles.js';
import { DAY_MS, MINUTE_MS } from '../config/constants.js';
import { startHistoricalBackfillWorker } from './historicalWorker.js';

const SYMBOL = 'BTCUSDT';
const NOW = Date.UTC(2024, 5, 15, 0, 0, 0);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('startHistoricalBackfillWorker', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
  });

  it('fills backward in pages from the already-covered edge down to BACKFILL_DAYS ago, newest page first', async () => {
    const backfillDays = 3;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;

    // warmup already covered the most recent 1 day; the worker must fill the 2 days before that.
    const coveredFrom = targetFrom + DAY_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, DAY_MS / MINUTE_MS));

    const historicalRange = makeCandleSeries(SYMBOL, targetFrom, (coveredFrom - targetFrom) / MINUTE_MS);
    const fetchKlines = vi.fn(createFixtureFetchKlines(historicalRange));
    const sleep = vi.fn(() => Promise.resolve());

    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      pageSize: 200,
      now: () => NOW,
      sleep,
    });

    await worker.whenDone();

    const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(job?.status).toBe('completed');
    expect(job?.fromTime).toBe(targetFrom);
    expect(job?.toTime).toBe(coveredFrom - MINUTE_MS);
    expect(job?.processedCount).toBe(historicalRange.length);
    expect(countCandles(dbHandle.db, SYMBOL)).toBe(historicalRange.length + DAY_MS / MINUTE_MS);
    expect(getEarliestCandle(dbHandle.db, SYMBOL)?.openTime).toBe(targetFrom);
    expect(fetchKlines.mock.calls.length).toBeGreaterThan(1); // paginated
    expect(sleep).toHaveBeenCalled();

    // first page requested must end at the newest uncovered boundary, not the oldest.
    expect(fetchKlines.mock.calls[0]![0]).toMatchObject({ endTime: coveredFrom - MINUTE_MS });
  });

  it('does nothing when the existing coverage already reaches back past BACKFILL_DAYS', async () => {
    const backfillDays = 1;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, targetFrom - 2 * DAY_MS, 1));

    const fetchKlines = vi.fn(createFixtureFetchKlines([]));
    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      now: () => NOW,
    });

    await worker.whenDone();

    expect(fetchKlines).not.toHaveBeenCalled();
    expect(getLatestBackfillJob(dbHandle.db, SYMBOL)).toBeUndefined();
  });

  it('marks the job failed and stops paging when a REST request fails', async () => {
    const backfillDays = 2;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, targetFrom + DAY_MS, 1));

    const fetchKlines = vi.fn().mockRejectedValue(new Error('binance unreachable'));
    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      now: () => NOW,
    });

    await worker.whenDone();

    const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(job?.status).toBe('failed');
    expect(job?.lastError).toContain('binance unreachable');
    expect(fetchKlines).toHaveBeenCalledTimes(1);
  });

  it('finishes the in-flight page before stop() resolves, then resumes from the persisted cursor after a restart', async () => {
    const backfillDays = 1;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    const coveredFrom = targetFrom + 20 * MINUTE_MS; // small range: 20 one-minute candles to backfill
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, 1));

    const fullRange = makeCandleSeries(SYMBOL, targetFrom, 20);
    const page1 = fullRange.slice(15, 20); // newest 5 (closest to coveredFrom)
    const deferredPage2 = createDeferred<typeof fullRange>();

    const fetchKlines = vi
      .fn()
      .mockResolvedValueOnce(page1)
      .mockReturnValueOnce(deferredPage2.promise);

    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      pageSize: 5,
      now: () => NOW,
      sleep: () => Promise.resolve(),
    });

    // let the first page settle before stopping mid-second-page.
    await vi.waitFor(() => expect(fetchKlines).toHaveBeenCalledTimes(2));

    const stopPromise = worker.stop();
    const page2 = fullRange.slice(10, 15);
    deferredPage2.resolve(page2);
    await stopPromise;

    const stoppedJob = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(stoppedJob?.status).toBe('running'); // stopped mid-flight, not completed
    expect(stoppedJob?.processedCount).toBe(10);
    expect(fetchKlines).toHaveBeenCalledTimes(2); // no third page attempted after stop()

    // simulate a process restart: a brand new worker instance against the same DB/job row.
    const resumeFetchKlines = vi.fn(createFixtureFetchKlines(fullRange));
    const resumedWorker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines: resumeFetchKlines,
      backfillDays,
      pageSize: 5,
      now: () => NOW,
      sleep: () => Promise.resolve(),
    });

    await resumedWorker.whenDone();

    expect(resumeFetchKlines.mock.calls[0]![0]).toMatchObject({ endTime: stoppedJob!.cursor });
    const finalJob = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(finalJob?.id).toBe(stoppedJob?.id); // same job row, resumed
    expect(finalJob?.status).toBe('completed');
    expect(finalJob?.processedCount).toBe(20);
  });

  it('calls onProgress whenever the job progresses', async () => {
    const backfillDays = 1;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    const coveredFrom = targetFrom + 10 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, 1));

    const fetchKlines = createFixtureFetchKlines(makeCandleSeries(SYMBOL, targetFrom, 10));
    const onProgress = vi.fn();

    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      pageSize: 100,
      now: () => NOW,
      sleep: () => Promise.resolve(),
      onProgress,
    });

    await worker.whenDone();

    expect(onProgress).toHaveBeenCalled();
  });
});
