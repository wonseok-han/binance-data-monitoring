# 003. 차트 탐색과 백필 실패 정책 보완

- 상태: `done`
- 백엔드 담당: Claude
- UI 담당: Codex
- 기준 설계: `docs/DESIGN.md`

## 목표

6시간봉의 시간 흐름과 최근 봉의 과거 탐색을 직관적으로 만든다. 장기 백필은 무기한 재시도하지 않고, 실패를 운영자가 확인하고 다시 시작할 수 있게 한다. 흩어진 제품 정책과 공용 기반 상수는 중앙 config 모듈에서 관리한다.

## 결정 사항

### 6시간봉 시간축

- 6시간봉은 UTC `00`, `06`, `12`, `18`시 경계를 사용한다.
- 날짜가 바뀌는 눈금은 날짜를, 같은 날짜의 나머지 눈금은 시간을 표시한다.
- 초기 표시 범위를 조정해 6시간 간격을 실제로 구분할 수 있게 한다.
- 툴팁에는 날짜와 시간을 모두 표시한다.

### 최근 봉 탐색

- 최근 봉 테이블은 8개 단위 페이지로 표시한다.
- `이전 8개`와 `최신 방향` 이동을 제공한다.
- 이미 조회한 candle을 먼저 사용하고, 가장 오래된 로컬 페이지에 도달했을 때만 `nextBefore`로 API를 호출한다.
- 과거 데이터를 추가해도 현재 보고 있는 페이지가 갑자기 최신 페이지로 이동하지 않는다.
- 종목이나 봉 주기를 바꾸면 최신 8개로 초기화한다.

### 백필 실패 정책

- `BACKFILL_MAX_RETRIES`를 추가하고 기본값은 연속 `12`회로 한다.
- 한 페이지라도 성공하면 연속 재시도 횟수를 0으로 초기화한다.
- 한도를 초과하면 job을 `failed`로 전환하고 백필 진행 위치, 오류와 실패 시각을 보존한다.
- 운영자가 종목별 failed job을 다시 `pending`으로 전환할 수 있는 수동 재개 명령을 제공한다.
- 실패는 구조화 로그, status API와 기존 UI의 `확인 필요` 상태로 노출한다.
- 향후 Webhook, Sentry, Prometheus 등에 연결할 수 있도록 실패 알림 포트를 정의하되 외부 서비스 연동은 이번 범위에서 제외한다.

### 백엔드 config 정리

환경변수를 config와 동일시하지 않는다. 여러 모듈에서 공유하는 제품 정책과 기반 상수를 `apps/server/src/config` 아래에서 책임별 파일로 관리한다.

```text
config/
├── index.ts       # config 모듈의 공개 진입점
├── runtime.ts     # 실행 환경에서 주입하는 인프라 설정
├── policy.ts      # 종목, 수집, 백필, 보존, HTTP 정책
└── time.ts        # MINUTE_MS, HOUR_MS, DAY_MS
```

- `policy.ts`에는 고정 종목, 백필·보존 기간, 페이지·batch 크기, 재시도·재연결 정책, API limit과 SSE heartbeat를 둔다.
- `time.ts`에는 여러 모듈이 공유하는 시간 단위 상수를 둔다.
- 외부 모듈은 `config/index.ts`를 통해서만 가져온다.
- 환경변수에는 `PORT`, `DATABASE_URL`, Binance endpoint, `CORS_ORIGIN`, `LOG_LEVEL`처럼 배포 환경에 따라 달라지는 값만 남긴다.
- 특정 도메인에서만 의미가 있는 규칙, 함수 내부 상수와 테스트 fixture는 해당 파일에 유지한다.
- 테스트에서 정책값을 줄여야 할 때는 환경변수 대신 config 또는 의존성 주입을 사용한다.

## 백엔드 작업 — Claude

- [x] `config/runtime.ts`, `policy.ts`, `time.ts`, `index.ts`로 중앙 config 모듈 재구성
- [x] `SYMBOLS`, 백필·보존·수집 재시도, SSE heartbeat와 API limit 환경변수를 typed policy로 이동
- [x] 중복된 page size, retry delay, batch size와 시간 상수를 중앙 config로 통합
- [x] 도메인 전용 상수와 테스트 fixture는 가까운 모듈에 유지
- [x] 환경변수 기반 테스트를 config 또는 의존성 주입 방식으로 변경
- [x] `BACKFILL_MAX_RETRIES` typed policy, 검증과 문서화
- [x] 연속 재시도 한도 초과 시 failed 전환 및 상태 영속화
- [x] 성공 시 retry count 초기화 회귀 테스트
- [x] 종목별 failed job 수동 재개 명령과 테스트
- [x] 백필 실패 알림 포트와 기본 구조화 로그 어댑터
- [x] status API와 공용 스키마 정합성 확인
- [x] `.env.example`, README 갱신 (`docs/DESIGN.md`는 UI 작업까지 끝난 뒤 AGENTS.md 작업 생명주기에 따라 일괄 갱신)
- [x] 전체 품질 명령 통과

백엔드 범위는 완료했다. 검증 결과는 문서 하단 "백엔드 검증 결과" 절 참고.

## UI 작업 — Codex

- [x] 6시간봉의 UTC 6시간 눈금과 초기 표시 범위 개선
- [x] 날짜 경계와 시간 눈금, 툴팁 포맷 테스트
- [x] 최근 봉 테이블 8개 단위 이전·최신 방향 페이지 탐색
- [x] 로컬 데이터 소진 시에만 다음 candle 페이지 요청
- [x] 종목·봉 주기 변경과 과거 추가 시 페이지 위치 테스트
- [x] 데스크톱·모바일에서 차트 축과 테이블 조작 검증
- [x] README와 `docs/DESIGN.md` 갱신
- [x] 전체 품질 명령 통과

## 완료 조건

- [x] 6시간봉에서 UTC `00`, `06`, `12`, `18`의 흐름을 구분할 수 있다.
- [x] 최근 봉의 이전 버튼을 누르면 실제로 더 오래된 8개 행이 표시된다.
- [x] 이미 받은 데이터를 탐색하는 동안 추가 API 요청이 발생하지 않는다.
- [x] 가장 오래된 로컬 지점에서만 다음 페이지 요청이 한 번 발생하고 데이터가 표시된다.
- [x] 백필의 일시적 오류가 설정된 횟수까지만 자동 재시도된다.
- [x] 한도 초과 job은 실패 원인과 백필 진행 위치를 잃지 않고 `failed`가 된다.
- [x] 수동 명령으로 failed job을 재개할 수 있다.
- [x] 외부 알림 시스템을 추가할 때 worker를 수정하지 않고 어댑터를 연결할 수 있다.
- [x] 공유 정책과 기반 상수는 중앙 config 모듈을 통해 사용되고 중복 기본값이 없다.
- [x] `.env.example`에는 배포 환경에 따라 달라지는 설정만 남는다.
- [x] 실제 브라우저 네트워크 요청과 화면 동작을 함께 검증한다.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 workspace 전체에서 통과한다.
- [x] 완료된 동작을 README와 `docs/DESIGN.md`에 반영하고 문서를 `done`으로 이동한다.

## 범위 제외

- 외부 Webhook, Sentry, Prometheus 서비스 실제 연동
- 알림 수신자와 에스컬레이션 정책 관리 화면
- 범용 백필 관리 콘솔
- 차트 라이브러리 교체

## 백엔드 검증 결과 (Claude)

### 로컬 브랜치·커밋

| 브랜치 | 내용 |
| --- | --- |
| `feat/3-config-policy-runtime-split` | `config/env.ts`·`constants.ts`를 `runtime.ts`(배포 환경변수)·`policy.ts`(고정 제품 정책)·`time.ts`(시간 상수)·`index.ts`(공개 진입점)로 재구성. 흩어져 있던 page size/retry delay/batch size 기본값을 policy 참조로 통합. `RETENTION_DAYS < BACKFILL_DAYS` 검증은 `assertPolicyInvariants()`로 이동 |
| `feat/3-backfill-max-retries-failed-policy` | `policy.backfill.maxRetries`(기본 12) 초과 시 job을 영구 `failed`로 전환, `backfill/notifier.ts`(`BackfillFailureNotifier` 포트 + 로깅 어댑터), `resumeFailedBackfillJob` 저장소 함수와 `backfill:resume` CLI |
| `feat/3-chart-table-navigation` | 6시간봉 UTC 날짜·6시간 눈금과 초기 표시 범위, 최근 봉 8개 단위 로컬 우선 탐색, 다음 페이지 요청 시점과 실패 상태 표시 개선 |

모두 로컬 `main`에 `--ff-only`로 반영되어 있고 원격 push는 하지 않았다.

### 설계 결정: `.env`가 아닌 `policy.ts`로 이동한 값

`SYMBOLS`, `BACKFILL_DAYS`/`BACKFILL_WARMUP_HOURS`/`BACKFILL_RETRY_BASE_DELAY_MS`/`BACKFILL_RETRY_MAX_DELAY_MS`, `RETENTION_DAYS`/`RETENTION_CLEANUP_INTERVAL_HOURS`, `STALE_AFTER_SECONDS`, `RECONNECT_BASE_DELAY_MS`/`RECONNECT_MAX_DELAY_MS`, `BINANCE_REST_MAX_RETRIES`/`BINANCE_REST_RETRY_DELAY_MS`, `SSE_HEARTBEAT_MS`는 배포 환경에 따라 달라질 이유가 없는 제품 정책이라 환경변수에서 제거하고 `apps/server/src/config/policy.ts`의 고정값으로 옮겼다. `PORT`, `DATABASE_URL`, `BINANCE_REST_URL`/`BINANCE_WS_URL`, `CORS_ORIGIN`, `LOG_LEVEL`만 배포마다 달라질 수 있는 런타임 환경변수로 남았다. 값을 바꾸려면 `.env`가 아니라 `policy.ts`를 수정하고 다시 빌드·배포해야 한다는 점을 README에 명시했다.

`BACKFILL_MAX_RETRIES`도 같은 이유로 처음부터 `policy.backfill.maxRetries`로만 구현했고 환경변수로 노출하지 않았다.

### 자동 검증

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — workspace 전체(`packages/shared`, `apps/server`, `apps/web`) 통과.
- `apps/server` 테스트 126개(신규 `config/runtime.test.ts`·`config/policy.test.ts`·`backfill/notifier.test.ts`, `historicalWorker.test.ts`의 `maxRetries` 초과 시 failed 전환·알림·재시작 후 이어받기 테스트, `backfillJobs.test.ts`의 `resumeFailedBackfillJob` 테스트 포함), `packages/shared` 4개, `apps/web` 32개 모두 통과.
- 환경변수로 정책값을 줄이던 기존 테스트를 의존성 주입(정책 객체 직접 구성 또는 worker deps 오버라이드)으로 전환했고, 실제 `policy` 기본값에 대해서도 `assertPolicyInvariants()`가 통과함을 별도로 검증했다.
- 공용 스키마(`historicalBackfill` 등)는 이번 변경에서 새 필드를 추가하지 않았다(재시도 한도 초과도 기존 `failed` 상태와 `lastError`로 충분히 표현됨). `apps/web` typecheck/test/build 회귀 없음을 확인했다.

### 실서버 스모크 테스트 (Binance 실연동)

- config 리팩터링 후 새 DB로 서버를 기동해 `policy.symbols`(BTCUSDT, ETHUSDT) 두 종목 모두 정상적으로 수집기가 시작되고 `/api/status`가 응답함을 확인(더 이상 `SYMBOLS` 환경변수 없이도 동일하게 동작).
- 실패 정책 end-to-end 검증: 스크립트로 `backfill_jobs`에 `status=failed`인 job을 직접 시딩 → `pnpm --filter @binance-monitoring/server run backfill:resume BTCUSDT` 실행 → `pending`으로 전환됨을 확인 → 같은 DB로 실제 서버를 기동 → historicalWorker가 DB에 저장된 진행 위치(`processedCount=40`)부터 이어받아 실제 Binance REST로 나머지 구간을 채우고 `completed`(`processedCount=43`)까지 정상 진행됨을 `/api/status`로 확인. `SIGTERM` 시 graceful shutdown도 정상(두 종목 collector 모두 정상 정지, 수 ms 내 `shutdown complete`).
- **중요**: `pnpm --filter @binance-monitoring/server run backfill:resume -- <SYMBOL>`처럼 `--filter`와 함께 `--` 구분자를 쓰면 pnpm이 `--`를 스크립트 인자로 그대로 전달해버려 심볼 인식에 실패하는 것을 실측으로 확인했다. README와 문서의 사용 예시는 `--` 없이 `pnpm --filter @binance-monitoring/server run backfill:resume <SYMBOL>` 형태로 통일했다.
- `maxRetries` 초과로 인한 `failed` 전환과 알림 포트 호출 자체는 실제 Binance 429/5xx를 안전하게 재현하기 어려워 `historicalWorker.test.ts`의 주입 가능한 fetchKlines/notifier 더블로 검증했다(연속 3회 실패 시 `maxRetries=2` 한도 초과로 `failed` 확정, 재시작 후 이어받은 재시도 횟수가 한도를 넘으면 즉시 `failed` 확정하는 경로 포함).

## UI 검증 결과 (Codex)

- 6시간봉 차트에서 날짜 경계는 `MM.DD`, 같은 날짜는 `06`·`12`·`18`로 표시되고 툴팁은 전체 UTC 날짜·시각을 표시함을 확인했다.
- 최근 120개 6시간봉을 8개씩 15페이지까지 이동하는 동안 `/api/candles` 추가 요청이 없음을 브라우저 네트워크와 서버 로그로 확인했다.
- 가장 오래된 로컬 페이지에서 `이전 8개`를 한 번 더 누르면 `/api/candles?symbol=BTCUSDT&interval=6h&limit=120&to=1783835999999`가 정확히 한 번 호출되고 16페이지가 표시됨을 확인했다.
- `최신 8개`로 최신 방향 이동, 봉 주기를 1분봉으로 변경할 때 1페이지 초기화, 데스크톱과 390px 모바일 폭의 조작 요소, 브라우저 콘솔 오류가 없음을 확인했다.
- 웹 테스트 32개에 UTC 눈금·툴팁, 초기 논리 범위, 로컬 우선 페이지 탐색, 과거 페이지 병합 뒤 위치 유지, 실패 상태 표시 회귀 테스트를 포함했다.

### 남은 위험 / 확장 방향

- `resumeFailedBackfillJob`은 재시도 횟수와 오류만 초기화하고 백필 진행 위치(`cursor`)와 `processedCount`는 그대로 보존한다. 실패 원인이 실제로 해결되지 않은 채 재개하면 같은 오류로 다시 `failed`가 될 수 있으므로, 운영자가 원인을 먼저 확인해야 한다는 점은 CLI 출력 메시지 수준으로만 안내하고 별도 확인 절차는 추가하지 않았다(범용 관리 콘솔은 범위 제외).
- `policy.ts`는 코드 상수이므로 값을 바꾸려면 재빌드·재배포가 필요하다. 운영 중 동적으로 정책을 조정할 방법은 이번 범위에 없다(설계 의도).
