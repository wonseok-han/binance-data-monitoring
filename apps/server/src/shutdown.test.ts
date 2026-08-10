import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from './shutdown.js';

describe('createShutdownHandler', () => {
  it('stops every collector, closes SSE clients, then closes the app, then closes the DB', async () => {
    const callOrder: string[] = [];
    const collectors = [
      { stop: vi.fn(() => void callOrder.push('stop-1')) },
      { stop: vi.fn(() => void callOrder.push('stop-2')) },
    ];
    const closeSseClients = vi.fn(() => callOrder.push('closeSseClients'));
    const closeApp = vi.fn(async () => {
      callOrder.push('closeApp');
    });
    const closeDb = vi.fn(() => callOrder.push('closeDb'));

    const shutdown = createShutdownHandler({ collectors, closeSseClients, closeApp, closeDb });
    await shutdown('SIGTERM');

    expect(collectors[0]!.stop).toHaveBeenCalledTimes(1);
    expect(collectors[1]!.stop).toHaveBeenCalledTimes(1);
    expect(closeSseClients).toHaveBeenCalledTimes(1);
    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['stop-1', 'stop-2', 'closeSseClients', 'closeApp', 'closeDb']);
  });

  it('closes SSE clients before closeApp() even when a collector stop() is still pending', async () => {
    const callOrder: string[] = [];
    let releaseStop!: () => void;
    const pendingStop = new Promise<void>((resolve) => {
      releaseStop = () => {
        callOrder.push('stop-async-resolved');
        resolve();
      };
    });

    const collectors = [{ stop: () => pendingStop }];
    const closeSseClients = vi.fn(() => callOrder.push('closeSseClients'));
    const closeApp = vi.fn(async () => {
      callOrder.push('closeApp');
    });
    const closeDb = vi.fn();

    const shutdown = createShutdownHandler({ collectors, closeSseClients, closeApp, closeDb });
    const shutdownPromise = shutdown('SIGTERM');

    await Promise.resolve();
    await Promise.resolve();
    expect(closeSseClients).not.toHaveBeenCalled(); // 아직 collector.stop()을 기다리는 중

    releaseStop();
    await shutdownPromise;

    expect(callOrder).toEqual(['stop-async-resolved', 'closeSseClients', 'closeApp']);
  });

  it('is idempotent: a second call while/after shutting down is a no-op', async () => {
    const closeSseClients = vi.fn();
    const closeApp = vi.fn(async () => {});
    const closeDb = vi.fn();

    const shutdown = createShutdownHandler({ collectors: [], closeSseClients, closeApp, closeDb });
    await shutdown('SIGTERM');
    await shutdown('SIGINT');

    expect(closeSseClients).toHaveBeenCalledTimes(1);
    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
  });

  it('logs the start and completion of shutdown', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const shutdown = createShutdownHandler({
      collectors: [],
      closeSseClients: vi.fn(),
      closeApp: vi.fn(async () => {}),
      closeDb: vi.fn(),
      logger,
    });

    await shutdown('SIGTERM');

    expect(logger.info).toHaveBeenCalledWith('shutdown started', { signal: 'SIGTERM' });
    expect(logger.info).toHaveBeenCalledWith('shutdown complete', { signal: 'SIGTERM' });
  });
});
