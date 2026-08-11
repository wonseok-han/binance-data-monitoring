// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, getCandles, subscribeToMarketEvents } from './api';

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

  it('bypasses an older in-flight candle snapshot when a fresh response is required', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(candleResponse), { status: 200 }),
    ));
    vi.stubGlobal('fetch', fetchMock);

    const initial = getCandles('BTCUSDT', '1m');
    const afterBackfill = getCandles('BTCUSDT', '1m', { fresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.all([initial, afterBackfill]);
  });

  it('shares a request while allowing each AbortSignal consumer to cancel independently', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = getCandles('BTCUSDT', '1m', { signal: firstController.signal });
    const second = getCandles('BTCUSDT', '1m', { signal: secondController.signal });
    firstController.abort();

    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    resolveFetch(new Response(JSON.stringify(candleResponse), { status: 200 }));
    await expect(second).resolves.toEqual(candleResponse);
  });

  it('shows a stable user message for empty and unreachable error responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCandles('BTCUSDT', '1m')).rejects.toMatchObject({
      message: '요청을 처리하지 못했습니다.',
      code: 'UNKNOWN_ERROR',
      status: 502,
    } satisfies Partial<ApiRequestError>);
    await expect(getCandles('BTCUSDT', '1m')).rejects.toMatchObject({
      message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      code: 'NETWORK_ERROR',
      status: 0,
    } satisfies Partial<ApiRequestError>);
  });

  it('uses nextBefore as the next request to cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(candleResponse), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getCandles('BTCUSDT', '1m', { to: 1_754_006_399_999 });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('&to=1754006399999'));
  });
});

describe('market event stream', () => {
  it('recreates a failed stream and requests one snapshot after it opens', () => {
    vi.useFakeTimers();
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();

      constructor() {
        FakeEventSource.instances.push(this);
      }

      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onReconnect = vi.fn();

    subscribeToMarketEvents({
      onCandle: vi.fn(),
      onStatus: vi.fn(),
      onStateChange: vi.fn(),
      onReconnect,
    });

    FakeEventSource.instances[0]?.onopen?.();
    expect(onReconnect).not.toHaveBeenCalled();
    FakeEventSource.instances[0]?.onerror?.();
    expect(FakeEventSource.instances[0]?.close).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1]?.onopen?.();
    expect(onReconnect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('cancels a pending reconnect when unsubscribing', () => {
    vi.useFakeTimers();
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();

      constructor() {
        FakeEventSource.instances.push(this);
      }

      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);

    const unsubscribe = subscribeToMarketEvents({
      onCandle: vi.fn(),
      onStatus: vi.fn(),
      onStateChange: vi.fn(),
      onReconnect: vi.fn(),
    });
    FakeEventSource.instances[0]?.onerror?.();
    unsubscribe();
    vi.runAllTimers();

    expect(FakeEventSource.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});
