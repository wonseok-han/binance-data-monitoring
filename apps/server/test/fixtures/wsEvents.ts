export interface WsKlineOverrides {
  x?: boolean;
  o?: string;
  h?: string;
  l?: string;
  c?: string;
  v?: string;
  q?: string;
  n?: number;
}

export function makeWsKlineEvent(symbol: string, openTime: number, overrides: WsKlineOverrides = {}) {
  return {
    e: 'kline',
    k: {
      t: openTime,
      T: openTime + 59_999,
      s: symbol,
      o: '100.00',
      h: '101.00',
      l: '99.00',
      c: '100.50',
      v: '10.5',
      q: '1050.0',
      n: 42,
      x: false,
      ...overrides,
    },
  };
}
