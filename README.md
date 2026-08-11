# Binance Data Monitoring

BTCUSDT와 ETHUSDT의 Binance 시세를 수집·복구하고 실시간 운영 대시보드로 제공하는 TypeScript pnpm 모노레포다.

- [기본 요구사항과 구현 추적](docs/REQUIREMENTS.md)
- [설계와 API 명세](docs/DESIGN.md)
- [운영 안정성과 확장 계획](docs/tasks/todo/006-production-readiness-and-scaling.md)
- [에이전트 작업 규칙](AGENTS.md)

## Quick Start

Node.js가 설치되지 않은 macOS·Linux·Windows WSL 환경을 기준으로 한다. Windows에서는 WSL 사용을 권장한다.

### 1. Node.js 설치

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install
nvm use
```

`.nvmrc`에 지정된 Node.js 22가 설치된다. nvm 설치 명령은 [공식 안내](https://github.com/nvm-sh/nvm#installing-and-updating)를 따른다.

### 2. pnpm 설치

```bash
npm install -g pnpm@11.17.0

node --version
pnpm --version
```

Node.js는 `v22.x`, pnpm은 `11.17.0`이 출력되어야 한다.

### 3. 프로젝트 실행

저장소 루트에서 실행한다.

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
pnpm db:migrate
pnpm dev
```

- 대시보드: <http://127.0.0.1:5173>
- API 서버: <http://127.0.0.1:3000>
- SQLite: `apps/server/data/market.db`

최초 실행 시 최근 24시간을 우선 확보한 뒤 실시간 수집을 시작하고, 나머지 365일은 백그라운드에서 채운다. 전체 백필이 끝나기 전에도 확보된 구간만큼 차트가 표시되는 것이 정상이다. 종료할 때는 `Ctrl+C`를 누른다.

## 주요 기능 및 구현

- **실시간 수집**: Binance WebSocket의 1분봉을 수집하고 DB 반영이 끝난 데이터만 SSE로 전달한다.
- **최초·재시작 백필**: WebSocket 이벤트를 먼저 버퍼링한 뒤 REST로 누락 구간을 복구하며, `(symbol, open_time)` upsert로 중복을 방지한다.
- **비차단 장기 백필**: 최근 데이터를 우선 준비하고 나머지는 최신→과거 방향으로 처리한다. 백필 진행 위치를 DB에 저장해 재시작 후 이어받는다.
- **실패 복구**: 일시적 오류는 제한된 지수 백오프로 재시도하고 영구 실패의 원인과 백필 진행 위치를 보존한다.
- **다중 봉 조회**: 원본 1분봉을 UTC 기준 6시간봉·일봉으로 조회 시 집계하고 페이지네이션 방식으로 과거 데이터를 탐색한다.
- **운영 API**: REST로 캔들·시장 요약·연결·지연·완전성·백필 상태와 health endpoint를 제공하고, SSE로 실시간 변경을 전달한다.
- **운영 대시보드**: OHLC·거래량 차트, 최근 봉, 수집 상태, 데이터 완전성과 백필 진행률을 실시간으로 표시한다.
- **데이터 관리**: SQLite와 Drizzle migration을 사용하고 보존 기간이 지난 원본 데이터를 배치로 정리한다.

상세한 데이터 흐름과 지표 선택 근거는 [설계 문서](docs/DESIGN.md)를 참고한다.

## 개발 환경

| 구분 | 기술 |
| --- | --- |
| Runtime / Package manager | Node.js 22, pnpm 11.17.0 |
| Language | TypeScript 6 |
| Server | Fastify 5, Zod 4, ws |
| Database | SQLite, better-sqlite3, Drizzle ORM |
| Web | React 19, Vite 7, Lightweight Charts 5 |
| Test / Quality | Vitest 4, Testing Library, ESLint |

## 환경변수

서버와 웹 설정은 각 앱에서 관리한다. 예시 파일은 기본값으로 바로 실행할 수 있다.

### Server (`apps/server/.env`)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 서버 포트 |
| `DATABASE_URL` | `./data/market.db` | SQLite 파일 경로 (`apps/server` 기준) |
| `BINANCE_REST_URL` | `https://api.binance.com` | Binance REST base URL |
| `BINANCE_WS_URL` | `wss://stream.binance.com:9443` | Binance WebSocket base URL |
| `CORS_ORIGIN` | `*` | `*` 또는 쉼표로 구분한 허용 origin |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` 중 하나 |

### Web (`apps/web/.env`)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 빈 값 | 분리 배포 시 사용할 API base URL. 빈 값은 same-origin |

예를 들어 API 포트와 CORS를 바꾸려면 `apps/server/.env`를 수정한다.

```dotenv
PORT=4000
CORS_ORIGIN=https://dashboard.example.com
LOG_LEVEL=debug
```

수집 종목과 백필·보존·재시도 정책은 환경별 인프라 설정이 아니므로 [`apps/server/src/config/policy.ts`](apps/server/src/config/policy.ts)에서 관리한다. 기본값은 BTCUSDT·ETHUSDT, 백필 365일, warmup 24시간, 보존 365일이다. Binance 공개 시세 API를 사용하므로 API key는 필요 없다.

## 명령

루트에서 실행한다.

| Command | 설명 |
| --- | --- |
| `pnpm dev` | server와 web 개발 서버 실행 |
| `pnpm db:migrate` | SQLite migration 적용 |
| `pnpm lint` | workspace 전체 ESLint 검사 |
| `pnpm typecheck` | workspace 전체 TypeScript 검사 |
| `pnpm test` | 네트워크 없는 단위·통합 테스트 |
| `pnpm build` | production build |
| `pnpm --filter @binance-monitoring/server start` | build된 API 서버 실행 |
| `pnpm --filter @binance-monitoring/server run backfill:resume <SYMBOL>` | 원인 해결 후 failed 백필 job 수동 재개 |

## API 요약

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health/live` | 프로세스 생존 확인 |
| GET | `/health/ready` | DB 접근 가능 여부 확인 |
| GET | `/api/status` | 종목별 수집·백필·데이터 완전성 상태 |
| GET | `/api/candles?symbol=BTCUSDT&interval=1m&limit=500` | `1m`, `6h`, `1d` 봉과 `page.nextBefore` 기반 과거 조회 |
| GET | `/api/summary?symbol=BTCUSDT` | 현재가, 1시간 등락률과 거래대금 |
| GET | `/api/events` | `candle`, `status` SSE 스트림 |

요청·응답 스키마와 페이지네이션 규칙은 [`docs/DESIGN.md`](docs/DESIGN.md#7-api-명세)를 따른다.

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

기본 테스트는 외부 Binance 네트워크를 사용하지 않는다. 실제 REST/WebSocket 연결은 별도 smoke test로 확인한다.
