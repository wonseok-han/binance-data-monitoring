import {
  ApiErrorSchema,
  CandleEventSchema,
  CandlesResponseSchema,
  StatusEventSchema,
  StatusResponseSchema,
  SummaryResponseSchema,
  type CandleEvent,
  type StatusEvent,
} from '@binance-monitoring/shared';
import type { MarketSymbol, RangeHours } from './market';

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

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
}

export function getStatus(signal?: AbortSignal) {
  return request('/api/status', StatusResponseSchema, signal);
}

export function getSummary(symbol: MarketSymbol, signal?: AbortSignal) {
  return request(`/api/summary?symbol=${symbol}`, SummaryResponseSchema, signal);
}

export function getCandles(
  symbol: MarketSymbol,
  rangeHours: RangeHours,
  signal?: AbortSignal,
) {
  const currentMinute = Math.floor(Date.now() / 60_000) * 60_000;
  const from = currentMinute - rangeHours * 60 * 60_000;
  const limit = rangeHours * 60 + 1;
  return request(
    `/api/candles?symbol=${symbol}&from=${from}&limit=${limit}`,
    CandlesResponseSchema,
    signal,
  );
}

export type StreamState = 'connecting' | 'live' | 'reconnecting';

export function subscribeToMarketEvents(options: {
  onCandle: (event: CandleEvent) => void;
  onStatus: (event: StatusEvent) => void;
  onStateChange: (state: StreamState) => void;
}): () => void {
  const source = new EventSource(apiUrl('/api/events'));
  options.onStateChange('connecting');

  source.onopen = () => options.onStateChange('live');
  source.onerror = () => options.onStateChange('reconnecting');

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
