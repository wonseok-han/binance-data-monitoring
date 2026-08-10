import { and, desc, eq } from 'drizzle-orm';
import type { DbHandle } from './client.js';
import { candles } from './schema.js';
import type { RawCandle } from '../collector/binanceRest.js';

export function upsertCandles(db: DbHandle['db'], rows: RawCandle[]): void {
  if (rows.length === 0) return;

  const now = Date.now();

  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(candles)
        .values({ ...row, updatedAt: now })
        .onConflictDoUpdate({
          target: [candles.symbol, candles.openTime],
          set: {
            closeTime: row.closeTime,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume,
            quoteVolume: row.quoteVolume,
            tradeCount: row.tradeCount,
            isClosed: row.isClosed,
            updatedAt: now,
          },
        })
        .run();
    }
  });
}

export function getLastClosedCandle(db: DbHandle['db'], symbol: string) {
  return db
    .select()
    .from(candles)
    .where(and(eq(candles.symbol, symbol), eq(candles.isClosed, true)))
    .orderBy(desc(candles.openTime))
    .limit(1)
    .get();
}

export function countCandles(db: DbHandle['db'], symbol: string): number {
  return db
    .select()
    .from(candles)
    .where(eq(candles.symbol, symbol))
    .all().length;
}
