import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbHandle } from '../db/client.js';
import { countCandles, getCandle } from '../db/candles.js';
import { getCollectorState } from '../db/collectorState.js';
import { createTestDb } from '../../test/helpers/db.js';
import { createFakeWsFactory } from '../../test/fixtures/fakeWs.js';
import { makeWsKlineEvent } from '../../test/fixtures/wsEvents.js';
import type { RawCandle } from './binanceRest.js';
import { lastCompletedOpenTime } from './backfill.js';
import { startCollector } from './collector.js';
import { MINUTE_MS } from '../config/constants.js';

const SYMBOL = 'BTCUSDT';
const NOW = Date.UTC(2024, 2, 1, 0, 0, 37, 123);
const WS_BASE_URL = 'wss://example.com';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe('startCollector', () => {
  let dbHandle: DbHandle;

  beforeEach(() => {
    dbHandle = createTestDb();
  });

  afterEach(() => {
    dbHandle.sqlite.close();
    vi.useRealTimers();
  });

  it('opens the WebSocket before backfill resolves, buffers events, then flushes them in time order and goes live', async () => {
    const { factory, instances } = createFakeWsFactory();
    const deferred = createDeferred<RawCandle[]>();
    const fetchKlines = vi.fn().mockReturnValue(deferred.promise);

    const collector = startCollector(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      wsFactory: factory,
      wsBaseUrl: WS_BASE_URL,
      backfillHours: 1,
      staleAfterSeconds: 10,
      now: () => NOW,
    });

    expect(instances).toHaveLength(1);
    expect(fetchKlines).toHaveBeenCalledTimes(1);

    instances[0]!.emit('open');

    const laterOpenTime = lastCompletedOpenTime(NOW);
    const earlierOpenTime = laterOpenTime - MINUTE_MS;
    instances[0]!.emit('message', makeWsKlineEvent(SYMBOL, laterOpenTime, { x: true }));
    instances[0]!.emit('message', makeWsKlineEvent(SYMBOL, earlierOpenTime, { x: true }));

    expect(countCandles(dbHandle.db, SYMBOL)).toBe(0);

    deferred.resolve([]);
    await flushMicrotasks();

    expect(countCandles(dbHandle.db, SYMBOL)).toBe(2);
    expect(getCandle(dbHandle.db, SYMBOL, earlierOpenTime)).toBeDefined();
    expect(getCandle(dbHandle.db, SYMBOL, laterOpenTime)).toBeDefined();

    const state = getCollectorState(dbHandle.db, SYMBOL);
    expect(state?.connectionStatus).toBe('live');
    expect(state?.lastClosedOpenTime).toBe(laterOpenTime);

    collector.stop();
  });

  it('updates an in-progress candle to closed via live upsert', async () => {
    const { factory, instances } = createFakeWsFactory();
    const fetchKlines = vi.fn().mockResolvedValue([]);

    const collector = startCollector(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      wsFactory: factory,
      wsBaseUrl: WS_BASE_URL,
      backfillHours: 1,
      staleAfterSeconds: 10,
      now: () => NOW,
    });

    instances[0]!.emit('open');
    await flushMicrotasks();

    const openTime = lastCompletedOpenTime(NOW);
    instances[0]!.emit('message', makeWsKlineEvent(SYMBOL, openTime, { x: false }));
    expect(getCandle(dbHandle.db, SYMBOL, openTime)?.isClosed).toBe(false);
    expect(getCollectorState(dbHandle.db, SYMBOL)?.lastClosedOpenTime).toBeNull();

    instances[0]!.emit('message', makeWsKlineEvent(SYMBOL, openTime, { x: true, c: '105.00' }));
    const closed = getCandle(dbHandle.db, SYMBOL, openTime);
    expect(closed?.isClosed).toBe(true);
    expect(closed?.close).toBe('105.00');
    expect(getCollectorState(dbHandle.db, SYMBOL)?.lastClosedOpenTime).toBe(openTime);

    collector.stop();
  });

  it('records a successful backfill run with its range, count, and duration', async () => {
    const { factory } = createFakeWsFactory();
    const fetchKlines = vi.fn().mockResolvedValue([]);

    const collector = startCollector(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      wsFactory: factory,
      wsBaseUrl: WS_BASE_URL,
      backfillHours: 1,
      staleAfterSeconds: 10,
      now: () => NOW,
    });

    await flushMicrotasks();

    const state = getCollectorState(dbHandle.db, SYMBOL);
    const record = JSON.parse(state!.lastBackfillJson!);

    expect(record.result).toBe('success');
    expect(record.count).toBe(0);
    expect(record.error).toBeNull();
    expect(record.from).not.toBeNull();
    expect(record.to).not.toBeNull();
    expect(record.durationMs).toBeGreaterThanOrEqual(0);

    collector.stop();
  });

  it('records a failed backfill run with the error message', async () => {
    const { factory } = createFakeWsFactory();
    const fetchKlines = vi.fn().mockRejectedValue(new Error('binance unreachable'));

    const collector = startCollector(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      wsFactory: factory,
      wsBaseUrl: WS_BASE_URL,
      backfillHours: 1,
      staleAfterSeconds: 10,
      now: () => NOW,
    });

    await flushMicrotasks();

    const state = getCollectorState(dbHandle.db, SYMBOL);
    const record = JSON.parse(state!.lastBackfillJson!);

    expect(record.result).toBe('error');
    expect(record.count).toBe(0);
    expect(record.error).toContain('binance unreachable');

    collector.stop();
  });

  it('reconnects with backoff after a disconnect and gap-fills via backfill again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { factory, instances } = createFakeWsFactory();
    const fetchKlines = vi.fn().mockResolvedValue([]);

    const collector = startCollector(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      wsFactory: factory,
      wsBaseUrl: WS_BASE_URL,
      backfillHours: 1,
      staleAfterSeconds: 10,
      now: () => NOW,
      reconnectBaseDelayMs: 1000,
      reconnectMaxDelayMs: 5000,
    });

    instances[0]!.emit('open');
    await flushMicrotasks();
    expect(getCollectorState(dbHandle.db, SYMBOL)?.connectionStatus).toBe('live');

    instances[0]!.close();
    expect(getCollectorState(dbHandle.db, SYMBOL)?.connectionStatus).toBe('reconnecting');
    expect(instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();

    expect(instances.length).toBeGreaterThanOrEqual(2);
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(getCollectorState(dbHandle.db, SYMBOL)?.connectionStatus).toBe('reconnecting');

    instances[1]!.emit('open');
    await flushMicrotasks();
    expect(getCollectorState(dbHandle.db, SYMBOL)?.connectionStatus).toBe('live');

    collector.stop();
  });

  it('marks the connection stale and forces a reconnect after staleAfterSeconds without events', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { factory, instances } = createFakeWsFactory();
    const fetchKlines = vi.fn().mockResolvedValue([]);
    let currentTime = NOW;

    const collector = startCollector(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      wsFactory: factory,
      wsBaseUrl: WS_BASE_URL,
      backfillHours: 1,
      staleAfterSeconds: 10,
      staleCheckIntervalMs: 1000,
      now: () => currentTime,
    });

    instances[0]!.emit('open');
    await flushMicrotasks();
    expect(getCollectorState(dbHandle.db, SYMBOL)?.connectionStatus).toBe('live');

    currentTime += 11_000;
    await vi.advanceTimersByTimeAsync(1000);

    expect(instances[0]!.closed).toBe(true);
    expect(getCollectorState(dbHandle.db, SYMBOL)?.connectionStatus).toBe('reconnecting');

    collector.stop();
  });

  it('stops cleanly without scheduling further reconnects', async () => {
    const { factory, instances } = createFakeWsFactory();
    const fetchKlines = vi.fn().mockResolvedValue([]);

    const collector = startCollector(SYMBOL, {
      db: dbHandle.db,
      fetchKlines,
      wsFactory: factory,
      wsBaseUrl: WS_BASE_URL,
      backfillHours: 1,
      staleAfterSeconds: 10,
      now: () => NOW,
    });

    instances[0]!.emit('open');
    await flushMicrotasks();

    collector.stop();
    expect(instances[0]!.closed).toBe(true);

    await flushMicrotasks();
    expect(instances).toHaveLength(1);
  });
});
