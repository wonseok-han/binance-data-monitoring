import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Candle,
  CandlesPage,
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
import { completenessPercentage, mergeCandles, type MarketSymbol } from '../lib/market';

type RequestState = 'loading' | 'ready' | 'error';

const SAFETY_REFRESH_MS = 5 * 60_000;
const EMPTY_PAGE: CandlesPage = { nextBefore: null, hasMore: false };

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
  const [page, setPage] = useState<CandlesPage>(EMPTY_PAGE);
  const [loadingPrevious, setLoadingPrevious] = useState(false);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [statuses, setStatuses] = useState<StatusResponse['symbols']>([]);
  const [requestState, setRequestState] = useState<RequestState>('loading');
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectionRef = useRef({ symbol, interval });
  const loadingPreviousRef = useRef(false);
  const reconnectControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    reconnectControllerRef.current?.abort();
    reconnectControllerRef.current = null;
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
          getCandles(symbol, interval, { signal }),
          requestSummary(symbol, signal),
        ]);

        setCandles(candlesResponse.candles);
        setPage(candlesResponse.page);
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
    setPage(EMPTY_PAGE);
    loadingPreviousRef.current = false;
    setLoadingPrevious(false);
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
          setCandles((current) => mergeCandles(current, [event.candle]));
        }

        if (!event.candle.isClosed) return;

        void requestSummary(selection.symbol).then((response) => {
          if (selectionRef.current.symbol === selection.symbol) setSummary(response);
        }).catch((refreshError: unknown) => {
          setError(refreshError instanceof Error ? refreshError.message : '시장 요약을 갱신하지 못했습니다.');
        });

        if (selection.interval !== '1m') {
          void getCandles(selection.symbol, selection.interval).then((response) => {
            if (
              selectionRef.current.symbol === selection.symbol &&
              selectionRef.current.interval === selection.interval
            ) {
              setCandles((current) => mergeCandles(current, response.candles));
            }
          }).catch((refreshError: unknown) => {
            setError(
              refreshError instanceof Error
                ? refreshError.message
                : '실시간 집계 봉을 갱신하지 못했습니다.',
            );
          });
        }
      },
      onStatus: (event) => {
        setLastUpdatedAt(Date.now());
        setStatuses((current) => mergeStatus(current, event.status));
      },
      onStateChange: setStreamState,
      onReconnect: () => {
        const selection = selectionRef.current;
        if (!selection.symbol) return;
        reconnectControllerRef.current?.abort();
        const controller = new AbortController();
        reconnectControllerRef.current = controller;
        void Promise.all([
          getStatus(controller.signal).then((response) => setStatuses(response.symbols)),
          requestSummary(selection.symbol, controller.signal).then((response) => {
            if (selectionRef.current.symbol === selection.symbol) setSummary(response);
          }),
          getCandles(selection.symbol, selection.interval, { signal: controller.signal }).then((response) => {
            if (
              selectionRef.current.symbol === selection.symbol &&
              selectionRef.current.interval === selection.interval
            ) {
              setCandles((current) => mergeCandles(current, response.candles));
            }
          }),
        ]).then(() => setLastUpdatedAt(Date.now())).catch((refreshError: unknown) => {
          if (refreshError instanceof DOMException && refreshError.name === 'AbortError') return;
          setError(refreshError instanceof Error ? refreshError.message : '재연결 후 데이터를 동기화하지 못했습니다.');
        }).finally(() => {
          if (reconnectControllerRef.current === controller) reconnectControllerRef.current = null;
        });
      },
    });

    return () => {
      reconnectControllerRef.current?.abort();
      reconnectControllerRef.current = null;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!symbol) return;
    const refreshTimer = window.setInterval(() => {
      const selection = selectionRef.current;
      void Promise.allSettled([
        getStatus().then((response) => {
          setStatuses(response.symbols);
          if (!response.symbols.some((status) => status.symbol === selectionRef.current.symbol)) {
            setSymbol(response.symbols[0]?.symbol ?? '');
          }
        }),
        requestSummary(selection.symbol).then((response) => {
          if (selectionRef.current.symbol === selection.symbol) setSummary(response);
        }),
        getCandles(selection.symbol, selection.interval).then((response) => {
          if (
            selectionRef.current.symbol === selection.symbol &&
            selectionRef.current.interval === selection.interval
          ) {
            setCandles((current) => mergeCandles(current, response.candles));
          }
        }),
      ]).then(() => setLastUpdatedAt(Date.now()));
    }, SAFETY_REFRESH_MS);

    return () => window.clearInterval(refreshTimer);
  }, [interval, symbol]);

  const selectedStatus = statuses.find((status) => status.symbol === symbol);
  const oldestOpenTime = candles[0]?.openTime;
  const coverageHasOlder =
    page.nextBefore != null &&
    oldestOpenTime != null &&
    selectedStatus?.coverage.from != null &&
    selectedStatus.coverage.from < oldestOpenTime;
  const canLoadPrevious = page.hasMore || coverageHasOlder;

  const loadPrevious = useCallback(async () => {
    if (!symbol || loadingPreviousRef.current || !canLoadPrevious || page.nextBefore == null) return;
    const requestedSelection = { symbol, interval };
    loadingPreviousRef.current = true;
    setLoadingPrevious(true);
    setError(null);

    try {
      const response = await getCandles(symbol, interval, { to: page.nextBefore });
      if (
        selectionRef.current.symbol !== requestedSelection.symbol ||
        selectionRef.current.interval !== requestedSelection.interval
      ) return;
      setCandles((current) => mergeCandles(current, response.candles));
      setPage(response.page);
      setLastUpdatedAt(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '이전 데이터를 불러오지 못했습니다.');
    } finally {
      loadingPreviousRef.current = false;
      if (
        selectionRef.current.symbol === requestedSelection.symbol &&
        selectionRef.current.interval === requestedSelection.interval
      ) setLoadingPrevious(false);
    }
  }, [canLoadPrevious, interval, page.nextBefore, symbol]);

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
    page,
    canLoadPrevious,
    loadingPrevious,
    loadPrevious,
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
