import type { WsConnection, WsEvent, WsFactory } from '../../src/collector/binanceWs.js';

type Listener = (...args: unknown[]) => void;

export class FakeWsConnection implements WsConnection {
  private readonly listeners: Record<WsEvent, Listener[]> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  closed = false;

  on(event: WsEvent, listener: Listener): void {
    this.listeners[event].push(listener);
  }

  emit(event: WsEvent, ...args: unknown[]): void {
    for (const listener of [...this.listeners[event]]) listener(...args);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

export function createFakeWsFactory(): { factory: WsFactory; instances: FakeWsConnection[] } {
  const instances: FakeWsConnection[] = [];
  const factory: WsFactory = () => {
    const connection = new FakeWsConnection();
    instances.push(connection);
    return connection;
  };
  return { factory, instances };
}
