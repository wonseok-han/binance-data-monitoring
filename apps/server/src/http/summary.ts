import type { DbHandle } from '../db/client.js';
import { getCandleAtOrBefore, getLatestCandle, sumQuoteVolumeSince } from '../db/candles.js';
import { HOUR_MS, MINUTE_MS } from '../config/index.js';

export interface SummaryResult {
  symbol: string;
  currentPrice: string;
  asOf: number;
  change1h: string | null;
  changePercent1h: number | null;
  quoteVolume1h: string;
}

export function buildSummary(db: DbHandle['db'], symbol: string): SummaryResult | null {
  const latest = getLatestCandle(db, symbol);
  if (!latest) return null;

  const past = getCandleAtOrBefore(db, symbol, latest.openTime - HOUR_MS);

  let change1h: string | null = null;
  let changePercent1h: number | null = null;

  if (past) {
    const currentPrice = Number(latest.close);
    const pastPrice = Number(past.close);
    if (pastPrice !== 0) {
      change1h = (currentPrice - pastPrice).toString();
      changePercent1h = ((currentPrice - pastPrice) / pastPrice) * 100;
    }
  }

  const quoteVolume1h = sumQuoteVolumeSince(db, symbol, latest.openTime - HOUR_MS + MINUTE_MS);

  return {
    symbol,
    currentPrice: latest.close,
    asOf: latest.openTime,
    change1h,
    changePercent1h,
    quoteVolume1h: quoteVolume1h.toString(),
  };
}
