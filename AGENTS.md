# Agent Guide

이 문서는 Codex를 포함한 모든 코딩 에이전트의 공통 작업 규칙이다.

## Source of Truth

- 현재 구현의 제품 범위, 기술 선택, 데이터 흐름, API 계약은 `docs/DESIGN.md`를 따른다.
- 아직 구현하지 않은 변경은 `docs/tasks/todo`, 진행 중인 변경은 `docs/tasks/in-progress`, 완료 기록은 `docs/tasks/done`에서 관리한다.
- 사용자의 현재 요청이 문서보다 우선한다. 설계를 바꾸는 작업은 task 문서에 변경 계약을 먼저 정의하고, 구현 완료 시 `docs/DESIGN.md`에 반영한다.
- `CLAUDE.md`는 Claude용 진입 문서이며 별도의 제품 요구사항을 정의하지 않는다.

## Task Lifecycle

- task 파일명은 설계 단계와 별개인 3자리 연속 번호를 사용한다. 예: `001-multi-timeframe.md`.
- 작업 시작 시 대상 문서 하나를 `todo`에서 `in-progress`로 이동하고 상태를 `in-progress`로 바꾼다.
- 체크리스트를 갱신하며 문서에 없는 범위를 임의로 추가하지 않는다.
- 여러 담당자가 이어서 작업하면 마지막 담당자가 완료할 때까지 `in-progress`에 유지한다.
- 모든 검증이 끝나면 실제 구현을 `docs/DESIGN.md`와 README에 반영하고 문서를 `done`으로 이동한다.
- 동일 내용을 여러 상태 폴더나 `DESIGN.md`에 미리 복사하지 않는다.

## README Contract

`README.md`는 저장소 사용자가 현재 구현을 설치하고 실행하며 주요 동작을 파악하는 진입 문서다. 다음 항목을 바꾸는 작업은 같은 변경에서 README도 갱신한다.

- 필수 개발 환경과 기술 스택
- 설치, 실행, 빌드, 마이그레이션, 검증 명령
- 환경변수, 기본값, 별도 설정 방법
- 사용자에게 제공되는 주요 기능과 실제 구현 방식
- 공개 API 계약과 저장소의 주요 구조

README에는 현재 동작하고 검증된 내용만 기록한다. `todo`나 `in-progress`의 계획을 완료된 기능처럼 미리 작성하지 않으며, 문서의 명령과 설정값은 실제 `package.json`, 코드, `.env.example`과 일치하는지 확인한다.

## Ownership

| 담당 | 소유 영역 |
| --- | --- |
| Claude | `apps/server`: 수집, 저장, 복구, REST/SSE API |
| Codex | `apps/web`: UX/UI, React 컴포넌트, 차트, 스타일, 접근성 |
| 공동 경계 | `packages/shared`, 루트 설정, 문서 |

- 상대의 소유 영역을 직접 수정하지 않는다. 필요한 변경은 계약과 이유를 먼저 제시한다.
- API 스키마 변경은 진행 중인 task 계약과 `packages/shared`를 먼저 맞춘 후 양쪽에서 적용하고, 완료 시 `docs/DESIGN.md`를 갱신한다.
- UI는 공용 계약과 동일한 fixture를 사용할 수 있지만, 제품 코드에 별도 mock 계약을 만들지 않는다.
- 공동 경계 파일을 수정할 때는 기존 작업을 확인하고 자기 작업에 필요한 최소 범위만 변경한다.

## Working Rules

- 활성 task의 단계를 하나씩 검증하며, 담당 범위가 끝날 때까지 중간 승인을 묻지 않고 계속 진행한다.
- 요구되지 않은 인증, 메시지 브로커, 컨테이너 오케스트레이션, 범용 추상화를 추가하지 않는다.
- Binance 응답과 HTTP 입력은 런타임 스키마로 검증한다. 내부 타입 단언만으로 신뢰하지 않는다.
- 시각은 UTC Unix milliseconds, 종목은 대문자, 금액은 decimal 문자열을 기준으로 한다.
- candle 쓰기는 반드시 `(symbol, open_time)` 기준 upsert로 구현한다.
- 수집 데이터는 DB 반영 성공 후 클라이언트로 전송한다.
- 기존 사용자 변경을 되돌리거나 관련 없는 코드를 정리하지 않는다.

## Autonomous Local Git Workflow

작업 시작 시 `git status --short --branch`로 현재 브랜치와 변경을 확인한다.

1. 첫 커밋이 없으면 설계문서와 프로젝트 기본 설정을 로컬 `main`의 기준 커밋으로 만든다.
2. 갱신된 로컬 `main`에서 기능 브랜치를 만든다: `feat/<번호>-<설명>`, `fix/<설명>`, `docs/<설명>`, `chore/<설명>`.
3. 기능을 구현하고 필수 검증을 실행한다.
4. 자기 작업 파일만 명시적으로 stage하고 Conventional Commits 형식으로 커밋한다. `feat`, `fix`, `docs`, `chore` 같은 접두사는 유지하되 제목과 본문은 한국어로 작성한다. `git add .`와 `git add -A`를 사용하지 않는다.
5. 로컬 `main`으로 전환해 `git merge --ff-only <branch>`로 반영한다. 완료 브랜치는 삭제하지 않는다.
6. 다음 기능은 갱신된 로컬 `main`에서 새 브랜치로 시작한다.

브랜치 생성, 로컬 커밋, fast-forward와 다음 기능 진행에는 매번 사용자 승인을 요청하지 않는다. 한 작업 트리에서는 한 에이전트만 브랜치 전환과 커밋을 수행한다.

다음 작업은 금지한다.

- `git push`, 원격 브랜치·태그 생성, Pull Request 생성 등 모든 원격 쓰기
- `git reset --hard`, 강제 checkout, 자동 stash, rebase, 기존 커밋 amend
- 다른 작업자의 변경을 stage하거나 커밋하는 행위

예상하지 못한 변경, merge 불가, 검증 실패가 발생하면 되돌리거나 우회하지 말고 원인과 현재 상태를 보고한다.

## Required Commands

구현 시 루트 `package.json`에 아래 명령을 제공하고 계속 동작하게 유지한다.

| Command | Contract |
| --- | --- |
| `pnpm dev` | server와 web 개발 서버 실행 |
| `pnpm lint` | 전체 workspace lint |
| `pnpm typecheck` | 전체 workspace TypeScript 검사 |
| `pnpm test` | 단위·통합 테스트 실행 |
| `pnpm build` | 전체 production build |
| `pnpm db:migrate` | SQLite 마이그레이션 적용 |

명령이 아직 없는 초기 단계에서는 먼저 프로젝트 골격을 만들고 실제 실행으로 검증한다.

## Test Priorities

다음 동작은 네트워크 없이 fixture와 fake clock으로 검증한다.

1. 최초 백필의 시작·종료 시간
2. 재시작 후 마지막 확정 봉 다음 시각부터 복구
3. REST와 WebSocket 중복 이벤트의 idempotent upsert
4. 미확정 봉이 확정 봉으로 갱신되는 동작
5. 재연결 후 gap fill과 상태 전이
6. API의 symbol 허용 목록과 limit 상한

외부 Binance 연결 테스트는 별도 smoke test로 분리하고 기본 테스트에 포함하지 않는다.

## Definition of Done

- 변경 범위에 해당하는 테스트를 먼저 추가하거나 함께 추가한다.
- 수정 후 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`를 실행한다.
- 실행하지 못한 검증은 성공했다고 표현하지 말고 이유를 남긴다.
- 환경변수를 추가하면 `.env.example`과 README를 동시에 갱신한다.
- API나 데이터 모델을 바꾸면 공용 스키마와 활성 task를 함께 갱신하고, 작업 완료 시 `docs/DESIGN.md`에 최종 상태를 반영한다.
- `README Contract`에 해당하는 변경은 구현과 같은 작업에서 README에 현재 상태를 반영한다.

## Shell Note

`_safe_eval` 또는 `exec_scmb_expand_args: command not found: _safe_eval` 오류가 발생하면 scm_breeze 충돌이다. `/bin/ls`, `/usr/bin/find`처럼 실행 파일의 절대 경로를 사용한다.
