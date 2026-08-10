// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Candle } from '@binance-monitoring/shared';
import { CandleTable } from './CandleTable';

afterEach(cleanup);

const sampleCandle: Candle = {
  symbol: 'BTCUSDT',
  openTime: Date.UTC(2026, 7, 10, 12, 30),
  closeTime: Date.UTC(2026, 7, 10, 12, 30, 59, 999),
  open: '100000.00',
  high: '100100.00',
  low: '99900.00',
  close: '100050.00',
  volume: '12.5',
  quoteVolume: '1250000',
  tradeCount: 230,
  isClosed: true,
  updatedAt: Date.UTC(2026, 7, 10, 12, 31),
};

describe('CandleTable', () => {
  it('shows an explicit empty state', () => {
    render(<CandleTable candles={[]} />);
    expect(screen.getByText('표시할 데이터가 없습니다')).toBeTruthy();
  });

  it('renders formatted candle values and status', () => {
    render(<CandleTable candles={[sampleCandle]} />);

    expect(screen.getByText('100,050.00')).toBeTruthy();
    expect(screen.getByText('1.25M USDT')).toBeTruthy();
    expect(screen.getByText('230')).toBeTruthy();
    expect(screen.getByText('확정')).toBeTruthy();
  });
});
