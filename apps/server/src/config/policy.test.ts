import { describe, expect, it } from 'vitest';
import { assertPolicyInvariants, policy } from './policy.js';

describe('assertPolicyInvariants', () => {
  it('accepts the real policy defaults', () => {
    expect(() => assertPolicyInvariants()).not.toThrow();
  });

  it('throws when retention.days is shorter than backfill.days', () => {
    const invalid = { ...policy, retention: { ...policy.retention, days: 30 }, backfill: { ...policy.backfill, days: 365 } };
    expect(() => assertPolicyInvariants(invalid)).toThrow(/retention\.days/);
  });

  it('accepts retention.days equal to backfill.days', () => {
    const valid = { ...policy, retention: { ...policy.retention, days: 30 }, backfill: { ...policy.backfill, days: 30 } };
    expect(() => assertPolicyInvariants(valid)).not.toThrow();
  });

  it('accepts retention.days longer than backfill.days', () => {
    const valid = { ...policy, retention: { ...policy.retention, days: 365 }, backfill: { ...policy.backfill, days: 30 } };
    expect(() => assertPolicyInvariants(valid)).not.toThrow();
  });
});
