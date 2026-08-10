import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ConnectionStatusSchema = z.enum(['connecting', 'live', 'reconnecting', 'stale']);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const CandleSchema = z.object({
  symbol: z.string(),
  openTime: z.number(),
  closeTime: z.number(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string(),
  quoteVolume: z.string(),
  tradeCount: z.number(),
  isClosed: z.boolean(),
  updatedAt: z.number(),
});
export type Candle = z.infer<typeof CandleSchema>;

export const IntervalSchema = z.enum(['1m', '6h', '1d']);
export type Interval = z.infer<typeof IntervalSchema>;

export const CandlesPageSchema = z.object({
  nextBefore: z.number().nullable(),
  hasMore: z.boolean(),
});
export type CandlesPage = z.infer<typeof CandlesPageSchema>;

export const CandlesResponseSchema = z.object({
  symbol: z.string(),
  interval: IntervalSchema,
  candles: z.array(CandleSchema),
  page: CandlesPageSchema,
});
export type CandlesResponse = z.infer<typeof CandlesResponseSchema>;

export const BackfillRunSchema = z.object({
  startedAt: z.number(),
  finishedAt: z.number(),
  durationMs: z.number(),
  from: z.number().nullable(),
  to: z.number().nullable(),
  count: z.number(),
  result: z.enum(['success', 'error']),
  error: z.string().nullable(),
});
export type BackfillRun = z.infer<typeof BackfillRunSchema>;

export const Completeness24hSchema = z.object({
  expected: z.number(),
  confirmed: z.number(),
  missing: z.number(),
});
export type Completeness24h = z.infer<typeof Completeness24hSchema>;

export const BackfillJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type BackfillJobStatus = z.infer<typeof BackfillJobStatusSchema>;

export const HistoricalBackfillSchema = z.object({
  status: BackfillJobStatusSchema,
  processed: z.number(),
  total: z.number(),
  progressPercent: z.number(),
  from: z.number(),
  to: z.number(),
  lastError: z.string().nullable(),
});
export type HistoricalBackfill = z.infer<typeof HistoricalBackfillSchema>;

export const CoverageRangeSchema = z.object({
  from: z.number().nullable(),
  to: z.number().nullable(),
});
export type CoverageRange = z.infer<typeof CoverageRangeSchema>;

export const SymbolStatusSchema = z.object({
  symbol: z.string(),
  connectionStatus: ConnectionStatusSchema,
  lastEventAt: z.number().nullable(),
  lastClosedOpenTime: z.number().nullable(),
  delayMs: z.number().nullable(),
  lastError: z.string().nullable(),
  lastBackfill: BackfillRunSchema.nullable(),
  completeness24h: Completeness24hSchema,
  historicalBackfill: HistoricalBackfillSchema.nullable(),
  coverage: CoverageRangeSchema,
});
export type SymbolStatus = z.infer<typeof SymbolStatusSchema>;

export const StatusResponseSchema = z.object({
  symbols: z.array(SymbolStatusSchema),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const SummaryResponseSchema = z.object({
  symbol: z.string(),
  currentPrice: z.string(),
  asOf: z.number(),
  change1h: z.string().nullable(),
  changePercent1h: z.number().nullable(),
  quoteVolume1h: z.string(),
});
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export const CandleEventSchema = z.object({
  symbol: z.string(),
  candle: CandleSchema,
});
export type CandleEvent = z.infer<typeof CandleEventSchema>;

export const StatusEventSchema = z.object({
  symbol: z.string(),
  status: SymbolStatusSchema,
});
export type StatusEvent = z.infer<typeof StatusEventSchema>;
