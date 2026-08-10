# Agent Guide

이 문서는 Codex를 포함한 모든 코딩 에이전트의 공통 작업 규칙이다.

## Source of Truth

- 제품 범위, 기술 선택, 데이터 흐름, API 계약은 `docs/DESIGN.md`를 따른다.
- 사용자의 현재 요청이 문서보다 우선한다. 요청이 설계를 바꾸면 먼저 `docs/DESIGN.md`를 함께 갱신한다.
- `CLAUDE.md`는 Claude용 진입 문서이며 별도의 제품 요구사항을 정의하지 않는다.

## Ownership

| 담당 | 소유 영역 |
| --- | --- |
| Claude | `apps/server`: 수집, 저장, 복구, REST/SSE API |
| Codex | `apps/web`: UX/UI, React 컴포넌트, 차트, 스타일, 접근성 |
| 공동 경계 | `packages/shared`, 루트 설정, 문서 |

- 상대의 소유 영역을 직접 수정하지 않는다. 필요한 변경은 계약과 이유를 먼저 제시한다.
- API 스키마 변경은 `docs/DESIGN.md`와 `packages/shared`를 먼저 맞춘 후 양쪽에서 적용한다.
- UI는 공용 계약과 동일한 fixture를 사용할 수 있지만, 제품 코드에 별도 mock 계약을 만들지 않는다.
- 공동 경계 파일을 수정할 때는 기존 작업을 확인하고 자기 작업에 필요한 최소 범위만 변경한다.

## Working Rules

- `docs/DESIGN.md`의 단계를 하나씩 검증하며, 담당 범위가 끝날 때까지 중간 승인을 묻지 않고 계속 진행한다.
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
4. 자기 작업 파일만 명시적으로 stage하고 Conventional Commits 형식으로 커밋한다. `git add .`와 `git add -A`를 사용하지 않는다.
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
- API나 데이터 모델을 바꾸면 공용 스키마와 `docs/DESIGN.md`를 동시에 갱신한다.

## Shell Note

`_safe_eval` 또는 `exec_scmb_expand_args: command not found: _safe_eval` 오류가 발생하면 scm_breeze 충돌이다. `/bin/ls`, `/usr/bin/find`처럼 실행 파일의 절대 경로를 사용한다.
