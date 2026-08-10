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
): Promise<T> {
  const execute = async (): Promise<T> => {
    const response = await fetch(apiUrl(path), { signal });
    const payload: unknown = await response.json();

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

  // AbortSignal이 있는 초기 화면 요청은 화면 전환 시 독립적으로 취소해야 한다.
  // 백그라운드/SSE 재동기화 요청만 URL 단위로 공유한다.
  if (signal) return execute();

  const existing = inFlightRequests.get(path) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = execute().finally(() => inFlightRequests.delete(path));
  inFlightRequests.set(path, pending);
  return pending;
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
  options: { signal?: AbortSignal; to?: number } = {},
) {
  const before = options.to == null ? '' : `&to=${options.to}`;
  return request(
    `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${intervalLimit(interval)}${before}`,
    CandlesResponseSchema,
    options.signal,
  );
}

export type StreamState = 'connecting' | 'live' | 'reconnecting';

export function subscribeToMarketEvents(options: {
  onCandle: (event: CandleEvent) => void;
  onStatus: (event: StatusEvent) => void;
  onStateChange: (state: StreamState) => void;
  onReconnect: () => void;
}): () => void {
  const source = new EventSource(apiUrl('/api/events'));
  let disconnected = false;
  options.onStateChange('connecting');

  source.onopen = () => {
    options.onStateChange('live');
    if (disconnected) options.onReconnect();
    disconnected = false;
  };
  source.onerror = () => {
    disconnected = true;
    options.onStateChange('reconnecting');
  };

  source.addEventListener('candle', (message) => {
    try {
      const parsed = CandleEventSchema.safeParse(JSON.parse(message.data as string));
      if (parsed.success) options.onCandle(parsed.data);
    } catch {
      // Ignore malformed stream frames and keep the connection alive.
    }
  });

  source.addEventListener('status', (message) => {
    try {
      const parsed = StatusEventSchema.safeParse(JSON.parse(message.data as string));
      if (parsed.success) options.onStatus(parsed.data);
    } catch {
      // Ignore malformed stream frames and keep the connection alive.
    }
  });

  return () => source.close();
}
