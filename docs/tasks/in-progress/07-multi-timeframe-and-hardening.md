# 07. 다중 봉 차트와 운영 안정성 개선

- 상태: `in-progress`
- 백엔드 담당: Claude
- UI 담당: Codex
- 기준 설계: `docs/DESIGN.md`

## 목표

현재 `1H / 6H / 24H` 기간 조회를 실제 `1분봉 / 6시간봉 / 일봉` 선택으로 바꾸고, 이에 필요한 집계·보존 정책과 운영 안정성 개선을 함께 적용한다.

과제의 **지표**는 연결 상태, 데이터 지연, 완전성, 현재가, 등락률, 거래대금처럼 상태를 판단하는 측정값이다. `1분봉 / 6시간봉 / 일봉`은 지표가 아니라 차트의 **봉 주기(timeframe)**다.

## 구현 결정

- Binance 1분봉을 원본으로 계속 수집하고 `(symbol, open_time)` 기준으로 저장한다.
- 6시간봉과 일봉은 저장된 1분봉을 UTC 기준으로 서버에서 집계한다.
- OHLC는 첫 시가, 최고가, 최저가, 마지막 종가로 계산한다.
- 거래량, 거래대금, 체결 수는 합산하고 decimal 문자열의 정밀도를 보존한다.
- 기대하는 확정 원본 봉 수가 모두 있을 때만 집계 봉을 확정한다.
- 최초 백필과 원본 보존 기간의 기본값은 30일로 한다.
- 운영 완전성은 차트 선택과 무관하게 최근 24시간 원본 1분봉을 기준으로 한다.
- 화면은 종가 영역 차트가 아닌 실제 OHLC 캔들 차트를 사용한다.

## API 변경

```http
GET /api/candles?symbol=BTCUSDT&interval=6h&from=...&to=...&limit=120
```

- `interval`: `1m | 6h | 1d`, 기본값 `1m`
- `limit`: 집계 후 반환할 봉 개수에 적용
- 응답: `{ "symbol", "interval", "candles" }`
- 공용 패키지에 봉 주기와 변경된 응답의 런타임 스키마를 정의
- SSE는 원본 1분봉을 계속 전송하며 UI가 현재 집계 봉을 갱신

## 백엔드 작업 — Claude

- [x] 봉 주기·API 공용 스키마와 집계 테스트 추가
- [x] UTC 6시간봉·일봉 집계와 `interval` 조회 API 구현
- [x] 집계 기능부터 domain/application/infrastructure/interface 경계를 적용
- [x] 운영자가 조절할 값을 config로 중앙화
- [x] `.env.example`에 용도, 단위, 기본값, 허용 범위 설명 추가
- [x] 30일 백필·보존과 안전한 만료 데이터 정리 구현
- [x] 백필 시각·구간·건수·소요 시간·결과를 상태 API에 제공
- [x] 최근 24시간 기대·확정·누락 1분봉 수를 상태 API에 제공
- [x] `/health/live`, `/health/ready` 분리와 CORS origin 설정
- [x] 전체 백엔드 회귀 테스트와 필수 품질 명령 통과

백엔드 범위는 완료했다. Codex의 UI 작업이 남아 있어 이 문서는 계속 `in-progress`로 유지한다. 검증 결과는 문서 하단 "백엔드 검증 결과" 절 참고.

클린 아키텍처는 전체 코드를 한 번에 다시 쓰지 않는다. 도메인 규칙이 Fastify, Drizzle, Binance 응답에 의존하지 않게 하고 외부 경계에만 포트를 둔다. 일대일 래퍼와 사용처가 하나뿐인 범용 추상화는 만들지 않는다.

환경변수에는 백필·보존 기간, 재시도·재연결 지연, stale 시간, SSE heartbeat, CORS origin처럼 배포 시 조절할 값만 둔다. 시간 단위, 지원 봉 주기, Binance 프로토콜 제한은 이름 있는 코드 상수로 유지한다.

## UI 작업 — Codex

- [ ] 기간 선택을 `1분 / 6시간 / 일` 봉 주기 선택으로 교체
- [ ] OHLC 캔들과 거래량 차트 구현
- [ ] 선택한 봉 주기에 맞춰 최근 봉 테이블 갱신
- [ ] SSE 1분봉으로 현재 집계 봉을 실시간 갱신하고 REST와 재동기화
- [ ] 종목 목록을 서버 상태 응답 기준으로 구성
- [ ] 운영 지표와 봉 주기를 화면에서 명확히 분리
- [ ] 반응형·접근성·오류 상태와 전체 품질 명령 검증

## 확장 경계

이번 작업에서는 현재의 단일 서버 프로세스를 유지한다. 수집기와 API 프로세스 분리는 처리량이나 독립 배포 요구가 생겼을 때 검토하며, 이를 위한 추상화를 미리 추가하지 않는다.

SQLite에서는 30일 보존과 별도 `VACUUM` 유지보수 정책까지만 다룬다. 실제 압축과 연속 집계는 PostgreSQL/TimescaleDB로 전환할 때 적용한다.

## 완료 조건

- [x] 새 DB에서 두 종목의 최근 30일 1분봉이 백필되고 실시간 수집이 이어진다.
- [x] 재시작 누락 구간이 중복 없이 복구된다.
- [x] 동일 원본이 UTC 기준 1분·6시간·일봉 OHLCV로 정확히 집계된다.
- [x] 진행 중인 집계 봉과 확정 봉이 구분된다.
- [ ] 대시보드 선택에 따라 실제 봉 개수와 OHLC가 바뀐다. (Codex 담당, 미착수)
- [x] 운영 완전성은 최근 24시간 원본 1분봉 기준으로 유지된다.
- [x] 만료 데이터 정리가 실시간 수집을 방해하지 않는다.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 통과한다 (workspace 전체 기준).
- [ ] 완료된 계약과 구조를 `docs/DESIGN.md`, README, `.env.example`에 반영한다.
      → `README.md`와 `.env.example`은 백엔드 변경분(interval API, config 변수, health 분리)을 이미 반영했다.
      `docs/DESIGN.md`는 AGENTS.md 작업 생명주기에 따라 **UI 작업까지 전체 완료된 뒤에만** 갱신하므로 아직 미반영이다.

## 백엔드 검증 결과 (Claude)

### 로컬 브랜치·커밋

| 브랜치 | 내용 |
| --- | --- |
| `docs/7-start-multi-timeframe-task` | 작업 문서를 `todo` → `in-progress`로 이동 |
| `feat/7-interval-schema-and-aggregation` | 봉 주기 공용 스키마, 집계 domain/application/infrastructure 계층, `interval` 조회 API |
| `feat/7-config-centralization` | 운영자 조절 값 config 중앙화, `.env.example` 문서화 |
| `feat/7-retention-cleanup` | `BACKFILL_DAYS`/`RETENTION_DAYS` 기본 30일, 배치 삭제 정리 작업 |
| `feat/7-status-backfill-metadata` | 상태 API에 백필 시각·구간·건수·소요시간·결과 노출 |
| `feat/7-status-completeness` | 상태 API에 24시간 완전성(기대/확정/누락) 노출 |
| `feat/7-health-split-cors` | `/health/live`, `/health/ready` 분리 |
| `docs/7-update-checklist` | 이 문서 갱신 (현재 브랜치) |

모두 로컬 `main`에 `--ff-only`로 반영되어 있고 원격 push는 하지 않았다.

### 자동 검증

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — workspace 전체(`packages/shared`, `apps/server`, `apps/web`) 통과.
- `apps/server` 테스트 79개(신규 domain/application/집계·decimal 정밀도·config·retention·completeness·health 테스트 포함), `packages/shared` 4개, `apps/web` 6개(미수정, 회귀 없음 확인) 모두 통과.
- 네트워크 호출은 fixture와 주입 가능한 clock/WebSocket 더블로 대체했고, 기본 테스트 스위트에는 포함하지 않았다.

### 실서버 스모크 테스트 (Binance 실연동)

- 기본값(`BACKFILL_DAYS=30`)으로 BTCUSDT를 새 DB에서 기동 → 43,200개 1분봉 백필을 약 6.5초에 완료, 중복 없음(`count(*) = count(DISTINCT open_time)`), `completeness24h: {expected:1440, confirmed:1440, missing:0}` 확인.
- `GET /api/candles?interval=6h`, `interval=1d`가 실제 Binance 데이터를 UTC 정렬 버킷으로 정확히 집계함을 확인(완료된 버킷은 `isClosed:true`, 진행 중 버킷은 `false`).
- `GET /api/status`에 `lastBackfill`(시각·구간·건수·소요시간·결과)과 `completeness24h`가 채워짐을 확인.
- `CORS_ORIGIN`을 특정 origin으로 설정 시 허용 origin은 `Access-Control-Allow-Origin` 헤더가 반환되고 그 외 origin은 차단됨을 확인.
- `/health/live`, `/health/ready` 정상 응답과 옛 `/health` 제거(404) 확인, Vite 프록시(`/health` 접두사)·`apps/web` 코드 모두 하위 경로 미의존 확인.
- `SIGTERM` graceful shutdown이 수집기·정리 작업 정지 → HTTP 서버 종료 → DB close 순서로 동작함을 로그로 확인.

### 남은 위험 / 다음 단계

- UI(Codex) 작업이 전혀 시작되지 않았다. 봉 주기 선택, OHLC 캔들 차트, 완전성/봉 주기 UI 분리, SSE 재동기화가 남아 있다.
- `/health` 단일 경로가 `/health/live`+`/health/ready`로 분리되는 breaking change다. Vite 프록시와 현재 `apps/web` 코드는 영향받지 않지만, 외부 모니터링(uptime check 등)이 `/health`를 직접 호출하고 있다면 갱신이 필요하다.
- `BACKFILL_HOURS` 환경변수가 `BACKFILL_DAYS`로 대체됐다(breaking rename). 기존 `.env`를 쓰던 배포가 있다면 값을 이관해야 한다.
- 만료 데이터 정리는 단위 테스트로 배치·yield 동작을 검증했지만, 실제 30일 이상 장기 운영에서의 관찰은 하지 못했다(환경 제약상 장시간 구동 불가).
