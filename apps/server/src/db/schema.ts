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

/** 장기 백필(최대 BACKFILL_DAYS)의 재개 가능한 진행 상태. 종목별로 최대 하나의 pending/running 작업만 둔다. */
export const backfillJobs = sqliteTable('backfill_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  fromTime: integer('from_time').notNull(),
  toTime: integer('to_time').notNull(),
  cursor: integer('cursor').notNull(),
  status: text('status').notNull().default('pending'),
  processedCount: integer('processed_count').notNull().default(0),
  totalCount: integer('total_count').notNull(),
  lastError: text('last_error'),
  /** 연속 재시도 횟수. 페이지 처리가 성공하면 0으로 초기화된다. */
  retryCount: integer('retry_count').notNull().default(0),
  /** 다음 재시도 예정 시각(backoff 대기 중일 때만 설정). */
  nextRetryAt: integer('next_retry_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
