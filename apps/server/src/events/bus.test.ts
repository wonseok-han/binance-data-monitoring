import { describe, expect, it, vi } from 'vitest';
import type { RawCandle } from '../collector/binanceRest.js';
import { createEventBus } from './bus.js';

const CANDLE: RawCandle = {
  symbol: 'BTCUSDT',
  openTime: 1,
  closeTime: 2,
  open: '1',
  high: '1',
  low: '1',
  close: '1',
  volume: '1',
  quoteVolume: '1',
  tradeCount: 1,
  isClosed: true,
};

describe('createEventBus', () => {
  it('delivers candle events only to candle subscribers', () => {
    const bus = createEventBus();
    const onCandle = vi.fn();
    const onStatus = vi.fn();
    bus.onCandle(onCandle);
    bus.onStatus(onStatus);

    bus.emitCandle('BTCUSDT', CANDLE);

    expect(onCandle).toHaveBeenCalledWith('BTCUSDT', CANDLE);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('unsubscribes via the returned disposer', () => {
    const bus = createEventBus();
    const listener = vi.fn();
    const off = bus.onStatus(listener);
    off();

    bus.emitStatus('BTCUSDT', {
      symbol: 'BTCUSDT',
      connectionStatus: 'live',
      lastEventAt: null,
      lastClosedOpenTime: null,
      delayMs: null,
      lastError: null,
      lastBackfill: null,
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
