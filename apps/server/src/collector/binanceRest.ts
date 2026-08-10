import { z } from 'zod';

const KlineSchema = z.tuple([
  z.number(), // open time
  z.string(), // open
  z.string(), // high
  z.string(), // low
  z.string(), // close
  z.string(), // volume
  z.number(), // close time
  z.string(), // quote asset volume
  z.number(), // trade count
  z.string(), // taker buy base volume
  z.string(), // taker buy quote volume
  z.string(), // unused
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
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 500;
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
