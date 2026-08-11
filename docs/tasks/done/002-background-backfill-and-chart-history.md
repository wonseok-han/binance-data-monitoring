# 002. 백그라운드 백필과 차트 과거 탐색 개선

- 상태: `done`
- 백엔드 담당: Claude
- UI 담당: Codex
- 기준 설계: `docs/DESIGN.md`

## 목표

긴 과거 시세를 백필하더라도 서버의 실시간 수집과 API 시작을 지연시키지 않는다. 웹의 불필요한 주기 조회를 줄이고, 차트는 필요한 과거 데이터만 커서 방식으로 추가 조회한다.

## 결정 사항

### 백필 기간 설정

- `BACKFILL_DAYS`: 새 DB가 확보할 전체 과거 기간. 기본값 `365`일.
- `BACKFILL_WARMUP_HOURS`: 서버 시작 시 우선 채울 최근 구간. 기본값 `24`시간.
- `RETENTION_DAYS`: 원본 1분봉 보존 기간. 기본값 `365`일.
- `RETENTION_DAYS < BACKFILL_DAYS`이면 시작 시 설정 오류로 거부한다.
- 임의 시작·종료 날짜를 받는 별도 CLI는 이번 범위에 추가하지 않는다.

### 단계적 백필

1. WebSocket을 먼저 연결한다.
2. 최근 누락 구간과 `BACKFILL_WARMUP_HOURS`를 우선 백필한다.
3. 버퍼를 반영하고 실시간 수집 상태로 전환한다.
4. 나머지 `BACKFILL_DAYS` 구간은 최신 시각부터 과거 방향으로 백그라운드 처리한다.

장기 백필 완료 여부는 `/health/ready`를 막지 않는다. DB 접근과 실시간 수집이 가능하면 ready이며, 과거 데이터 진행률은 별도 상태로 제공한다.

### 재시작 가능한 장기 백필 작업

SQLite에 `backfill_jobs`를 추가한다.

```text
id, symbol, from_time, to_time, cursor,
status, processed_count, total_count,
retry_count, next_retry_at,
last_error, created_at, updated_at
```

- 상태는 `pending`, `running`, `retrying`, `completed`, `failed`를 사용한다.
- 종목별 작업은 하나씩 실행하고 Binance 페이지 크기 단위로 다음 백필 처리 위치를 저장한다.
- 서버 재시작 시 `pending`/`running`/`retrying` 작업을 마지막으로 저장된 진행 위치부터 재개한다.
- REST/WS 중복은 기존 `(symbol, open_time)` upsert로 안전하게 처리한다.
- 종료 신호를 받으면 현재 페이지 반영(또는 재시도 대기)을 즉시 중단하고 백필 진행 위치를 저장한 뒤 worker를 종료한다.
- 일시적 오류(네트워크 오류, Binance 429/5xx)는 job을 `failed`로 만들지 않고 `retrying` 상태로 전환해 지수 백오프(`BACKFILL_RETRY_BASE_DELAY_MS` ~ `BACKFILL_RETRY_MAX_DELAY_MS`) 후 같은 페이지를 재시도한다. 연속 재시도 횟수(`retryCount`)와 다음 재시도 시각(`nextRetryAt`)을 함께 저장해 재시작 후에도 남은 대기 시간만 마저 기다리고 이어서 진행한다.
- 잘못된 요청 등 재시도로 해결되지 않는 영구 오류만 즉시 `failed`로 확정하며, `failed`는 자동 재개하지 않는다.
- 외부 작업 큐나 메시지 브로커는 사용하지 않는다.

## API와 실시간 동기화 개선

변경 전 웹은 30초마다 status, summary, candles를 모두 재조회하고, 6시간봉·일봉은 원본 SSE 이벤트를 받을 때 최대 1초마다 candles를 다시 조회했다. 이를 다음과 같이 변경한다.

- 최초 화면과 종목·봉 주기 변경 시 필요한 snapshot을 한 번 조회한다.
- 1분봉은 SSE candle을 직접 upsert하고 주기적인 candle 조회를 제거한다.
- 6시간봉·일봉은 **확정 1분봉 이벤트**가 왔을 때만 candles를 다시 조회한다.
- summary는 확정 1분봉 이벤트에서 갱신한다. 현재가는 원본 SSE로 계속 즉시 갱신한다.
- 서버는 확정 봉 저장과 백필 진행 상태 변경 시 status SSE를 발행한다.
- SSE 재연결이 완료되면 status, summary, 현재 candle page를 한 번 재동기화한다.
- 안전망 전체 polling은 5분 간격으로 낮춘다.
- 같은 URL의 진행 중 요청은 중복 실행하지 않는다.

백필 상태와 데이터 범위를 `/api/status`에 추가한다.

```json
{
  "historicalBackfill": {
    "status": "running",
    "processed": 240000,
    "total": 525600,
    "progressPercent": 45.66,
    "from": 1754784000000,
    "to": 1786320000000,
    "lastError": null,
    "retryCount": 0,
    "nextRetryAt": null
  },
  "coverage": {
    "from": 1769904000000,
    "to": 1786320000000
  }
}
```

## 차트 과거 데이터 탐색

숫자 페이지 대신 시간축에 맞는 커서 기반 지연 로딩을 사용한다.

```http
GET /api/candles?symbol=BTCUSDT&interval=1d&to=...&limit=120
```

응답에 다음 페이지 정보를 추가한다.

```json
{
  "symbol": "BTCUSDT",
  "interval": "1d",
  "candles": [],
  "page": {
    "nextBefore": 1754006399999,
    "hasMore": true
  }
}
```

- 초기 조회량은 `1m = 360`, `6h = 120`, `1d = 120`으로 한다.
- 사용자가 차트 왼쪽 끝에 접근하면 `nextBefore`로 이전 데이터를 조회해 앞에 추가한다.
- 중복 open time을 제거하고 사용자가 보고 있던 시간 위치를 유지한다.
- 최근 봉 테이블에는 `이전 데이터 불러오기` 버튼을 제공한다.
- 백필이 아직 도달하지 않은 구간은 빈 데이터가 아니라 `과거 데이터 백필 중`으로 안내한다.

## 백엔드 작업 — Claude

- [x] 설정 스키마와 보존 기간 관계 검증
- [x] `backfill_jobs` 마이그레이션과 저장소 구현
- [x] 최근 구간 우선 복구와 장기 백필 worker 분리
- [x] 백필 진행 위치 저장, 재시작 재개, graceful shutdown 테스트
- [x] 백필 진행률·coverage 상태 API와 SSE 제공
- [x] candles 응답의 `page.nextBefore`/`hasMore` 페이지네이션 구현
- [x] 확정 봉 기준 status SSE 발행
- [x] 장기 백필 중 API·실시간 수집 비차단 검증
- [x] 전체 백엔드 회귀 테스트와 필수 품질 명령 통과
- [x] 장기 백필 job의 영속적 자동 재시도(지수 백오프, 재시작 후 재개, 영구 오류만 최종 failed)

백엔드 범위와 검증 결과는 문서 하단 "백엔드 검증 결과" 절에 기록했다.

## UI 작업 — Codex

- [x] 30초 전체 polling을 이벤트 중심 동기화와 5분 안전망으로 변경
- [x] 6시간봉·일봉 재조회를 확정 1분봉 이벤트로 제한
- [x] SSE 재연결 snapshot 동기화와 동일 요청 중복 방지
- [x] 차트 왼쪽 경계의 `page.nextBefore` 기반 과거 데이터 로딩
- [x] 테이블의 이전 데이터 불러오기
- [x] 백필 진행률, 데이터 보유 범위와 백필 중 상태 표시
- [x] 데스크톱·모바일·접근성·오류 상태 검증
- [x] 전체 프론트엔드 회귀 테스트와 필수 품질 명령 통과

## 네트워크 안정성 보완 — 재개

완료 후 실제 `pnpm dev` 조건에서 브라우저 요청과 API 구조화 로그를 함께 대조한 결과, 정상 조회 경로는 동작하지만 SSE 단절·복구와 초기 중복 요청에 결함이 확인되어 작업을 다시 연다.

### 재현 결과

- 초기 화면의 candles와 summary는 각각 1회 `200`이지만 `/api/status`는 React 개발 모드 StrictMode에서 동시에 2회 요청된다.
- 35초 유휴 상태에서는 status, summary, candles 추가 요청이 없어 기존 30초 polling이 제거됐음을 확인했다.
- 6시간봉 전환은 candles와 summary를 각각 1회 요청하고 모두 `200`을 받는다.
- 이전 데이터 버튼은 `to=<nextBefore>`가 포함된 candles 요청을 정확히 1회 보내고 `200`을 받는다.
- 활성 SSE 연결이 있는 상태에서 API 서버를 종료하면 `shutdown complete`까지 진행되지 않고 개발 runner가 서버를 강제 종료한다.
- API 서버가 실제로 종료돼도 브라우저는 30초 이상 `실시간 연결됨`을 표시한다.
- API 재기동 후 새 `/api/events` 연결과 snapshot 요청이 발생하지 않는다. 수동 `다시 시도`는 REST를 복구하지만 SSE는 `재연결 중`에 머문다.
- API가 없는 상태에서 Vite proxy의 빈 오류 응답을 JSON으로 파싱해 `Unexpected end of JSON input`이 사용자에게 노출된다.
- 위 네트워크 결함은 browser console error 없이도 발생하므로 console 확인만으로 통과 처리하지 않는다.

### 백엔드 보완 — Claude

- [x] 활성 SSE 클라이언트를 추적하고 shutdown 시 HTTP drain 전에 명시적으로 종료
- [x] SSE 구독 중 `SIGTERM`에서도 정해진 순서로 `shutdown complete`까지 종료되는 통합 테스트 추가
- [x] 서버 종료가 Vite proxy를 거친 브라우저에도 스트림 종료로 전달되는지 실연동 검증

백엔드 보완은 완료했다(원인·조치·검증은 문서 하단 "백엔드 검증 결과"의 `feat/2-sse-shutdown-drain` 항목 참고). UI 보완이 남아 있어 이 절은 계속 열어 둔다.

### UI 보완 — Codex

- [x] AbortSignal을 사용하는 초기 snapshot도 같은 URL의 동시 요청을 공유해 StrictMode 중복 제거
- [x] EventSource의 브라우저 기본 재연결에만 의존하지 않고 명시적인 close·지수 백오프·재생성 구현
- [x] SSE 복구 후 status, summary, 현재 candle page를 정확히 한 번 재동기화
- [x] 빈 본문과 비 JSON 오류 응답을 안전하게 처리하고 사용자용 네트워크 오류 메시지 표시
- [x] 재연결 timer와 진행 중 요청을 unmount·종목 전환 시 정리하는 테스트 추가

### 네트워크 재검증 조건

- [x] 최초 로드에서 status, summary, candles와 SSE 연결이 의도한 횟수만 발생하고 모두 정상 응답
- [x] 35초 유휴 상태에서 30초 polling이 발생하지 않음
- [x] 활성 SSE 상태에서 서버 종료 시 graceful shutdown 완료 및 UI가 재연결 상태로 전환
- [x] 서버 재기동 후 `/api/events` 재연결과 snapshot 1회 동기화 후 `실시간 연결됨` 복귀
- [x] API 장애와 복구 과정에서 예상하지 않은 `4xx`/`5xx`, 중복 요청, 기술적인 JSON 파싱 오류 문구가 없음
- [x] 보완 후 전체 테스트와 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` 통과
- [x] 최종 동작이 바뀌면 `docs/DESIGN.md`와 README를 함께 갱신하고 다시 `done`으로 이동

## 완료 조건

- [x] `BACKFILL_DAYS=365`인 새 DB에서도 HTTP와 실시간 수집이 장기 백필 완료를 기다리지 않는다.
- [x] 최근 24시간을 먼저 사용할 수 있고 과거 데이터가 최신→과거 방향으로 확장된다.
- [x] 서버 중단 후 같은 작업이 DB에 저장된 백필 진행 위치부터 재개된다.
- [x] idle 상태의 웹이 30초마다 세 API를 호출하지 않는다.
- [x] 6시간봉·일봉 candle 재조회는 최대 확정 1분봉 주기로 제한된다.
- [x] 차트가 이전 데이터를 추가해도 중복과 시간 위치 점프가 없다.
- [x] UI에서 진행률과 현재 데이터 보유 범위를 확인할 수 있다.
- [x] 보존 기간이 백필 목표보다 짧은 잘못된 설정을 거부한다.
- [x] 네트워크 없는 테스트와 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 통과한다.
- [x] 완료된 계약과 구조를 `docs/DESIGN.md`, README, `.env.example`에 반영한다.

## 범위 제외

- 수집기/API 프로세스 분리와 메시지 브로커
- PostgreSQL/TimescaleDB 이전과 장기 집계 테이블
- 숫자 페이지 기반 차트 탐색
- 백필 일시정지·취소 관리 화면
- 임의 날짜 범위 백필 CLI

## 백엔드 검증 결과 (Claude)

### 로컬 브랜치·커밋

| 브랜치 | 내용 |
| --- | --- |
| `docs/2-start-background-backfill-task` | 작업 문서를 `todo` → `in-progress`로 이동 |
| `feat/2-config-warmup-retention-validation` | `BACKFILL_WARMUP_HOURS` 추가, 기본값 365일, `RETENTION_DAYS < BACKFILL_DAYS` 거부 |
| `feat/2-backfill-jobs-schema-repo` | `backfill_jobs` 테이블/마이그레이션/리포지토리, `getEarliestCandle` |
| `feat/2-historical-backfill-worker` | 장기 백필 worker(진행 위치 저장, 재개, graceful stop) |
| `feat/2-status-historical-sse-collector` | `status/status.ts` 통합, `historicalBackfill`/`coverage`, 확정봉 SSE, `onFirstLive`, 비동기 shutdown, index.ts 배선 |
| `feat/2-candles-cursor-pagination` | candles 응답 `page.nextBefore`/`hasMore` |
| `docs/2-update-checklist` | 이 문서 갱신 |
| `feat/2-backfill-job-retry` | 장기 백필 job 영속적 자동 재시도(지수 백오프), `retrying` 상태·`retryCount`/`nextRetryAt` 노출 |
| `feat/2-event-sync-cursor-history` | 이벤트 중심 동기화, 동일 요청 공유, SSE 재연결 snapshot과 페이지네이션 과거 탐색 |
| `feat/2-backfill-operations-ui` | 백필 진행률·coverage·재시도 상태 UI와 반응형·접근성 표시 |
| `feat/2-sse-shutdown-drain` | SSE 클라이언트 레지스트리 추가, shutdown이 HTTP drain 전에 활성 SSE 연결을 명시적으로 종료 |
| `feat/2-ui-network-recovery` | 초기 요청 공유, SSE 지수 백오프 재생성, 복구 snapshot과 안전한 오류 처리 |

모두 로컬 `main`에 `--ff-only`로 반영되어 있고 원격 push는 하지 않았다.

### 자동 검증

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — workspace 전체(`packages/shared`, `apps/server`, `apps/web`) 통과.
- `apps/server` 테스트 120개(신규 backfill_jobs 리포지토리·historicalWorker의 페이지네이션/영구·일시적 오류 분기/지수 백오프 재시도/재시도 중 graceful stop/재시작 후 진행·재시도 재개·candles `page.nextBefore` 페이지네이션·collector의 onFirstLive/확정봉 SSE·비동기 shutdown(SSE 클라이언트 종료 순서 포함)·binanceRest 오류 분류·sseRegistry 테스트 포함), `packages/shared` 4개, `apps/web` 26개 모두 통과.
- 공용 스키마의 `historicalBackfill`, `coverage`, `page`, `retryCount`/`nextRetryAt` 계약을 UI가 직접 사용하며 typecheck/test/build로 함께 검증했다.
- 네트워크 호출은 fixture와 주입 가능한 clock/REST/WebSocket 더블로 대체했고 기본 테스트 스위트에는 포함하지 않았다.
- `apps/server/src/http/routes/events.test.ts`에 실제 Fastify 서버·실제 SSE 연결·실제 `createShutdownHandler`를 사용하는 통합 테스트를 추가해, 활성 SSE 연결이 있는 상태에서 shutdown이 타임아웃 없이 끝나고 클라이언트가 실제로 스트림 종료(`done: true`)를 관찰함을 검증했다(회귀 시 테스트가 타임아웃으로 실패한다).

### 실서버 스모크 테스트 (Binance 실연동)

- 기본값(`BACKFILL_DAYS=365`, `BACKFILL_WARMUP_HOURS=24`)으로 새 DB에서 BTCUSDT 기동 → `/health/ready`가 0.55초 만에 응답(장기 백필을 기다리지 않음), 3초 뒤 `/api/status`에서 `connectionStatus: live`, `completeness24h: 1440/1440`, `historicalBackfill: { status: running, total: 524160 }`이 이미 진행 중임을 확인.
- `BACKFILL_DAYS=60`으로 백필이 진행 중인 상태에서 `SIGTERM` 전송 → 진행 중이던 페이지를 마저 처리하고 백필 진행 위치를 저장한 뒤(`shutdown started` → `collector stopped` → `shutdown complete` 약 100ms) 정상 종료. 재시작 시 **같은 `backfill_jobs` id**로 저장된 진행 위치부터 이어서 처리됨을 확인(처음부터 다시 시작하지 않음).
- `GET /api/candles?interval=1d`에서 받은 `page.nextBefore`를 다음 요청의 `to`로 넘겨 과거 페이지를 정상적으로 이어받고, 더 이상 데이터가 없을 때 `hasMore: false`와 빈 배열을 확인.
- 75초간 SSE(`/api/events`)를 구독해 확정 1분봉 저장 시 `event: status`가 정확히 발행됨을 확인(연결 상태 변화가 없어도 발행됨).
- 잘못된 설정(`RETENTION_DAYS < BACKFILL_DAYS`)이 서버 시작 전 오류로 거부됨을 확인.
- (재시도 기능 추가 후) `BACKFILL_DAYS=1`로 새 DB에서 실제 Binance 연동으로 기동 → 정상 완료된 job의 `/api/status`에 `historicalBackfill.retryCount: 0`, `nextRetryAt: null`이 노출됨을 확인. `SIGTERM` 전송 시 `shutdown started` → `collector stopped` → `shutdown complete`가 여전히 수 ms 내로 끝나 재시도 대기 로직 추가가 graceful shutdown 지연을 유발하지 않음을 확인. 실제 429/5xx나 네트워크 단절을 재현하는 재시도 경로 자체는 `historicalWorker.test.ts`의 주입 가능한 fetchKlines/sleep 더블로 검증했다(백오프 지연 값, 같은 페이지 재시도, 영구 오류 즉시 failed, 재시도 대기 중 stop() 즉시 반환, 재시작 후 retrying 상태 재개 포함).
- (SSE shutdown 보완, `feat/2-sse-shutdown-drain`) 실제 backend(`node dist/index.js`, `PORT=3000`)와 `apps/web`의 실제 Vite dev 서버(포트 5173, `/api`→3000 프록시)를 함께 띄우고 `curl -N http://127.0.0.1:5173/api/events`로 프록시를 거친 SSE 연결을 연 채로 backend에 `SIGTERM` 전송 → 수정 전에는 활성 SSE keep-alive 소켓 때문에 `app.close()`가 끝나지 않아 `shutdown complete` 로그가 찍히지 않았던 것과 달리, 수정 후에는 `shutdown started` → `collector stopped` → `shutdown complete`가 1초 내로 완료됨을 확인. 같은 순간 `curl`(만료 시간 20초로 설정) 프로세스가 타임아웃을 기다리지 않고 즉시 종료됨을 확인해, 서버 종료가 Vite 프록시를 거쳐 실제 클라이언트 연결까지 스트림 종료로 전달됨을 검증했다. Vite 로그에는 프록시 오류가 남지 않았다(연결이 깨끗하게 끝남).

## UI 검증 결과 (Codex)

- UI 테스트 26개에서 5분 안전망, 확정봉 기반 집계 재조회, AbortSignal 소비자 간 동일 URL 요청 공유, SSE 지수 백오프 재생성·재연결 snapshot, 빈·비 JSON 오류 처리, timer·요청 정리, 과거 페이지 병합·중복 제거와 차트 논리 위치 보존을 검증했다.
- 실제 Binance 연동 화면에서 `to=<nextBefore>` 요청, 백필 진행률과 실제 보유 범위 갱신, 이전 데이터 버튼을 확인했다.
- 실제 Vite proxy 환경의 최초 로드에서 status, summary, candles와 SSE가 각각 1회만 연결됨을 API 구조화 로그로 확인했다. 활성 SSE 상태에서 API를 종료하면 UI가 `스트림 재연결 중`으로 바뀌고 서버는 `shutdown complete`까지 종료됐다. API 재기동 후 `/api/events`와 세 snapshot 요청이 각각 1회 발생하고 `실시간 연결됨`으로 복귀했다.
- API가 없는 상태에서 새로고침해도 `Unexpected end of JSON input` 같은 기술적인 문구 없이 사용자용 오류와 `다시 시도`가 표시되며, 브라우저 console 오류는 없었다.
- 데스크톱과 390px 모바일 화면에서 차트·운영 카드·테이블 배치를 확인했다.

## 남은 위험

- `backfill_jobs`의 `failed`는 잘못된 요청 등 재시도로 해결되지 않는 영구 오류로만 확정되며, 이 경우에는 여전히 자동 재개하지 않는다(운영자의 수동 개입 필요, 재시도/취소 UI는 범위 제외). 일시적 오류는 이제 job이 살아있는 한 상한(`BACKFILL_RETRY_MAX_DELAY_MS`) 내에서 무기한 재시도하므로, Binance 쪽 장애가 오래 지속되면 job이 `retrying`에 계속 머무를 수 있다 — 별도 알림/모니터링은 이번 범위에 포함하지 않았다.
- 365일 전체 백필을 끝까지 실행하는 장시간 테스트는 하지 않았다(수십~수백 초 규모로 축소한 값들로 페이지네이션·재개·비차단 동작의 정확성만 검증했다). 로직상 페이지 수만 늘어날 뿐 동일하게 동작해야 하지만, 실제 장시간 운영에서의 관찰은 하지 못했다.
