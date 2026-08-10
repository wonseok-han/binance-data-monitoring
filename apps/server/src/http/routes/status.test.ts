import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../../db/client.js';
import { upsertCollectorState } from '../../db/collectorState.js';
import { createTestDb } from '../../../test/helpers/db.js';
import { loadConfig } from '../../config.js';
import { createEventBus } from '../../events/bus.js';
import { buildApp } from '../app.js';

describe('GET /api/status', () => {
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

  it('defaults to connecting with null fields when no collector_state row exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/status' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.symbols).toHaveLength(2);
    expect(body.symbols).toContainEqual({
      symbol: 'BTCUSDT',
      connectionStatus: 'connecting',
      lastEventAt: null,
      lastClosedOpenTime: null,
      delayMs: null,
      lastError: null,
      lastBackfill: null,
    });
  });

  it('reflects stored collector_state and computes delayMs from lastEventAt', async () => {
    const lastEventAt = Date.now() - 5000;
    upsertCollectorState(dbHandle.db, 'BTCUSDT', { connectionStatus: 'live', lastEventAt });

    const response = await app.inject({ method: 'GET', url: '/api/status' });
    const body = response.json();
    const btc = body.symbols.find((entry: { symbol: string }) => entry.symbol === 'BTCUSDT');

    expect(btc.connectionStatus).toBe('live');
    expect(btc.delayMs).toBeGreaterThanOrEqual(5000);
  });

  it('surfaces the last backfill run recorded in collector_state', async () => {
    const record = {
      startedAt: 1000,
      finishedAt: 1500,
      durationMs: 500,
      from: 0,
      to: 999,
      count: 42,
      result: 'success' as const,
      error: null,
    };
    upsertCollectorState(dbHandle.db, 'BTCUSDT', { lastBackfillJson: JSON.stringify(record) });

    const response = await app.inject({ method: 'GET', url: '/api/status' });
    const body = response.json();
    const btc = body.symbols.find((entry: { symbol: string }) => entry.symbol === 'BTCUSDT');

    expect(btc.lastBackfill).toEqual(record);
  });
});
