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

/** [from, to] 범위 내에서 최대 `limit`개의 봉을 open_time 오름차순으로 반환한다. */
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

/** [from, to] 범위 내 모든 봉, 오름차순. limit이 없으므로 호출자가 직접 범위를 제한해야 한다. */
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

export function getEarliestCandle(db: DbHandle['db'], symbol: string) {
  return db
    .select()
    .from(candles)
    .where(eq(candles.symbol, symbol))
    .orderBy(candles.openTime)
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
 * 한 종목에 대해 `cutoffOpenTime`보다 오래된 봉을 최대 `batchSize`개
 * 삭제하고 삭제된 개수를 반환한다. 호출자는 크기 제한 없는 DELETE 한 번
 * 대신 이 함수를 (호출 사이마다 이벤트 루프를 양보하며) 반복 호출하므로,
 * 삭제 대상이 많아도 수집기나 HTTP 서버가 오래 막히지 않는다.
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
