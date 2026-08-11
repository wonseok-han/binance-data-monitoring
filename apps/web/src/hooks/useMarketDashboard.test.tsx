// @vitest-environment jsdom

import type { Candle, SymbolStatus } from '@binance-monitoring/shared';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarketDashboard } from './useMarketDashboard';

const api = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getSummary: vi.fn(),
  getCandles: vi.fn(),
  subscribe: vi.fn(),
  handlers: undefined as
    | {
        onCandle: (event: { symbol: string; candle: Candle }) => void;
        onStatus: (event: { symbol: string; status: SymbolStatus }) => void;
        onReconnect: () => void;
      }
    | undefined,
}));

vi.mock('../lib/api', () => ({
  ApiRequestError: class ApiRequestError extends Error {
    code = 'UNKNOWN';
  },
  getStatus: api.getStatus,
  getSummary: api.getSummary,
  getCandles: api.getCandles,
  subscribeToMarketEvents: api.subscribe,
}));

const status: SymbolStatus = {
  symbol: 'BTCUSDT',
  connectionStatus: 'live',
  lastEventAt: 1,
  lastClosedOpenTime: 60_000,
  delayMs: 0,
  lastError: null,
  lastBackfill: null,
  completeness24h: { expected: 1440, confirmed: 1440, missing: 0 },
  historicalBackfill: null,
  coverage: { from: 60_000, to: 120_000 },
};

function candle(isClosed: boolean): Candle {
  return {
    symbol: 'BTCUSDT',
    openTime: 120_000,
    closeTime: 179_999,
    open: '100',
    high: '110',
    low: '90',
    close: '105',
    volume: '2',
    quoteVolume: '205',
    tradeCount: 3,
    isClosed,
    updatedAt: 130_000,
  };
}

function backfillStatus(state: 'running' | 'completed'): SymbolStatus {
  return {
    ...status,
    historicalBackfill: {
      status: state,
      processed: state === 'completed' ? 525_600 : 1_000,
      total: 525_600,
      progressPercent: state === 'completed' ? 100 : 0.19,
      from: Date.UTC(2025, 7, 10),
      to: Date.UTC(2026, 7, 10),
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
    },
  };
}

beforeEach(() => {
  api.getStatus.mockReset().mockResolvedValue({ symbols: [status] });
  api.getSummary.mockReset().mockResolvedValue({
    symbol: 'BTCUSDT',
    currentPrice: '105',
    asOf: 130_000,
    change1h: '5',
    changePercent1h: 5,
    quoteVolume1h: '1000',
  });
  api.getCandles.mockReset().mockImplementation((_symbol, interval) =>
    Promise.resolve({
      symbol: 'BTCUSDT',
      interval,
      candles: [candle(true)],
      page: { nextBefore: 119_999, hasMore: true },
    }),
  );
  api.subscribe.mockReset().mockImplementation((handlers) => {
    api.handlers = handlers;
    return () => {};
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useMarketDashboard synchronization', () => {
  it('keeps the current candle data when the active interval is selected again', async () => {
    const { result } = renderHook(() => useMarketDashboard());
    await waitFor(() => expect(result.current.requestState).toBe('ready'));
    api.getCandles.mockClear();

    act(() => result.current.setInterval('1m'));

    expect(result.current.candles).toHaveLength(1);
    expect(api.getCandles).not.toHaveBeenCalled();
  });

  it('uses a five-minute safety poll and refreshes aggregates only for a closed candle', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const { result } = renderHook(() => useMarketDashboard());

    await waitFor(() => expect(result.current.requestState).toBe('ready'));
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 300_000);

    api.getSummary.mockClear();
    api.getCandles.mockClear();
    act(() => result.current.setInterval('6h'));
    await waitFor(() => expect(api.getCandles).toHaveBeenCalledWith('BTCUSDT', '6h', expect.anything()));
    api.getSummary.mockClear();
    api.getCandles.mockClear();

    act(() => api.handlers?.onCandle({ symbol: 'BTCUSDT', candle: candle(false) }));
    expect(api.getSummary).not.toHaveBeenCalled();
    expect(api.getCandles).not.toHaveBeenCalled();

    act(() => api.handlers?.onCandle({ symbol: 'BTCUSDT', candle: candle(true) }));
    await waitFor(() => expect(api.getSummary).toHaveBeenCalledOnce());
    expect(api.getCandles).toHaveBeenCalledOnce();
  });

  it('resynchronizes status, summary, and the selected candle page after reconnecting', async () => {
    const { result } = renderHook(() => useMarketDashboard());
    await waitFor(() => expect(result.current.requestState).toBe('ready'));
    api.getStatus.mockClear();
    api.getSummary.mockClear();
    api.getCandles.mockClear();

    act(() => api.handlers?.onReconnect());

    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalledOnce();
      expect(api.getSummary).toHaveBeenCalledOnce();
      expect(api.getCandles).toHaveBeenCalledOnce();
    });
  });

  it('replaces the candle snapshot once when historical backfill completes', async () => {
    api.getStatus.mockResolvedValue({ symbols: [backfillStatus('running')] });
    const { result } = renderHook(() => useMarketDashboard());
    await waitFor(() => expect(result.current.requestState).toBe('ready'));
    api.getCandles.mockClear().mockResolvedValue({
      symbol: 'BTCUSDT',
      interval: '1m',
      candles: [{ ...candle(true), openTime: 60_000 }],
      page: { nextBefore: 59_999, hasMore: false },
    });

    act(() => api.handlers?.onStatus({ symbol: 'BTCUSDT', status: backfillStatus('completed') }));

    await waitFor(() => expect(api.getCandles).toHaveBeenCalledWith('BTCUSDT', '1m', { fresh: true }));
    await waitFor(() => expect(result.current.candles[0]?.openTime).toBe(60_000));
    expect(result.current.page).toEqual({ nextBefore: 59_999, hasMore: false });

    act(() => api.handlers?.onStatus({ symbol: 'BTCUSDT', status: backfillStatus('completed') }));
    expect(api.getCandles).toHaveBeenCalledOnce();
  });

  it('cancels reconnect snapshot consumers when the selection changes', async () => {
    const { result } = renderHook(() => useMarketDashboard());
    await waitFor(() => expect(result.current.requestState).toBe('ready'));
    api.getStatus.mockClear().mockReturnValue(new Promise(() => {}));
    api.getSummary.mockClear().mockReturnValue(new Promise(() => {}));
    api.getCandles.mockClear().mockReturnValue(new Promise(() => {}));

    act(() => api.handlers?.onReconnect());
    const statusSignal = api.getStatus.mock.calls[0]?.[0] as AbortSignal;
    const candleSignal = api.getCandles.mock.calls[0]?.[2]?.signal as AbortSignal;
    expect(statusSignal.aborted).toBe(false);
    expect(candleSignal.aborted).toBe(false);

    act(() => result.current.setInterval('6h'));
    expect(statusSignal.aborted).toBe(true);
    expect(candleSignal.aborted).toBe(true);
  });

  it('enables the next cursor when background coverage has expanded past the oldest candle', async () => {
    api.getCandles.mockResolvedValue({
      symbol: 'BTCUSDT',
      interval: '1m',
      candles: [candle(true)],
      page: { nextBefore: 119_999, hasMore: false },
    });
    const { result } = renderHook(() => useMarketDashboard());

    await waitFor(() => expect(result.current.requestState).toBe('ready'));
    expect(result.current.page.hasMore).toBe(false);
    expect(result.current.canLoadPrevious).toBe(true);
  });
});
