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

- 상태는 `pending`, `running`, `completed`, `failed`를 사용한다.
- 종목별 작업은 하나씩 실행하고 Binance 페이지 크기 단위로 cursor를 저장한다.
- 서버 재시작 시 `pending` 또는 `running` 작업을 마지막 cursor부터 재개한다.
- REST/WS 중복은 기존 `(symbol, open_time)` upsert로 안전하게 처리한다.
- 종료 신호를 받으면 현재 페이지 반영과 cursor 저장을 마친 뒤 worker를 종료한다.
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
    "lastError": null
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

- [ ] 설정 스키마와 보존 기간 관계 검증
- [ ] `backfill_jobs` 마이그레이션과 저장소 구현
- [ ] 최근 구간 우선 복구와 장기 백필 worker 분리
- [ ] cursor 저장, 재시작 재개, graceful shutdown 테스트
- [ ] 백필 진행률·coverage 상태 API와 SSE 제공
- [ ] candles 응답의 cursor page 계약 구현
- [ ] 확정 봉 기준 status SSE 발행
- [ ] 장기 백필 중 API·실시간 수집 비차단 검증
- [ ] 전체 백엔드 회귀 테스트와 필수 품질 명령 통과

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

- [ ] `BACKFILL_DAYS=365`인 새 DB에서도 HTTP와 실시간 수집이 장기 백필 완료를 기다리지 않는다.
- [ ] 최근 24시간을 먼저 사용할 수 있고 과거 데이터가 최신→과거 방향으로 확장된다.
- [ ] 서버 중단 후 같은 작업이 저장된 cursor부터 재개된다.
- [ ] idle 상태의 웹이 30초마다 세 API를 호출하지 않는다.
- [ ] 6시간봉·일봉 candle 재조회는 최대 확정 1분봉 주기로 제한된다.
- [ ] 차트가 이전 데이터를 추가해도 중복과 시간 위치 점프가 없다.
- [ ] UI에서 진행률과 현재 데이터 보유 범위를 확인할 수 있다.
- [ ] 보존 기간이 백필 목표보다 짧은 잘못된 설정을 거부한다.
- [ ] 네트워크 없는 테스트와 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 통과한다.
- [ ] 완료된 계약과 구조를 `docs/DESIGN.md`, README, `.env.example`에 반영한다.

## 범위 제외

- 수집기/API 프로세스 분리와 메시지 브로커
- PostgreSQL/TimescaleDB 이전과 장기 집계 테이블
- 숫자 페이지 기반 차트 탐색
- 백필 일시정지·취소 관리 화면
- 임의 날짜 범위 백필 CLI

