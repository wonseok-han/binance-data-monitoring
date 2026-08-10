import type { DbHandle } from '../db/client.js';
import { getCollectorState } from '../db/collectorState.js';
import type { ConnectionStatus } from '../db/collectorState.js';

export interface SymbolStatusResult {
  symbol: string;
  connectionStatus: ConnectionStatus;
  lastEventAt: number | null;
  lastClosedOpenTime: number | null;
  delayMs: number | null;
  lastError: string | null;
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
    };
  });
}
