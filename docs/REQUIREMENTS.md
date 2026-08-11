# Binance 데이터 모니터링 요구사항

이 문서는 프로젝트가 충족해야 하는 기본 요구사항을 정리한다. 구체적인 기술 선택과 구현 방법은 [`DESIGN.md`](DESIGN.md), 향후 운영 확장은 [`006-production-readiness-and-scaling.md`](tasks/todo/006-production-readiness-and-scaling.md)를 따른다.

## 1. 데이터 수집 파이프라인

### R1. 실시간 데이터 수집

- Binance API를 사용해 `BTCUSDT`, `ETHUSDT` 두 종목의 데이터를 실시간으로 수집한다.

### R2. 최초 실행 백필

- 시스템 최초 실행 시 과거 시세가 없는 상태에서 필요한 과거 데이터를 채울 수 있어야 한다.

### R3. 재시작 후 누락 복구

- 서버 중단 후 재시작하더라도 중단된 구간의 누락 데이터를 채울 수 있어야 한다.
- 최초 실행 백필과 재시작 후 복구는 같은 기능으로 구현해도 된다.

## 2. 운영 대시보드

### R4. 실시간 대시보드

- 수집한 데이터를 기반으로 운영 대시보드를 제공한다.
- 데이터 변경을 화면에서 실시간으로 확인할 수 있어야 한다.

### R5. 지표와 표현 방식

- 투자 판단 또는 운영 현황 파악에 도움이 되는 지표를 자유롭게 정의한다.
- 선택한 지표의 이유와 근거를 간단한 문서로 남긴다.
- 그래프, 숫자 카드, 테이블 등 목적에 맞는 표현 방식을 자유롭게 사용한다.

## 3. 구현 조건과 평가 관점

- 언어와 기술 스택은 자유롭게 선택한다.
- 구현 범위는 요구사항을 충족하는 선에서 자유롭게 확장할 수 있다.
- 다음 내용을 함께 고려한다.
  - 결과물의 완성도
  - 문제 접근 방식
  - 구조 설계
  - 안정성
  - 확장성
  - AI 도구 활용 방식

## 4. 요구사항 추적표

| ID | 대응 구현 | 설계·검증 근거 | 상태 |
| --- | --- | --- | --- |
| R1 | Binance WebSocket `kline_1m` 수집, BTCUSDT·ETHUSDT 고정 정책 | [`DESIGN.md` 3장](DESIGN.md#3-전체-구조), [`DESIGN.md` 5장](DESIGN.md#5-수집과-누락-복구) | 완료 |
| R2 | 최근 24시간 우선 백필 후 365일 백그라운드 백필 | [`DESIGN.md` 5장](DESIGN.md#5-수집과-누락-복구), [`DESIGN.md` 완료 기준](DESIGN.md#12-완료-기준) | 완료 |
| R3 | 마지막 확정 봉 기준 gap-fill, DB에 저장된 백필 진행 위치로 재개 | [`DESIGN.md` 5장](DESIGN.md#5-수집과-누락-복구), [`002 작업 기록`](tasks/done/002-background-backfill-and-chart-history.md) | 완료 |
| R4 | REST snapshot과 SSE 이벤트를 사용하는 React 대시보드 | [`DESIGN.md` 6장](DESIGN.md#6-대시보드), [`004 작업 기록`](tasks/done/004-recent-records-and-backfill-refresh.md) | 완료 |
| R5 | 운영 상태·완전성·시장 요약·OHLC/거래량 차트·최근 봉 | [`DESIGN.md` 지표 선택 근거](DESIGN.md#대시보드-지표-선택-근거) | 완료 |

구조와 안정성에 대한 현재 결정은 `DESIGN.md`, 구현 범위를 넘어서는 확장 계획은 `docs/tasks/todo/006-production-readiness-and-scaling.md`에 기록한다. AI 도구의 역할과 작업 경계는 `AGENTS.md`, `CLAUDE.md`와 task 이력에 남기며 별도의 결과 설명 문서로 중복하지 않는다.
