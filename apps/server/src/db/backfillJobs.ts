import { desc, eq } from 'drizzle-orm';
import type { DbHandle } from './client.js';
import { backfillJobs } from './schema.js';

export type BackfillJobStatus = 'pending' | 'running' | 'retrying' | 'completed' | 'failed';

export interface CreateBackfillJobInput {
  symbol: string;
  fromTime: number;
  toTime: number;
  cursor: number;
  totalCount: number;
  now: number;
}

/** 종목의 가장 최근 백필 job 행을 반환한다(없으면 undefined). 재개 여부 판단에 사용한다. */
export function getLatestBackfillJob(db: DbHandle['db'], symbol: string) {
  return db
    .select()
    .from(backfillJobs)
    .where(eq(backfillJobs.symbol, symbol))
    .orderBy(desc(backfillJobs.id))
    .limit(1)
    .get();
}

export function createBackfillJob(db: DbHandle['db'], input: CreateBackfillJobInput) {
  const result = db
    .insert(backfillJobs)
    .values({
      symbol: input.symbol,
      fromTime: input.fromTime,
      toTime: input.toTime,
      cursor: input.cursor,
      status: 'pending',
      processedCount: 0,
      totalCount: input.totalCount,
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();

  return { id: Number(result.lastInsertRowid) };
}

export interface UpdateBackfillJobProgressInput {
  cursor: number;
  processedCount: number;
  status: BackfillJobStatus;
  lastError?: string | null;
  /** 연속 재시도 횟수. 생략하면 기존 값을 유지하지 않고 0으로 초기화한다(성공 진행 갱신 시 기본값). */
  retryCount?: number;
  nextRetryAt?: number | null;
  now: number;
}

export function updateBackfillJobProgress(
  db: DbHandle['db'],
  id: number,
  update: UpdateBackfillJobProgressInput,
): void {
  db.update(backfillJobs)
    .set({
      cursor: update.cursor,
      processedCount: update.processedCount,
      status: update.status,
      lastError: update.lastError === undefined ? null : update.lastError,
      retryCount: update.retryCount ?? 0,
      nextRetryAt: update.nextRetryAt === undefined ? null : update.nextRetryAt,
      updatedAt: update.now,
    })
    .where(eq(backfillJobs.id, id))
    .run();
}
