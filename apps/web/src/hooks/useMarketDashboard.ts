import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, StatusResponse, SummaryResponse, SymbolStatus } from '@binance-monitoring/shared';
import {
  ApiRequestError,
  getCandles,
  getStatus,
  getSummary,
  subscribeToMarketEvents,
  type StreamState,
} from '../lib/api';
import {
  calculateCompleteness,
  MINUTE_MS,
  type MarketSymbol,
  type RangeHours,
} from '../lib/market';

type RequestState = 'loading' | 'ready' | 'error';

function mergeCandle(candles: Candle[], incoming: Candle, rangeHours: RangeHours): Candle[] {
  const cutoff = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - rangeHours * 60 * MINUTE_MS;
  const next = candles.filter(
    (candle) => candle.openTime !== incoming.openTime && candle.openTime >= cutoff,
  );
  next.push(incoming);
  return next.sort((left, right) => left.openTime - right.openTime);
}

function mergeStatus(statuses: SymbolStatus[], incoming: SymbolStatus): SymbolStatus[] {
  const next = statuses.filter((status) => status.symbol !== incoming.symbol);
  next.push(incoming);
  return next.sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function useMarketDashboard() {
  const [symbol, setSymbol] = useState<MarketSymbol>('BTCUSDT');
  const [rangeHours, setRangeHours] = useState<RangeHours>(24);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [statuses, setStatuses] = useState<StatusResponse['symbols']>([]);
  const [requestState, setRequestState] = useState<RequestState>('loading');
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectionRef = useRef({ symbol, rangeHours });

  useEffect(() => {
    selectionRef.current = { symbol, rangeHours };
  }, [rangeHours, symbol]);

  const loadMarket = useCallback(
    async (signal?: AbortSignal) => {
      setRequestState('loading');
      setError(null);

      try {
        const [statusResponse, candlesResponse] = await Promise.all([
          getStatus(signal),
          getCandles(symbol, rangeHours, signal),
        ]);
        let summaryResponse: SummaryResponse | null = null;

        try {
          summaryResponse = await getSummary(symbol, signal);
        } catch (summaryError) {
          if (!(summaryError instanceof ApiRequestError && summaryError.code === 'NO_DATA')) {
            throw summaryError;
          }
        }

        setStatuses(statusResponse.symbols);
        setCandles(candlesResponse.candles);
        setSummary(summaryResponse);
        setLastUpdatedAt(Date.now());
        setRequestState('ready');
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setRequestState('error');
        setError(loadError instanceof Error ? loadError.message : '데이터를 불러오지 못했습니다.');
      }
    },
    [rangeHours, symbol],
  );

  useEffect(() => {
    const controller = new AbortController();
    setCandles([]);
    setSummary(null);
    void loadMarket(controller.signal);
    return () => controller.abort();
  }, [loadMarket]);

  useEffect(() => {
    const unsubscribe = subscribeToMarketEvents({
      onCandle: (event) => {
        setLastUpdatedAt(Date.now());
        const selection = selectionRef.current;
        if (event.symbol !== selection.symbol) return;
        setCandles((current) => mergeCandle(current, event.candle, selection.rangeHours));
        setSummary((current) =>
          current
            ? { ...current, currentPrice: event.candle.close, asOf: event.candle.updatedAt }
            : current,
        );
      },
      onStatus: (event) => {
        setLastUpdatedAt(Date.now());
        setStatuses((current) => mergeStatus(current, event.status));
      },
      onStateChange: setStreamState,
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      void Promise.allSettled([
        getStatus().then((statusResponse) => {
          setStatuses(statusResponse.symbols);
          setLastUpdatedAt(Date.now());
        }),
        getSummary(symbol).then((summaryResponse) => {
          setSummary(summaryResponse);
          setLastUpdatedAt(Date.now());
        }),
      ]);
    }, 30_000);

    return () => window.clearInterval(refreshTimer);
  }, [symbol]);

  const completeness = useMemo(
    () => calculateCompleteness(candles, rangeHours, Date.now()),
    [candles, rangeHours],
  );

  return {
    symbol,
    setSymbol,
    rangeHours,
    setRangeHours,
    candles,
    summary,
    statuses,
    requestState,
    streamState,
    lastUpdatedAt,
    error,
    completeness,
    refresh: () => void loadMarket(),
  };
}
