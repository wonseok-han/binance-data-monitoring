/**
 * 여러 모듈이 공유하는 고정 제품 정책과 기반 상수. 배포 환경에 따라 값이
 * 달라지지 않으므로 환경변수가 아니라 코드로 관리한다(`runtime.ts`는
 * 반대로 배포마다 달라지는 값만 담는다). 테스트에서 다른 값이 필요하면
 * 이 값을 환경변수로 우회하지 말고 각 모듈의 의존성 주입 파라미터를
 * 사용한다.
 */
export interface Policy {
  /** 이 프로젝트가 수집하는 종목. 제품 범위로 고정되어 있다(docs/DESIGN.md 1절). */
  symbols: string[];
  backfill: {
    /** 새 DB가 최종적으로 확보할 전체 과거 기간(일). */
    days: number;
    /** 서버 시작 시(또는 재연결 직후) 실시간 전환을 막지 않고 우선 채우는 최근 구간(시간). */
    warmupHours: number;
    /** 장기 백필 한 페이지에 조회할 Binance kline 개수. */
    pageSize: number;
    /** 장기 백필 페이지 사이의 지연(ms). */
    interPageDelayMs: number;
    /** 일시적 오류(네트워크 오류, Binance 429/5xx) 재시도 지수 백오프의 시작 지연(ms). */
    retryBaseDelayMs: number;
    /** 위 지수 백오프의 최대 지연 상한(ms). */
    retryMaxDelayMs: number;
    /** 연속 재시도가 이 횟수를 넘으면 job을 영구 failed로 전환한다. */
    maxRetries: number;
  };
  retention: {
    /** 원본 1분봉 보존 기간(일). `backfill.days` 이상이어야 한다. */
    days: number;
    /** 만료 데이터 정리 작업 실행 주기(시간). */
    cleanupIntervalHours: number;
    /** 정리 작업 한 번에 삭제할 배치 크기. */
    batchSize: number;
  };
  collector: {
    /** 이 시간(초) 동안 이벤트가 없으면 stale로 표시하고 재연결한다. */
    staleAfterSeconds: number;
    /** WebSocket 재연결 지수 백오프 시작 지연(ms). */
    reconnectBaseDelayMs: number;
    /** WebSocket 재연결 지수 백오프 최대 지연 상한(ms). */
    reconnectMaxDelayMs: number;
  };
  binanceRest: {
    /** REST 요청이 재시도 가능한 오류일 때 최대 재시도 횟수. */
    maxRetries: number;
    /** REST 재시도 기본 지연(ms, `Retry-After` 없을 때 시도마다 지수 증가). */
    retryDelayMs: number;
  };
  api: {
    /** `/api/candles` limit 기본값. */
    candlesDefaultLimit: number;
    /** `/api/candles` limit 최대값. */
    candlesMaxLimit: number;
  };
  sse: {
    /** `/api/events` heartbeat 주기(ms). */
    heartbeatMs: number;
  };
}

export const policy: Policy = {
  symbols: ['BTCUSDT', 'ETHUSDT'],
  backfill: {
    days: 365,
    warmupHours: 24,
    pageSize: 1000,
    interPageDelayMs: 100,
    retryBaseDelayMs: 1000,
    retryMaxDelayMs: 300_000,
    maxRetries: 12,
  },
  retention: {
    days: 365,
    cleanupIntervalHours: 6,
    batchSize: 1000,
  },
  collector: {
    staleAfterSeconds: 10,
    reconnectBaseDelayMs: 1000,
    reconnectMaxDelayMs: 30_000,
  },
  binanceRest: {
    maxRetries: 3,
    retryDelayMs: 500,
  },
  api: {
    candlesDefaultLimit: 500,
    candlesMaxLimit: 2000,
  },
  sse: {
    heartbeatMs: 15_000,
  },
};

/**
 * `policy` 값 사이의 불변 조건을 검증한다. 배포 설정 오류가 아니라 코드
 * 수정 실수를 서버 시작 전에 잡기 위한 방어적 점검이므로 기본값은 항상
 * 통과해야 한다.
 */
export function assertPolicyInvariants(p: Policy = policy): void {
  if (p.retention.days < p.backfill.days) {
    throw new Error('policy.retention.days must be greater than or equal to policy.backfill.days');
  }
}
