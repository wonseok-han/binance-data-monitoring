# 005. README와 앱별 실행 환경 정리

- 상태: `done`
- 담당: Codex
- 기준 설계: `docs/DESIGN.md`

## 목표

Node.js가 없는 사용자도 README만 보고 실행할 수 있게 하고, 서버와 웹의 환경 설정을 각 앱이 소유하도록 정리한다. README는 설치·실행 진입점에 집중하고 상세 설계와 향후 확장 계획은 분리한다.

## 결정 사항

- README 최상단에 macOS·Linux·WSL용 nvm 설치부터 시작하는 Quick Start를 둔다.
- `.nvmrc`로 Node.js 22를 고정하고 `npm install -g pnpm@11.17.0`으로 프로젝트의 pnpm 버전을 설치한다.
- 서버, DB migration, failed backfill 재개 명령은 실행 위치와 관계없이 `apps/server/.env`를 읽는다.
- Vite는 기본 환경 파일 탐색 규칙으로 `apps/web/.env`를 읽는다.
- README에는 주요 기능과 구현, 개발 환경, 환경변수, 명령과 API 요약을 유지한다.
- 데이터 흐름, 지표 선택 근거와 API 명세는 `docs/DESIGN.md`를 단일 기준으로 사용한다.
- 문제 접근 방식과 AI 활용 방식은 별도 설명 문서로 과도하게 정리하지 않고 설계와 task 이력을 사실 근거로 유지한다.

## 작업

- [x] `.nvmrc` 추가
- [x] 서버 전용 `.env` loader와 격리 테스트 추가
- [x] 서버·migration·backfill 재개 진입점에 loader 적용
- [x] 웹 환경 설정을 `apps/web/.env`로 분리
- [x] 앱별 `.env.example` 추가와 루트 `.env.example` 제거
- [x] README Quick Start와 환경변수 예시 갱신
- [x] README의 중복된 설치·정책·테스트 상세를 줄이고 필수 제출 항목 유지
- [x] 기본 요구사항과 구현 근거를 연결하는 `docs/REQUIREMENTS.md` 추가
- [x] 사용자 문서의 `API 계약` 표현을 `API 명세`로 통일
- [x] `docs/DESIGN.md`, `AGENTS.md`, `CLAUDE.md` 정합성 갱신

## 완료 조건

- [x] README만 보고 nvm, Node.js, pnpm, 환경변수와 DB를 준비해 대시보드를 실행할 수 있다.
- [x] README에 개발 환경, 주요 기능과 구현, 환경변수 예시가 남아 있다.
- [x] `apps/server/.env`의 `PORT`와 `DATABASE_URL`이 server, migration, backfill 재개 명령에 동일하게 적용된다.
- [x] `apps/web/.env`의 `VITE_API_BASE_URL`이 Vite 빌드에 적용된다.
- [x] README와 DESIGN의 상세 중복을 줄이고 문서 링크와 용어를 일치시킨다.

## 검증 결과

- 격리된 환경 객체와 임시 `.env`를 사용해 값 로딩과 기존 runtime 환경변수 우선순위를 테스트했다.
- 임시 `apps/server/.env`의 DB를 migration과 backfill 재개 CLI가 함께 사용함을 확인했다.
- 같은 임시 서버 설정의 `PORT=43901`로 실제 서버가 listen하고 `/health/live`에 응답함을 확인했다.
- 임시 `apps/web/.env`의 `VITE_API_BASE_URL`이 production bundle에 반영됨을 확인했다. 검증용 `.env`와 DB는 제거했다.
- workspace 전체 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`가 통과했다. 테스트는 server 128개, shared 4개, web 34개다.
- README를 268줄에서 149줄로 줄이고 환경변수 경로, package script와 문서 링크가 실제 파일과 일치함을 확인했다.
- 요구사항 R1~R5가 `DESIGN.md`와 완료 task의 구현 근거로 연결됨을 확인했다.
