import type { DbHandle } from '../db/client.js';
import { getCollectorState, parseBackfillRecord } from '../db/collectorState.js';
import type { BackfillRunRecord, ConnectionStatus } from '../db/collectorState.js';
import { getEarliestCandle, getLatestCandle } from '../db/candles.js';
import { getLatestBackfillJob } from '../db/backfillJobs.js';
import type { BackfillJobStatus } from '../db/backfillJobs.js';
import { computeCompleteness24h } from './completeness.js';
import type { Completeness24h } from './completeness.js';

export interface HistoricalBackfillStatus {
  status: BackfillJobStatus;
  processed: number;
  total: number;
  progressPercent: number;
  from: number;
  to: number;
  lastError: string | null;
  retryCount: number;
  nextRetryAt: number | null;
}

export interface CoverageRange {
  from: number | null;
  to: number | null;
}

export interface SymbolStatusResult {
  symbol: string;
  connectionStatus: ConnectionStatus;
  lastEventAt: number | null;
  lastClosedOpenTime: number | null;
  delayMs: number | null;
  lastError: string | null;
  lastBackfill: BackfillRunRecord | null;
  completeness24h: Completeness24h;
  historicalBackfill: HistoricalBackfillStatus | null;
  coverage: CoverageRange;
}

function buildHistoricalBackfillStatus(
  job: ReturnType<typeof getLatestBackfillJob>,
): HistoricalBackfillStatus | null {
  if (!job) return null;

  const progressPercent = job.totalCount > 0 ? Math.round((job.processedCount / job.totalCount) * 10000) / 100 : 100;

  return {
    status: job.status as BackfillJobStatus,
    processed: job.processedCount,
    total: job.totalCount,
    progressPercent,
    from: job.fromTime,
    to: job.toTime,
    lastError: job.lastError,
    retryCount: job.retryCount,
    nextRetryAt: job.nextRetryAt,
  };
}

/** 한 종목의 전체 상태 스냅샷을 만든다. REST /api/status와 SSE status 이벤트가 이 함수를 공유한다. */
export function buildSymbolStatus(db: DbHandle['db'], symbol: string, now: number): SymbolStatusResult {
  const state = getCollectorState(db, symbol);
  const job = getLatestBackfillJob(db, symbol);
  const earliest = getEarliestCandle(db, symbol);
  const latest = getLatestCandle(db, symbol);

  return {
    symbol,
    connectionStatus: (state?.connectionStatus as ConnectionStatus | undefined) ?? 'connecting',
    lastEventAt: state?.lastEventAt ?? null,
    lastClosedOpenTime: state?.lastClosedOpenTime ?? null,
    delayMs: state?.lastEventAt != null ? now - state.lastEventAt : null,
    lastError: state?.lastError ?? null,
    lastBackfill: parseBackfillRecord(state?.lastBackfillJson),
    completeness24h: computeCompleteness24h(db, symbol, now),
    historicalBackfill: buildHistoricalBackfillStatus(job),
    coverage: {
      from: earliest?.openTime ?? null,
      to: latest?.openTime ?? null,
    },
  };
}

export function buildStatus(db: DbHandle['db'], symbols: string[], now: number): SymbolStatusResult[] {
  return symbols.map((symbol) => buildSymbolStatus(db, symbol, now));
}
