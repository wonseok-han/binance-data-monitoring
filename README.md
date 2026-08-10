# Binance Data Monitoring

BTCUSDT와 ETHUSDT의 Binance 1분봉을 수집·복구하고 실시간 운영 대시보드로 제공하는 TypeScript pnpm 모노레포다. 아키텍처와 API 계약의 기준 문서는 [`docs/DESIGN.md`](docs/DESIGN.md)이며, 작업 규칙은 [`AGENTS.md`](AGENTS.md)를 따른다.

## 요구 사항

- Node.js 22 이상
- pnpm 11 이상 (`corepack enable` 또는 `npm i -g pnpm`)

## 설치와 실행

```bash
pnpm install
cp .env.example .env      # 필요하면 값 수정
pnpm db:migrate           # SQLite 스키마 생성 (apps/server/data/market.db)
pnpm dev                  # server와 web 개발 서버 동시 실행
```

- 운영 대시보드: <http://127.0.0.1:5173>
- API 서버: <http://127.0.0.1:3000>

서버가 기동되면 다음 순서로 동작한다.

1. 종목별로 Binance WebSocket(`kline_1m`) 구독을 먼저 시작한다.
2. DB의 마지막 확정 봉을 조회해 REST로 누락 구간을 백필한다 (최초 실행은 `BACKFILL_HOURS`만큼).
3. 백필 중 버퍼링된 실시간 이벤트를 시간순으로 반영하고 실시간 upsert 모드로 전환한다.
4. 연결이 끊기면 지수 백오프로 재연결하고, 재연결 시마다 같은 절차로 갭을 채운다.

`pnpm dev`는 `SIGINT`(Ctrl+C)를 받으면 각 종목의 수집기와 REST 서버를 정리한 뒤 종료한다(graceful shutdown).

## 운영 대시보드

대시보드는 시장 분석보다 수집 파이프라인의 상태 확인을 우선한다.

- 종목별 WebSocket 연결 상태, 데이터 지연, 마지막 확정 봉과 최근 오류
- 조회 구간(1H/6H/24H)의 확정 봉 완전성과 누락 개수
- 현재가, 1시간 등락률, 1시간 거래대금
- REST 초기 조회 이후 SSE로 갱신되는 가격·거래량 차트
- OHLC, 거래대금, 체결 수와 확정 여부를 보여주는 최근 봉 테이블
- 로딩, 백필 중, 빈 데이터, API 오류와 SSE 재연결 상태
- 데스크톱과 모바일 반응형 레이아웃, 키보드 포커스와 reduced motion 지원

Vite 개발 서버는 `/api`, `/health` 요청을 로컬 API 서버로 프록시한다. 분리 배포할 때는 빌드 시 `VITE_API_BASE_URL`에 API 주소를 지정한다.

## 명령

루트에서 실행하며 workspace 전체(`apps/server`, `packages/shared`)에 적용된다.

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

`.env.example`을 복사해 `.env`를 만든다. 값을 비워두면 아래 기본값이 적용된다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 서버 포트 |
| `DATABASE_URL` | `./data/market.db` | SQLite 파일 경로 (`apps/server` 기준 상대경로) |
| `BINANCE_REST_URL` | `https://api.binance.com` | Binance REST API base URL |
| `BINANCE_WS_URL` | `wss://stream.binance.com:9443` | Binance WebSocket base URL |
| `SYMBOLS` | `BTCUSDT,ETHUSDT` | 수집할 종목 (쉼표 구분, API의 symbol 허용 목록도 이 값으로 결정된다) |
| `BACKFILL_HOURS` | `24` | 최초 백필 시작 시점 (현재로부터 몇 시간 전부터) |
| `STALE_AFTER_SECONDS` | `10` | 이 시간 동안 이벤트가 없으면 `stale`로 표시하고 재연결 |
| `LOG_LEVEL` | `info` | pino 로그 레벨 |
| `VITE_API_BASE_URL` | 빈 값 | web을 분리 배포할 때 사용할 API base URL |

Binance 공개 시세 API만 사용하므로 API key는 필요 없다.

## API

전체 계약은 [`docs/DESIGN.md`](docs/DESIGN.md#7-api-계약)를 따른다. 오류 응답은 모두 `{ "error": { "code", "message" } }` 형태다.

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health` | 프로세스와 DB 접근 여부 확인 |
| GET | `/api/status` | 종목별 연결 상태, 마지막 이벤트 시각, 지연 시간(`delayMs`) |
| GET | `/api/candles?symbol=BTCUSDT&from=&to=&limit=500` | 기간별 봉 조회 (open_time 오름차순, `limit` 기본 500 · 최대 2000) |
| GET | `/api/summary?symbol=BTCUSDT` | 현재가, 1시간 등락률, 1시간 거래대금 |
| GET | `/api/events` | `candle`/`status` SSE 스트림 |

`symbol`은 `SYMBOLS` 환경변수로 정해진 허용 목록으로 검증한다. `/api/summary`는 아직 데이터가 없는 종목에 대해 `404 NO_DATA`를 반환한다.

## 저장소 구조

```text
apps/
  server/                 # 수집기, SQLite 저장소, REST/SSE API (Claude 담당)
    src/collector/        # Binance REST/WebSocket 연동, 백필, 재연결
    src/db/                # Drizzle 스키마·마이그레이션·리포지토리
    src/http/              # Fastify 라우트, 검증, 에러 포맷
    src/events/             # SSE용 in-process pub/sub
    drizzle/                # 생성된 SQL 마이그레이션
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
- WebSocket 버퍼링→백필→flush→live 전환, 미확정→확정 봉 갱신, 재연결 gap-fill, stale 감지 (`apps/server/src/collector/collector.test.ts`)
- API 쿼리 검증과 SSE 스트림 (`apps/server/src/http/**/*.test.ts`)
- graceful shutdown 순서 (`apps/server/src/shutdown.test.ts`)
- 데이터 완전성·표시 포맷과 최근 봉 테이블 (`apps/web/src/**/*.test.ts(x)`)

GitHub Actions도 같은 `lint → typecheck → test → build` 순서로 전체 workspace를 검증한다.

실제 Binance REST/WebSocket 연동은 로컬에서 `pnpm build && node apps/server/dist/index.js`로 수동 검증했으며 기본 테스트 스위트에는 포함하지 않는다.
