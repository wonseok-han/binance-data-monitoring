const symbols = ['BTCUSDT', 'ETHUSDT'] as const;

export function App() {
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

        <div className="global-status" role="status">
          <span className="status-dot status-dot--pending" aria-hidden="true" />
          <span>데이터 연결 준비 중</span>
          <time>마지막 갱신 —</time>
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
            {symbols.map((symbol, index) => (
              <button
                className={index === 0 ? 'symbol-button symbol-button--active' : 'symbol-button'}
                key={symbol}
                type="button"
              >
                <span>{symbol.slice(0, 3)}</span>
                <small>/ USDT</small>
              </button>
            ))}
          </div>
        </section>

        <section className="market-strip" aria-label="시장 요약">
          <article className="price-card panel">
            <div className="card-label-row">
              <span className="card-label">BTC / USDT</span>
              <span className="micro-badge">1분봉</span>
            </div>
            <div className="price-placeholder">—</div>
            <p className="muted-copy">첫 번째 시세를 기다리고 있습니다.</p>
          </article>

          {['1시간 등락률', '1시간 거래대금', '24시간 완전성'].map((label) => (
            <article className="metric-card panel" key={label}>
              <span className="card-label">{label}</span>
              <strong>—</strong>
              <small>데이터 준비 중</small>
            </article>
          ))}
        </section>

        <section className="workspace-grid">
          <article className="chart-panel panel" aria-labelledby="price-chart-title">
            <div className="panel-header">
              <div>
                <p className="eyebrow">MARKET FLOW</p>
                <h2 id="price-chart-title">가격 및 거래량</h2>
              </div>
              <div className="range-switcher" aria-label="조회 기간">
                <button type="button">1H</button>
                <button type="button">6H</button>
                <button className="range-button--active" type="button">
                  24H
                </button>
              </div>
            </div>
            <div className="chart-empty">
              <div className="chart-grid" aria-hidden="true" />
              <span className="empty-icon" aria-hidden="true">
                ↗
              </span>
              <strong>차트 데이터를 불러오는 중입니다</strong>
              <small>수집된 1분봉이 여기에 실시간으로 표시됩니다.</small>
            </div>
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
              {symbols.map((symbol) => (
                <article className="collector-card" key={symbol}>
                  <div>
                    <span className="asset-symbol">{symbol.slice(0, 3)}</span>
                    <small>{symbol}</small>
                  </div>
                  <span className="connection-chip connection-chip--pending">연결 중</span>
                  <dl>
                    <div>
                      <dt>데이터 지연</dt>
                      <dd>—</dd>
                    </div>
                    <div>
                      <dt>마지막 확정 봉</dt>
                      <dd>—</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="integrity-summary">
              <div className="integrity-ring" aria-hidden="true">
                <span>—</span>
              </div>
              <div>
                <span className="card-label">24시간 데이터 완전성</span>
                <strong>확정 봉 분석 대기 중</strong>
                <small>누락 구간 —</small>
              </div>
            </div>
          </aside>
        </section>

        <section className="table-panel panel" aria-labelledby="candles-title">
          <div className="panel-header">
            <div>
              <p className="eyebrow">RECENT RECORDS</p>
              <h2 id="candles-title">최근 확정 봉</h2>
            </div>
            <span className="muted-copy">UTC 기준</span>
          </div>
          <div className="table-empty">
            <strong>표시할 데이터가 없습니다</strong>
            <span>수집이 시작되면 최근 1분봉을 확인할 수 있습니다.</span>
          </div>
        </section>
      </main>
    </div>
  );
}
