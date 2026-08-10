import { eq } from 'drizzle-orm';
import type { DbHandle } from './client.js';
import { collectorState } from './schema.js';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'stale';

export interface CollectorStateUpdate {
  lastEventAt?: number;
  lastClosedOpenTime?: number;
  connectionStatus?: ConnectionStatus;
  /** `null`이면 저장된 오류를 지운다; `undefined`면 그대로 둔다. */
  lastError?: string | null;
  /** JSON으로 직렬화한 BackfillRunRecord; `undefined`면 그대로 둔다. */
  lastBackfillJson?: string | null;
}

export function upsertCollectorState(db: DbHandle['db'], symbol: string, update: CollectorStateUpdate): void {
  const existing = db.select().from(collectorState).where(eq(collectorState.symbol, symbol)).get();

  if (!existing) {
    db.insert(collectorState)
      .values({
        symbol,
        connectionStatus: update.connectionStatus ?? 'connecting',
        lastEventAt: update.lastEventAt ?? null,
        lastClosedOpenTime: update.lastClosedOpenTime ?? null,
        lastError: update.lastError ?? null,
        lastBackfillJson: update.lastBackfillJson ?? null,
      })
      .run();
    return;
  }

  db.update(collectorState)
    .set({
      connectionStatus: update.connectionStatus ?? existing.connectionStatus,
      lastEventAt: update.lastEventAt ?? existing.lastEventAt,
      lastClosedOpenTime: update.lastClosedOpenTime ?? existing.lastClosedOpenTime,
      lastError: update.lastError === undefined ? existing.lastError : update.lastError,
      lastBackfillJson: update.lastBackfillJson === undefined ? existing.lastBackfillJson : update.lastBackfillJson,
    })
    .where(eq(collectorState.symbol, symbol))
    .run();
}

export function getCollectorState(db: DbHandle['db'], symbol: string) {
  return db.select().from(collectorState).where(eq(collectorState.symbol, symbol)).get();
}

export function listCollectorStates(db: DbHandle['db']) {
  return db.select().from(collectorState).all();
}

export interface BackfillRunRecord {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  from: number | null;
  to: number | null;
  count: number;
  result: 'success' | 'error';
  error: string | null;
}

export function serializeBackfillRecord(record: BackfillRunRecord): string {
  return JSON.stringify(record);
}

export function parseBackfillRecord(json: string | null | undefined): BackfillRunRecord | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as BackfillRunRecord;
  } catch {
    return null;
  }
}
