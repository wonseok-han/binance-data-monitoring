import type { DbHandle } from '../db/client.js';
import { getLastClosedCandle, upsertCandles } from '../db/candles.js';
import { serializeBackfillRecord, upsertCollectorState } from '../db/collectorState.js';
import type { BackfillRunRecord } from '../db/collectorState.js';
import type { FetchKlines, RawCandle } from './binanceRest.js';
import { computeBackfillRange, runBackfill } from './backfill.js';
import { klineStreamUrl, parseKlineMessage } from './binanceWs.js';
import type { WsConnection, WsFactory } from './binanceWs.js';
import type { EventBus } from '../events/bus.js';
import { buildSymbolStatus } from '../status/status.js';
import { policy } from '../config/index.js';

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
  /** 이 종목이 처음으로 실시간 모드에 도달했을 때 정확히 한 번 호출된다(재연결 시에는 다시 호출되지 않는다). */
  onFirstLive?: () => void;
}

export interface Collector {
  stop: () => void;
}

/**
 * 종목 하나의 수집기를 시작(하고 계속 유지)한다: 이벤트를 놓치지 않도록
 * REST 백필을 실행하기 전에 WebSocket 구독을 먼저 연다. 백필+flush가
 * 끝날 때까지 들어오는 이벤트는 버퍼링하며, 재연결 시에도 동일한
 * connect-buffer-backfill-flush 절차를 재사용해 연결이 끊긴 동안
 * 놓친 구간을 gap-fill한다.
 */
export function startCollector(symbol: string, deps: CollectorDeps): Collector {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? noopLogger;
  const reconnectBaseDelayMs = deps.reconnectBaseDelayMs ?? policy.collector.reconnectBaseDelayMs;
  const reconnectMaxDelayMs = deps.reconnectMaxDelayMs ?? policy.collector.reconnectMaxDelayMs;
  const staleCheckIntervalMs = deps.staleCheckIntervalMs ?? 1000;

  let stopped = false;
  let socket: WsConnection | null = null;
  let socketOpen = false;
  let mode: 'buffering' | 'live' = 'buffering';
  let buffer: RawCandle[] = [];
  let attempt = 0;
  let lastEventAt = now();
  let reachedLiveBefore = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setInterval> | null = null;

  function emitStatusSnapshot(): void {
    if (!deps.events) return;
    deps.events.emitStatus(symbol, buildSymbolStatus(deps.db, symbol, now()));
  }

  function updateState(update: Parameters<typeof upsertCollectorState>[2]): void {
    upsertCollectorState(deps.db, symbol, update);
    if (update.connectionStatus !== undefined) emitStatusSnapshot();
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
    // 확정 봉은 completeness24h/coverage가 바뀌므로 connectionStatus 변경이 없어도 상태 스냅샷을 발행한다.
    if (candle.isClosed) emitStatusSnapshot();
  }

  function flushBuffer(): number {
    if (buffer.length === 0) return 0;
    const sorted = [...buffer].sort((a, b) => a.openTime - b.openTime);
    buffer = [];
    upsertCandles(deps.db, sorted);
    return sorted.length;
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
    logger.info('collector connecting', { symbol, attempt });
    socket = deps.wsFactory(klineStreamUrl(deps.wsBaseUrl, symbol));
    attachHandlers(socket);

    const backfillStartedAt = now();
    const plannedRange = computeBackfillRange(deps.db, symbol, deps.backfillHours, backfillStartedAt);

    function buildBackfillRecord(result: BackfillRunRecord['result'], count: number, error: string | null): string {
      const finishedAt = now();
      const record: BackfillRunRecord = {
        startedAt: backfillStartedAt,
        finishedAt,
        durationMs: finishedAt - backfillStartedAt,
        from: plannedRange?.startTime ?? null,
        to: plannedRange?.endTime ?? null,
        count,
        result,
        error,
      };
      return serializeBackfillRecord(record);
    }

    runBackfill({ db: deps.db, fetchKlines: deps.fetchKlines, now }, symbol, deps.backfillHours)
      .then((backfilledCount) => {
        if (stopped) return;
        const flushedCount = flushBuffer();
        mode = 'live';
        lastEventAt = now();

        const lastClosed = getLastClosedCandle(deps.db, symbol);
        updateState({
          lastError: null,
          lastBackfillJson: buildBackfillRecord('success', backfilledCount, null),
          ...(lastClosed ? { lastClosedOpenTime: lastClosed.openTime } : {}),
          ...(socketOpen ? { connectionStatus: 'live' as const } : {}),
        });
        startStaleWatchdog();
        logger.info('collector live', { symbol, backfilledCount, flushedCount });

        if (!reachedLiveBefore) {
          reachedLiveBefore = true;
          deps.onFirstLive?.();
        }
      })
      .catch((error: unknown) => {
        logger.error('backfill failed', { symbol, error: String(error) });
        if (stopped) return;
        updateState({
          connectionStatus: 'reconnecting',
          lastError: String(error),
          lastBackfillJson: buildBackfillRecord('error', 0, String(error)),
        });
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
      logger.info('collector stopped', { symbol });
    },
  };
}
