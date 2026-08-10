import type { DbHandle } from '../db/client.js';
import { getLastClosedCandle, upsertCandles } from '../db/candles.js';
import { getCollectorState, upsertCollectorState } from '../db/collectorState.js';
import type { ConnectionStatus } from '../db/collectorState.js';
import type { FetchKlines, RawCandle } from './binanceRest.js';
import { runBackfill } from './backfill.js';
import { klineStreamUrl, parseKlineMessage } from './binanceWs.js';
import type { WsConnection, WsFactory } from './binanceWs.js';
import type { EventBus } from '../events/bus.js';

export interface CollectorLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: CollectorLogger = { info: () => {}, error: () => {} };

export interface CollectorDeps {
  db: DbHandle['db'];
  fetchKlines: FetchKlines;
  wsFactory: WsFactory;
  wsBaseUrl: string;
  backfillHours: number;
  staleAfterSeconds: number;
  now?: () => number;
  logger?: CollectorLogger;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  staleCheckIntervalMs?: number;
  events?: EventBus;
}

export interface Collector {
  stop: () => void;
}

/**
 * Starts (and keeps alive) the collector for a single symbol: the WebSocket
 * subscription is opened before the REST backfill runs so events are never
 * missed, incoming events are buffered until the backfill+flush completes,
 * and the same connect-buffer-backfill-flush cycle is reused on every
 * reconnect to gap-fill whatever was missed while disconnected.
 */
export function startCollector(symbol: string, deps: CollectorDeps): Collector {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? noopLogger;
  const reconnectBaseDelayMs = deps.reconnectBaseDelayMs ?? 1000;
  const reconnectMaxDelayMs = deps.reconnectMaxDelayMs ?? 30_000;
  const staleCheckIntervalMs = deps.staleCheckIntervalMs ?? 1000;

  let stopped = false;
  let socket: WsConnection | null = null;
  let socketOpen = false;
  let mode: 'buffering' | 'live' = 'buffering';
  let buffer: RawCandle[] = [];
  let attempt = 0;
  let lastEventAt = now();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setInterval> | null = null;

  function updateState(update: Parameters<typeof upsertCollectorState>[2]): void {
    upsertCollectorState(deps.db, symbol, update);

    if (deps.events && update.connectionStatus !== undefined) {
      const state = getCollectorState(deps.db, symbol);
      if (state) {
        deps.events.emitStatus(symbol, {
          symbol,
          connectionStatus: state.connectionStatus as ConnectionStatus,
          lastEventAt: state.lastEventAt,
          lastClosedOpenTime: state.lastClosedOpenTime,
          delayMs: state.lastEventAt != null ? now() - state.lastEventAt : null,
          lastError: state.lastError,
        });
      }
    }
  }

  function clearStaleWatchdog(): void {
    if (staleTimer) {
      clearInterval(staleTimer);
      staleTimer = null;
    }
  }

  function startStaleWatchdog(): void {
    clearStaleWatchdog();
    staleTimer = setInterval(() => {
      if (stopped || mode !== 'live') return;
      if (now() - lastEventAt >= deps.staleAfterSeconds * 1000) {
        logger.error('collector stale, forcing reconnect', { symbol });
        updateState({ connectionStatus: 'stale' });
        socket?.close();
      }
    }, staleCheckIntervalMs);
  }

  function backoffDelay(): number {
    const capped = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** attempt);
    const jitter = Math.random() * Math.min(250, capped);
    attempt += 1;
    return capped + jitter;
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectAndSync();
    }, backoffDelay());
  }

  function handleCandle(candle: RawCandle): void {
    lastEventAt = now();
    if (mode === 'buffering') {
      buffer.push(candle);
      return;
    }

    upsertCandles(deps.db, [candle]);
    updateState({
      lastEventAt,
      ...(candle.isClosed ? { lastClosedOpenTime: candle.openTime } : {}),
    });
    deps.events?.emitCandle(symbol, candle);
  }

  function flushBuffer(): void {
    if (buffer.length === 0) return;
    const sorted = [...buffer].sort((a, b) => a.openTime - b.openTime);
    buffer = [];
    upsertCandles(deps.db, sorted);
  }

  function attachHandlers(ws: WsConnection): void {
    ws.on('open', () => {
      socketOpen = true;
      attempt = 0;
      if (mode === 'live') {
        updateState({ connectionStatus: 'live', lastError: null });
      }
    });

    ws.on('message', (data) => {
      const candle = parseKlineMessage(data);
      if (candle) handleCandle(candle);
    });

    ws.on('error', (error) => {
      logger.error('collector websocket error', { symbol, error: String(error) });
      updateState({ lastError: String(error) });
    });

    ws.on('close', () => {
      socketOpen = false;
      clearStaleWatchdog();
      if (stopped) return;
      updateState({ connectionStatus: 'reconnecting' });
      scheduleReconnect();
    });
  }

  function connectAndSync(): void {
    if (stopped) return;
    mode = 'buffering';
    buffer = [];
    socket = deps.wsFactory(klineStreamUrl(deps.wsBaseUrl, symbol));
    attachHandlers(socket);

    runBackfill({ db: deps.db, fetchKlines: deps.fetchKlines, now }, symbol, deps.backfillHours)
      .then(() => {
        if (stopped) return;
        flushBuffer();
        mode = 'live';
        lastEventAt = now();

        const lastClosed = getLastClosedCandle(deps.db, symbol);
        updateState({
          lastError: null,
          ...(lastClosed ? { lastClosedOpenTime: lastClosed.openTime } : {}),
          ...(socketOpen ? { connectionStatus: 'live' as const } : {}),
        });
        startStaleWatchdog();
      })
      .catch((error: unknown) => {
        logger.error('backfill failed', { symbol, error: String(error) });
        if (stopped) return;
        updateState({ connectionStatus: 'reconnecting', lastError: String(error) });
        socket?.close();
      });
  }

  updateState({ connectionStatus: 'connecting' });
  connectAndSync();

  return {
    stop: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearStaleWatchdog();
      socket?.close();
    },
  };
}
