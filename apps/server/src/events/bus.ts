import { EventEmitter } from 'node:events';
import type { RawCandle } from '../collector/binanceRest.js';
import type { BackfillRunRecord, ConnectionStatus } from '../db/collectorState.js';
import type { Completeness24h } from '../status/completeness.js';

export interface StatusEventPayload {
  symbol: string;
  connectionStatus: ConnectionStatus;
  lastEventAt: number | null;
  lastClosedOpenTime: number | null;
  delayMs: number | null;
  lastError: string | null;
  lastBackfill: BackfillRunRecord | null;
  completeness24h: Completeness24h;
}

export interface EventBus {
  emitCandle(symbol: string, candle: RawCandle): void;
  emitStatus(symbol: string, status: StatusEventPayload): void;
  onCandle(listener: (symbol: string, candle: RawCandle) => void): () => void;
  onStatus(listener: (symbol: string, status: StatusEventPayload) => void): () => void;
}

/**
 * DB에 반영이 확정된 candle/status 변경을 SSE 구독자에게 전파하는
 * 프로세스 내 pub/sub. 대응하는 SQLite 쓰기가 커밋되기 전에는
 * 절대 이벤트를 발행하지 않는다.
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
