// @vitest-environment jsdom

import type { SymbolStatus } from '@binance-monitoring/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BackfillStatus } from './BackfillStatus';

afterEach(cleanup);

function status(state: 'running' | 'retrying' | 'failed'): SymbolStatus {
  return {
    symbol: 'BTCUSDT',
    connectionStatus: 'live',
    lastEventAt: 1,
    lastClosedOpenTime: 1,
    delayMs: 0,
    lastError: null,
    lastBackfill: null,
    completeness24h: { expected: 1440, confirmed: 1440, missing: 0 },
    historicalBackfill: {
      status: state,
      processed: 240_000,
      total: 525_600,
      progressPercent: 45.66,
      from: Date.UTC(2025, 7, 10),
      to: Date.UTC(2026, 7, 10),
      lastError: state === 'running' ? null : 'Binance REST unavailable',
      retryCount: state === 'retrying' ? 3 : 0,
      nextRetryAt: state === 'retrying' ? Date.UTC(2026, 7, 10, 12, 30) : null,
    },
    coverage: { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 7, 10) },
  };
}

describe('BackfillStatus', () => {
  it('shows progress and the actual covered date range', () => {
    render(<BackfillStatus symbol="BTCUSDT" status={status('running')} />);

    expect(screen.getByText('백필 중')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('45.66');
    expect(screen.getByText('240,000 / 525,600개')).toBeTruthy();
    expect(screen.getByText('2026.01.01 — 2026.08.10')).toBeTruthy();
  });

  it('explains retry state without marking realtime collection as failed', () => {
    render(<BackfillStatus symbol="BTCUSDT" status={status('retrying')} />);

    expect(screen.getByText('재시도 대기')).toBeTruthy();
    expect(screen.getByText(/연속 3회/)).toBeTruthy();
    expect(screen.getByText('Binance REST unavailable')).toBeTruthy();
  });
});
