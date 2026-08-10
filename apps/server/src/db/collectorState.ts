import { eq } from 'drizzle-orm';
import type { DbHandle } from './client.js';
import { collectorState } from './schema.js';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'stale';

export interface CollectorStateUpdate {
  lastEventAt?: number;
  lastClosedOpenTime?: number;
  connectionStatus?: ConnectionStatus;
  /** `null` clears the stored error; `undefined` leaves it untouched. */
  lastError?: string | null;
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
