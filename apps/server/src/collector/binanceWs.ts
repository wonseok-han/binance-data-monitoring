import { WebSocket } from 'ws';
import { z } from 'zod';
import type { RawCandle } from './binanceRest.js';

export type WsEvent = 'open' | 'message' | 'close' | 'error';

export interface WsConnection {
  on(event: WsEvent, listener: (...args: unknown[]) => void): void;
  close(): void;
}

export type WsFactory = (url: string) => WsConnection;

const KlineEventSchema = z.object({
  e: z.literal('kline'),
  k: z.object({
    t: z.number(),
    T: z.number(),
    s: z.string(),
    o: z.string(),
    h: z.string(),
    l: z.string(),
    c: z.string(),
    v: z.string(),
    q: z.string(),
    n: z.number(),
    x: z.boolean(),
  }),
});

export function parseKlineMessage(raw: unknown): RawCandle | null {
  let json: unknown = raw;

  if (typeof raw === 'string') {
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
  } else if (Buffer.isBuffer(raw)) {
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      return null;
    }
  }

  const result = KlineEventSchema.safeParse(json);
  if (!result.success) return null;

  const { k } = result.data;
  return {
    symbol: k.s,
    openTime: k.t,
    closeTime: k.T,
    open: k.o,
    high: k.h,
    low: k.l,
    close: k.c,
    volume: k.v,
    quoteVolume: k.q,
    tradeCount: k.n,
    isClosed: k.x,
  };
}

export function klineStreamUrl(baseWsUrl: string, symbol: string): string {
  return `${baseWsUrl.replace(/\/$/, '')}/ws/${symbol.toLowerCase()}@kline_1m`;
}

export function createWsFactory(): WsFactory {
  return (url: string) => new WebSocket(url) as unknown as WsConnection;
}
