// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCandles, subscribeToMarketEvents } from './api';

const candleResponse = {
  symbol: 'BTCUSDT',
  interval: '1m' as const,
  candles: [],
  page: { nextBefore: 123, hasMore: true },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP requests', () => {
  it('deduplicates concurrent requests for the same URL', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = getCandles('BTCUSDT', '1m');
    const second = getCandles('BTCUSDT', '1m');
    expect(fetchMock).toHaveBeenCalledOnce();

    resolveFetch(new Response(JSON.stringify(candleResponse), { status: 200 }));
    await expect(Promise.all([first, second])).resolves.toEqual([candleResponse, candleResponse]);
  });

  it('uses nextBefore as the next request to cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(candleResponse), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getCandles('BTCUSDT', '1m', { to: 1_754_006_399_999 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('&to=1754006399999'),
      expect.objectContaining({ signal: undefined }),
    );
  });
});

describe('market event stream', () => {
  it('requests a snapshot only after a disconnected stream opens again', () => {
    class FakeEventSource {
      static instance: FakeEventSource;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        FakeEventSource.instance = this;
      }

      addEventListener() {}
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onReconnect = vi.fn();

    subscribeToMarketEvents({
      onCandle: vi.fn(),
      onStatus: vi.fn(),
      onStateChange: vi.fn(),
      onReconnect,
    });

    FakeEventSource.instance.onopen?.();
    expect(onReconnect).not.toHaveBeenCalled();
    FakeEventSource.instance.onerror?.();
    FakeEventSource.instance.onopen?.();
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});
