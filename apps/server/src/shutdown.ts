export interface ShutdownLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ShutdownDeps {
  collectors: { stop: () => void }[];
  closeApp: () => Promise<void>;
  closeDb: () => void;
  logger?: ShutdownLogger;
}

/**
 * Stops accepting new work first (collector sockets/timers), then lets
 * Fastify drain in-flight requests, and only closes the DB handle once
 * both have settled. Idempotent: a second signal during shutdown is a
 * no-op rather than double-closing the DB.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    deps.logger?.info('shutdown started', { signal });
    deps.collectors.forEach((collector) => collector.stop());
    await deps.closeApp();
    deps.closeDb();
    deps.logger?.info('shutdown complete', { signal });
  };
}
