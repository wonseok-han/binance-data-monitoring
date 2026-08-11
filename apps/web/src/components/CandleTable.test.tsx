// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    ...sampleCandle,
    openTime: sampleCandle.openTime + index * 60_000,
    closeTime: sampleCandle.closeTime + index * 60_000,
    updatedAt: sampleCandle.updatedAt + index * 60_000,
    tradeCount: 10_000 + index,
  }));
}

describe('CandleTable', () => {
  it('shows an explicit empty state', () => {
    render(<CandleTable candles={[]} interval="6h" />);
    expect(screen.getByText('표시할 데이터가 없습니다')).toBeTruthy();
    expect(screen.getByText('수집이 시작되면 최근 6시간봉을 확인할 수 있습니다.')).toBeTruthy();
  });

  it('renders formatted candle values and status', () => {
    render(<CandleTable candles={[sampleCandle]} interval="1m" />);

    expect(screen.getByText('100,050.00')).toBeTruthy();
    expect(screen.getByText('1.25M USDT')).toBeTruthy();
    expect(screen.getByText('230')).toBeTruthy();
    expect(screen.getByText('확정')).toBeTruthy();
  });

  it('reveals local candles eight at a time before requesting an older cursor', async () => {
    const onLoadPrevious = vi.fn().mockResolvedValue(false);
    render(
      <CandleTable
        candles={candles(16)}
        interval="1m"
        canLoadPrevious
        onLoadPrevious={onLoadPrevious}
      />,
    );

    expect(screen.getByText('10,015')).toBeTruthy();
    expect(screen.queryByText('10,007')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '더보기' }));
    expect(screen.getByText('10,007')).toBeTruthy();
    expect(onLoadPrevious).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '더보기' }));
    await waitFor(() => expect(onLoadPrevious).toHaveBeenCalledOnce());
  });

  it('appends cursor candles below the rows already shown', async () => {
    const allCandles = candles(16);
    let resolveLoad!: (loaded: boolean) => void;
    const onLoadPrevious = vi.fn(
      () => new Promise<boolean>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const view = render(
      <CandleTable
        candles={allCandles.slice(8)}
        interval="1m"
        canLoadPrevious
        onLoadPrevious={onLoadPrevious}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '더보기' }));
    view.rerender(
      <CandleTable
        candles={allCandles}
        interval="1m"
        canLoadPrevious={false}
        onLoadPrevious={onLoadPrevious}
      />,
    );
    await act(async () => resolveLoad(true));

    expect(screen.getByText('10,007')).toBeTruthy();
    expect(screen.getByText('10,015')).toBeTruthy();
    expect(screen.queryByText('2페이지')).toBeNull();
  });

  it('offers cursor loading and distinguishes a backfill-in-progress empty state', async () => {
    const onLoadPrevious = vi.fn().mockResolvedValue(false);
    const { rerender } = render(
      <CandleTable
        candles={[sampleCandle]}
        interval="1d"
        canLoadPrevious
        onLoadPrevious={onLoadPrevious}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '더보기' }));
    await waitFor(() => expect(onLoadPrevious).toHaveBeenCalledOnce());

    rerender(<CandleTable candles={[]} interval="1d" backfillInProgress />);
    expect(screen.getByText('과거 데이터 백필 중')).toBeTruthy();
  });
});
