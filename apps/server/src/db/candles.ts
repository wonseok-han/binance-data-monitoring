import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
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

/** Every candle within [from, to], ascending. No limit — callers bound the range themselves. */
export function getCandlesInRange(db: DbHandle['db'], symbol: string, from: number, to: number) {
  return db
    .select()
    .from(candles)
    .where(and(eq(candles.symbol, symbol), gte(candles.openTime, from), lte(candles.openTime, to)))
    .orderBy(candles.openTime)
    .all();
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

/**
 * Deletes up to `batchSize` candles older than `cutoffOpenTime` for one
 * symbol and returns how many were removed. Callers loop this (yielding the
 * event loop between calls) instead of issuing one unbounded DELETE, so a
 * large backlog never blocks the collector/HTTP server for long.
 */
export function deleteExpiredCandlesBatch(
  db: DbHandle['db'],
  symbol: string,
  cutoffOpenTime: number,
  batchSize: number,
): number {
  const result = db.run(sql`
    DELETE FROM ${candles} WHERE rowid IN (
      SELECT rowid FROM ${candles}
      WHERE ${candles.symbol} = ${symbol} AND ${candles.openTime} < ${cutoffOpenTime}
      LIMIT ${batchSize}
    )
  `);
  return result.changes;
}

export function countClosedCandlesInRange(db: DbHandle['db'], symbol: string, from: number, to: number): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(candles)
    .where(
      and(eq(candles.symbol, symbol), eq(candles.isClosed, true), gte(candles.openTime, from), lte(candles.openTime, to)),
    )
    .get();
  return row?.count ?? 0;
}

export function sumQuoteVolumeSince(db: DbHandle['db'], symbol: string, sinceOpenTimeInclusive: number): number {
  const rows = db
    .select({ quoteVolume: candles.quoteVolume })
    .from(candles)
    .where(and(eq(candles.symbol, symbol), gte(candles.openTime, sinceOpenTimeInclusive)))
    .all();

  return rows.reduce((sum, row) => sum + Number(row.quoteVolume), 0);
}
