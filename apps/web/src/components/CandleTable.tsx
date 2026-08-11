import type { Candle, Interval } from '@binance-monitoring/shared';
import { useState } from 'react';
import { formatCompactUsdt, formatPrice, formatUtcDateTime, intervalLabel } from '../lib/market';

const ROWS_PER_PAGE = 8;

interface CandleTableProps {
  candles: Candle[];
  interval: Interval;
  canLoadPrevious?: boolean;
  loadingPrevious?: boolean;
  onLoadPrevious?: () => boolean | Promise<boolean>;
  backfillInProgress?: boolean;
}

export function CandleTable({
  candles,
  interval,
  canLoadPrevious = false,
  loadingPrevious = false,
  onLoadPrevious,
  backfillInProgress = false,
}: CandleTableProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [requestingPrevious, setRequestingPrevious] = useState(false);
  const pageEnd = Math.max(0, candles.length - pageIndex * ROWS_PER_PAGE);
  const pageStart = Math.max(0, pageEnd - ROWS_PER_PAGE);
  const rows = candles.slice(pageStart, pageEnd).reverse();
  const hasOlderLocal = pageStart > 0;
  const hasNewer = pageIndex > 0;
  const canGoOlder = hasOlderLocal || canLoadPrevious;
  const isLoadingPrevious = loadingPrevious || requestingPrevious;

  const showOlder = async () => {
    if (hasOlderLocal) {
      setPageIndex((current) => current + 1);
      return;
    }
    if (!canLoadPrevious || !onLoadPrevious || isLoadingPrevious) return;
    setRequestingPrevious(true);
    try {
      if (await onLoadPrevious()) setPageIndex((current) => current + 1);
    } finally {
      setRequestingPrevious(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="table-empty">
        <strong>{backfillInProgress ? '과거 데이터 백필 중' : '표시할 데이터가 없습니다'}</strong>
        <span>
          {backfillInProgress
            ? `${intervalLabel(interval)} 데이터 범위가 확장되고 있습니다.`
            : `수집이 시작되면 최근 ${intervalLabel(interval)}을 확인할 수 있습니다.`}
        </span>
      </div>
    );
  }

  return (
    <>
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
      {(canGoOlder || hasNewer || backfillInProgress) && onLoadPrevious ? (
        <div className="table-pagination">
          <button type="button" disabled={!hasNewer} onClick={() => setPageIndex((current) => current - 1)}>
            최신 8개
          </button>
          <span>{pageIndex + 1}페이지</span>
          <button
            type="button"
            disabled={!canGoOlder || isLoadingPrevious}
            onClick={() => void showOlder()}
          >
            {isLoadingPrevious
              ? '이전 기록 불러오는 중'
              : canGoOlder
                ? '이전 8개'
                : '과거 데이터 백필 중'}
          </button>
        </div>
      ) : null}
    </>
  );
}
