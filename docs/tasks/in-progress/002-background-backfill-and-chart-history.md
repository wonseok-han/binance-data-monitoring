# 002. 백그라운드 백필과 차트 과거 탐색 개선

- 상태: `in-progress`
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

### 영속 백필 작업

SQLite에 `backfill_jobs`를 추가한다.

```text
id, symbol, from_time, to_time, cursor,
status, processed_count, total_count,
last_error, created_at, updated_at
```

- 상태는 `pending`, `running`, `retrying`, `completed`, `failed`를 사용한다.
- 종목별 작업은 하나씩 실행하고 Binance 페이지 크기 단위로 cursor를 저장한다.
- 서버 재시작 시 `pending`/`running`/`retrying` 작업을 마지막 cursor부터 재개한다.
- REST/WS 중복은 기존 `(symbol, open_time)` upsert로 안전하게 처리한다.
- 종료 신호를 받으면 현재 페이지 반영(또는 재시도 대기)을 즉시 중단하고 cursor를 저장한 뒤 worker를 종료한다.
- 일시적 오류(네트워크 오류, Binance 429/5xx)는 job을 `failed`로 만들지 않고 `retrying` 상태로 전환해 지수 백오프(`BACKFILL_RETRY_BASE_DELAY_MS` ~ `BACKFILL_RETRY_MAX_DELAY_MS`) 후 같은 페이지를 재시도한다. 연속 재시도 횟수(`retryCount`)와 다음 재시도 시각(`nextRetryAt`)을 함께 저장해 재시작 후에도 남은 대기 시간만 마저 기다리고 이어서 진행한다.
- 잘못된 요청 등 재시도로 해결되지 않는 영구 오류만 즉시 `failed`로 확정하며, `failed`는 자동 재개하지 않는다.
- 외부 작업 큐나 메시지 브로커는 사용하지 않는다.

## API와 실시간 동기화 개선

현재 웹은 30초마다 status, summary, candles를 모두 재조회하고, 6시간봉·일봉은 원본 SSE 이벤트를 받을 때 최대 1초마다 candles를 다시 조회한다. 이를 다음과 같이 변경한다.

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
- [x] cursor 저장, 재시작 재개, graceful shutdown 테스트
- [x] 백필 진행률·coverage 상태 API와 SSE 제공
- [x] candles 응답의 cursor page 계약 구현
- [x] 확정 봉 기준 status SSE 발행
- [x] 장기 백필 중 API·실시간 수집 비차단 검증
- [x] 전체 백엔드 회귀 테스트와 필수 품질 명령 통과
- [x] 장기 백필 job의 영속적 자동 재시도(지수 백오프, 재시작 후 재개, 영구 오류만 최종 failed)

백엔드 범위는 완료했다. Codex의 UI 작업이 남아 있어 이 문서는 계속 `in-progress`로 유지한다. 검증 결과는 문서 하단 "백엔드 검증 결과" 절 참고.

## UI 작업 — Codex

- [ ] 30초 전체 polling을 이벤트 중심 동기화와 5분 안전망으로 변경
- [ ] 6시간봉·일봉 재조회를 확정 1분봉 이벤트로 제한
- [ ] SSE 재연결 snapshot 동기화와 동일 요청 중복 방지
- [ ] 차트 왼쪽 경계의 cursor 기반 과거 데이터 로딩
- [ ] 테이블의 이전 데이터 불러오기
- [ ] 백필 진행률, 데이터 보유 범위와 백필 중 상태 표시
- [ ] 데스크톱·모바일·접근성·오류 상태 검증
- [ ] 전체 프론트엔드 회귀 테스트와 필수 품질 명령 통과

## 완료 조건

- [x] `BACKFILL_DAYS=365`인 새 DB에서도 HTTP와 실시간 수집이 장기 백필 완료를 기다리지 않는다.
- [x] 최근 24시간을 먼저 사용할 수 있고 과거 데이터가 최신→과거 방향으로 확장된다.
- [x] 서버 중단 후 같은 작업이 저장된 cursor부터 재개된다.
- [ ] idle 상태의 웹이 30초마다 세 API를 호출하지 않는다. (Codex 담당, 미착수)
- [ ] 6시간봉·일봉 candle 재조회는 최대 확정 1분봉 주기로 제한된다. (Codex 담당; 백엔드는 확정 1분봉마다 `candle` SSE를 이미 발행한다 — 트리거는 준비됨)
- [ ] 차트가 이전 데이터를 추가해도 중복과 시간 위치 점프가 없다. (Codex 담당; 백엔드 cursor 페이지네이션은 준비됨)
- [ ] UI에서 진행률과 현재 데이터 보유 범위를 확인할 수 있다. (Codex 담당; 백엔드 `historicalBackfill`/`coverage`는 준비됨)
- [x] 보존 기간이 백필 목표보다 짧은 잘못된 설정을 거부한다.
- [x] 네트워크 없는 테스트와 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 통과한다 (workspace 전체, 현재 `apps/web` 상태 기준. UI 작업 반영 후 재검증 필요).
- [ ] 완료된 계약과 구조를 `docs/DESIGN.md`, README, `.env.example`에 반영한다.
      → `README.md`와 `.env.example`은 백엔드 변경분(warmup 설정, `backfill_jobs`, 상태 API 확장, cursor 페이지네이션)을 이미 반영했다.
      `docs/DESIGN.md`는 AGENTS.md 작업 생명주기에 따라 **UI 작업까지 전체 완료된 뒤에만** 갱신하므로 아직 미반영이다.

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
| `feat/2-historical-backfill-worker` | 장기 백필 worker(cursor 저장, 재개, graceful stop) |
| `feat/2-status-historical-sse-collector` | `status/status.ts` 통합, `historicalBackfill`/`coverage`, 확정봉 SSE, `onFirstLive`, 비동기 shutdown, index.ts 배선 |
| `feat/2-candles-cursor-pagination` | candles 응답 `page.nextBefore`/`hasMore` |
| `docs/2-update-checklist` | 이 문서 갱신 |
| `feat/2-backfill-job-retry` | 장기 백필 job 영속적 자동 재시도(지수 백오프), `retrying` 상태·`retryCount`/`nextRetryAt` 노출 (현재 브랜치) |

모두 로컬 `main`에 `--ff-only`로 반영되어 있고 원격 push는 하지 않았다.

### 자동 검증

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — workspace 전체(`packages/shared`, `apps/server`, `apps/web`) 통과.
- `apps/server` 테스트 115개(신규 backfill_jobs 리포지토리·historicalWorker의 페이지네이션/영구·일시적 오류 분기/지수 백오프 재시도/재시도 중 graceful stop/재시작 후 진행·재시도 재개·candles cursor 페이지네이션·collector의 onFirstLive/확정봉 SSE·비동기 shutdown·binanceRest 오류 분류 테스트 포함), `packages/shared` 4개, `apps/web` 10개(미수정, 회귀 없음) 모두 통과.
- 새 필드(`historicalBackfill`, `coverage`, `page`, `historicalBackfill.retryCount`/`nextRetryAt`)를 공용 스키마에 필수 필드로 추가했지만 `apps/web`의 typecheck/test/build 모두 회귀 없이 통과함을 확인했다(기존 코드가 이 값들을 아직 사용하지 않기 때문).
- 네트워크 호출은 fixture와 주입 가능한 clock/REST/WebSocket 더블로 대체했고 기본 테스트 스위트에는 포함하지 않았다.

### 실서버 스모크 테스트 (Binance 실연동)

- 기본값(`BACKFILL_DAYS=365`, `BACKFILL_WARMUP_HOURS=24`)으로 새 DB에서 BTCUSDT 기동 → `/health/ready`가 0.55초 만에 응답(장기 백필을 기다리지 않음), 3초 뒤 `/api/status`에서 `connectionStatus: live`, `completeness24h: 1440/1440`, `historicalBackfill: { status: running, total: 524160 }`이 이미 진행 중임을 확인.
- `BACKFILL_DAYS=60`으로 백필이 진행 중인 상태에서 `SIGTERM` 전송 → 진행 중이던 페이지를 마저 처리하고 cursor를 저장한 뒤(`shutdown started` → `collector stopped` → `shutdown complete` 약 100ms) 정상 종료. 재시작 시 **같은 `backfill_jobs` id**로 저장된 cursor부터 이어서 진행됨을 확인(처음부터 다시 시작하지 않음).
- `GET /api/candles?interval=1d`에서 받은 `page.nextBefore`를 다음 요청의 `to`로 넘겨 과거 페이지를 정상적으로 이어받고, 더 이상 데이터가 없을 때 `hasMore: false`와 빈 배열을 확인.
- 75초간 SSE(`/api/events`)를 구독해 확정 1분봉 저장 시 `event: status`가 정확히 발행됨을 확인(연결 상태 변화가 없어도 발행됨).
- 잘못된 설정(`RETENTION_DAYS < BACKFILL_DAYS`)이 서버 시작 전 오류로 거부됨을 확인.
- (재시도 기능 추가 후) `BACKFILL_DAYS=1`로 새 DB에서 실제 Binance 연동으로 기동 → 정상 완료된 job의 `/api/status`에 `historicalBackfill.retryCount: 0`, `nextRetryAt: null`이 노출됨을 확인. `SIGTERM` 전송 시 `shutdown started` → `collector stopped` → `shutdown complete`가 여전히 수 ms 내로 끝나 재시도 대기 로직 추가가 graceful shutdown 지연을 유발하지 않음을 확인. 실제 429/5xx나 네트워크 단절을 재현하는 재시도 경로 자체는 `historicalWorker.test.ts`의 주입 가능한 fetchKlines/sleep 더블로 검증했다(백오프 지연 값, 같은 페이지 재시도, 영구 오류 즉시 failed, 재시도 대기 중 stop() 즉시 반환, 재시작 후 retrying 상태 재개 포함).

### 남은 위험 / 다음 단계

- UI(Codex) 작업이 전혀 시작되지 않았다. 이벤트 중심 동기화, 6h/1d 확정봉 트리거 재조회, cursor 기반 무한 스크롤, 백필 진행률/coverage/재시도 상태 표시가 남아 있다.
- `backfill_jobs`의 `failed`는 잘못된 요청 등 재시도로 해결되지 않는 영구 오류로만 확정되며, 이 경우에는 여전히 자동 재개하지 않는다(운영자의 수동 개입 필요, 재시도/취소 UI는 범위 제외). 일시적 오류는 이제 job이 살아있는 한 상한(`BACKFILL_RETRY_MAX_DELAY_MS`) 내에서 무기한 재시도하므로, Binance 쪽 장애가 오래 지속되면 job이 `retrying`에 계속 머무를 수 있다 — 별도 알림/모니터링은 이번 범위에 포함하지 않았다.
- `BACKFILL_DAYS`(전체 목표 기간)와 `BACKFILL_WARMUP_HOURS`(동기 warmup 구간) 두 값의 관계를 UI에서 설명하지 않으면 사용자가 왜 "완료"와 "진행 중"이 공존하는지 혼동할 수 있다.
- 365일 전체 백필을 끝까지 실행하는 장시간 테스트는 하지 않았다(수십~수백 초 규모로 축소한 값들로 페이지네이션·재개·비차단 동작의 정확성만 검증했다). 로직상 페이지 수만 늘어날 뿐 동일하게 동작해야 하지만, 실제 장시간 운영에서의 관찰은 하지 못했다.

