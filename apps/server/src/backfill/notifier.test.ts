import { describe, expect, it, vi } from 'vitest';
import { createLoggingBackfillFailureNotifier } from './notifier.js';

describe('createLoggingBackfillFailureNotifier', () => {
  it('logs the failure event as a structured error', () => {
    const error = vi.fn();
    const notifier = createLoggingBackfillFailureNotifier({ error });

    notifier.notifyFailed({ symbol: 'BTCUSDT', jobId: 7, error: 'bad request', failedAt: 1234 });

    expect(error).toHaveBeenCalledWith(
      'historical backfill job failed permanently',
      expect.objectContaining({ symbol: 'BTCUSDT', jobId: 7, error: 'bad request', failedAt: 1234 }),
    );
  });
});
