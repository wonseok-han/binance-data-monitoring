# Binance 데이터 모니터링 설계

## 1. 목표

BTCUSDT와 ETHUSDT의 Binance 1분봉 데이터를 실시간으로 수집하고, 최초 실행과 재시작 시 누락 데이터를 자동 복구한다. 사용자는 웹 대시보드에서 가격과 수집 상태를 바로 확인할 수 있어야 한다.

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
| 차트 | Recharts | 가격·거래량 차트를 적은 코드로 구성할 수 있다. |
| 검증 | Vitest | 서버와 웹에서 같은 테스트 도구를 사용할 수 있다. |

SQLite는 과제 범위의 두 종목과 1분봉에 충분하다. 여러 수집기 인스턴스나 더 많은 종목이 필요해지면 저장소만 PostgreSQL/TimescaleDB로 교체한다.

## 3. 전체 구조

```text
Binance REST API ── 과거/누락 1분봉 ─┐
                                    ├─ Collector ─ SQLite
Binance WebSocket ─ 실시간 1분봉 ───┘       │
                                            ├─ REST API ─ 초기 조회
                                            └─ SSE ────── 실시간 갱신
                                                           │
                                                     React Dashboard
```

서버 프로세스 하나가 수집, 복구, API 제공을 담당한다. 수집된 봉은 SQLite에 먼저 반영한 뒤 클라이언트로 전송한다. 브라우저는 REST로 초기 화면을 채우고 SSE로 변경분을 받는다.

SSE를 선택한 이유는 대시보드 통신이 서버에서 브라우저로만 흐르기 때문이다. 브라우저의 자동 재연결을 사용할 수 있어 별도 양방향 프로토콜이 필요 없다.

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

이 상태는 대시보드의 수집기 상태 카드와 상태 API에 사용한다.

## 5. 수집과 누락 복구

### 시작 순서

각 종목에 대해 다음 순서를 지킨다.

1. WebSocket 구독을 먼저 시작하고 들어오는 이벤트를 메모리 버퍼에 보관한다.
2. DB의 마지막 확정 봉을 조회한다.
3. 데이터가 없으면 `BACKFILL_HOURS` 전부터, 있으면 마지막 확정 봉의 다음 1분부터 REST 백필한다.
4. 마지막으로 완료된 1분봉까지 페이지 단위로 조회해 upsert한다.
5. 버퍼 이벤트를 시간순으로 upsert하고 실시간 모드로 전환한다.

WebSocket을 먼저 연결하므로 백필 도중 발생하는 최신 이벤트를 놓치지 않는다. 기본 `BACKFILL_HOURS`는 24시간이며 환경변수로 변경할 수 있다.

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

## 6. 대시보드

### 화면 구성

1. **수집 상태 카드**: 종목별 연결 상태, 마지막 이벤트 시각, 데이터 지연 시간
2. **시장 요약 카드**: 현재가, 최근 1시간 등락률, 최근 1시간 거래대금
3. **가격 차트**: 최근 24시간 종가, BTC/ETH 종목 전환
4. **거래량 차트**: 같은 구간의 분당 USDT 거래대금
5. **최근 봉 테이블**: 시각, OHLC, 거래량, 체결 수, 확정 여부

### 지표 선택 근거

- 연결 상태와 데이터 지연은 수집 장애를 가장 빠르게 보여준다.
- 현재가와 등락률은 데이터가 실제 시장 흐름을 반영하는지 직관적으로 확인하게 한다.
- 거래대금과 체결 수는 가격 변화가 활발한 거래를 동반하는지 파악하는 데 유용하다.
- 최근 봉 테이블은 차트만으로 찾기 어려운 중복, 시간 역전, 미확정 봉 문제를 확인하게 한다.

색상만으로 상태를 구분하지 않고 텍스트 라벨을 함께 사용한다. 화면 상단에는 마지막 갱신 시각과 브라우저의 SSE 연결 상태를 표시한다.

## 7. API 계약

| Method | Path | 용도 |
| --- | --- | --- |
| GET | `/health` | 프로세스와 DB 접근 여부 확인 |
| GET | `/api/status` | 종목별 수집 상태와 지연 시간 |
| GET | `/api/candles?symbol=BTCUSDT&from=...&to=...&limit=1440` | 기간별 봉 조회 |
| GET | `/api/summary?symbol=BTCUSDT` | 현재가, 1시간 등락률과 거래대금 |
| GET | `/api/events` | candle/status 이벤트 SSE 스트림 |

`symbol`은 허용 목록으로 검증한다. `limit` 기본값은 500, 최대값은 2,000이다. 오류 응답은 `{ "error": { "code", "message" } }` 형태로 통일한다.

SSE 이벤트는 다음 두 종류만 사용한다.

```text
event: candle
data: { "symbol": "BTCUSDT", "candle": { ... } }

event: status
data: { "symbol": "BTCUSDT", "status": { ... } }
```

## 8. 저장소 구조

```text
apps/
  server/                 # 수집기, 복구 로직, REST/SSE API
    src/collector/        # Binance 연결과 백필
    src/db/               # 스키마, 저장소, 마이그레이션
    src/http/             # API 라우트
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
BACKFILL_HOURS=24
STALE_AFTER_SECONDS=10
LOG_LEVEL=info
```

실제 값은 `.env`에 두고, 저장소에는 같은 키를 가진 `.env.example`만 커밋한다. Binance 공개 시세 API만 사용하므로 API key는 필요하지 않다.

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

1~4단계의 백엔드 구현은 Claude가 담당한다. 5단계는 Codex가 담당하며, 6단계는 각자 소유 영역을 마무리한다.

## 12. 완료 기준

- 새 DB에서 실행하면 두 종목의 최근 24시간 봉이 채워지고 실시간 수집이 이어진다.
- 서버를 3분 이상 중지했다가 재시작하면 해당 구간이 자동으로 채워진다.
- 동일 구간을 여러 번 백필해도 `(symbol, open_time)` 중복이 없다.
- WebSocket 재연결 중 상태가 대시보드에 표시되고 복구 후 `live`로 돌아온다.
- 대시보드의 가격, 거래량, 최근 봉이 새 이벤트에 맞춰 갱신된다.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 모두 성공한다.
- README만 보고 새 환경에서 설치와 실행이 가능하다.

## 13. 확장 방향

실제 운영 규모로 확장할 때만 다음을 고려한다.

- PostgreSQL/TimescaleDB로 저장소 교체
- 수집기와 API 프로세스 분리 및 메시지 브로커 도입
- 데이터 보존 기간, 압축, 집계 정책 추가
- Prometheus 메트릭과 알림 연동
- 종목별 파티셔닝과 다중 수집기 리더 선출

현재 구현에는 이 기능을 미리 넣지 않는다.
