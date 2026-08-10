export interface ShutdownLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ShutdownDeps {
  collectors: { stop: () => void | Promise<void> }[];
  closeApp: () => Promise<void>;
  closeDb: () => void;
  logger?: ShutdownLogger;
}

/**
 * 신규 작업 수락(수집기 소켓/타이머)부터 먼저 멈추고 각 stop()이 끝나기를
 * 기다린 뒤(예: 장기 백필 worker는 진행 중인 페이지를 마저 처리하고
 * cursor를 저장한 뒤에야 resolve된다) Fastify가 처리 중인 요청을 마무리
 * 하게 하고, 그 다음에야 DB 핸들을 닫는다. 멱등적으로 동작한다: 종료
 * 도중 두 번째 신호가 와도 DB를 이중으로 닫지 않고 아무 동작도 하지 않는다.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    deps.logger?.info('shutdown started', { signal });
    await Promise.all(deps.collectors.map((collector) => collector.stop()));
    await deps.closeApp();
    deps.closeDb();
    deps.logger?.info('shutdown complete', { signal });
  };
}
