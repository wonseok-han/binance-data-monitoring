# Binance 데이터 모니터링 설계

## 1. 목표

BTCUSDT와 ETHUSDT의 Binance 1분봉 데이터를 실시간으로 수집하고, 최초 실행과 재시작 시 누락 데이터를 자동 복구한다. 사용자는 웹 대시보드에서 수집 상태와 1분봉·6시간봉·일봉 시세를 바로 확인할 수 있어야 한다.

이 프로젝트의 우선순위는 다음과 같다.

1. 데이터 누락 없이 다시 실행할 수 있을 것
2. 로컬에서 쉽게 실행하고 검증할 수 있을 것
3. 운영 상태를 화면에서 빠르게 판단할 수 있을 것

### 범위에서 제외하는 것

- 주문 실행과 투자 추천
- 사용자 인증과 권한 관리
- 초 단위 원시 체결 데이터의 영구 보관
- 다중 서버 배포와 대규모 스트림 처리

## 2. 기술 선택

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| 언어 | TypeScript | 서버와 웹에서 타입과 데이터 모델을 공유하기 쉽다. |
| 런타임 | Node.js 22 LTS | WebSocket과 HTTP 처리를 한 언어로 구현할 수 있다. |
| 패키지 관리 | pnpm workspace | 서버, 웹, 공용 타입을 하나의 저장소에서 관리한다. |
| 서버 | Fastify | 작고 빠르며 REST와 SSE 구성이 단순하다. |
| 웹 | React + Vite | 실시간 대시보드 구현과 로컬 개발이 간단하다. |
| 저장소 | SQLite + Drizzle ORM | 별도 인프라 없이 실행 가능하며 upsert와 마이그레이션을 명시적으로 관리할 수 있다. |
| 차트 | Lightweight Charts | 금융 차트에 필요한 OHLC 캔들, 거래량, 확대·이동을 제공한다. |
| 검증 | Vitest | 서버와 웹에서 같은 테스트 도구를 사용할 수 있다. |

SQLite는 과제 범위의 두 종목과 1분봉에 충분하다. 여러 수집기 인스턴스나 더 많은 종목이 필요해지면 저장소만 PostgreSQL/TimescaleDB로 교체한다.

## 3. 전체 구조

```text
Binance REST API ── 과거/누락 1분봉 ─┐
                                    ├─ Collector ─ SQLite(1분봉 원본)
Binance WebSocket ─ 실시간 1분봉 ───┘       │
                                            ├─ UTC 집계 ─ 1분/6시간/일봉 REST API
                                            └─ SSE ────── 실시간 1분봉 이벤트
                                                           │
                                                     React Dashboard
```

서버 프로세스 하나가 수집, 최근 구간 복구, 장기 백필, 집계와 API 제공을 담당한다. 수집된 1분봉은 SQLite에 먼저 반영한 뒤 클라이언트로 전송한다. 6시간봉과 일봉은 저장된 1분봉을 UTC 시간 버킷으로 조회 시 집계한다. 장기 백필은 실시간 전환 후 별도 worker에서 실행하며 진행 cursor를 DB에 저장한다.

브라우저는 REST snapshot으로 초기 화면을 채우고 SSE를 실시간 변경 신호로 사용한다. 1분봉은 SSE 이벤트를 직접 반영하고, 6시간봉·일봉과 시장 요약은 확정 1분봉 이벤트에서만 다시 조회한다. SSE 단절 시 연결을 명시적으로 닫고 최대 30초의 지수 백오프로 새 연결을 만들며, 복구 후 한 번 재동기화한다. 전체 조회 polling은 5분 안전망으로만 사용한다.

SSE를 선택한 이유는 대시보드 통신이 서버에서 브라우저로만 흐르기 때문이다. 단방향 스트림과 가벼운 재연결만 필요하므로 별도 양방향 프로토콜이 필요 없다.

## 4. 데이터 모델

### candles

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| symbol | text | `BTCUSDT` 또는 `ETHUSDT` |
| open_time | integer | 봉 시작 시각, Unix milliseconds |
| close_time | integer | 봉 종료 시각, Unix milliseconds |
| open/high/low/close | text | 정밀도 손실을 피하기 위한 decimal 문자열 |
| volume | text | Base asset 거래량 |
| quote_volume | text | USDT 거래대금 |
| trade_count | integer | 해당 봉의 체결 수 |
| is_closed | integer | Binance가 봉 종료를 확정했는지 여부 |
| updated_at | integer | 마지막 반영 시각 |

기본 키는 `(symbol, open_time)`이다. REST 백필과 WebSocket이 같은 봉을 전달해도 upsert하므로 중복되지 않는다.

### collector_state

| 필드 | 설명 |
| --- | --- |
| symbol | 종목 |
| last_event_at | 마지막 WebSocket 이벤트 수신 시각 |
| last_closed_open_time | 마지막으로 확정 저장된 봉의 시작 시각 |
| connection_status | `connecting`, `live`, `reconnecting`, `stale` |
| last_error | 가장 최근 오류 요약, 없으면 null |
| last_backfill_json | 마지막 백필의 구간, 건수, 소요시간, 성공·실패 결과 |

이 상태는 대시보드의 수집기 상태 카드와 상태 API에 사용한다. 최근 24시간 원본 1분봉의 기대·확정·누락 개수는 상태 API 조회 시 서버에서 계산한다.

### backfill_jobs

| 필드 | 설명 |
| --- | --- |
| symbol / from_time / to_time | 종목과 장기 백필 목표 구간 |
| cursor | 다음에 이어서 처리할 페이지 위치 |
| status | `pending`, `running`, `retrying`, `completed`, `failed` |
| processed_count / total_count | 처리량과 전체 목표량 |
| retry_count / next_retry_at | 연속 재시도 횟수와 다음 재시도 시각 |
| last_error | 가장 최근 오류, 없으면 null |
| created_at / updated_at | 생성·갱신 시각 |

페이지를 반영할 때마다 cursor와 진행 상태를 같은 SQLite에 저장한다. 서버가 중단되면 `pending`, `running`, `retrying` 작업을 마지막 cursor부터 재개한다.

## 5. 수집과 누락 복구

### 시작 순서

각 종목에 대해 다음 순서를 지킨다.

1. WebSocket 구독을 먼저 시작하고 들어오는 이벤트를 메모리 버퍼에 보관한다.
2. DB의 마지막 확정 봉을 조회해 최근 누락 구간과 `BACKFILL_WARMUP_HOURS`를 우선 REST 백필한다.
3. 버퍼 이벤트를 시간순으로 upsert하고 실시간 모드로 전환한다. HTTP API와 ready 상태는 이 시점부터 장기 백필 완료를 기다리지 않는다.
4. 남은 `BACKFILL_DAYS` 구간은 최신 시각에서 과거 방향으로 백그라운드 worker가 채운다.

WebSocket을 먼저 연결하므로 백필 도중 발생하는 최신 이벤트를 놓치지 않는다. 기본 `BACKFILL_DAYS`와 `RETENTION_DAYS`는 365일, `BACKFILL_WARMUP_HOURS`는 24시간이다. 보존 기간이 목표 백필 기간보다 짧으면 서버 시작 전에 설정 오류로 거부한다.

### 시간 경계

- 저장과 API의 기준 시각은 UTC Unix milliseconds다.
- 백필 종료점은 현재 진행 중인 봉이 아니라 **마지막으로 완료된 1분봉**이다.
- 진행 중인 봉은 WebSocket으로 upsert하며 `is_closed = 0`으로 저장한다.
- 같은 봉의 종료 이벤트가 오면 `is_closed = 1`로 갱신한다.

### 재연결

- WebSocket 종료 시 지수 백오프와 작은 무작위 지연을 적용한다.
- 재연결 직후 마지막 확정 봉부터 현재까지 REST로 다시 조회한다.
- 10초 이상 이벤트가 없으면 상태를 `stale`로 표시하고 재연결을 시도한다.
- Binance REST가 일시 실패하면 제한된 횟수만 재시도하며 `Retry-After`를 존중한다.
- 종료 신호를 받으면 신규 요청을 중단하고 DB 작업을 마친 뒤 연결을 닫는다.

### 장기 백필 작업

- 종목별 job을 하나씩 처리하고 Binance 페이지 단위로 candle과 cursor를 저장한다.
- 네트워크 오류와 Binance `418`/`429`/`5xx`는 `retrying` 상태로 전환해 최대 5분의 지수 백오프로 같은 페이지를 다시 시도한다.
- 재시도 횟수와 다음 시각은 영속화하며, 정상 페이지 처리 후 연속 재시도 횟수를 초기화한다.
- 잘못된 요청처럼 재시도로 해결되지 않는 오류만 `failed`로 확정한다.
- 종료 신호는 진행 중 페이지 또는 재시도 대기를 중단하고 저장된 cursor를 보존한다.
- 장기 백필 진행률과 실제 데이터 보유 범위는 status API와 SSE로 제공한다.

### 봉 집계와 데이터 보존

- 1분봉은 수집 원본이며 6시간봉과 일봉은 UTC 기준으로 조회 시 집계한다.
- `open`은 첫 봉 시가, `high`와 `low`는 최댓값·최솟값, `close`는 마지막 봉 종가다.
- 거래량, 거래대금과 체결 수는 합산하며 decimal 문자열의 정밀도를 보존한다.
- 기대하는 확정 1분봉 수(`6h = 360`, `1d = 1,440`)가 모두 있을 때만 집계 봉을 확정한다.
- 원본 1분봉은 기본 365일간 보존한다. 만료 데이터는 실시간 수집과 분리된 배치로 삭제하며 실패해도 수집을 중단하지 않는다.

## 6. 대시보드

### 화면 구성

1. **전체 연결 표시**: 브라우저의 SSE 상태와 마지막 화면 갱신 시각
2. **수집 운영 카드**: 종목별 연결 상태, 데이터 최신성, 최근 24시간 완전성, 마지막 확정 봉, 최근 오류
3. **장기 백필 상태**: 진행률, 처리량, 데이터 보유 범위, 재시도 횟수·다음 시각과 최근 오류
4. **시장 요약 카드**: 현재가, 최근 1시간 등락률, 최근 1시간 거래대금
5. **가격·거래량 차트**: OHLC 캔들과 거래량, 서버 설정 종목 및 1분봉/6시간봉/일봉 전환, 왼쪽 경계의 과거 데이터 지연 로딩
6. **최근 봉 테이블**: 선택한 봉 주기의 시각, OHLC, 거래량, 체결 수, 확정 여부와 이전 데이터 불러오기

### 대시보드 지표 선택 근거

이 대시보드는 시장 분석보다 데이터 수집 파이프라인의 운영 상태 확인을 우선한다. 지표는 **장애 감지, 누락 검증, 원인 파악, 데이터 활용 확인**이라는 네 가지 질문에 답하도록 선택했다.

- **연결 상태와 데이터 최신성**은 실시간 수집이 현재 정상인지 보여준다. 연결 상태가 `live`여도 이벤트가 멈출 수 있으므로 `현재 시각 - lastEventAt`으로 계산한 지연 시간을 함께 표시한다.
- **최근 24시간 완전성과 누락 봉 개수**는 기대되는 1분봉 수와 실제 확정 봉 수를 비교한다. 최초 백필과 재시작 후 누락 복구가 실제로 완료됐는지 직접 검증하는 지표다.
- **마지막 확정 봉과 최근 오류**는 수집이 어느 시점에서 멈췄고 원인이 무엇인지 판단하게 한다. 연결 중, 재연결 중, stale 상태를 구분해 복구 진행 여부도 확인할 수 있다.
- **현재가, 1시간 등락률과 거래대금**은 저장된 데이터가 실제 시장 변화를 반영하는지 직관적으로 검증하고, 수집 데이터의 활용 가능성을 보여준다.
- **가격·거래량 차트**는 가격 변화와 거래 활동을 같은 시간축에서 비교해 비정상적인 공백이나 급격한 데이터 변화를 찾게 한다.
- **최근 봉 테이블**은 차트만으로 확인하기 어려운 시간 역전, 미확정 봉, 비정상 OHLC와 개별 데이터 값을 점검하는 감사 화면이다.

최근 24시간 완전성은 조회 구간 내 기대되는 1분봉 수 대비 고유한 확정 봉 수의 비율로 계산한다. 누락 봉 개수는 기대 봉 수에서 실제 확정 봉 수를 뺀 값이며, 진행 중인 현재 봉은 계산에서 제외한다.

`1분봉`, `6시간봉`, `일봉`은 지표가 아니라 차트의 **봉 주기(timeframe)**다. 1분봉은 최신 변화와 실시간 수집 결과, 6시간봉은 단기 잡음을 줄인 하루 안의 흐름, 일봉은 일별 추세와 변동 범위를 확인하기 위해 제공한다. 차트의 봉 주기를 바꿔도 운영 완전성은 최근 24시간 원본 1분봉을 기준으로 유지한다.

색상만으로 상태를 구분하지 않고 텍스트 라벨을 함께 사용한다. 화면 상단에는 마지막 갱신 시각과 브라우저의 SSE 연결 상태를 표시한다.

### 실시간 동기화와 과거 탐색

- 최초 화면과 종목·봉 주기 변경 시 REST snapshot을 한 번 조회한다.
- 1분봉은 SSE candle을 `(symbol, openTime)` 기준으로 직접 upsert한다.
- 6시간봉·일봉과 summary 재조회는 확정 1분봉 이벤트에서만 수행한다.
- SSE 오류 시 기존 EventSource를 닫고 1초부터 최대 30초까지 지수 백오프로 새 연결을 만든다.
- SSE 재연결 후 status, summary, 최신 candle page를 한 번 재동기화한다.
- AbortSignal 사용 여부와 관계없이 같은 URL의 진행 중 요청은 공유하되 각 화면 소비자는 독립적으로 취소할 수 있다. 전체 polling은 5분 간격의 안전망으로 제한한다.
- 빈 본문이나 JSON이 아닌 API 오류 응답은 기술적인 파싱 오류 대신 사용자용 오류 메시지로 표시한다.
- 초기 조회량은 `1m = 360`, `6h = 120`, `1d = 120`이다.
- 차트 왼쪽 경계 또는 테이블 버튼에서 `page.nextBefore`를 `to`로 전달해 과거 데이터를 앞에 병합한다. open time 중복을 제거하고 차트의 논리 범위를 이동해 사용자가 보던 위치를 유지한다.
- 더 과거 데이터가 아직 DB에 없고 장기 백필이 진행 중이면 빈 데이터 대신 `과거 데이터 백필 중`으로 안내한다. coverage가 확장되면 같은 cursor를 다시 조회할 수 있다.

## 7. API 계약

| Method | Path | 용도 |
| --- | --- | --- |
| GET | `/health/live` | 프로세스 생존 확인 |
| GET | `/health/ready` | DB 접근 가능 여부 확인 |
| GET | `/api/status` | 종목별 수집 상태, 장기 백필 진행률·재시도 상태, 데이터 보유 범위와 24시간 완전성 |
| GET | `/api/candles?symbol=BTCUSDT&interval=6h&from=...&to=...&limit=120` | 봉 주기별 시세 조회 |
| GET | `/api/summary?symbol=BTCUSDT` | 현재가, 1시간 등락률과 거래대금 |
| GET | `/api/events` | candle/status 이벤트 SSE 스트림 |

`symbol`은 허용 목록으로 검증한다. `interval`은 `1m`, `6h`, `1d`만 허용하며 기본값은 `1m`이다. `limit` 기본값은 500, 최대값은 2,000이고 집계 후 반환할 봉 개수에 적용한다. candles 응답은 `{ "symbol", "interval", "candles", "page": { "nextBefore", "hasMore" } }`, 오류는 `{ "error": { "code", "message" } }` 형태로 통일한다. `nextBefore`를 다음 요청의 `to`로 전달해 더 과거의 page를 조회한다.

status의 각 종목에는 `historicalBackfill`과 `coverage`가 포함된다. `historicalBackfill`은 상태, 처리량, 진행률, 목표 구간, 최근 오류, 재시도 횟수와 다음 재시도 시각을 제공한다. `coverage`는 DB가 실제로 보유한 원본 1분봉의 시작·종료 시각이다.

SSE 이벤트는 다음 두 종류만 사용한다.

```text
event: candle
data: { "symbol": "BTCUSDT", "candle": { ... } }

event: status
data: { "symbol": "BTCUSDT", "status": { ... } }
```

status 이벤트는 연결 상태뿐 아니라 확정 1분봉 저장과 장기 백필 진행 상태 변경에도 발행한다.

## 8. 저장소 구조

```text
apps/
  server/                 # 수집기, 복구 로직, REST/SSE API
    src/collector/        # Binance 연결과 최근 구간 백필
    src/backfill/         # 영속 장기 백필 worker
    src/aggregation/      # 집계 domain/application/infrastructure 경계
    src/db/               # 스키마, 저장소, 마이그레이션
    src/http/             # API 라우트
    src/retention/        # 만료 데이터 정리
    src/status/           # 데이터 완전성 계산
    src/config/           # 환경변수 검증과 코드 상수
  web/                    # React 대시보드
packages/
  shared/                 # API 스키마와 공용 타입
docs/
  DESIGN.md               # 제품·아키텍처 기준 문서
AGENTS.md                 # 모든 코딩 에이전트의 공통 작업 규칙
CLAUDE.md                 # Claude Code용 진입 문서
```

## 9. 환경변수

```dotenv
PORT=3000
DATABASE_URL=./data/market.db
BINANCE_REST_URL=https://api.binance.com
BINANCE_WS_URL=wss://stream.binance.com:9443
SYMBOLS=BTCUSDT,ETHUSDT
BACKFILL_DAYS=365
BACKFILL_WARMUP_HOURS=24
BACKFILL_RETRY_BASE_DELAY_MS=1000
BACKFILL_RETRY_MAX_DELAY_MS=300000
RETENTION_DAYS=365
RETENTION_CLEANUP_INTERVAL_HOURS=6
STALE_AFTER_SECONDS=10
RECONNECT_BASE_DELAY_MS=1000
RECONNECT_MAX_DELAY_MS=30000
BINANCE_REST_MAX_RETRIES=3
BINANCE_REST_RETRY_DELAY_MS=500
SSE_HEARTBEAT_MS=15000
CORS_ORIGIN=*
LOG_LEVEL=info
VITE_API_BASE_URL=
```

실제 값은 `.env`에 두고, 저장소에는 같은 키와 설명을 가진 `.env.example`만 커밋한다. 배포마다 조절할 값만 환경변수로 관리하고 시간 단위, 지원 봉 주기와 Binance 프로토콜 제한은 이름 있는 코드 상수로 유지한다. Binance 공개 시세 API만 사용하므로 API key는 필요하지 않다.

## 10. 역할 분담

| 담당 | 소유 영역 | 작업 범위 |
| --- | --- | --- |
| Claude | `apps/server` | 수집기, 백필·복구, SQLite, REST/SSE API와 백엔드 테스트 |
| Codex | `apps/web` | 정보 구조, 시각 디자인, React UI, 차트, 반응형·접근성, 프론트엔드 테스트 |
| 공동 경계 | `packages/shared`, 루트 설정, 문서 | API 스키마와 workspace 설정. 기존 계약을 바꿀 때 먼저 설계문서를 갱신한다. |

Claude는 웹 패키지의 시각 디자인이나 컴포넌트를 구현하지 않는다. Codex는 서버 구현을 직접 변경하지 않는다. 작업에 상대 영역의 변경이 필요하면 우회 구현을 만들지 말고 필요한 계약 변경을 먼저 명시한다.

UI는 백엔드가 완성되기 전에도 `packages/shared` 계약과 동일한 fixture로 개발할 수 있다. 실제 연동 시 fixture 전용 분기를 제품 코드에 남기지 않는다.

### 로컬 Git 자동화

- 기능 하나당 `feat/<번호>-<설명>` 브랜치를 로컬 `main`에서 만든다. 문서·설정만 바꾸는 작업은 `docs/` 또는 `chore/` 접두사를 사용한다.
- 기능 검증이 끝나면 Conventional Commits 형식으로 한 개 이상의 응집된 커밋을 만든다.
- 완료한 브랜치는 로컬 `main`에 `--ff-only`로 반영하고 보존한다. 다음 기능은 갱신된 로컬 `main`에서 시작한다.
- 담당자는 자신의 구현 범위가 완료될 때까지 브랜치 생성, 검증, 커밋, 다음 기능 진행을 별도 승인 없이 수행한다.
- `git push`, Pull Request 생성 등 원격 저장소를 변경하는 작업은 수행하지 않는다.
- 첫 커밋이 없는 저장소에서는 현재 설계문서와 프로젝트 기본 설정을 로컬 `main`의 기준 커밋으로 만든 뒤 위 흐름을 시작한다.
- 예상하지 못한 기존 변경이 있으면 자동으로 stash, reset, amend하지 않고 작업을 멈춰 충돌 범위를 알린다.

## 11. 구현 순서

각 단계는 독립적으로 검증한 뒤, 담당 범위가 끝날 때까지 별도 승인을 기다리지 않고 다음 단계로 넘어간다.

1. **프로젝트 골격**: workspace, lint, typecheck, test, build 명령을 만든다.
2. **저장과 백필**: DB 스키마와 REST 백필을 구현하고 중복·시간 경계 테스트를 통과시킨다.
3. **실시간 수집**: WebSocket, 재연결, 시작 순서와 상태 추적을 구현한다.
4. **조회 API**: candles, summary, status, SSE API를 구현한다.
5. **대시보드**: Codex가 상태 카드, 차트, 테이블을 REST + SSE에 연결한다.
6. **운영 마무리**: 로그, graceful shutdown, README, `.env.example`을 완성한다.
7. **다중 봉과 운영 강화**: UTC 집계, 보존 정책, 백필·완전성 관측, health 분리와 OHLC 차트를 추가한다.
8. **비차단 장기 백필과 과거 탐색**: 영속 백필 job, 진행·재시도 상태, candle cursor와 이벤트 중심 UI 동기화를 추가한다.

1~4단계의 백엔드 구현은 Claude가, 5단계는 Codex가 담당했다. 6~8단계는 각자 소유 영역을 나누어 완료했다.

## 12. 완료 기준

- 새 DB에서 실행하면 최근 24시간을 우선 사용할 수 있고 두 종목의 365일 1분봉이 백그라운드에서 최신→과거 방향으로 채워진다.
- 장기 백필은 HTTP ready와 실시간 수집을 막지 않으며 서버 재시작 후 저장된 cursor부터 이어진다.
- 서버를 3분 이상 중지했다가 재시작하면 해당 구간이 자동으로 채워진다.
- 동일 구간을 여러 번 백필해도 `(symbol, open_time)` 중복이 없다.
- WebSocket 재연결 중 상태가 대시보드에 표시되고 복구 후 `live`로 돌아온다.
- 1분봉 원본이 UTC 기준 6시간봉과 일봉 OHLCV로 정확히 집계되며 진행 중인 봉과 확정 봉이 구분된다.
- 대시보드의 1분봉·6시간봉·일봉 가격, 거래량과 최근 봉이 새 이벤트에 맞춰 갱신된다.
- 대시보드는 30초 전체 polling 없이 SSE 이벤트와 5분 안전망으로 동기화한다.
- 차트와 테이블은 cursor로 과거 데이터를 추가하며 중복이나 보던 시간 위치의 점프가 없다.
- 장기 백필 진행률, 실제 보유 범위, 재시도·실패 상태를 실시간 수집 상태와 분리해 표시한다.
- 운영 완전성은 선택한 차트 봉 주기와 무관하게 최근 24시간 원본 1분봉을 기준으로 표시된다.
- 보존 기간이 지난 데이터가 실시간 수집을 방해하지 않고 정리된다.
- 잘못된 환경변수는 서버 시작 전에 명확한 오류로 거부된다.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 모두 성공한다.
- README만 보고 새 환경에서 설치와 실행이 가능하다.

## 13. 확장 방향

실제 운영 규모로 확장할 때만 다음을 고려한다.

- PostgreSQL/TimescaleDB로 저장소 교체
- 수집기와 API 프로세스 분리 및 메시지 브로커 도입
- TimescaleDB 압축과 연속 집계 정책
- Prometheus 메트릭과 알림 연동
- 종목별 파티셔닝과 다중 수집기 리더 선출

현재 구현에는 이 기능을 미리 넣지 않는다. SQLite 파일 공간 회수가 필요하면 수집과 분리된 유지보수 시점에 `VACUUM`을 실행한다.
