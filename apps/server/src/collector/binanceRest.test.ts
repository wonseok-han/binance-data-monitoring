import { describe, expect, it, vi } from 'vitest';
import { BinanceRestError, createBinanceRestClient, isRetryableBinanceError } from './binanceRest.js';

const SAMPLE_KLINE = [
  1_700_000_000_000,
  '100.00',
  '101.00',
  '99.00',
  '100.50',
  '10.5',
  1_700_000_059_999,
  '1050.0',
  42,
  '5.0',
  '500.0',
  '0',
];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('createBinanceRestClient', () => {
  it('parses a successful klines response into RawCandle rows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([SAMPLE_KLINE]));
    const client = createBinanceRestClient({ baseUrl: 'https://api.binance.com', fetchImpl });

    const rows = await client.fetchKlines({ symbol: 'BTCUSDT', startTime: 0, endTime: 1 });

    expect(rows).toEqual([
      {
        symbol: 'BTCUSDT',
        openTime: 1_700_000_000_000,
        closeTime: 1_700_000_059_999,
        open: '100.00',
        high: '101.00',
        low: '99.00',
        close: '100.50',
        volume: '10.5',
        quoteVolume: '1050.0',
        tradeCount: 42,
        isClosed: true,
      },
    ]);
  });

  it('retries a retryable error and honors the Retry-After header', async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(jsonResponse([SAMPLE_KLINE]));

    const client = createBinanceRestClient({
      baseUrl: 'https://api.binance.com',
      fetchImpl,
      sleepImpl,
    });

    const rows = await client.fetchKlines({ symbol: 'BTCUSDT', startTime: 0, endTime: 1 });

    expect(rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });

  it('throws BinanceRestError after exceeding maxRetries on repeated 500s', async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));

    const client = createBinanceRestClient({
      baseUrl: 'https://api.binance.com',
      fetchImpl,
      maxRetries: 2,
      sleepImpl,
    });

    await expect(client.fetchKlines({ symbol: 'BTCUSDT', startTime: 0, endTime: 1 })).rejects.toThrow(
      BinanceRestError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('fails fast on a non-retryable client error without sleeping', async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));

    const client = createBinanceRestClient({
      baseUrl: 'https://api.binance.com',
      fetchImpl,
      sleepImpl,
    });

    await expect(client.fetchKlines({ symbol: 'BTCUSDT', startTime: 0, endTime: 1 })).rejects.toThrow(
      BinanceRestError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});

describe('isRetryableBinanceError', () => {
  it('treats rate limit and server errors as retryable', () => {
    expect(isRetryableBinanceError(new BinanceRestError('rate limited', 429))).toBe(true);
    expect(isRetryableBinanceError(new BinanceRestError('server error', 503))).toBe(true);
    expect(isRetryableBinanceError(new BinanceRestError('banned', 418))).toBe(true);
  });

  it('treats other client errors as permanent', () => {
    expect(isRetryableBinanceError(new BinanceRestError('bad request', 400))).toBe(false);
    expect(isRetryableBinanceError(new BinanceRestError('not found', 404))).toBe(false);
  });

  it('treats unknown errors (network failures, timeouts) as retryable', () => {
    expect(isRetryableBinanceError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableBinanceError(new Error('unexpected'))).toBe(true);
  });
});
