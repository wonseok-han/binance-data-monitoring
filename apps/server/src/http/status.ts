import type { DbHandle } from '../db/client.js';
import { getCollectorState, parseBackfillRecord } from '../db/collectorState.js';
import type { BackfillRunRecord, ConnectionStatus } from '../db/collectorState.js';
import { computeCompleteness24h } from '../status/completeness.js';
import type { Completeness24h } from '../status/completeness.js';

export interface SymbolStatusResult {
  symbol: string;
  connectionStatus: ConnectionStatus;
  lastEventAt: number | null;
  lastClosedOpenTime: number | null;
  delayMs: number | null;
  lastError: string | null;
  lastBackfill: BackfillRunRecord | null;
  completeness24h: Completeness24h;
}

export function buildStatus(db: DbHandle['db'], symbols: string[], now: number): SymbolStatusResult[] {
  return symbols.map((symbol) => {
    const state = getCollectorState(db, symbol);

    return {
      symbol,
      connectionStatus: (state?.connectionStatus as ConnectionStatus | undefined) ?? 'connecting',
      lastEventAt: state?.lastEventAt ?? null,
      lastClosedOpenTime: state?.lastClosedOpenTime ?? null,
      delayMs: state?.lastEventAt != null ? now - state.lastEventAt : null,
      lastError: state?.lastError ?? null,
      lastBackfill: parseBackfillRecord(state?.lastBackfillJson),
      completeness24h: computeCompleteness24h(db, symbol, now),
    };
  });
}
