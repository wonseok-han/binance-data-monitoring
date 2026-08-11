# 006. 운영 안정성과 확장 준비

- 상태: `todo`
- 기준 설계: `docs/DESIGN.md`

## 목적

현재 구현은 두 종목을 단일 서버와 SQLite로 수집·조회하는 범위에 맞춰져 있다. 데이터량, 가용성 요구와 운영 조직이 커질 때 필요한 개선을 적용 조건과 우선순위에 따라 정리한다.

## 현재 기준

다음 안정성은 이미 구현되어 있으며 향후 변경에서도 유지해야 한다.

- WebSocket 우선 연결과 이벤트 버퍼링, `(symbol, open_time)` idempotent upsert
- 최초·재시작 gap-fill과 DB에 저장되는 백필 진행 위치
- 일시적 오류의 제한된 지수 백오프와 영구 실패의 원인·진행 위치 보존
- 브라우저 SSE 재연결과 REST snapshot 재동기화
- graceful shutdown과 런타임 스키마 검증
- 외부 네트워크 없는 회귀 테스트와 분리된 실제 Binance smoke test

## 한계와 대응 방향

| 현재 한계 | 대응 방향 | 적용 조건 |
| --- | --- | --- |
| 수집기, 백필 worker와 API가 한 프로세스에 결합됨 | PostgreSQL/TimescaleDB 이전 후 ingest와 API 프로세스 분리 | API 배포·장애가 수집에 영향을 주거나 역할별 독립 확장이 필요할 때 |
| SQLite의 단일 writer와 장기 시계열 조회 한계 | PostgreSQL/TimescaleDB 이전 | 데이터량이나 동시 조회가 SQLite 성능 범위를 넘을 때 |
| 6시간봉·일봉을 요청마다 집계함 | rollup table과 독립 보존 정책 | 집계 조회가 API latency 또는 DB 부하의 주요 원인이 될 때 |
| 종목을 문자열 목록으로 관리하고 UI가 3자리 base asset과 USDT quote asset을 가정함 | `{ symbol, baseAsset, quoteAsset }` 형태의 market 설정을 수집기·API·UI의 단일 기준으로 사용하고 종목 수에 독립적인 테스트로 변경 | 세 번째 종목 또는 USDT가 아닌 거래쌍을 지원할 때 |
| 백필 실패가 로그와 notifier port에만 노출됨 | 외부 알림과 운영 지표 연결 | 로그를 직접 확인하는 방식으로 장애 대응 시간을 만족하기 어려울 때 |
| 실제 장기 장애와 365일 전체 백필을 자동 검증하지 않음 | fixture 기반 장기 검증과 축소된 정기 Binance smoke test | 운영 배포 전 반복 가능한 장기 검증이 필요할 때 |

인증, 사용자별 권한, 공개 API rate limit과 다중 리전 배포는 현재 내부 운영 도구 범위에서 계속 제외한다. 외부 사용자에게 API를 공개하거나 다중 리전 가용성이 요구될 때 별도 요구사항으로 정의한다.

## 확장 계획

### 1. 관측성과 운영 검증

- [ ] `BackfillFailureNotifier`를 Sentry, Slack 또는 PagerDuty adapter와 연결한다.
- [ ] 수집 지연, 누락 봉, 백필 실패와 API latency를 Prometheus 지표로 제공한다.
- [ ] 임계치 기반 경보와 failed job 조회·재개용 제한된 관리 화면을 추가한다.
- [ ] 생성한 365일 fixture와 임시 DB로 전체 백필의 페이지 수, 진행 위치 재개와 최종 coverage를 검증한다.
- [ ] 실제 Binance 검증은 짧은 범위의 정기 smoke test로 제한하고 REST/WS 연결, rate limit 처리와 재연결 경계만 확인한다.

### 2. 저장소와 집계

- [ ] `(symbol, open_time)` 고유 키와 decimal 정밀도를 유지하며 PostgreSQL 또는 TimescaleDB로 이전한다.
- [ ] 6시간봉·일봉 rollup table을 만들고 원본 1분봉과 독립적인 보존 정책을 적용한다.
- [ ] 오래된 원본을 TimescaleDB 압축 또는 object storage로 이동한다.

저장소 이전은 3단계 프로세스 분리의 선행 조건이다. SQLite에 분리용 중간 구조를 추가하지 않는다.

### 3. 프로세스 분리

#### 목표 구조

PostgreSQL/TimescaleDB 이전이 끝난 뒤 같은 `apps/server` 패키지의 실행 단위를 ingest와 API로 분리한다.

```text
Binance REST/WS
      │
      ▼
┌────────────── ingest process ──────────────┐
│ collector · gap-fill · historical backfill │
│ retention                                  │
└───────────────────┬────────────────────────┘
                    │ candle/state + event 기록
                    ▼
┌────────── PostgreSQL / TimescaleDB ────────┐
│ candles · collector_state · backfill_jobs  │
│ event_outbox                               │
└───────────────────┬────────────────────────┘
                    │ 데이터 조회 + event relay
                    ▼
┌──────────────── api process ───────────────┐
│ Fastify REST · SSE                         │
└───────────────────┬────────────────────────┘
                    │
                    ▼
                  Browser
```

- **ingest process**: WebSocket 수집, 최초·재연결 gap-fill, 장기 백필과 retention을 소유하고 PostgreSQL/TimescaleDB에 기록한다.
- **api process**: Fastify REST/SSE만 소유한다. Binance에 직접 연결하지 않고 DB를 read-only 역할로 조회한다.
- **migration command**: 두 프로세스 시작 전에 별도로 실행한다. API 시작 과정에서 schema를 변경하지 않는다.
- 백필 worker는 처음에는 ingest process 안에 둔다. 실시간 수집과의 자원 경합이 실제 문제가 된 뒤에만 별도 worker로 분리한다.

#### 프로세스 간 이벤트 전달

현재 `EventEmitter`는 한 프로세스 안에서만 동작하므로 그대로 사용할 수 없다. 이전한 PostgreSQL/TimescaleDB에 `event_outbox`를 추가해 DB를 프로세스 경계로 사용한다.

- ingest process는 candle 또는 상태와 `event_outbox` 행을 같은 DB transaction에 기록한다. commit된 이벤트만 API에 보이므로 기존의 “DB 반영 후 전송” 원칙을 유지한다.
- api process는 마지막 이벤트 번호 이후의 outbox를 읽어 SSE로 전달한다. SSE `id`와 `Last-Event-ID`를 사용해 재연결 구간을 복구한다.
- REST snapshot을 최종 기준으로 유지하고 outbox는 짧은 기간만 보존한다.

#### 이후 확장

- 첫 분리에서는 ingest process를 1개만 실행하고 API process만 독립적으로 배포·확장한다.
- 수집량이 늘면 실시간 수집과 장기 백필 worker를 분리하고 같은 작업의 중복 실행을 막는 소유권 조정을 추가한다.
- DB 기반 이벤트 전달이 한계에 도달하면 메시지 브로커를 도입하되, DB commit 이후 이벤트 전송과 중복 안전성 원칙은 유지한다.

#### 검증 기준

- [ ] API 프로세스를 종료해도 ingest process가 candle과 백필 진행 위치를 계속 저장한다.
- [ ] ingest process를 종료해도 API가 마지막 저장 데이터와 수집 중단 상태를 응답한다.
- [ ] API 재시작과 SSE 재연결에서 `Last-Event-ID` 이후 이벤트가 누락 없이 재전송된다.
- [ ] DB transaction이 rollback된 이벤트는 outbox와 SSE에 나타나지 않는다.
- [ ] 두 프로세스가 독립적으로 graceful shutdown하며 기존 REST/SSE 명세와 UI 동작을 유지한다.

## 완료 조건

이 task는 한 번에 전부 구현하지 않는다. 각 단계의 적용 조건이 충족되면 해당 범위를 별도 task로 분리하고, 구현·운영 검증이 끝난 항목만 체크한다.
