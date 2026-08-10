# Binance Data Monitoring

BTCUSDT와 ETHUSDT의 Binance 1분봉을 수집·복구하고 REST/SSE API로 제공하는 TypeScript pnpm 모노레포다. 아키텍처와 API 계약의 기준 문서는 [`docs/DESIGN.md`](docs/DESIGN.md)이며, 작업 규칙은 [`AGENTS.md`](AGENTS.md)를 따른다.

## 요구 사항

- Node.js 22 이상
- pnpm 11 이상 (`corepack enable` 또는 `npm i -g pnpm`)

## 설치와 실행

```bash
pnpm install
cp .env.example .env      # 필요하면 값 수정
pnpm db:migrate           # SQLite 스키마 생성 (apps/server/data/market.db)
pnpm dev                  # apps/server 개발 서버 실행 (watch 모드)
```

서버가 기동되면 다음 순서로 동작한다.

1. 종목별로 Binance WebSocket(`kline_1m`) 구독을 먼저 시작한다.
2. DB의 마지막 확정 봉을 조회해 REST로 누락 구간을 백필한다 (최초 실행은 `BACKFILL_HOURS`만큼).
3. 백필 중 버퍼링된 실시간 이벤트를 시간순으로 반영하고 실시간 upsert 모드로 전환한다.
4. 연결이 끊기면 지수 백오프로 재연결하고, 재연결 시마다 같은 절차로 갭을 채운다.

`pnpm dev`는 `SIGINT`(Ctrl+C)를 받으면 각 종목의 수집기와 REST 서버를 정리한 뒤 종료한다(graceful shutdown).

## 명령

루트에서 실행하며 workspace 전체(`apps/server`, `packages/shared`)에 적용된다.

| Command | 설명 |
| --- | --- |
| `pnpm dev` | 개발 서버 실행 (watch) |
| `pnpm lint` | ESLint 검사 |
| `pnpm typecheck` | TypeScript 타입 검사 (`--noEmit`) |
| `pnpm test` | Vitest 단위/통합 테스트 |
| `pnpm build` | production 빌드 (`dist/`) |
| `pnpm db:migrate` | SQLite 마이그레이션 적용 |

`apps/web`은 아직 골격이 없다 (Codex 담당, `docs/DESIGN.md` 11단계 5번). 위 명령은 현재 존재하는 패키지에만 재귀적으로 적용되며, `apps/web`이 추가되면 별도 수정 없이 함께 실행된다.

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
  web/                    # React 대시보드 (Codex 담당, 아직 미착수)
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

실제 Binance REST/WebSocket 연동은 로컬에서 `pnpm build && node apps/server/dist/index.js`로 수동 검증했으며 기본 테스트 스위트에는 포함하지 않는다.
