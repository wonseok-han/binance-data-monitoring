import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../../db/client.js';
import { createTestDb } from '../../../test/helpers/db.js';
import { loadConfig } from '../../config.js';
import { createEventBus, type EventBus } from '../../events/bus.js';
import { buildApp } from '../app.js';

describe('GET /api/events (SSE)', () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;
  let events: EventBus;
  let baseUrl: string;

  beforeEach(async () => {
    dbHandle = createTestDb();
    events = createEventBus();
    app = buildApp({ db: dbHandle, config: loadConfig({}), events });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await app.close();
    dbHandle.sqlite.close();
  });

  it('streams candle and status events published on the shared event bus', async () => {
    const response = await fetch(`${baseUrl}/api/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';

    const readUntil = async (marker: string, timeoutMs = 2000): Promise<void> => {
      const deadline = Date.now() + timeoutMs;
      while (!received.includes(marker)) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for "${marker}", received so far: ${received}`);
        }
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }
    };

    // give the server a tick to register the SSE subscription before publishing
    await new Promise((resolve) => setTimeout(resolve, 50));

    events.emitCandle('BTCUSDT', {
      symbol: 'BTCUSDT',
      openTime: 1,
      closeTime: 2,
      open: '1',
      high: '1',
      low: '1',
      close: '1',
      volume: '1',
      quoteVolume: '1',
      tradeCount: 1,
      isClosed: true,
    });
    events.emitStatus('BTCUSDT', {
      symbol: 'BTCUSDT',
      connectionStatus: 'live',
      lastEventAt: 1,
      lastClosedOpenTime: 1,
      delayMs: 0,
      lastError: null,
    });

    await readUntil('event: status');

    expect(received).toContain('event: candle');
    expect(received).toContain('"symbol":"BTCUSDT"');
    expect(received).toContain('event: status');

    await reader.cancel();
  });
});
