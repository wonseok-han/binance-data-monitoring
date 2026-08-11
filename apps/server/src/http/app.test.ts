import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client.js';
import { createTestDb } from '../../test/helpers/db.js';
import { loadRuntimeConfig } from '../config/index.js';
import { createEventBus } from '../events/bus.js';
import { createSseRegistry } from './sseRegistry.js';
import { buildApp } from './app.js';

describe('health checks', () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;

  beforeEach(() => {
    dbHandle = createTestDb();
    app = buildApp({ db: dbHandle, config: loadRuntimeConfig({}), events: createEventBus(), sse: createSseRegistry() });
  });

  afterEach(async () => {
    await app.close();
    dbHandle.sqlite.close();
  });

  it('GET /health/live returns ok even when the DB is unreachable', async () => {
    const brokenDb = createTestDb();
    brokenDb.sqlite.close();
    const brokenApp = buildApp({ db: brokenDb, config: loadRuntimeConfig({}), events: createEventBus(), sse: createSseRegistry() });

    const response = await brokenApp.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await brokenApp.close();
  });

  it('GET /health/ready returns ok once the DB is reachable', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
