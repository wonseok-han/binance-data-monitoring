import { primaryKey, sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const candles = sqliteTable(
  'candles',
  {
    symbol: text('symbol').notNull(),
    openTime: integer('open_time').notNull(),
    closeTime: integer('close_time').notNull(),
    open: text('open').notNull(),
    high: text('high').notNull(),
    low: text('low').notNull(),
    close: text('close').notNull(),
    volume: text('volume').notNull(),
    quoteVolume: text('quote_volume').notNull(),
    tradeCount: integer('trade_count').notNull(),
    isClosed: integer('is_closed', { mode: 'boolean' }).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.symbol, table.openTime] })],
);

export const collectorState = sqliteTable('collector_state', {
  symbol: text('symbol').primaryKey(),
  lastEventAt: integer('last_event_at'),
  lastClosedOpenTime: integer('last_closed_open_time'),
  connectionStatus: text('connection_status').notNull().default('connecting'),
  lastError: text('last_error'),
  /** JSON으로 직렬화한 BackfillRunRecord: startedAt/finishedAt/durationMs/from/to/count/result/error. */
  lastBackfillJson: text('last_backfill_json'),
});
