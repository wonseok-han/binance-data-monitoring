import type { Candle, Interval } from '@binance-monitoring/shared';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import {
  formatChartTime,
  formatChartTooltip,
  formatCompactUsdt,
  formatPrice,
  intervalLabel,
} from '../lib/market';
import {
  initialVisibleLogicalRange,
  preserveVisibleRangeAfterPrepend,
  toFinancialChartData,
} from '../lib/chartData';

interface MarketChartsProps {
  candles: Candle[];
  interval: Interval;
  loading: boolean;
  canLoadPrevious: boolean;
  loadingPrevious: boolean;
  onLoadPrevious: () => void;
  backfillInProgress: boolean;
}

function timeToMilliseconds(time: Time): number {
  if (typeof time === 'number') return time * 1_000;
  if (typeof time === 'string') return Date.parse(time);
  return Date.UTC(time.year, time.month - 1, time.day);
}

export function MarketCharts({
  candles,
  interval,
  loading,
  canLoadPrevious,
  loadingPrevious,
  onLoadPrevious,
  backfillInProgress,
}: MarketChartsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const previousIntervalRef = useRef<Interval | null>(null);
  const previousFirstOpenTimeRef = useRef<number | null>(null);
  const loadPreviousRef = useRef(onLoadPrevious);
  const canLoadPreviousRef = useRef(canLoadPrevious);
  const loadingPreviousRef = useRef(loadingPrevious);
  const latest = candles.at(-1);
  const hasData = candles.length > 0;

  useEffect(() => {
    loadPreviousRef.current = onLoadPrevious;
    canLoadPreviousRef.current = canLoadPrevious;
    loadingPreviousRef.current = loadingPrevious;
  }, [canLoadPrevious, loadingPrevious, onLoadPrevious]);

  useEffect(() => {
    if (!hasData) return;
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e12' },
        textColor: '#697483',
        fontFamily: 'Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#181d24' },
        horzLines: { color: '#181d24' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#596271', labelBackgroundColor: '#2b313a' },
        horzLine: { color: '#596271', labelBackgroundColor: '#2b313a' },
      },
      rightPriceScale: {
        borderColor: '#242a32',
        scaleMargins: { top: 0.08, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#242a32',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
        barSpacing: 8,
        minBarSpacing: 3,
        tickMarkFormatter: (time: Time) => formatChartTime(timeToMilliseconds(time), interval),
      },
      localization: {
        timeFormatter: (time: Time) => formatChartTooltip(timeToMilliseconds(time), interval),
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#37c99b',
      downColor: '#ff6b78',
      borderUpColor: '#37c99b',
      borderDownColor: '#ff6b78',
      wickUpColor: '#37c99b',
      wickDownColor: '#ff6b78',
      priceLineVisible: true,
      lastValueVisible: true,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    previousFirstOpenTimeRef.current = null;

    const handleVisibleRange = (range: { from: number; to: number } | null) => {
      if (
        range &&
        range.from <= 10 &&
        canLoadPreviousRef.current &&
        !loadingPreviousRef.current
      ) {
        loadPreviousRef.current();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRange);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [hasData, interval]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    const previousFirstOpenTime = previousFirstOpenTimeRef.current;
    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    const prependedCount =
      previousFirstOpenTime == null
        ? 0
        : candles.filter((candle) => candle.openTime < previousFirstOpenTime).length;
    const data = toFinancialChartData(candles);
    candleSeries.setData(
      data.candlesticks.map((point) => ({ ...point, time: point.time as UTCTimestamp })),
    );
    volumeSeries.setData(
      data.volumes.map((point) => ({ ...point, time: point.time as UTCTimestamp })),
    );

    if (prependedCount > 0 && visibleRange) {
      chart
        .timeScale()
        .setVisibleLogicalRange(preserveVisibleRangeAfterPrepend(visibleRange, prependedCount));
    } else if (previousIntervalRef.current !== interval || candles.length <= 1) {
      const initialRange = initialVisibleLogicalRange(
        candles.length,
        interval,
        containerRef.current?.clientWidth ?? 0,
      );
      if (initialRange) chart.timeScale().setVisibleLogicalRange(initialRange);
      else chart.timeScale().fitContent();
      previousIntervalRef.current = interval;
    }
    previousFirstOpenTimeRef.current = candles[0]?.openTime ?? null;
  }, [candles, interval]);

  if (!hasData) {
    return (
      <div className="chart-empty" role="status">
        <div className="chart-grid" aria-hidden="true" />
        <span className="empty-icon" aria-hidden="true">
          ↗
        </span>
        <strong>
          {loading
            ? '차트 데이터를 불러오는 중입니다'
            : backfillInProgress
              ? '과거 데이터 백필 중'
              : '표시할 시세가 없습니다'}
        </strong>
        <small>
          {loading
            ? `${intervalLabel(interval)} 데이터를 준비하고 있습니다.`
            : backfillInProgress
              ? '과거 구간을 수집하고 있습니다. 실시간 데이터는 계속 갱신됩니다.'
              : '수집 데이터가 준비되면 가격 흐름이 표시됩니다.'}
        </small>
      </div>
    );
  }

  return (
    <div className="financial-chart" aria-label={`${intervalLabel(interval)} OHLC 및 거래량 차트`} role="group">
      <div className="chart-legend" aria-live="polite">
        <span>
          시 <strong>{formatPrice(latest?.open)}</strong>
        </span>
        <span>
          고 <strong className="value-positive">{formatPrice(latest?.high)}</strong>
        </span>
        <span>
          저 <strong className="value-negative">{formatPrice(latest?.low)}</strong>
        </span>
        <span>
          종 <strong>{formatPrice(latest?.close)}</strong>
        </span>
        <span className="chart-legend__volume">
          거래대금 <strong>{formatCompactUsdt(latest?.quoteVolume)}</strong>
        </span>
      </div>
      <div className="chart-canvas" ref={containerRef} />
    </div>
  );
}
