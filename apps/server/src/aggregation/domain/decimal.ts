/**
 * decimal 문자열(예: Binance의 volume/quoteVolume 필드)을 합산한다.
 * `values.reduce((a, b) => a + Number(b), 0)`처럼 float로 변환해 더하면
 * 발생하는 정밀도 손실이 없다. 모든 값을 가장 넓은 소수 자릿수에 맞춰
 * 스케일링한 뒤 BigInt로 합산하고, 다시 소수점을 끼워 넣는다.
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
