/**
 * Numbers as people type them in a numeric quiz answer, and how one is compared with the answer.
 * Pure and shared: the browser uses it to tell the user their input is not a number before
 * sending it, and the API grades with it.
 *
 * Accepted forms (surrounding space ignored, `−` read as `-`):
 *
 *   integer    42   -7   1,000,000
 *   fraction   1/3  -5/36  (integers either side, non-zero denominator)
 *   decimal    0.25  .5  1.5e-3  12.5%  (a percent sign divides by 100)
 *
 * Every form is an exact rational, so `1/3`, `2/6` and `0.5` vs `1/2` compare exactly.
 */

/** Longest numeric answer the API accepts; also bounds the BigInt work per answer. */
export const NUMERIC_INPUT_MAX = 40;
/** Largest decimal exponent read (`1e30`). */
const MAX_EXPONENT = 30;

/**
 * How a value was written, which decides how strictly it is compared (`numericMatches`):
 * an integer or a fraction claims to be exact, a decimal may be a rounding.
 */
export type NumericForm = 'integer' | 'fraction' | 'decimal';

/** `num / den` in lowest terms, `den > 0`. */
export interface NumericValue {
  num: bigint;
  den: bigint;
  form: NumericForm;
}

export interface NumericTolerance {
  /** Accept when |given − answer| ≤ abs. */
  abs?: number | undefined;
  /** Accept when |given − answer| ≤ rel · |answer|. */
  rel?: number | undefined;
}

/**
 * Tolerance for a decimal answer when the question sets none: half a percent, so any correct
 * rounding (or truncation) to three significant figures is accepted and two figures is not.
 */
export const NUMERIC_DEFAULT_REL = 0.005;

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

function reduce(num: bigint, den: bigint, form: NumericForm): NumericValue {
  const g = gcd(num, den) || 1n;
  return { num: num / g, den: den / g, form };
}

const INTEGER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;
const FRACTION_RE = /^([+-]?)(\d+)\/(\d+)$/;
const DECIMAL_RE = new RegExp(
  String.raw`^([+-]?)(?:(${INTEGER})(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d{1,2}))?(%?)$`,
  'i',
);

/** Reads a typed number; null when the text is not one of the accepted forms. */
export function parseNumeric(text: string): NumericValue | null {
  if (text.length > NUMERIC_INPUT_MAX * 2) return null;
  const s = text
    .trim()
    .replace(/−/g, '-')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+%$/, '%');
  if (s === '' || s.length > NUMERIC_INPUT_MAX) return null;

  const frac = FRACTION_RE.exec(s);
  if (frac) {
    const den = BigInt(frac[3] ?? '0');
    if (den === 0n) return null;
    const num = BigInt(frac[2] ?? '0');
    return reduce(frac[1] === '-' ? -num : num, den, 'fraction');
  }

  const m = DECIMAL_RE.exec(s);
  if (!m) return null;
  const [, sign, whole, afterPoint, bareFraction, exponent, percent] = m;
  const intDigits = (whole ?? '').replace(/,/g, '');
  const fracDigits = afterPoint ?? bareFraction ?? '';
  const exp = exponent ? Number(exponent) : 0;
  if (Math.abs(exp) > MAX_EXPONENT) return null;

  let num = BigInt(`${intDigits}${fracDigits}` || '0');
  let den = 10n ** BigInt(fracDigits.length);
  if (exp > 0) num *= 10n ** BigInt(exp);
  if (exp < 0) den *= 10n ** BigInt(-exp);
  if (percent) den *= 100n;
  const isInteger =
    !percent && exponent === undefined && afterPoint === undefined && bareFraction === undefined;
  return reduce(sign === '-' ? -num : num, den, isInteger ? 'integer' : 'decimal');
}

export const numericToNumber = (v: NumericValue): number => Number(v.num) / Number(v.den);

/**
 * Whether `given` counts as the answer `expected`.
 *
 *  1. Equal as rationals: always.
 *  2. The question sets a tolerance: within `abs` or within `rel` of the answer, however the
 *     value was written (estimates, simulated or irrational answers).
 *  3. No tolerance, and the answer is not a whole number: a *decimal* within
 *     `NUMERIC_DEFAULT_REL` of it, so `0.333` is accepted for `1/3`. A fraction or an integer
 *     claims to be exact and has to be (`33/100` is not `1/3`).
 *  4. No tolerance and a whole-number answer (a count): only the exact value.
 */
export function numericMatches(
  expected: NumericValue,
  given: NumericValue,
  tolerance?: NumericTolerance,
): boolean {
  const cross = given.num * expected.den - expected.num * given.den;
  if (cross === 0n) return true;
  const diff = Math.abs(Number(cross) / Number(given.den * expected.den));
  const size = Math.abs(numericToNumber(expected));
  if (tolerance) return diff <= Math.max(tolerance.abs ?? 0, (tolerance.rel ?? 0) * size);
  if (expected.den === 1n || given.form !== 'decimal') return false;
  return diff <= NUMERIC_DEFAULT_REL * size;
}
