export interface BackfillFailureEvent {
  symbol: string;
  jobId: number;
  error: string;
  failedAt: number;
}

/**
 * 장기 백필 job이 영구적으로 실패했을 때(재시도로 해결되지 않는 오류,
 * 또는 연속 재시도 한도 초과) 운영자에게 알리는 포트. Webhook, Sentry,
 * Prometheus 등 실제 연동은 이 인터페이스를 구현하는 어댑터를
 * historicalWorker에 주입하는 방식으로 추가하며, worker 코드는
 * 수정하지 않는다.
 */
export interface BackfillFailureNotifier {
  notifyFailed(event: BackfillFailureEvent): void;
}

export interface BackfillFailureNotifierLogger {
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

/** 기본 어댑터: 구조화 로그로만 알린다. */
export function createLoggingBackfillFailureNotifier(logger: BackfillFailureNotifierLogger): BackfillFailureNotifier {
  return {
    notifyFailed(event) {
      logger.error('historical backfill job failed permanently', { ...event });
    },
  };
}
