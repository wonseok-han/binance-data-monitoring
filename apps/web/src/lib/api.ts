import {
  ApiErrorSchema,
  CandleEventSchema,
  CandlesResponseSchema,
  StatusEventSchema,
  StatusResponseSchema,
  SummaryResponseSchema,
  type CandleEvent,
  type Interval,
  type StatusEvent,
} from '@binance-monitoring/shared';
import { intervalLimit, type MarketSymbol } from './market';

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const inFlightRequests = new Map<string, Promise<unknown>>();
const STREAM_RETRY_BASE_DELAY_MS = 1_000;
const STREAM_RETRY_MAX_DELAY_MS = 30_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

async function request<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  signal?: AbortSignal,
  shareInFlight = true,
): Promise<T> {
  const execute = async (): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(apiUrl(path));
    } catch {
      throw new ApiRequestError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 'NETWORK_ERROR', 0);
    }

    const body = await response.text();
    let payload: unknown = null;
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch {
        if (response.ok) {
          throw new ApiRequestError('서버 응답을 확인할 수 없습니다.', 'INVALID_RESPONSE', response.status);
        }
      }
    }

    if (!response.ok) {
      const parsedError = ApiErrorSchema.safeParse(payload);
      throw new ApiRequestError(
        parsedError.success ? parsedError.data.error.message : '요청을 처리하지 못했습니다.',
        parsedError.success ? parsedError.data.error.code : 'UNKNOWN_ERROR',
        response.status,
      );
    }

    return schema.parse(payload);
  };

  const existing = shareInFlight
    ? (inFlightRequests.get(path) as Promise<T> | undefined)
    : undefined;
  const shared = existing ?? (shareInFlight
    ? execute().finally(() => inFlightRequests.delete(path))
    : execute());
  if (shareInFlight && !existing) inFlightRequests.set(path, shared);
  if (!signal) return shared;
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function getStatus(signal?: AbortSignal) {
  return request('/api/status', StatusResponseSchema, signal);
}

export function getSummary(symbol: MarketSymbol, signal?: AbortSignal) {
  return request(`/api/summary?symbol=${symbol}`, SummaryResponseSchema, signal);
}

export function getCandles(
  symbol: MarketSymbol,
  interval: Interval,
  options: { signal?: AbortSignal; to?: number; fresh?: boolean } = {},
) {
  const before = options.to == null ? '' : `&to=${options.to}`;
  return request(
    `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${intervalLimit(interval)}${before}`,
    CandlesResponseSchema,
    options.signal,
    !options.fresh,
  );
}

export type StreamState = 'connecting' | 'live' | 'reconnecting';

export function subscribeToMarketEvents(options: {
  onCandle: (event: CandleEvent) => void;
  onStatus: (event: StatusEvent) => void;
  onStateChange: (state: StreamState) => void;
  onReconnect: () => void;
}): () => void {
  let source: EventSource | null = null;
  let retryTimer: number | null = null;
  let retryCount = 0;
  let disconnected = false;
  let stopped = false;
  options.onStateChange('connecting');

  const connect = () => {
    if (stopped) return;
    const nextSource = new EventSource(apiUrl('/api/events'));
    source = nextSource;

    nextSource.onopen = () => {
      if (stopped || source !== nextSource) return;
      retryCount = 0;
      options.onStateChange('live');
      if (disconnected) options.onReconnect();
      disconnected = false;
    };
    nextSource.onerror = () => {
      if (stopped || source !== nextSource) return;
      disconnected = true;
      options.onStateChange('reconnecting');
      nextSource.close();
      source = null;
      const delay = Math.min(
        STREAM_RETRY_BASE_DELAY_MS * 2 ** retryCount,
        STREAM_RETRY_MAX_DELAY_MS,
      );
      retryCount += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    nextSource.addEventListener('candle', (message) => {
      try {
        const parsed = CandleEventSchema.safeParse(JSON.parse(message.data as string));
        if (parsed.success) options.onCandle(parsed.data);
      } catch {
        // Ignore malformed stream frames and keep the connection alive.
      }
    });

    nextSource.addEventListener('status', (message) => {
      try {
        const parsed = StatusEventSchema.safeParse(JSON.parse(message.data as string));
        if (parsed.success) options.onStatus(parsed.data);
      } catch {
        // Ignore malformed stream frames and keep the connection alive.
      }
    });
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer != null) window.clearTimeout(retryTimer);
    source?.close();
    source = null;
  };
}
