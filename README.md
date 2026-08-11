# Binance Data Monitoring

BTCUSDT와 ETHUSDT의 Binance 시세를 수집·복구하고 실시간 운영 대시보드로 제공하는 TypeScript pnpm 모노레포다. 아키텍처와 API 계약의 기준 문서는 [`docs/DESIGN.md`](docs/DESIGN.md)이며, 작업 규칙은 [`AGENTS.md`](AGENTS.md)를 따른다.

## 주요 기능 및 구현

- **실시간 수집과 복구**: Binance 1분봉 WebSocket을 먼저 연결해 이벤트를 버퍼링한 뒤, 최근 누락 구간과 `BACKFILL_WARMUP_HOURS`만 우선 REST 백필해 실시간 전환을 지연시키지 않는다. 최초 실행과 재시작 모두 같은 흐름을 사용하며 `(symbol, open_time)` upsert로 중복을 방지한다.
- **백그라운드 장기 백필**: 실시간 전환 직후 나머지 `BACKFILL_DAYS` 구간을 최신→과거 방향으로 백그라운드에서 채운다. 진행 상태(cursor)를 `backfill_jobs`에 저장해 재시작 시 이어서 처리하고, HTTP·실시간 수집을 막지 않는다. 일시적 오류는 job을 실패시키지 않고 지수 백오프 후 자동 재시도하며, 영구 오류만 최종 `failed`로 확정한다.
- **안정적인 운영 상태 추적**: 재연결 지수 백오프, 누락 구간 복구, stale 감지, 최근 오류와 데이터 지연을 종목별로 기록한다.
- **다중 봉 조회**: 저장된 1분봉을 원본으로 유지하고 조회 시 UTC 경계에 맞춰 6시간봉과 일봉으로 집계하며, 커서 기반 페이지네이션으로 과거 데이터를 이어서 조회한다.
- **REST·SSE 제공**: 캔들, 요약, 수집 상태와 헬스 체크 API를 제공하고, DB 반영이 끝난 이벤트만 SSE로 전달한다. 확정 1분봉 저장 시 상태 스냅샷도 함께 발행한다.
- **운영 대시보드**: OHLC 캔들·거래량 차트, 최근 봉, 데이터 완전성, 연결 상태와 장기 백필 진행률·보유 범위를 실시간으로 표시한다. 과거 데이터는 커서 방식으로 필요한 만큼 추가 조회하며, SSE 단절 시 지수 백오프로 자동 복구하고 최신 화면을 한 번 재동기화한다.
- **데이터 관리**: SQLite와 Drizzle을 사용하며 설정된 보존 기간이 지난 1분봉을 주기적으로 정리한다.

## 개발 환경

| 구분 | 기술 |
| --- | --- |
| Runtime / Package manager | Node.js 22 이상, pnpm 11 이상 |
| Language | TypeScript 6 |
| Server | Fastify 5, Zod 4, ws |
| Database | SQLite, better-sqlite3, Drizzle ORM |
| Web | React 19, Vite 7, Lightweight Charts 5 |
| Test / Quality | Vitest 4, Testing Library, ESLint |

pnpm이 없다면 `corepack enable`로 활성화하거나 `npm install -g pnpm`으로 설치한다.

## 설치 및 실행

### 1. 의존성 설치

```bash
pnpm install
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

기본값으로 바로 실행할 수 있다. 포트, DB 경로, Binance endpoint, CORS, 로그 레벨처럼 배포 환경마다 달라지는 값만 `.env`에서 조정한다. 예를 들어 다음과 같이 설정할 수 있다.

```dotenv
PORT=4000
DATABASE_URL=./data/market.db
CORS_ORIGIN=https://dashboard.example.com
```

수집 종목, 백필·보존 기간, 재시도·재연결 정책처럼 배포 환경과 무관한 제품 정책은 환경변수가 아니라 [`apps/server/src/config/policy.ts`](apps/server/src/config/policy.ts)에서 고정값으로 관리한다. 값을 바꾸려면 이 파일을 수정하고 다시 빌드·배포한다(현재 기본값은 [제품 정책](#제품-정책)을 참고). 전체 환경변수와 기본값은 [환경변수](#환경변수)와 [`.env.example`](.env.example)을 참고한다. Binance 공개 시세 API를 사용하므로 API key는 필요 없다.

### 3. 데이터베이스 준비 및 개발 서버 실행

```bash
pnpm db:migrate
pnpm dev
```

- 운영 대시보드: <http://127.0.0.1:5173>
- API 서버: <http://127.0.0.1:3000>
- SQLite 기본 경로: `apps/server/data/market.db`

서버가 기동되면 다음 순서로 동작한다.

1. 종목별로 Binance WebSocket(`kline_1m`) 구독을 먼저 시작한다.
2. DB의 마지막 확정 봉을 조회해 REST로 누락 구간을 백필한다 (최초 실행은 `BACKFILL_WARMUP_HOURS`만큼).
3. 백필 중 버퍼링된 실시간 이벤트를 시간순으로 반영하고 실시간 upsert 모드로 전환한다. 이 시점부터 HTTP API가 정상 응답한다.
4. 실시간 전환 직후 나머지 `BACKFILL_DAYS` 구간을 최신→과거 방향으로 백그라운드에서 채운다. 진행 상태는 `backfill_jobs`에 저장되어 재시작해도 이어서 처리된다.
5. 연결이 끊기면 지수 백오프로 재연결하고, 재연결 시마다 같은 절차로 갭을 채운다.

`pnpm dev`는 `SIGINT`(Ctrl+C)를 받으면 각 종목의 수집기, 백그라운드 백필 worker(진행 중인 페이지까지 마무리)와 정리 작업을 멈춘 뒤, 활성 `/api/events` SSE 연결을 모두 명시적으로 끊고(그렇지 않으면 열려 있는 연결 때문에 HTTP drain이 끝나지 않는다) REST 서버와 DB를 순서대로 정리한 뒤 종료한다(graceful shutdown).

## 대시보드 지표

대시보드는 시장 분석보다 수집 파이프라인의 상태 확인을 우선한다.

- 종목별 WebSocket 연결 상태, 데이터 지연, 마지막 확정 봉과 최근 오류
- 장기 백필 진행률, 실제 데이터 보유 범위, 재시도 횟수·다음 시각과 영구 실패 상태
- 최근 24시간 원본 1분봉의 확정 봉 완전성과 누락 개수
- 현재가, 1시간 등락률, 1시간 거래대금
- 1분봉·6시간봉·일봉을 선택할 수 있는 OHLC 캔들·거래량 차트
- 1분봉 SSE 직접 반영, 확정 1분봉 기준 집계·요약 재조회, 명시적인 SSE 지수 백오프 복구와 5분 안전망 동기화
- 차트 왼쪽 경계와 테이블 버튼을 통한 cursor 기반 과거 데이터 추가 로딩
- 선택한 봉의 OHLC, 거래대금, 체결 수와 확정 여부를 보여주는 최근 봉 테이블
- 로딩, 백필 중, 빈 데이터, API 오류와 SSE 재연결 상태
- 데스크톱과 모바일 반응형 레이아웃, 키보드 포커스와 reduced motion 지원

Vite 개발 서버는 `/api`, `/health` 요청을 로컬 API 서버로 프록시한다. 분리 배포할 때는 빌드 시 `VITE_API_BASE_URL`에 API 주소를 지정한다.

## 명령

루트에서 실행하며 workspace 전체(`apps/server`, `apps/web`, `packages/shared`)에 적용된다.

| Command | 설명 |
| --- | --- |
| `pnpm dev` | server와 web 개발 서버 실행 (watch/HMR) |
| `pnpm lint` | ESLint 검사 |
| `pnpm typecheck` | TypeScript 타입 검사 (`--noEmit`) |
| `pnpm test` | Vitest 단위/통합 테스트 |
| `pnpm build` | production 빌드 (`dist/`) |
| `pnpm db:migrate` | SQLite 마이그레이션 적용 |

루트 명령은 `apps/server`, `apps/web`, `packages/shared`에 재귀적으로 적용된다.

## 환경변수

`.env.example`을 복사해 `.env`를 만든다. 값을 비워두면 아래 기본값이 적용된다. 여기에는 배포 환경마다 달라질 수 있는 인프라 설정만 있다(`apps/server/src/config/runtime.ts`). 수집 종목이나 백필·보존 기간 같은 제품 정책은 [제품 정책](#제품-정책)을 참고한다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 서버 포트 |
| `DATABASE_URL` | `./data/market.db` | SQLite 파일 경로 (`apps/server` 기준 상대경로) |
| `BINANCE_REST_URL` | `https://api.binance.com` | Binance REST API base URL |
| `BINANCE_WS_URL` | `wss://stream.binance.com:9443` | Binance WebSocket base URL |
| `CORS_ORIGIN` | `*` | 허용 CORS origin. `*` 또는 쉼표로 구분한 origin 목록 |
| `LOG_LEVEL` | `info` | pino 로그 레벨 |
| `VITE_API_BASE_URL` | 빈 값 | web을 분리 배포할 때 사용할 API base URL |

## 제품 정책

수집 종목, 백필·보존 기간, 재시도·재연결 정책, API limit과 SSE heartbeat는 배포 환경에 따라 달라지지 않는 고정값이라 [`apps/server/src/config/policy.ts`](apps/server/src/config/policy.ts)의 코드 상수로 관리한다. 값을 바꾸려면 이 파일을 수정하고 다시 빌드·배포한다.

| 정책 | 기본값 | 설명 |
| --- | --- | --- |
| `symbols` | `BTCUSDT,ETHUSDT` | 수집할 종목. API의 symbol 허용 목록도 이 값으로 결정된다 |
| `backfill.days` | `365` | 새 DB가 최종 확보할 전체 과거 기간 (일). `retention.days`보다 크면 시작을 거부한다 |
| `backfill.warmupHours` | `24` | 실시간 전환 전 우선 채우는 최근 구간 (시간). 나머지는 백그라운드로 채운다 |
| `backfill.pageSize` | `1000` | 장기 백필 한 페이지에 조회할 Binance kline 개수 |
| `backfill.interPageDelayMs` | `100` | 장기 백필 페이지 사이의 지연 (ms) |
| `backfill.retryBaseDelayMs` | `1000` | 일시적 오류(네트워크 오류, Binance 429/5xx) 재시도 지수 백오프 시작 지연 (ms) |
| `backfill.retryMaxDelayMs` | `300000` | 위 지수 백오프의 최대 지연 상한 (ms) |
| `backfill.maxRetries` | `12` | 연속 재시도가 이 횟수를 넘으면 job을 영구 `failed`로 전환 |
| `retention.days` | `365` | 1분봉 보존 기간 (이보다 오래된 봉은 정리 작업이 삭제). `backfill.days`보다 작으면 시작을 거부한다 |
| `retention.cleanupIntervalHours` | `6` | 만료 데이터 정리 작업 실행 주기 (시간) |
| `retention.batchSize` | `1000` | 정리 작업 한 번에 삭제할 배치 크기 |
| `collector.staleAfterSeconds` | `10` | 이 시간 동안 이벤트가 없으면 `stale`로 표시하고 재연결 |
| `collector.reconnectBaseDelayMs` | `1000` | WebSocket 재연결 지수 백오프 시작 지연 (ms) |
| `collector.reconnectMaxDelayMs` | `30000` | WebSocket 재연결 지수 백오프 최대 지연 (ms) |
| `binanceRest.maxRetries` | `3` | REST 요청이 재시도 가능한 오류일 때 최대 재시도 횟수 |
| `binanceRest.retryDelayMs` | `500` | REST 재시도 기본 지연 (ms, `Retry-After` 없을 때 시도마다 지수 증가) |
| `api.candlesDefaultLimit` | `500` | `/api/candles` limit 기본값 |
| `api.candlesMaxLimit` | `2000` | `/api/candles` limit 최대값 |
| `sse.heartbeatMs` | `15000` | `/api/events` heartbeat 주기 (ms) |

## API

전체 계약은 [`docs/DESIGN.md`](docs/DESIGN.md#7-api-계약)를 따른다. 오류 응답은 모두 `{ "error": { "code", "message" } }` 형태다.

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health/live` | 프로세스 생존 확인 (DB 접근 없음) |
| GET | `/health/ready` | DB 접근 가능 여부까지 확인 |
| GET | `/api/status` | 종목별 연결 상태, 지연, 마지막 백필 결과, 장기 백필 진행률·재시도 상태(`historicalBackfill`), 데이터 보유 범위(`coverage`), 최근 24시간 완전성 |
| GET | `/api/candles?symbol=BTCUSDT&interval=1m&from=&to=&limit=500` | 기간별 봉 조회 (`interval`: `1m`\|`6h`\|`1d`, 기본 `1m`; open_time 오름차순; `limit`은 집계 후 봉 개수에 적용, 기본 500 · 최대 2000) |
| GET | `/api/summary?symbol=BTCUSDT` | 현재가, 1시간 등락률, 1시간 거래대금 |
| GET | `/api/events` | `candle`/`status` SSE 스트림 |

`symbol`은 [제품 정책](#제품-정책) `symbols`로 정해진 허용 목록으로 검증한다. `/api/summary`는 아직 데이터가 없는 종목에 대해 `404 NO_DATA`를 반환한다.

`/api/candles` 응답에는 `page: { nextBefore, hasMore }`가 포함된다. `nextBefore`를 다음 요청의 `to`로 넘기면 더 과거 데이터를 커서 방식으로 이어서 조회할 수 있다. `hasMore`가 `false`이고 `historicalBackfill.status`가 `running`/`pending`/`retrying`이면 아직 그 구간까지 백필이 도달하지 못한 것이며, 데이터가 실제로 없는 것과 다르다.

`historicalBackfill.status`는 `pending`/`running`/`retrying`/`completed`/`failed` 중 하나다. 일시적 오류(네트워크 오류, Binance 429/5xx)는 job을 `failed`로 만들지 않고 `retrying` 상태로 지수 백오프 후 같은 페이지를 자동 재시도한다(`retryCount`, `nextRetryAt` 필드로 진행 상태를 확인할 수 있다). 서버가 재시작돼도 재시도 상태와 남은 대기 시간이 보존되어 이어서 처리된다. 잘못된 요청처럼 재시도로 해결되지 않는 영구 오류만 `failed`로 확정되며, `failed` job은 자동 재시도하지 않는다(운영자의 수동 개입 필요).

## 저장소 구조

```text
apps/
  server/                 # 수집기, SQLite 저장소, REST/SSE API (Claude 담당)
    src/collector/        # Binance REST/WebSocket 연동, 최근 구간 백필, 재연결
    src/backfill/         # 장기(BACKFILL_DAYS) 백그라운드 백필 worker
    src/aggregation/      # 봉 주기 집계 (domain/application/infrastructure 경계)
    src/status/           # 상태 스냅샷 조립, 24시간 완전성 계산
    src/retention/        # 만료 1분봉 정리 작업
    src/db/               # Drizzle 스키마·마이그레이션·리포지토리
    src/http/             # Fastify 라우트, 검증, 에러 포맷
    src/events/           # SSE용 in-process pub/sub
    src/config/           # runtime(배포 환경변수), policy(고정 제품 정책), time(시간 상수); index.ts로만 노출
    drizzle/              # 생성된 SQL 마이그레이션
  web/                    # React 운영 대시보드, REST/SSE 클라이언트와 UI 테스트
packages/
  shared/                 # API 응답 zod 스키마와 공용 타입
docs/
  DESIGN.md               # 아키텍처·API 계약 기준 문서
AGENTS.md                 # 모든 코딩 에이전트의 공통 작업 규칙
CLAUDE.md                 # Claude Code용 진입 문서
```

## 테스트

`pnpm test`는 네트워크 호출 없이 fixture와 주입 가능한 clock/WebSocket 더블로 동작한다.

- 백필 시작/종료 시각 계산과 재시작 후 이어받기 (`apps/server/src/collector/backfill.test.ts`)
- REST 재시도/`Retry-After` 처리 (`apps/server/src/collector/binanceRest.test.ts`)
- WebSocket 버퍼링→백필→flush→live 전환, 미확정→확정 봉 갱신, 재연결 gap-fill, stale 감지, onFirstLive 1회 호출, 확정봉 status SSE (`apps/server/src/collector/collector.test.ts`)
- 장기 백필 worker의 페이지네이션, 영구/일시적 오류 분기, 지수 백오프 재시도, 재시도 중 graceful stop, 재시작 후 진행·재시도 상태 재개 (`apps/server/src/backfill/historicalWorker.test.ts`)
- API 쿼리 검증, candles cursor 페이지네이션(`page.nextBefore`/`hasMore`), SSE 스트림과 실제 서버·연결로 검증하는 SSE 활성 상태의 graceful shutdown(hang 없이 스트림 종료) (`apps/server/src/http/**/*.test.ts`)
- graceful shutdown 순서(SSE 클라이언트 종료 → HTTP drain → DB 종료)와 비동기 stop() 대기 (`apps/server/src/shutdown.test.ts`)
- 이벤트 중심 동기화, AbortSignal 소비자 간 동일 URL 요청 공유, SSE 지수 백오프 재생성·재연결 snapshot, 오류 응답 처리, timer·요청 정리, cursor 병합과 차트 위치 보존 (`apps/web/src/**/*.test.ts(x)`)
- 백필 진행률·coverage·재시도 상태, 금융 차트와 최근 봉 테이블의 접근 가능한 상태 표시 (`apps/web/src/**/*.test.ts(x)`)

GitHub Actions도 같은 `lint → typecheck → test → build` 순서로 전체 workspace를 검증한다.

실제 Binance REST/WebSocket 연동은 로컬에서 `pnpm build && node apps/server/dist/index.js`로 수동 검증했으며 기본 테스트 스위트에는 포함하지 않는다.
