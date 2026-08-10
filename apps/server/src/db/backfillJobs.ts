import { desc, eq } from 'drizzle-orm';
import type { DbHandle } from './client.js';
import { backfillJobs } from './schema.js';

export type BackfillJobStatus = 'pending' | 'running' | 'completed' | 'failed';

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
      updatedAt: update.now,
    })
    .where(eq(backfillJobs.id, id))
    .run();
}
