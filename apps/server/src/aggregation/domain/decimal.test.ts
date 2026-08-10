import { describe, expect, it } from 'vitest';
import { addDecimalStrings } from './decimal.js';

describe('addDecimalStrings', () => {
  it('sums whole numbers', () => {
    expect(addDecimalStrings(['1', '2', '3'])).toBe('6');
  });

  it('avoids the float precision loss that Number() summation has', () => {
    // JS의 float 연산에서는 Number('0.1') + Number('0.2') === 0.30000000000000004 이다.
    expect(addDecimalStrings(['0.1', '0.2'])).toBe('0.3');
  });

  it('aligns mixed decimal precisions before summing', () => {
    expect(addDecimalStrings(['10.5', '0.123'])).toBe('10.623');
  });

  it('handles many small values without accumulating error', () => {
    const values = Array.from({ length: 1000 }, () => '0.00000001');
    expect(addDecimalStrings(values)).toBe('0.00001000');
  });

  it('handles negative values', () => {
    expect(addDecimalStrings(['5.5', '-2.25'])).toBe('3.25');
  });

  it('returns "0" for an empty list', () => {
    expect(addDecimalStrings([])).toBe('0');
  });

  it('handles a single value unchanged', () => {
    expect(addDecimalStrings(['42.42000000'])).toBe('42.42000000');
  });
});
