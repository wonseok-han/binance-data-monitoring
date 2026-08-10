import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, HealthResponseSchema } from './schemas.js';

describe('HealthResponseSchema', () => {
  it('accepts the ok status', () => {
    expect(HealthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects any other status', () => {
    expect(() => HealthResponseSchema.parse({ status: 'down' })).toThrow();
  });
});

describe('ApiErrorSchema', () => {
  it('accepts a code/message envelope', () => {
    const payload = { error: { code: 'NOT_FOUND', message: 'missing' } };
    expect(ApiErrorSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a payload without the error wrapper', () => {
    expect(() => ApiErrorSchema.parse({ code: 'NOT_FOUND', message: 'missing' })).toThrow();
  });
});
