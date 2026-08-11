import { z } from 'zod';
import { policy } from '../config/index.js';

const KlineSchema = z.tuple([
  z.number(), // 시가 시각
  z.string(), // 시가
  z.string(), // 고가
  z.string(), // 저가
  z.string(), // 종가
  z.string(), // 거래량
  z.number(), // 종가 시각
  z.string(), // 거래대금(USDT)
  z.number(), // 체결 수
  z.string(), // taker 매수 base 거래량
  z.string(), // taker 매수 quote 거래량
  z.string(), // 사용하지 않음
]);

const KlinesResponseSchema = z.array(KlineSchema);

export interface RawCandle {
  symbol: string;
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradeCount: number;
  isClosed: boolean;
}

export class BinanceRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BinanceRestError';
  }
}

export interface FetchKlinesParams {
  symbol: string;
  startTime: number;
  endTime: number;
  limit?: number;
}

export type FetchKlines = (params: FetchKlinesParams) => Promise<RawCandle[]>;

export interface BinanceRestClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([408, 418, 429]);

function isRetryable(status: number): boolean {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

/**
 * 장기 백필처럼 REST 클라이언트의 내장 재시도(maxRetries)를 소진한 뒤에도
 * job 단위로 계속 재시도할지 판단한다. `BinanceRestError`는 HTTP 상태로
 * 판단하고, 그 외(네트워크 오류, 타임아웃, 응답 파싱 실패 등 알 수 없는 오류)는
 * 원인을 알 수 없으므로 일시적인 것으로 간주해 재시도 대상으로 취급한다.
 */
export function isRetryableBinanceError(error: unknown): boolean {
  if (error instanceof BinanceRestError) {
    return isRetryable(error.status);
  }
  return true;
}

function retryDelayFor(response: Response, baseDelayMs: number, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  return baseDelayMs * 2 ** attempt;
}

function toRawCandle(symbol: string, kline: z.infer<typeof KlineSchema>): RawCandle {
  const [openTime, open, high, low, close, volume, closeTime, quoteVolume, tradeCount] = kline;
  return {
    symbol,
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
    quoteVolume,
    tradeCount,
    isClosed: true,
  };
}

export function createBinanceRestClient(options: BinanceRestClientOptions): { fetchKlines: FetchKlines } {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? policy.binanceRest.maxRetries;
  const retryDelayMs = options.retryDelayMs ?? policy.binanceRest.retryDelayMs;
  const sleepImpl =
    options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function fetchKlines(params: FetchKlinesParams): Promise<RawCandle[]> {
    const url = new URL('/api/v3/klines', options.baseUrl);
    url.searchParams.set('symbol', params.symbol);
    url.searchParams.set('interval', '1m');
    url.searchParams.set('startTime', String(params.startTime));
    url.searchParams.set('endTime', String(params.endTime));
    url.searchParams.set('limit', String(params.limit ?? 1000));

    for (let attempt = 0; ; attempt += 1) {
      const response = await fetchImpl(url);

      if (response.ok) {
        const json = await response.json();
        const klines = KlinesResponseSchema.parse(json);
        return klines.map((kline) => toRawCandle(params.symbol, kline));
      }

      if (attempt >= maxRetries || !isRetryable(response.status)) {
        throw new BinanceRestError(
          `Binance REST request failed for ${params.symbol}: ${response.status}`,
          response.status,
        );
      }

      await sleepImpl(retryDelayFor(response, retryDelayMs, attempt));
    }
  }

  return { fetchKlines };
}
