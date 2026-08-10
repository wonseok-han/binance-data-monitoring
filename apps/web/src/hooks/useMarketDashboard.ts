import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Candle,
  Interval,
  StatusResponse,
  SummaryResponse,
  SymbolStatus,
} from '@binance-monitoring/shared';
import {
  ApiRequestError,
  getCandles,
  getStatus,
  getSummary,
  subscribeToMarketEvents,
  type StreamState,
} from '../lib/api';
import { completenessPercentage, type MarketSymbol } from '../lib/market';

type RequestState = 'loading' | 'ready' | 'error';

function mergeOneMinuteCandle(candles: Candle[], incoming: Candle): Candle[] {
  const next = candles.filter((candle) => candle.openTime !== incoming.openTime);
  next.push(incoming);
  return next.sort((left, right) => left.openTime - right.openTime).slice(-360);
}

function mergeStatus(statuses: SymbolStatus[], incoming: SymbolStatus): SymbolStatus[] {
  const next = statuses.filter((status) => status.symbol !== incoming.symbol);
  next.push(incoming);
  return next.sort((left, right) => left.symbol.localeCompare(right.symbol));
}

async function requestSummary(symbol: MarketSymbol, signal?: AbortSignal) {
  try {
    return await getSummary(symbol, signal);
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === 'NO_DATA') return null;
    throw error;
  }
}

export function useMarketDashboard() {
  const [symbol, setSymbol] = useState<MarketSymbol>('');
  const [interval, setInterval] = useState<Interval>('1m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [statuses, setStatuses] = useState<StatusResponse['symbols']>([]);
  const [requestState, setRequestState] = useState<RequestState>('loading');
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectionRef = useRef({ symbol, interval });
  const aggregateRefreshTimer = useRef<number | null>(null);

  useEffect(() => {
    selectionRef.current = { symbol, interval };
  }, [interval, symbol]);

  const loadConfiguredSymbols = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await getStatus(signal);
      setStatuses(response.symbols);
      setSymbol((current) =>
        response.symbols.some((status) => status.symbol === current)
          ? current
          : (response.symbols[0]?.symbol ?? ''),
      );
      setLastUpdatedAt(Date.now());

      if (response.symbols.length === 0) {
        setRequestState('error');
        setError('서버에 설정된 조회 종목이 없습니다.');
      }
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setRequestState('error');
      setError(loadError instanceof Error ? loadError.message : '종목 정보를 불러오지 못했습니다.');
    }
  }, []);

  const loadMarket = useCallback(
    async (signal?: AbortSignal, showLoading = true) => {
      if (!symbol) return;
      if (showLoading) setRequestState('loading');
      setError(null);

      try {
        const [candlesResponse, summaryResponse] = await Promise.all([
          getCandles(symbol, interval, signal),
          requestSummary(symbol, signal),
        ]);

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
    [interval, symbol],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadConfiguredSymbols(controller.signal);
    return () => controller.abort();
  }, [loadConfiguredSymbols]);

  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    setCandles([]);
    setSummary(null);
    void loadMarket(controller.signal);
    return () => controller.abort();
  }, [loadMarket, symbol]);

  useEffect(() => {
    const unsubscribe = subscribeToMarketEvents({
      onCandle: (event) => {
        setLastUpdatedAt(Date.now());
        const selection = selectionRef.current;
        if (event.symbol !== selection.symbol) return;

        setSummary((current) =>
          current
            ? { ...current, currentPrice: event.candle.close, asOf: event.candle.updatedAt }
            : current,
        );

        if (selection.interval === '1m') {
          setCandles((current) => mergeOneMinuteCandle(current, event.candle));
          return;
        }

        if (aggregateRefreshTimer.current !== null) return;
        aggregateRefreshTimer.current = window.setTimeout(() => {
          aggregateRefreshTimer.current = null;
          const latest = selectionRef.current;
          void getCandles(latest.symbol, latest.interval).then((response) => {
            if (
              selectionRef.current.symbol === latest.symbol &&
              selectionRef.current.interval === latest.interval
            ) {
              setCandles(response.candles);
            }
          });
        }, 1_000);
      },
      onStatus: (event) => {
        setLastUpdatedAt(Date.now());
        setStatuses((current) => mergeStatus(current, event.status));
      },
      onStateChange: setStreamState,
    });

    return () => {
      unsubscribe();
      if (aggregateRefreshTimer.current !== null) {
        window.clearTimeout(aggregateRefreshTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!symbol) return;
    const refreshTimer = window.setInterval(() => {
      void Promise.allSettled([
        getStatus().then((response) => {
          setStatuses(response.symbols);
          if (!response.symbols.some((status) => status.symbol === selectionRef.current.symbol)) {
            setSymbol(response.symbols[0]?.symbol ?? '');
          }
        }),
        requestSummary(symbol).then(setSummary),
        getCandles(symbol, interval).then((response) => setCandles(response.candles)),
      ]).then(() => setLastUpdatedAt(Date.now()));
    }, 30_000);

    return () => window.clearInterval(refreshTimer);
  }, [interval, symbol]);

  const selectedStatus = statuses.find((status) => status.symbol === symbol);
  const completeness = useMemo(() => {
    const value = selectedStatus?.completeness24h;
    return {
      expected: value?.expected ?? 0,
      confirmed: value?.confirmed ?? 0,
      missing: value?.missing ?? 0,
      percentage: completenessPercentage(value),
    };
  }, [selectedStatus]);

  return {
    symbol,
    symbols: statuses.map((status) => status.symbol),
    setSymbol,
    interval,
    setInterval,
    candles,
    summary,
    statuses,
    requestState,
    streamState,
    lastUpdatedAt,
    error,
    completeness,
    refresh: () => {
      void loadConfiguredSymbols();
      void loadMarket();
    },
  };
}
