import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from './shutdown.js';

describe('createShutdownHandler', () => {
  it('stops every collector, then closes the app, then closes the DB', async () => {
    const callOrder: string[] = [];
    const collectors = [
      { stop: vi.fn(() => callOrder.push('stop-1')) },
      { stop: vi.fn(() => callOrder.push('stop-2')) },
    ];
    const closeApp = vi.fn(async () => {
      callOrder.push('closeApp');
    });
    const closeDb = vi.fn(() => callOrder.push('closeDb'));

    const shutdown = createShutdownHandler({ collectors, closeApp, closeDb });
    await shutdown('SIGTERM');

    expect(collectors[0]!.stop).toHaveBeenCalledTimes(1);
    expect(collectors[1]!.stop).toHaveBeenCalledTimes(1);
    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['stop-1', 'stop-2', 'closeApp', 'closeDb']);
  });

  it('is idempotent: a second call while/after shutting down is a no-op', async () => {
    const closeApp = vi.fn(async () => {});
    const closeDb = vi.fn();

    const shutdown = createShutdownHandler({ collectors: [], closeApp, closeDb });
    await shutdown('SIGTERM');
    await shutdown('SIGINT');

    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
  });

  it('logs the start and completion of shutdown', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const shutdown = createShutdownHandler({
      collectors: [],
      closeApp: vi.fn(async () => {}),
      closeDb: vi.fn(),
      logger,
    });

    await shutdown('SIGTERM');

    expect(logger.info).toHaveBeenCalledWith('shutdown started', { signal: 'SIGTERM' });
    expect(logger.info).toHaveBeenCalledWith('shutdown complete', { signal: 'SIGTERM' });
  });
});
