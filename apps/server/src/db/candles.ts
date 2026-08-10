import { and, desc, eq, gte, lte } from 'drizzle-orm';
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

export function getCandle(db: DbHandle['db'], symbol: string, openTime: number) {
  return db
    .select()
    .from(candles)
    .where(and(eq(candles.symbol, symbol), eq(candles.openTime, openTime)))
    .get();
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

export interface QueryCandlesOptions {
  from?: number;
  to?: number;
  limit: number;
}

/** Returns up to `limit` candles within [from, to], ascending by open_time. */
export function queryCandles(db: DbHandle['db'], symbol: string, options: QueryCandlesOptions) {
  const conditions = [eq(candles.symbol, symbol)];
  if (options.from !== undefined) conditions.push(gte(candles.openTime, options.from));
  if (options.to !== undefined) conditions.push(lte(candles.openTime, options.to));

  const rows = db
    .select()
    .from(candles)
    .where(and(...conditions))
    .orderBy(desc(candles.openTime))
    .limit(options.limit)
    .all();

  return rows.reverse();
}

export function getLatestCandle(db: DbHandle['db'], symbol: string) {
  return db
    .select()
    .from(candles)
    .where(eq(candles.symbol, symbol))
    .orderBy(desc(candles.openTime))
    .limit(1)
    .get();
}

export function getCandleAtOrBefore(db: DbHandle['db'], symbol: string, openTimeInclusiveMax: number) {
  return db
    .select()
    .from(candles)
    .where(and(eq(candles.symbol, symbol), lte(candles.openTime, openTimeInclusiveMax)))
    .orderBy(desc(candles.openTime))
    .limit(1)
    .get();
}

export function sumQuoteVolumeSince(db: DbHandle['db'], symbol: string, sinceOpenTimeInclusive: number): number {
  const rows = db
    .select({ quoteVolume: candles.quoteVolume })
    .from(candles)
    .where(and(eq(candles.symbol, symbol), gte(candles.openTime, sinceOpenTimeInclusive)))
    .all();

  return rows.reduce((sum, row) => sum + Number(row.quoteVolume), 0);
}
