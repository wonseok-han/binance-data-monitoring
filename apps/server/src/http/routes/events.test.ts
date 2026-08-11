import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../../db/client.js';
import { createTestDb } from '../../../test/helpers/db.js';
import { loadRuntimeConfig } from '../../config/index.js';
import { createEventBus, type EventBus } from '../../events/bus.js';
import { createSseRegistry, type SseRegistry } from '../sseRegistry.js';
import { createShutdownHandler } from '../../shutdown.js';
import { buildApp } from '../app.js';

describe('GET /api/events (SSE)', () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;
  let events: EventBus;
  let sse: SseRegistry;
  let baseUrl: string;

  beforeEach(async () => {
    dbHandle = createTestDb();
    events = createEventBus();
    sse = createSseRegistry();
    app = buildApp({ db: dbHandle, config: loadRuntimeConfig({}), events, sse });
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

    // 발행 전에 서버가 SSE 구독을 등록할 시간을 준다
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
      lastBackfill: null,
      completeness24h: { expected: 1440, confirmed: 0, missing: 1440 },
      historicalBackfill: null,
      coverage: { from: null, to: null },
    });

    await readUntil('event: status');

    expect(received).toContain('event: candle');
    expect(received).toContain('"symbol":"BTCUSDT"');
    expect(received).toContain('event: status');

    await reader.cancel();
  });

  it('closes an active SSE connection so graceful shutdown does not hang on app.close()', async () => {
    const response = await fetch(`${baseUrl}/api/events`);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();

    // 서버가 연결을 sse 레지스트리에 등록할 시간을 준다.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sse.size()).toBe(1);

    const shutdown = createShutdownHandler({
      collectors: [],
      closeSseClients: () => sse.closeAll(),
      closeApp: () => app.close(),
      closeDb: () => {},
    });

    // reply.hijack()으로 벗어난 SSE keep-alive 소켓을 명시적으로 끊지 않으면
    // app.close()가 이 열린 연결을 기다리며 영원히 멈춘다. 타임아웃을 걸어
    // 그 회귀를 감지한다.
    await Promise.race([
      shutdown('SIGTERM'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown hung')), 2000)),
    ]);

    expect(sse.size()).toBe(0);

    // 연결 직후 서버가 보낸 초기 개행 등 이미 버퍼에 쌓인 데이터를 모두 소비한 뒤에야
    // 진짜 스트림 종료(done)를 관찰할 수 있다.
    let done = false;
    const drainDeadline = Date.now() + 2000;
    while (!done) {
      if (Date.now() > drainDeadline) throw new Error('stream did not end after shutdown');
      ({ done } = await reader.read());
    }
    expect(done).toBe(true); // 서버가 스트림을 실제로 끊어 클라이언트가 종료를 관찰한다
  });
});
