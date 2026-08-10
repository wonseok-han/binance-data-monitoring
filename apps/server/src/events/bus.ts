import { EventEmitter } from 'node:events';
import type { RawCandle } from '../collector/binanceRest.js';
import type { ConnectionStatus } from '../db/collectorState.js';

export interface StatusEventPayload {
  symbol: string;
  connectionStatus: ConnectionStatus;
  lastEventAt: number | null;
  lastClosedOpenTime: number | null;
  delayMs: number | null;
  lastError: string | null;
}

export interface EventBus {
  emitCandle(symbol: string, candle: RawCandle): void;
  emitStatus(symbol: string, status: StatusEventPayload): void;
  onCandle(listener: (symbol: string, candle: RawCandle) => void): () => void;
  onStatus(listener: (symbol: string, status: StatusEventPayload) => void): () => void;
}

/**
 * In-process pub/sub used to fan out DB-confirmed candle/status changes to
 * SSE subscribers. Nothing is ever published before the corresponding write
 * to SQLite has already committed.
 */
export function createEventBus(): EventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  return {
    emitCandle(symbol, candle) {
      emitter.emit('candle', symbol, candle);
    },
    emitStatus(symbol, status) {
      emitter.emit('status', symbol, status);
    },
    onCandle(listener) {
      emitter.on('candle', listener);
      return () => emitter.off('candle', listener);
    },
    onStatus(listener) {
      emitter.on('status', listener);
      return () => emitter.off('status', listener);
    },
  };
}
