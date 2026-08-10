import type { Candle } from '@binance-monitoring/shared';
import { formatCompactUsdt, formatPrice, formatUtcDateTime } from '../lib/market';

export function CandleTable({ candles }: { candles: Candle[] }) {
  const rows = candles.slice(-8).reverse();

  if (rows.length === 0) {
    return (
      <div className="table-empty">
        <strong>표시할 데이터가 없습니다</strong>
        <span>수집이 시작되면 최근 1분봉을 확인할 수 있습니다.</span>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">시각 (UTC)</th>
            <th scope="col">시가</th>
            <th scope="col">고가</th>
            <th scope="col">저가</th>
            <th scope="col">종가</th>
            <th scope="col">거래대금</th>
            <th scope="col">체결</th>
            <th scope="col">상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((candle) => (
            <tr key={candle.openTime}>
              <td>{formatUtcDateTime(candle.openTime)}</td>
              <td>{formatPrice(candle.open)}</td>
              <td className="value-positive">{formatPrice(candle.high)}</td>
              <td className="value-negative">{formatPrice(candle.low)}</td>
              <td>{formatPrice(candle.close)}</td>
              <td>{formatCompactUsdt(candle.quoteVolume)}</td>
              <td>{candle.tradeCount.toLocaleString('en-US')}</td>
              <td>
                <span className={candle.isClosed ? 'row-state row-state--closed' : 'row-state'}>
                  {candle.isClosed ? '확정' : '진행 중'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
