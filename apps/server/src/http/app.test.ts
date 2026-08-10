import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client.js';
import { createTestDb } from '../../test/helpers/db.js';
import { loadConfig } from '../config.js';
import { buildApp } from './app.js';

describe('GET /health', () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;

  beforeEach(() => {
    dbHandle = createTestDb();
    app = buildApp({ db: dbHandle, config: loadConfig({}) });
  });

  afterEach(async () => {
    await app.close();
    dbHandle.sqlite.close();
  });

  it('returns ok once the DB is reachable', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
