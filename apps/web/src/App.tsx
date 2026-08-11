import type { ConnectionStatus, SymbolStatus } from '@binance-monitoring/shared';
import type { CSSProperties } from 'react';
import { lazy, Suspense } from 'react';
import { BackfillStatus } from './components/BackfillStatus';
import { CandleTable } from './components/CandleTable';
import { useMarketDashboard } from './hooks/useMarketDashboard';
import {
  formatCompactUsdt,
  formatLag,
  formatPercent,
  formatPrice,
  formatUtcDateTime,
  formatUtcTime,
  INTERVAL_OPTIONS,
  intervalLabel,
  statusLabel,
} from './lib/market';

const MarketCharts = lazy(() =>
  import('./components/MarketCharts').then((module) => ({ default: module.MarketCharts })),
);

const streamLabel = {
  connecting: '실시간 연결 중',
  live: '실시간 연결됨',
  reconnecting: '스트림 재연결 중',
} as const;

function statusClass(status: ConnectionStatus): string {
  return `connection-chip connection-chip--${status}`;
}

function CollectorCard({
  symbol,
  status,
}: {
  symbol: string;
  status: SymbolStatus | undefined;
}) {
  const connectionStatus = status?.connectionStatus ?? 'connecting';
  const effectiveDelay =
    status?.lastEventAt == null
      ? null
      : Math.max(status.delayMs ?? 0, Date.now() - status.lastEventAt);

  return (
    <article className="collector-card">
      <div>
        <span className="asset-symbol">{symbol.slice(0, 3)}</span>
        <small>{symbol}</small>
      </div>
      <span className={statusClass(connectionStatus)}>{statusLabel(connectionStatus)}</span>
      <dl>
        <div>
          <dt>데이터 지연</dt>
          <dd>{formatLag(effectiveDelay)}</dd>
        </div>
        <div>
          <dt>마지막 확정 봉</dt>
          <dd>{formatUtcTime(status?.lastClosedOpenTime ?? null)}</dd>
        </div>
        <div>
          <dt>24시간 완전성</dt>
          <dd>
            {status
              ? `${status.completeness24h.confirmed.toLocaleString()} / ${status.completeness24h.expected.toLocaleString()}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>최근 백필</dt>
          <dd>{formatUtcTime(status?.lastBackfill?.finishedAt ?? null)}</dd>
        </div>
      </dl>
      {status?.lastError ? <p className="collector-error">{status.lastError}</p> : null}
      <BackfillStatus symbol={symbol} status={status} />
    </article>
  );
}

export function App() {
  const dashboard = useMarketDashboard();
  const isLoading = dashboard.requestState === 'loading';
  const change = dashboard.summary?.changePercent1h ?? null;
  const selectedStatus = dashboard.statuses.find((status) => status.symbol === dashboard.symbol);
  const backfillInProgress = ['pending', 'running', 'retrying'].includes(
    selectedStatus?.historicalBackfill?.status ?? '',
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="MarketOps 대시보드 홈">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>
            <strong>MarketOps</strong>
            <small>BINANCE DATA MONITOR</small>
          </span>
        </a>

        <div className="global-status" role="status" aria-live="polite">
          <span className={`status-dot status-dot--${dashboard.streamState}`} aria-hidden="true" />
          <span>{streamLabel[dashboard.streamState]}</span>
          <time>마지막 갱신 {formatUtcTime(dashboard.lastUpdatedAt)} UTC</time>
        </div>
      </header>

      <main id="main" className="dashboard">
        <section className="page-heading" aria-labelledby="dashboard-title">
          <div>
            <p className="eyebrow">REAL-TIME OPERATIONS</p>
            <h1 id="dashboard-title">시장 데이터 관제</h1>
            <p className="page-description">
              실시간 수집 상태와 데이터 완전성을 한 화면에서 확인합니다.
            </p>
          </div>

          <div className="symbol-switcher" aria-label="조회 종목">
            {dashboard.symbols.map((symbol) => (
              <button
                aria-pressed={dashboard.symbol === symbol}
                className={
                  dashboard.symbol === symbol
                    ? 'symbol-button symbol-button--active'
                    : 'symbol-button'
                }
                key={symbol}
                type="button"
                onClick={() => dashboard.setSymbol(symbol)}
              >
                <span>{symbol.slice(0, 3)}</span>
                <small>/ USDT</small>
              </button>
            ))}
          </div>
        </section>

        {dashboard.error ? (
          <div className="error-banner" role="alert">
            <div>
              <strong>데이터를 불러오지 못했습니다</strong>
              <span>{dashboard.error}</span>
            </div>
            <button type="button" onClick={dashboard.refresh}>
              다시 시도
            </button>
          </div>
        ) : null}

        <section className="market-strip" aria-label="시장 요약">
          <article className="price-card panel">
            <div className="card-label-row">
              <span className="card-label">{dashboard.symbol.replace('USDT', ' / USDT')}</span>
              <span className="micro-badge">{intervalLabel(dashboard.interval)}</span>
            </div>
            <div className="price-value">
              {formatPrice(dashboard.summary?.currentPrice)}
              <small>USDT</small>
            </div>
            <p className="muted-copy">
              {dashboard.summary
                ? `${formatUtcTime(dashboard.summary.asOf)} UTC 기준`
                : '첫 번째 시세를 기다리고 있습니다.'}
            </p>
          </article>

          <article className="metric-card panel">
            <span className="card-label">1시간 등락률</span>
            <strong className={change == null ? '' : change >= 0 ? 'value-positive' : 'value-negative'}>
              {formatPercent(change)}
            </strong>
            <small>{dashboard.summary?.change1h ? `${formatPrice(dashboard.summary.change1h)} USDT` : '데이터 준비 중'}</small>
          </article>

          <article className="metric-card panel">
            <span className="card-label">1시간 거래대금</span>
            <strong>{formatCompactUsdt(dashboard.summary?.quoteVolume1h)}</strong>
            <small>USDT 기준 누적 거래량</small>
          </article>

          <article className="metric-card panel">
            <span className="card-label">24시간 완전성</span>
            <strong>
              {dashboard.completeness.expected > 0
                ? `${dashboard.completeness.percentage.toFixed(2)}%`
                : '—'}
            </strong>
            <small>
              {dashboard.completeness.expected > 0
                ? `${dashboard.completeness.confirmed.toLocaleString()} / ${dashboard.completeness.expected.toLocaleString()}개 확정 1분봉`
                : '데이터 준비 중'}
            </small>
          </article>
        </section>

        <section className="workspace-grid">
          <article className="chart-panel panel" aria-labelledby="price-chart-title">
            <div className="panel-header">
              <div>
                <p className="eyebrow">MARKET FLOW</p>
                <h2 id="price-chart-title">가격 및 거래량</h2>
              </div>
              <div className="range-switcher" aria-label="차트 봉 주기">
                {INTERVAL_OPTIONS.map((option) => (
                  <button
                    aria-pressed={dashboard.interval === option.value}
                    className={dashboard.interval === option.value ? 'range-button--active' : ''}
                    key={option.value}
                    type="button"
                    onClick={() => dashboard.setInterval(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <Suspense
              fallback={
                <div className="chart-empty" role="status">
                  <strong>차트 모듈을 준비하고 있습니다</strong>
                </div>
              }
            >
              <MarketCharts
                candles={dashboard.candles}
                interval={dashboard.interval}
                loading={isLoading}
                canLoadPrevious={dashboard.canLoadPrevious}
                loadingPrevious={dashboard.loadingPrevious}
                onLoadPrevious={dashboard.loadPrevious}
                backfillInProgress={backfillInProgress}
              />
            </Suspense>
          </article>

          <aside className="operations-panel panel" aria-labelledby="pipeline-title">
            <div className="panel-header">
              <div>
                <p className="eyebrow">PIPELINE HEALTH</p>
                <h2 id="pipeline-title">수집 운영 상태</h2>
              </div>
              <span className="outline-badge">UTC</span>
            </div>

            <div className="collector-list">
              {dashboard.symbols.map((symbol) => (
                <CollectorCard
                  key={symbol}
                  symbol={symbol}
                  status={dashboard.statuses.find((status) => status.symbol === symbol)}
                />
              ))}
            </div>

            <div className="integrity-summary">
              <div
                className="integrity-ring"
                style={{
                  '--integrity': `${dashboard.completeness.percentage * 3.6}deg`,
                } as CSSProperties}
                aria-hidden="true"
              >
                <span>
                  {dashboard.completeness.expected > 0
                    ? `${Math.round(dashboard.completeness.percentage)}%`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="card-label">최근 24시간 원본 완전성</span>
                <strong>
                  {dashboard.completeness.expected === 0
                    ? '확정 봉 분석 대기 중'
                    : dashboard.completeness.missing === 0
                    ? '누락 없이 수집 중'
                    : `${dashboard.completeness.missing}개 봉 누락`}
                </strong>
                <small>
                  마지막 확정 {formatUtcDateTime(selectedStatus?.lastClosedOpenTime ?? null)} UTC
                </small>
              </div>
            </div>
          </aside>
        </section>

        <section className="table-panel panel" aria-labelledby="candles-title">
          <div className="panel-header">
            <div>
              <p className="eyebrow">RECENT RECORDS</p>
              <h2 id="candles-title">최근 {intervalLabel(dashboard.interval)}</h2>
            </div>
            <span className="muted-copy">{dashboard.symbol} · UTC 기준</span>
          </div>
          <CandleTable
            key={`${dashboard.symbol}-${dashboard.interval}`}
            candles={dashboard.candles}
            interval={dashboard.interval}
            canLoadPrevious={dashboard.canLoadPrevious}
            loadingPrevious={dashboard.loadingPrevious}
            onLoadPrevious={dashboard.loadPrevious}
            backfillInProgress={!dashboard.canLoadPrevious && backfillInProgress}
          />
        </section>
      </main>
    </div>
  );
}
