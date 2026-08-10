import type { Candle } from '@binance-monitoring/shared';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatChartTime, formatCompactUsdt, formatPrice, type RangeHours } from '../lib/market';

interface MarketChartsProps {
  candles: Candle[];
  rangeHours: RangeHours;
  loading: boolean;
}

export function MarketCharts({ candles, rangeHours, loading }: MarketChartsProps) {
  const chartData = candles.map((candle) => ({
    time: candle.openTime,
    close: Number(candle.close),
    volume: Number(candle.quoteVolume),
  }));

  if (chartData.length === 0) {
    return (
      <div className="chart-empty" role="status">
        <div className="chart-grid" aria-hidden="true" />
        <span className="empty-icon" aria-hidden="true">
          ↗
        </span>
        <strong>{loading ? '차트 데이터를 불러오는 중입니다' : '표시할 시세가 없습니다'}</strong>
        <small>
          {loading
            ? '수집된 1분봉을 준비하고 있습니다.'
            : '백필이 완료되면 가격 흐름이 표시됩니다.'}
        </small>
      </div>
    );
  }

  return (
    <div className="chart-stack" aria-label="가격 및 거래량 차트">
      <div className="price-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 14, right: 8, bottom: 2, left: 2 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f5b642" stopOpacity={0.25} />
                <stop offset="90%" stopColor="#f5b642" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#20252d" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#66717f', fontSize: 9 }}
              minTickGap={50}
              tickFormatter={(value: number) => formatChartTime(value, rangeHours)}
            />
            <YAxis
              dataKey="close"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#66717f', fontSize: 9 }}
              width={58}
              domain={['auto', 'auto']}
              tickFormatter={(value: number) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value)}
            />
            <Tooltip
              cursor={{ stroke: '#596271', strokeDasharray: '3 3' }}
              contentStyle={{
                background: '#111419',
                border: '1px solid #2a3039',
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(value) => `${formatChartTime(Number(value), rangeHours)} UTC`}
              formatter={(value) => [formatPrice(Number(value)), '종가']}
            />
            <Area
              dataKey="close"
              type="monotone"
              stroke="#f5b642"
              strokeWidth={2}
              fill="url(#priceGradient)"
              dot={false}
              activeDot={{ r: 4, fill: '#f5b642', stroke: '#111419', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="volume-chart">
        <span className="volume-label">QUOTE VOLUME</span>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 14, right: 8, bottom: 0, left: 2 }}>
            <XAxis dataKey="time" hide />
            <YAxis dataKey="volume" hide />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.025)' }}
              contentStyle={{
                background: '#111419',
                border: '1px solid #2a3039',
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(value) => `${formatChartTime(Number(value), rangeHours)} UTC`}
              formatter={(value) => [formatCompactUsdt(Number(value)), '거래대금']}
            />
            <Bar dataKey="volume" fill="#4e6073" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
