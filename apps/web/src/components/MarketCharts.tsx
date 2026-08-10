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
import { formatChartTime, formatCompactUsdt, formatPrice, intervalLabel } from '../lib/market';
import { toFinancialChartData } from '../lib/chartData';

interface MarketChartsProps {
  candles: Candle[];
  interval: Interval;
  loading: boolean;
}

function timeToMilliseconds(time: Time): number {
  if (typeof time === 'number') return time * 1_000;
  if (typeof time === 'string') return Date.parse(time);
  return Date.UTC(time.year, time.month - 1, time.day);
}

export function MarketCharts({ candles, interval, loading }: MarketChartsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const previousIntervalRef = useRef<Interval | null>(null);
  const latest = candles.at(-1);
  const hasData = candles.length > 0;

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
        timeFormatter: (time: Time) => `${formatChartTime(timeToMilliseconds(time), interval)} UTC`,
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

    return () => {
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

    const data = toFinancialChartData(candles);
    candleSeries.setData(
      data.candlesticks.map((point) => ({ ...point, time: point.time as UTCTimestamp })),
    );
    volumeSeries.setData(
      data.volumes.map((point) => ({ ...point, time: point.time as UTCTimestamp })),
    );

    if (previousIntervalRef.current !== interval || candles.length <= 1) {
      chart.timeScale().fitContent();
      previousIntervalRef.current = interval;
    }
  }, [candles, interval]);

  if (!hasData) {
    return (
      <div className="chart-empty" role="status">
        <div className="chart-grid" aria-hidden="true" />
        <span className="empty-icon" aria-hidden="true">
          ↗
        </span>
        <strong>{loading ? '차트 데이터를 불러오는 중입니다' : '표시할 시세가 없습니다'}</strong>
        <small>
          {loading
            ? `${intervalLabel(interval)} 데이터를 준비하고 있습니다.`
            : '백필이 완료되면 가격 흐름이 표시됩니다.'}
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
