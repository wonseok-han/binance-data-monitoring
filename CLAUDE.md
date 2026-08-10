# Binance Data Monitoring

BTCUSDT와 ETHUSDT의 Binance 1분봉을 수집·복구하고 실시간 운영 대시보드로 제공하는 TypeScript 프로젝트다.

## Read First

1. `docs/DESIGN.md` — 범위, 아키텍처, 데이터/API 계약, 완료 기준
2. `AGENTS.md` — 구현 규칙, 필수 명령, 테스트 우선순위

두 문서와 다른 구현을 제안해야 한다면 코드를 먼저 바꾸지 말고 이유와 trade-off를 짧게 설명한다.

## Your Scope

- Claude의 소유 영역은 `apps/server`의 수집기, 저장소, 복구 로직, REST/SSE API와 관련 테스트다.
- `packages/shared`에는 백엔드가 제공하는 런타임 API 스키마와 타입을 구현할 수 있다.
- `apps/web`의 UX/UI, React 컴포넌트, 차트와 스타일은 Codex가 담당한다. 명시적인 요청 없이 수정하지 않는다.
- UI 연동에 계약 변경이 필요하면 프론트엔드 우회 코드를 작성하지 말고 `docs/DESIGN.md`의 API 변경안을 먼저 제시한다.

## Implementation Workflow

1. 작업할 설계 단계와 완료 조건을 한 문장으로 명시한다.
2. `AGENTS.md`의 로컬 Git 절차에 따라 기능 브랜치를 만든다.
3. 관련 파일만 읽고 가장 작은 변경을 구현한다.
4. 네트워크 경계는 fixture로, 시간 로직은 fake clock으로 테스트한다.
5. 변경한 범위의 테스트와 전체 품질 명령을 실행한 뒤 로컬 커밋과 fast-forward를 완료한다.
6. 백엔드 담당 범위가 끝날 때까지 승인을 기다리지 않고 다음 기능 브랜치로 계속한다.
7. 전체 작업이 끝나면 브랜치·커밋, 동작, 검증 결과, 남은 위험만 간결하게 보고한다.

## Local Git Boundary

- 브랜치 생성, 로컬 커밋, 로컬 `main` fast-forward는 별도 확인 없이 수행한다.
- 기능마다 새 브랜치와 응집된 커밋을 만들고 완료 브랜치를 보존한다.
- `git push`와 그 밖의 원격 쓰기는 절대 수행하지 않는다.
- 예상하지 못한 변경은 stash, reset, amend하거나 함께 커밋하지 않는다.
- 정확한 브랜치명과 절차는 `AGENTS.md`의 `Autonomous Local Git Workflow`를 따른다.

## Commands

프로젝트 골격 구현 후 다음 루트 명령을 사용한다.

```bash
pnpm install
pnpm db:migrate
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

현재 명령이 아직 존재하지 않으면 `docs/DESIGN.md`의 1단계로 생성한다. 존재하지 않는 명령을 실행했다고 보고하지 않는다.

## Guardrails

- 설계 범위 밖 기능과 사용처가 하나뿐인 추상화를 만들지 않는다.
- Binance 클라이언트, 저장소, HTTP 계층을 분리하되 계층을 추가하지 않는다.
- 수집 순서, upsert 키, 시간 경계는 `docs/DESIGN.md`와 동일하게 유지한다.
- 오류를 삼키지 않는다. 재시도 가능한 오류와 종료해야 할 설정 오류를 구분한다.
- 테스트를 통과시키기 위해 실제 동작을 약화하거나 네트워크 호출을 기본 테스트에 넣지 않는다.
- 관련 없는 파일의 포맷이나 구조를 변경하지 않는다.
- Codex 소유인 `apps/web`을 구현하거나 시각 디자인 결정을 대신하지 않는다.

## Project Map

```text
apps/server   collector + SQLite + REST/SSE
apps/web      React dashboard
packages/shared  runtime schemas + shared types
docs/DESIGN.md   architecture source of truth
```

구조가 실제로 생성되기 전에는 이 지도를 구현 목표로 취급한다. 구조가 합의하에 바뀌면 이 문서와 설계문서를 함께 갱신한다.
