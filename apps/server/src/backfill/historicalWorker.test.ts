import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbHandle } from '../db/client.js';
import { countCandles, getEarliestCandle, upsertCandles } from '../db/candles.js';
import { createBackfillJob, getLatestBackfillJob, updateBackfillJobProgress } from '../db/backfillJobs.js';
import { createTestDb } from '../../test/helpers/db.js';
import { createFixtureFetchKlines, makeCandleSeries } from '../../test/fixtures/candles.js';
import { DAY_MS, MINUTE_MS } from '../config/index.js';
import { BinanceRestError } from '../collector/binanceRest.js';
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

  it('marks the job failed immediately on a permanent (non-retryable) error, without retrying', async () => {
    const backfillDays = 2;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, targetFrom + DAY_MS, 1));

    const fetchKlines = vi.fn().mockRejectedValue(new BinanceRestError('bad request', 400));
    const sleep = vi.fn(() => Promise.resolve());
    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      now: () => NOW,
      sleep,
    });

    await worker.whenDone();

    const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(job?.status).toBe('failed');
    expect(job?.lastError).toContain('bad request');
    expect(job?.retryCount).toBe(0);
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a transient error with backoff and resumes the same page without losing progress', async () => {
    const backfillDays = 1;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    const coveredFrom = targetFrom + 5 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, 1));

    const fullRange = makeCandleSeries(SYMBOL, targetFrom, 5);
    const fetchKlines = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(fullRange);
    const sleep = vi.fn(() => Promise.resolve());

    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      pageSize: 100,
      now: () => NOW,
      sleep,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 30_000,
    });

    await worker.whenDone();

    const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(job?.status).toBe('completed');
    expect(job?.retryCount).toBe(0); // 성공 후 초기화
    expect(job?.processedCount).toBe(5);
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(fetchKlines.mock.calls[1]![0]).toEqual(fetchKlines.mock.calls[0]![0]); // 같은 페이지 재시도
    expect(sleep).toHaveBeenCalledWith(1000); // 첫 재시도는 base delay
  });

  it('caps retry backoff at retryMaxDelayMs and keeps retrying indefinitely on transient errors', async () => {
    const backfillDays = 1;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    const coveredFrom = targetFrom + 5 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, 1));

    const fullRange = makeCandleSeries(SYMBOL, targetFrom, 5);
    const fetchKlines = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(fullRange);
    const sleep = vi.fn((_ms: number) => Promise.resolve());

    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      pageSize: 100,
      now: () => NOW,
      sleep,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 2500,
    });

    await worker.whenDone();

    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1000, 2000, 2500]); // 1000, 2000, 4000→cap 2500
    expect(getLatestBackfillJob(dbHandle.db, SYMBOL)?.status).toBe('completed');
  });

  it('resumes a job left in retrying status after a restart, waiting out any remaining backoff', async () => {
    const backfillDays = 1;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    const coveredFrom = targetFrom + 5 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, 1));

    // 이전 실행이 일시적 오류로 retrying 상태를 남기고 재시작된 상황을 재현한다.
    const { id } = createBackfillJob(dbHandle.db, {
      symbol: SYMBOL,
      fromTime: targetFrom,
      toTime: coveredFrom - MINUTE_MS,
      cursor: coveredFrom - MINUTE_MS,
      totalCount: 5,
      now: NOW - 10_000,
    });
    updateBackfillJobProgress(dbHandle.db, id, {
      cursor: coveredFrom - MINUTE_MS,
      processedCount: 0,
      status: 'retrying',
      lastError: 'temporary error',
      retryCount: 3,
      nextRetryAt: NOW - 1000, // 이미 지난 재시도 시각
      now: NOW - 1000,
    });

    const fullRange = makeCandleSeries(SYMBOL, targetFrom, 5);
    const fetchKlines = vi.fn(createFixtureFetchKlines(fullRange));
    const sleep = vi.fn(() => Promise.resolve());

    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      pageSize: 100,
      now: () => NOW,
      sleep,
    });

    await worker.whenDone();

    const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(job?.id).toBe(id); // 같은 job을 이어서 처리
    expect(job?.status).toBe('completed');
    expect(job?.retryCount).toBe(0);
  });

  it('stop() resolves promptly even while waiting out a retry backoff, without failing or completing the job', async () => {
    const backfillDays = 1;
    const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
    const coveredFrom = targetFrom + 5 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, 1));

    const fetchKlines = vi.fn().mockRejectedValue(new Error('network error'));
    let releaseSleep!: () => void;
    const sleepGate = new Promise<void>((resolve) => {
      releaseSleep = resolve;
    });
    const sleep = vi.fn(() => sleepGate); // stop() 없이는 절대 스스로 풀리지 않는다.

    const worker = startHistoricalBackfillWorker(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      backfillDays,
      pageSize: 100,
      now: () => NOW,
      sleep,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 300_000,
    });

    await vi.waitFor(() => expect(sleep).toHaveBeenCalled());

    await worker.stop(); // sleepGate가 풀리지 않아도 hang 없이 반환되어야 한다.

    const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
    expect(job?.status).toBe('retrying'); // backoff 대기 중에 멈췄고 failed/completed는 아니다.

    releaseSleep();
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

  describe('maxRetries', () => {
    it('marks the job failed once consecutive transient errors exceed maxRetries, without retrying further', async () => {
      const backfillDays = 1;
      const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
      const coveredFrom = targetFrom + 5 * MINUTE_MS;
      upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, 1));

      const fetchKlines = vi.fn().mockRejectedValue(new Error('timeout'));
      const sleep = vi.fn(() => Promise.resolve());
      const notifyFailed = vi.fn();

      const worker = startHistoricalBackfillWorker(SYMBOL, {
        db: dbHandle.db,
        fetchKlines,
        backfillDays,
        pageSize: 100,
        now: () => NOW,
        sleep,
        maxRetries: 2,
        notifier: { notifyFailed },
      });

      await worker.whenDone();

      const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
      expect(job?.status).toBe('failed');
      expect(job?.retryCount).toBe(3); // maxRetries(2)를 넘어선 3번째 시도에서 확정
      expect(job?.lastError).toContain('timeout');
      expect(fetchKlines).toHaveBeenCalledTimes(3); // 최초 시도 + 재시도 2회
      expect(notifyFailed).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: SYMBOL, jobId: job?.id, error: expect.stringContaining('timeout') }),
      );
    });

    it('calls the notifier when a permanent error fails the job immediately', async () => {
      const backfillDays = 2;
      const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
      upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, targetFrom + DAY_MS, 1));

      const fetchKlines = vi.fn().mockRejectedValue(new BinanceRestError('bad request', 400));
      const notifyFailed = vi.fn();

      const worker = startHistoricalBackfillWorker(SYMBOL, {
        db: dbHandle.db,
        fetchKlines,
        backfillDays,
        now: () => NOW,
        sleep: () => Promise.resolve(),
        notifier: { notifyFailed },
      });

      await worker.whenDone();

      const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
      expect(job?.status).toBe('failed');
      expect(notifyFailed).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: SYMBOL, jobId: job?.id, error: expect.stringContaining('bad request') }),
      );
    });

    it('does not exceed maxRetries when resuming a retrying job that already used up some attempts', async () => {
      const backfillDays = 1;
      const targetFrom = Math.floor(NOW / MINUTE_MS) * MINUTE_MS - backfillDays * DAY_MS;
      const coveredFrom = targetFrom + 5 * MINUTE_MS;
      upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, coveredFrom, 1));

      // 이전 실행에서 이미 2번 재시도한 뒤 재시작된 상황을 재현한다(maxRetries=2).
      const { id } = createBackfillJob(dbHandle.db, {
        symbol: SYMBOL,
        fromTime: targetFrom,
        toTime: coveredFrom - MINUTE_MS,
        cursor: coveredFrom - MINUTE_MS,
        totalCount: 5,
        now: NOW - 10_000,
      });
      updateBackfillJobProgress(dbHandle.db, id, {
        cursor: coveredFrom - MINUTE_MS,
        processedCount: 0,
        status: 'retrying',
        lastError: 'temporary error',
        retryCount: 2,
        nextRetryAt: NOW - 1000,
        now: NOW - 1000,
      });

      const fetchKlines = vi.fn().mockRejectedValue(new Error('still failing'));
      const notifyFailed = vi.fn();

      const worker = startHistoricalBackfillWorker(SYMBOL, {
        db: dbHandle.db,
        fetchKlines,
        backfillDays,
        pageSize: 100,
        now: () => NOW,
        sleep: () => Promise.resolve(),
        maxRetries: 2,
        notifier: { notifyFailed },
      });

      await worker.whenDone();

      const job = getLatestBackfillJob(dbHandle.db, SYMBOL);
      expect(job?.id).toBe(id);
      expect(job?.status).toBe('failed'); // 이어받은 retryCount(2)에 이번 시도가 더해져 한도를 넘는다
      expect(job?.retryCount).toBe(3);
      expect(fetchKlines).toHaveBeenCalledTimes(1); // 재개 직후 첫 시도에서 바로 한도 초과
      expect(notifyFailed).toHaveBeenCalledTimes(1);
    });
  });
});
