import type { SymbolStatus } from '@binance-monitoring/shared';
import { backfillStatusLabel, formatUtcDate, formatUtcTime } from '../lib/market';

export function BackfillStatus({
  symbol,
  status,
}: {
  symbol: string;
  status: SymbolStatus | undefined;
}) {
  const backfill = status?.historicalBackfill;
  const coverage = status?.coverage;
  const progress = Math.min(100, Math.max(0, backfill?.progressPercent ?? 0));

  return (
    <section className="backfill-status" aria-label={`${symbol} 과거 데이터 백필`}>
      <div className="backfill-status__heading">
        <span>과거 데이터 백필</span>
        <strong className={`backfill-state backfill-state--${backfill?.status ?? 'idle'}`}>
          {backfill ? backfillStatusLabel(backfill.status) : '대기 중'}
        </strong>
      </div>

      {backfill ? (
        <>
          <div
            className="backfill-progress"
            role="progressbar"
            aria-label={`${symbol} 과거 데이터 백필 진행률`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="backfill-status__meta">
            <span>{progress.toFixed(1)}%</span>
            <span>
              {backfill.processed.toLocaleString()} / {backfill.total.toLocaleString()}개
            </span>
          </div>
        </>
      ) : null}

      <dl className="backfill-details">
        <div>
          <dt>데이터 보유 범위</dt>
          <dd>
            {coverage?.from != null && coverage.to != null
              ? `${formatUtcDate(coverage.from)} — ${formatUtcDate(coverage.to)}`
              : '확보 전'}
          </dd>
        </div>
        {backfill?.status === 'retrying' ? (
          <div>
            <dt>다음 재시도</dt>
            <dd>
              {formatUtcTime(backfill.nextRetryAt)} UTC · 연속 {backfill.retryCount}회
            </dd>
          </div>
        ) : null}
      </dl>

      {backfill?.lastError ? (
        <p
          className={
            backfill.status === 'failed'
              ? 'backfill-error backfill-error--failed'
              : 'backfill-error'
          }
        >
          {backfill.lastError}
        </p>
      ) : null}
    </section>
  );
}
