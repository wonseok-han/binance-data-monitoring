/**
 * Sums decimal strings (e.g. Binance's volume/quoteVolume fields) without the
 * float precision loss that `values.reduce((a, b) => a + Number(b), 0)` would
 * introduce. Scales every value to the widest decimal precision present,
 * sums as BigInt, then reinserts the decimal point.
 */
export function addDecimalStrings(values: string[]): string {
  if (values.length === 0) return '0';

  let maxDecimals = 0;
  for (const value of values) {
    const dot = value.indexOf('.');
    if (dot !== -1) maxDecimals = Math.max(maxDecimals, value.length - dot - 1);
  }

  let total = 0n;
  for (const value of values) {
    total += toScaledBigInt(value, maxDecimals);
  }

  return fromScaledBigInt(total, maxDecimals);
}

function toScaledBigInt(value: string, decimals: number): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', frac = ''] = unsigned.split('.');
  const digits = `${whole}${frac.padEnd(decimals, '0')}`;
  const magnitude = BigInt(digits.length > 0 ? digits : '0');
  return negative ? -magnitude : magnitude;
}

function fromScaledBigInt(scaled: bigint, decimals: number): string {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const digits = magnitude.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const frac = decimals > 0 ? digits.slice(digits.length - decimals) : '';
  const result = decimals > 0 ? `${whole}.${frac}` : whole;
  return negative && magnitude !== 0n ? `-${result}` : result;
}
