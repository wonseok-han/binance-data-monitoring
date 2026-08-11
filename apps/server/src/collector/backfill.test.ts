import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../db/client.js';
import { countCandles, upsertCandles } from '../db/candles.js';
import { createTestDb } from '../../test/helpers/db.js';
import { createFixtureFetchKlines, makeCandleSeries } from '../../test/fixtures/candles.js';
import { computeBackfillRange, lastCompletedOpenTime, runBackfill } from './backfill.js';
import { HOUR_MS, MINUTE_MS } from '../config/index.js';

const SYMBOL = 'BTCUSDT';

// 2024-03-01T00:00:37.123Z, 의도적으로 분 경계에 맞추지 않았다.
const NOW = Date.UTC(2024, 2, 1, 0, 0, 37, 123);

describe('lastCompletedOpenTime', () => {
  it('excludes the in-progress minute', () => {
    const currentMinuteOpen = Math.floor(NOW / MINUTE_MS) * MINUTE_MS;
    expect(lastCompletedOpenTime(NOW)).toBe(currentMinuteOpen - MINUTE_MS);
  });
});

describe('computeBackfillRange', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
  });

  it('starts BACKFILL_HOURS before now when there is no stored candle', () => {
    const range = computeBackfillRange(dbHandle.db, SYMBOL, 24, NOW);

    const currentMinuteOpen = Math.floor(NOW / MINUTE_MS) * MINUTE_MS;
    expect(range).toEqual({
      startTime: currentMinuteOpen - 24 * HOUR_MS,
      endTime: currentMinuteOpen - MINUTE_MS,
    });
  });

  it('resumes from the minute after the last closed candle on restart', () => {
    const lastClosedOpenTime = lastCompletedOpenTime(NOW) - 5 * MINUTE_MS;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, lastClosedOpenTime, 1));

    const range = computeBackfillRange(dbHandle.db, SYMBOL, 24, NOW);

    expect(range?.startTime).toBe(lastClosedOpenTime + MINUTE_MS);
  });

  it('returns null when already caught up to the last completed candle', () => {
    const range = computeBackfillRange(dbHandle.db, SYMBOL, 24, NOW);
    const upToDateOpenTime = range!.endTime;
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, upToDateOpenTime, 1));

    expect(computeBackfillRange(dbHandle.db, SYMBOL, 24, NOW)).toBeNull();
  });
});

describe('runBackfill', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
  });

  it('fills the initial BACKFILL_HOURS window from fixture klines', async () => {
    const backfillHours = 2;
    const currentMinuteOpen = Math.floor(NOW / MINUTE_MS) * MINUTE_MS;
    const expectedStart = currentMinuteOpen - backfillHours * HOUR_MS;
    const expectedCount = backfillHours * 60;

    const fixture = makeCandleSeries(SYMBOL, expectedStart, expectedCount + 5);
    const fetchKlines = createFixtureFetchKlines(fixture);

    const total = await runBackfill({ db: dbHandle.db, fetchKlines, now: () => NOW }, SYMBOL, backfillHours);

    expect(total).toBe(expectedCount);
    expect(countCandles(dbHandle.db, SYMBOL)).toBe(expectedCount);
  });

  it('paginates across multiple REST pages using a small page size', async () => {
    const backfillHours = 1;
    const currentMinuteOpen = Math.floor(NOW / MINUTE_MS) * MINUTE_MS;
    const expectedStart = currentMinuteOpen - backfillHours * HOUR_MS;
    const expectedCount = backfillHours * 60;

    const fixture = makeCandleSeries(SYMBOL, expectedStart, expectedCount);
    const fetchKlines = createFixtureFetchKlines(fixture);

    const total = await runBackfill(
      { db: dbHandle.db, fetchKlines, now: () => NOW, pageSize: 7 },
      SYMBOL,
      backfillHours,
    );

    expect(total).toBe(expectedCount);
    expect(countCandles(dbHandle.db, SYMBOL)).toBe(expectedCount);
  });

  it('does not duplicate rows when backfilling the same range twice', async () => {
    const backfillHours = 1;
    const currentMinuteOpen = Math.floor(NOW / MINUTE_MS) * MINUTE_MS;
    const expectedStart = currentMinuteOpen - backfillHours * HOUR_MS;
    const expectedCount = backfillHours * 60;

    const fixture = makeCandleSeries(SYMBOL, expectedStart, expectedCount);
    const fetchKlines = createFixtureFetchKlines(fixture);
    const deps = { db: dbHandle.db, fetchKlines, now: () => NOW };

    await runBackfill(deps, SYMBOL, backfillHours);
    // 같은 "now"로 두 번째 실행하면 더 이상 백필할 것이 없다.
    const secondRunTotal = await runBackfill(deps, SYMBOL, backfillHours);

    expect(secondRunTotal).toBe(0);
    expect(countCandles(dbHandle.db, SYMBOL)).toBe(expectedCount);
  });

  it('upserting the same (symbol, open_time) twice does not create duplicate rows', () => {
    const openTime = Date.UTC(2024, 2, 1, 0, 0, 0);
    const original = makeCandleSeries(SYMBOL, openTime, 1);
    const updated = makeCandleSeries(SYMBOL, openTime, 1);
    updated[0]!.close = '999.99';

    upsertCandles(dbHandle.db, original);
    upsertCandles(dbHandle.db, updated);

    expect(countCandles(dbHandle.db, SYMBOL)).toBe(1);
  });

  it('returns 0 without calling fetchKlines when already up to date', async () => {
    let calls = 0;
    const fetchKlines = async () => {
      calls += 1;
      return [];
    };
    upsertCandles(dbHandle.db, makeCandleSeries(SYMBOL, lastCompletedOpenTime(NOW), 1));

    const total = await runBackfill({ db: dbHandle.db, fetchKlines, now: () => NOW }, SYMBOL, 24);

    expect(total).toBe(0);
    expect(calls).toBe(0);
  });
});
