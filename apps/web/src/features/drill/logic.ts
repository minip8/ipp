/**
 * The mental math drill, without React: a seeded generator of arithmetic questions, how a typed
 * answer is marked, the run's state machine (countdown, questions against a real-time clock, the
 * end) and what a finished run adds up to. Everything here is deterministic for a seed, so a run
 * can be replayed exactly (the browser tests compute their answers from it).
 *
 * Every number is an exact rational (`Rational`, BigInt), never a float: a question's answer is
 * computed exactly from the operands it shows, and compared through the site's own `parseNumeric`
 * and `numericMatches` (packages/contracts/src/numeric.ts).
 */
import {
  DRILL_CATEGORIES,
  DRILL_CATEGORY_INFO,
  DRILL_LEVEL_LABEL,
  type DrillBest,
  type DrillCategory,
  type DrillCategoryResult,
  DrillConfig,
  type DrillDuration,
  type DrillLevel,
  type DrillRun,
  drillScore,
  type NumericValue,
  numericMatches,
  parseNumeric,
  type RecordDrillRunRequest,
} from '@ipp/contracts';

// ---------------------------------------------------------------- random numbers

/** mulberry32: a small, fast 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  /** An integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    const x = xs[Math.floor(this.next() * xs.length)];
    if (x === undefined) throw new Error('pick from an empty list');
    return x;
  }
  /** An integer in [lo, hi] for which `ok` holds (drawn until one is found). */
  intWhere(lo: number, hi: number, ok: (n: number) => boolean): number {
    for (let i = 0; i < 10_000; i++) {
      const n = this.int(lo, hi);
      if (ok(n)) return n;
    }
    throw new Error(`no integer in [${lo}, ${hi}] satisfies the condition`);
  }
  /** Like `intWhere`, but null when a few hundred draws find none. */
  tryIntWhere(lo: number, hi: number, ok: (n: number) => boolean): number | null {
    for (let i = 0; i < 300; i++) {
      const n = this.int(lo, hi);
      if (ok(n)) return n;
    }
    return null;
  }
  /** One of `options` by weight. */
  weighted<T extends string>(options: readonly (readonly [T, number])[]): T {
    const total = options.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of options) {
      r -= w;
      if (r < 0) return v;
    }
    const last = options.at(-1);
    if (!last) throw new Error('no options');
    return last[0];
  }
}

/** A seed from `?seed=`: a whole number that fits in 32 bits, else null. */
export function parseSeed(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 0xffffffff ? n : null;
}

// ---------------------------------------------------------------- exact rationals

/** `num / den` in lowest terms, `den > 0`. */
export interface Rational {
  num: bigint;
  den: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

export function rat(num: bigint | number, den: bigint | number = 1n): Rational {
  let n = BigInt(num);
  let d = BigInt(den);
  if (d === 0n) throw new Error('zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  return { num: n / g, den: d / g };
}

/** A decimal with `dp` places, from its digits: `dec(375, 3)` is 0.375. */
export const dec = (scaled: number, dp: number): Rational => rat(BigInt(scaled), 10n ** BigInt(dp));

export const add = (a: Rational, b: Rational) => rat(a.num * b.den + b.num * a.den, a.den * b.den);
export const sub = (a: Rational, b: Rational) => rat(a.num * b.den - b.num * a.den, a.den * b.den);
export const mul = (a: Rational, b: Rational) => rat(a.num * b.num, a.den * b.den);
export const div = (a: Rational, b: Rational) => {
  if (b.num === 0n) throw new Error('division by zero');
  return rat(a.num * b.den, a.den * b.num);
};
export const ratEq = (a: Rational, b: Rational) => a.num === b.num && a.den === b.den;
export const ratCmp = (a: Rational, b: Rational) => {
  const d = a.num * b.den - b.num * a.den;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};
export const isInteger = (r: Rational) => r.den === 1n;
export const toNumber = (r: Rational) => Number(r.num) / Number(r.den);

/** Decimal places of a terminating rational (0 for an integer); null when it does not terminate. */
export function decimalPlaces(r: Rational): number | null {
  let d = r.den;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  return d === 1n ? Math.max(twos, fives) : null;
}

/** The exact decimal of a terminating rational, as typed: `-12.375`. Throws otherwise. */
export function decimalText(r: Rational): string {
  const k = decimalPlaces(r);
  if (k === null) throw new Error(`${r.num}/${r.den} has no exact decimal`);
  const scaled = (r.num * 10n ** BigInt(k)) / r.den;
  const neg = scaled < 0n;
  const digits = (neg ? -scaled : scaled).toString().padStart(k + 1, '0');
  const whole = digits.slice(0, digits.length - k);
  const frac = digits.slice(digits.length - k);
  return `${neg ? '-' : ''}${whole}${k > 0 ? `.${frac}` : ''}`;
}

/** `3/4`, `-7/12`, or the integer. */
export const fractionText = (r: Rational) => (r.den === 1n ? `${r.num}` : `${r.num}/${r.den}`);

const group = (whole: string) =>
  whole.length > 3 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;

/**
 * A number as a question shows it: thousands separators from 1,000 and a real minus sign. A
 * rational that does not terminate is shown as a fraction.
 */
export function displayNumber(r: Rational): string {
  if (decimalPlaces(r) === null) return displayFraction(r);
  const t = decimalText(r);
  const neg = t.startsWith('-');
  const [whole = '', frac] = (neg ? t.slice(1) : t).split('.');
  return `${neg ? '−' : ''}${group(whole)}${frac !== undefined ? `.${frac}` : ''}`;
}

export const displayFraction = (r: Rational) => {
  const t = fractionText(r);
  return t.startsWith('-') ? `−${t.slice(1)}` : t;
};

/** A positive number rounded to `sig` significant figures, as a plain decimal (`15400`, `0.0213`). */
export function roundSig(r: Rational, sig: number): Rational {
  const x = toNumber(r);
  if (x === 0) return rat(0);
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const places = sig - 1 - exp;
  // Exact: scale by a power of ten, round the integer part, scale back.
  const scale = 10n ** BigInt(Math.abs(places));
  const scaled = places >= 0 ? mul(r, rat(scale)) : div(r, rat(scale));
  const twice = (2n * scaled.num) / scaled.den;
  const rounded = twice >= 0n ? (twice + 1n) / 2n : -((-twice + 1n) / 2n);
  return places >= 0 ? rat(rounded, scale) : rat(rounded * scale);
}

// ---------------------------------------------------------------- questions

/** What the typed answer has to be, beyond equal: */
export type AnswerForm =
  /** any exact form of the number (`3/4`, `0.75`, `6/8`) */
  | 'any'
  /** a fraction (the question gives the decimal) */
  | 'fraction'
  /** a decimal (the question gives the fraction) */
  | 'decimal'
  /** the percentage figure: `12.5` or `12.5%` */
  | 'percent';

export type QuestionKind =
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'frac-add'
  | 'frac-sub'
  | 'frac-mul'
  | 'frac-div'
  | 'frac-to-dec'
  | 'dec-to-frac'
  | 'pct-of'
  | 'pct-rise'
  | 'pct-fall'
  | 'pct-before-rise'
  | 'pct-before-fall'
  | 'est-mul'
  | 'est-div';

/** What the keyboard has to offer: `decimal` is digits and a point; `text` adds `-` and `/`. */
export type DrillInputMode = 'decimal' | 'text';

export interface DrillQuestion {
  /** Position in the run, from 0. */
  index: number;
  category: DrillCategory;
  kind: QuestionKind;
  /** The arithmetic, shown large: `47 + 38`, `2/3 ÷ 4/9`, `15% of 240`, `80 → 60`. */
  text: string;
  /** A short line above it when the arithmetic alone does not say what is asked. */
  ask: string | null;
  /** The numbers in `text`, in order. */
  operands: Rational[];
  answer: Rational;
  form: AnswerForm;
  /** Relative tolerance of an estimate; null for an exact answer. */
  tolerance: number | null;
  inputMode: DrillInputMode;
  /** The canonical answer as one would type it; always marked right. */
  answerText: string;
  /** Identifies the question within a run, so it is not asked twice. */
  key: string;
}

type Generated = Omit<DrillQuestion, 'index' | 'category' | 'key' | 'answerText'> & {
  answerText?: string;
};

/** Ends in a non-zero digit: no "round" operands (×10, ×20) where the point is the arithmetic. */
const unround = (n: number) => n % 10 !== 0;

const OP = { add: '+', sub: '−', mul: '×', div: '÷' } as const;

/** Each estimate is marked right within this share of the exact answer. */
export const ESTIMATE_TOLERANCE: Record<DrillLevel, number> = {
  warmup: 0.1,
  standard: 0.05,
  hard: 0.03,
};

function exact(
  kind: QuestionKind,
  operands: Rational[],
  answer: Rational,
  text: string,
  opts: { ask?: string; form?: AnswerForm; inputMode?: DrillInputMode } = {},
): Generated {
  return {
    kind,
    text,
    ask: opts.ask ?? null,
    operands,
    answer,
    form: opts.form ?? 'any',
    tolerance: null,
    inputMode: opts.inputMode ?? 'decimal',
  };
}

// ---- addition and subtraction

function genAddSubtract(rng: Rng, level: DrillLevel): Generated {
  // [first lo, first hi, second lo, second hi] as scaled integers, and decimal places.
  let range: [number, number, number, number];
  let dp = 0;
  if (level === 'warmup') range = [11, 99, 11, 99];
  else if (level === 'standard') {
    if (rng.chance(0.6)) range = [100, 999, 11, 999];
    else [range, dp] = [[11, 999, 11, 999], 1];
  } else if (rng.chance(0.5)) range = [1000, 9999, 100, 9999];
  else [range, dp] = [[101, 99_999, 101, 99_999], 2];
  const [lo1, hi1, lo2, hi2] = range;
  // A decimal operand ends in a non-zero digit, so it shows all its places.
  const shape = (n: number) => dp === 0 || unround(n);
  const isAdd = rng.chance(0.5);
  let a = rng.intWhere(lo1, hi1, shape);
  // Most sums carry out of the last digit, and most differences borrow into it.
  const last = (n: number) => n % 10;
  const carries = (b: number) =>
    isAdd ? last(a) + last(b) >= 10 : last(Math.max(a, b)) < last(Math.min(a, b));
  const plain = (b: number) => b !== a && shape(b);
  let b =
    (rng.chance(0.7) && rng.tryIntWhere(lo2, hi2, (n) => plain(n) && carries(n))) ||
    rng.intWhere(lo2, hi2, plain);
  // Signs: warm-up never goes below zero; standard differences sometimes do; hard may also
  // start from a negative number.
  const negativeFirst = level === 'hard' && rng.chance(0.25);
  if (!isAdd && !negativeFirst) {
    const negative = level !== 'warmup' && rng.chance(0.3);
    if (negative !== a < b) [a, b] = [b, a];
  }
  const x = dec(negativeFirst ? -a : a, dp);
  const y = dec(b, dp);
  return exact(
    isAdd ? 'add' : 'sub',
    [x, y],
    isAdd ? add(x, y) : sub(x, y),
    `${displayNumber(x)} ${isAdd ? OP.add : OP.sub} ${displayNumber(y)}`,
    // A negative answer needs the minus key, which a decimal pad does not have.
    { inputMode: level === 'warmup' ? 'decimal' : 'text' },
  );
}

// ---- multiplication

function genMultiply(rng: Rng, level: DrillLevel): Generated {
  let x: Rational;
  let y: Rational;
  if (level === 'warmup') {
    // Times tables, but not the first few rows (2 × 3 is no practice).
    const a = rng.intWhere(2, 12, (n) => n !== 10);
    x = rat(a);
    y = rat(rng.intWhere(a < 5 ? 5 : 2, 12, (n) => n !== 10));
  } else if (level === 'standard') {
    if (rng.chance(0.6)) {
      x = rat(rng.intWhere(13, 99, unround));
      y = rat(rng.int(3, 9));
    } else {
      x = rat(rng.int(11, 19));
      y = rat(rng.intWhere(13, 49, unround));
    }
  } else if (rng.chance(0.6)) {
    x = rat(rng.intWhere(13, 99, unround));
    y = rat(rng.intWhere(13, 99, unround));
  } else {
    x = dec(rng.intWhere(11, 99, unround), 1);
    y = rng.chance(0.5)
      ? dec(rng.intWhere(11, 99, unround), 1)
      : rat(rng.intWhere(13, 99, unround));
  }
  if (rng.chance(0.5)) [x, y] = [y, x];
  return exact('mul', [x, y], mul(x, y), `${displayNumber(x)} ${OP.mul} ${displayNumber(y)}`);
}

// ---- division: built from the answer, so it is always exact

const TERMINATING_DIVISORS = [4, 8, 16, 20, 25, 40] as const;

function genDivide(rng: Rng, level: DrillLevel): Generated {
  let divisor: Rational;
  let quotient: Rational;
  if (level === 'warmup') {
    const d = rng.intWhere(2, 12, (n) => n !== 10);
    divisor = rat(d);
    quotient = rat(rng.intWhere(d < 5 ? 5 : 2, 12, (n) => n !== 10));
  } else if (level === 'standard') {
    if (rng.chance(0.7)) {
      divisor = rat(rng.intWhere(3, 12, (n) => n !== 10));
      quotient = rat(rng.intWhere(11, 99, unround));
    } else {
      divisor = dec(rng.int(2, 9), 1);
      quotient = rat(rng.int(3, 50));
    }
  } else {
    const kind = rng.weighted([
      ['whole', 5],
      ['decimal', 3],
      ['terminating', 2],
    ] as const);
    if (kind === 'whole') {
      divisor = rat(rng.intWhere(13, 49, unround));
      quotient = rat(rng.intWhere(13, 99, unround));
    } else if (kind === 'decimal') {
      divisor = dec(rng.intWhere(12, 95, unround), 2);
      quotient = rat(rng.int(4, 60));
    } else {
      const d = rng.pick(TERMINATING_DIVISORS);
      // At least two places (7 ÷ 8 = 0.875, not 4 ÷ 20 = 0.2).
      const n = rng.intWhere(3, 99, (k) => (decimalPlaces(rat(k, d)) ?? 0) >= 2);
      divisor = rat(d);
      quotient = rat(n, d);
    }
  }
  const dividend = mul(quotient, divisor);
  return exact(
    'div',
    [dividend, divisor],
    quotient,
    `${displayNumber(dividend)} ${OP.div} ${displayNumber(divisor)}`,
  );
}

// ---- fractions

const FRACTION_DENS: Record<DrillLevel, readonly number[]> = {
  warmup: [2, 3, 4, 5, 6, 8, 10],
  standard: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12],
  hard: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16],
};
/** Denominators of the fraction ⇄ decimal conversions: all terminate. */
const CONVERSION_DENS: Record<DrillLevel, readonly number[]> = {
  warmup: [2, 4, 5, 8, 20],
  standard: [8, 16, 20, 25, 40],
  hard: [16, 32, 40, 80, 125],
};

const coprime = (a: number, b: number) => gcd(BigInt(a), BigInt(b)) === 1n;

/** A reduced fraction over one of `dens`: proper, or (hard) sometimes improper but not whole. */
function fraction(rng: Rng, dens: readonly number[], improper: boolean): Rational {
  const d = rng.pick(dens);
  const n = rng.intWhere(1, improper ? 2 * d - 1 : d - 1, (k) => k % d !== 0 && coprime(k, d));
  return rat(n, d);
}

function genFractions(rng: Rng, level: DrillLevel): Generated {
  const kind = rng.weighted(
    level === 'warmup'
      ? ([
          ['frac-add', 25],
          ['frac-sub', 20],
          ['frac-mul', 20],
          ['frac-div', 10],
          ['frac-to-dec', 15],
          ['dec-to-frac', 10],
        ] as const)
      : ([
          ['frac-add', 20],
          ['frac-sub', 20],
          ['frac-mul', 15],
          ['frac-div', 15],
          ['frac-to-dec', 15],
          ['dec-to-frac', 15],
        ] as const),
  );
  if (kind === 'frac-to-dec' || kind === 'dec-to-frac') {
    const d = rng.pick(CONVERSION_DENS[level]);
    const f = rat(
      rng.intWhere(1, d - 1, (k) => coprime(k, d)),
      d,
    );
    if (kind === 'frac-to-dec')
      return exact(kind, [f], f, displayFraction(f), { ask: 'As a decimal', form: 'decimal' });
    return exact(kind, [f], f, displayNumber(f), {
      ask: 'As a fraction',
      form: 'fraction',
      inputMode: 'text',
    });
  }
  const dens = FRACTION_DENS[level];
  const improper = level === 'hard' && rng.chance(0.4);
  for (;;) {
    let x = fraction(rng, dens, improper);
    let y: Rational;
    if (level === 'warmup' && (kind === 'frac-add' || kind === 'frac-sub')) {
      // Related denominators (one a multiple of the other): one conversion, then add.
      const related = dens.filter((d) => d % Number(x.den) === 0 || Number(x.den) % d === 0);
      y = fraction(rng, related, false);
    } else if (level === 'warmup' && kind === 'frac-div') {
      // Dividing by a unit fraction: 3/4 ÷ 1/2.
      y = rat(1, rng.pick(dens.filter((d) => d <= 6)));
    } else y = fraction(rng, dens, improper && rng.chance(0.5));
    if (ratEq(x, y)) continue;
    if (kind === 'frac-sub' && ratCmp(x, y) < 0) [x, y] = [y, x];
    const op = { 'frac-add': add, 'frac-sub': sub, 'frac-mul': mul, 'frac-div': div }[kind];
    const answer = op(x, y);
    // Not degenerate: a sum or difference that is a whole number, or a quotient of 1.
    if ((kind === 'frac-add' || kind === 'frac-sub') && isInteger(answer)) continue;
    const sym = { 'frac-add': OP.add, 'frac-sub': OP.sub, 'frac-mul': OP.mul, 'frac-div': OP.div }[
      kind
    ];
    return exact(kind, [x, y], answer, `${displayFraction(x)} ${sym} ${displayFraction(y)}`, {
      inputMode: 'text',
    });
  }
}

// ---- percentages

const hundred = rat(100);
/** p% as a factor: 20 → 1/5. */
const pct = (p: Rational) => div(p, hundred);
/** Rational p from a percentage given in halves (25 → 12.5). */
const halves = (n: number) => rat(n, 2);
const placesAtMost = (r: Rational, k: number) => {
  const p = decimalPlaces(r);
  return p !== null && p <= k;
};

function genPercentages(rng: Rng, level: DrillLevel): Generated {
  const kind = rng.weighted([
    ['pct-of', 4],
    ['change', 3],
    ['before', 3],
  ] as const);
  if (kind === 'pct-of') {
    const p =
      level === 'warmup'
        ? rat(rng.pick([5, 10, 20, 25, 50, 75]))
        : level === 'standard'
          ? rng.chance(0.8)
            ? rat(rng.int(1, 19) * 5)
            : halves(rng.pick([25, 75, 125]))
          : rng.chance(0.7)
            ? rat(rng.intWhere(2, 99, (n) => n !== 50))
            : halves(rng.pick([5, 15, 25, 35, 75, 125, 175]));
    const [lo, hi, places] =
      level === 'warmup' ? [20, 400, 0] : level === 'standard' ? [20, 800, 1] : [100, 2000, 2];
    const y = rat(rng.intWhere(lo, hi, (n) => placesAtMost(mul(pct(p), rat(n)), places)));
    return exact('pct-of', [p, y], mul(pct(p), y), `${displayNumber(p)}% of ${displayNumber(y)}`, {
      ask: 'Find the number',
    });
  }
  const rise = level === 'warmup' && kind === 'before' ? true : rng.chance(0.5);
  if (kind === 'change') {
    // From a to b, a rise or a fall of p%; b a whole number.
    let p: Rational;
    let a: number;
    if (level === 'warmup') {
      p = rat(rng.pick(rise ? [10, 20, 25, 50, 100] : [10, 20, 25, 50]));
      const pp = p;
      a = rng.intWhere(20, 400, (n) => isInteger(mul(pct(pp), rat(n))));
    } else if (level === 'standard') {
      p = rat(rng.int(5, 80));
      const pp = p;
      a = rng.intWhere(20, 500, (n) => isInteger(mul(pct(pp), rat(n))));
    } else {
      p = halves(rng.intWhere(3, rise ? 199 : 150, (n) => n % 2 === 1 || rng.chance(0.4)));
      const pp = p;
      a = rng.intWhere(40, 2000, (n) => isInteger(mul(pct(pp), rat(n))));
    }
    const from = rat(a);
    const to = rise ? mul(from, add(rat(1), pct(p))) : mul(from, sub(rat(1), pct(p)));
    return exact(
      rise ? 'pct-rise' : 'pct-fall',
      [from, to],
      p,
      `${displayNumber(from)} → ${displayNumber(to)}`,
      { ask: rise ? 'Percentage rise, in %' : 'Percentage fall, in %', form: 'percent' },
    );
  }
  // Reversing a percentage: after a rise (fall) of p% it is v; what was it before?
  const p =
    level === 'warmup'
      ? rat(rng.pick([10, 20, 25, 50]))
      : level === 'standard'
        ? rat(rng.pick([5, 10, 15, 20, 25, 30, 40, 60]))
        : rng.chance(0.25)
          ? halves(rng.pick([25, 35, 75]))
          : rat(rng.pick([5, 15, 20, 25, 30, 35, 40, 45, 60, 75]));
  const factor = rise ? add(rat(1), pct(p)) : sub(rat(1), pct(p));
  const [lo, hi, places] =
    level === 'warmup' ? [20, 200, 0] : level === 'standard' ? [20, 500, 0] : [40, 2000, 1];
  const before = rat(rng.intWhere(lo, hi, (n) => placesAtMost(mul(rat(n), factor), places)));
  const after = mul(before, factor);
  return exact(
    rise ? 'pct-before-rise' : 'pct-before-fall',
    [p, after],
    before,
    `${displayNumber(p)}% ${rise ? 'rise' : 'fall'} → ${displayNumber(after)}`,
    { ask: 'Find the number before' },
  );
}

// ---- estimation

function genEstimation(rng: Rng, level: DrillLevel): Generated {
  const isMul = rng.chance(0.5);
  let x: Rational;
  let y: Rational;
  if (level === 'warmup') {
    if (isMul) {
      x = rat(rng.intWhere(101, 999, unround));
      y = rat(rng.intWhere(11, 99, unround));
    } else {
      x = rat(rng.intWhere(1001, 9999, unround));
      y = rat(rng.intWhere(11, 99, unround));
    }
  } else if (level === 'standard') {
    if (isMul) {
      if (rng.chance(0.5)) {
        x = rat(rng.intWhere(101, 999, unround));
        y = rat(rng.intWhere(101, 999, unround));
      } else {
        x = rat(rng.intWhere(1001, 9999, unround));
        y = dec(rng.intWhere(101, 999, unround), 3);
      }
    } else {
      x = rat(rng.intWhere(10_001, 99_999, unround));
      y = rat(rng.intWhere(11, 99, unround));
    }
  } else if (isMul) {
    if (rng.chance(0.5)) {
      x = rat(rng.intWhere(10_001, 99_999, unround));
      y = dec(rng.intWhere(101, 999, unround), 4);
    } else {
      x = rat(rng.intWhere(101, 999, unround));
      y = dec(rng.intWhere(1001, 9999, unround), 3);
    }
  } else if (rng.chance(0.6)) {
    x = rat(rng.intWhere(100_001, 999_999, unround));
    y = rat(rng.intWhere(101, 999, unround));
  } else {
    x = rat(rng.intWhere(1001, 9999, unround));
    y = dec(rng.intWhere(11, 99, unround), 2);
  }
  const answer = isMul ? mul(x, y) : div(x, y);
  const tolerance = ESTIMATE_TOLERANCE[level];
  return {
    kind: isMul ? 'est-mul' : 'est-div',
    text: `${displayNumber(x)} ${isMul ? OP.mul : OP.div} ${displayNumber(y)}`,
    ask: `Estimate, within ${Math.round(tolerance * 100)}%`,
    operands: [x, y],
    answer,
    form: 'any',
    tolerance,
    inputMode: 'decimal',
    answerText: decimalText(roundSig(answer, 3)),
  };
}

const GENERATORS: Record<DrillCategory, (rng: Rng, level: DrillLevel) => Generated> = {
  'add-subtract': genAddSubtract,
  multiply: genMultiply,
  divide: genDivide,
  fractions: genFractions,
  percentages: genPercentages,
  estimation: genEstimation,
};

/** The canonical typed answer: the exact decimal when there is one, else the fraction. */
function canonical(g: Generated): string {
  if (g.answerText) return g.answerText;
  if (g.form === 'fraction') return fractionText(g.answer);
  const t = decimalPlaces(g.answer) === null ? fractionText(g.answer) : decimalText(g.answer);
  return g.form === 'percent' ? `${t}%` : t;
}

/** Same question whichever way round a sum or product is written. */
function questionKey(g: Generated): string {
  const ops = g.operands.map(fractionText);
  if (g.kind === 'add' || g.kind === 'mul' || g.kind === 'frac-add' || g.kind === 'frac-mul')
    ops.sort();
  return `${g.kind}:${ops.join(',')}`;
}

/** How many questions back a repeat is avoided once a category's questions run short. */
const REPEAT_WINDOW = 25;
/** A category is not asked more than this many times in a row when others are on. */
export const MAX_CATEGORY_STREAK = 2;

/**
 * The questions of one run, generated on demand and kept, so `at(i)` is the same question however
 * often it is asked for (React may call things twice). Deterministic for `(seed, level,
 * categories)`: a run is the same run whatever was answered.
 */
export class DrillDeck {
  private readonly rng: Rng;
  private readonly questions: DrillQuestion[] = [];
  private readonly seen = new Set<string>();
  readonly categories: DrillCategory[];

  constructor(
    readonly seed: number,
    readonly level: DrillLevel,
    categories: readonly DrillCategory[],
  ) {
    this.rng = new Rng(seed);
    this.categories = DRILL_CATEGORIES.filter((c) => categories.includes(c));
    if (this.categories.length === 0) throw new Error('a drill needs at least one category');
  }

  at(index: number): DrillQuestion {
    while (this.questions.length <= index) this.questions.push(this.make(this.questions.length));
    const q = this.questions[index];
    if (!q) throw new Error('unreachable');
    return q;
  }

  private make(index: number): DrillQuestion {
    const prev = this.questions.slice(-MAX_CATEGORY_STREAK).map((q) => q.category);
    const streak =
      prev.length === MAX_CATEGORY_STREAK && prev.every((c) => c === prev[0]) ? prev[0] : null;
    const options =
      this.categories.length > 1 && streak
        ? this.categories.filter((c) => c !== streak)
        : this.categories;
    const category = this.rng.pick(options);
    const recent = new Set(this.questions.slice(-REPEAT_WINDOW).map((q) => q.key));
    let fallback: Generated | null = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const g = GENERATORS[category](this.rng, this.level);
      const key = questionKey(g);
      if (!this.seen.has(key)) return this.finish(g, index, category, key);
      if (!fallback && !recent.has(key)) fallback = g;
    }
    // The category has run out of new questions (a long run of times tables): repeat one that
    // was not asked recently.
    const g = fallback ?? GENERATORS[category](this.rng, this.level);
    return this.finish(g, index, category, questionKey(g));
  }

  private finish(g: Generated, index: number, category: DrillCategory, key: string) {
    this.seen.add(key);
    return { ...g, index, category, key, answerText: canonical(g) };
  }
}

// ---------------------------------------------------------------- marking

export type Verdict =
  | { outcome: 'right' }
  | { outcome: 'wrong' }
  /** Not sent: the text is not an answer of the kind asked for. The field says why. */
  | { outcome: 'invalid'; note: string }
  /** Nothing typed: Enter does nothing. */
  | { outcome: 'empty' };

export const NOT_A_NUMBER = 'Not a number';

/**
 * Marks typed text. A percentage answer is the percentage figure: a trailing `%` is dropped
 * before reading it, so `12.5%` and `12.5` are both 12.5 (while `parseNumeric('12.5%')` alone
 * would read 0.125). Elsewhere a `%` is refused as not the kind of answer asked for. Exact
 * questions accept any exactly equal form; an estimate anything within its tolerance.
 */
export function markAnswer(q: DrillQuestion, typed: string): Verdict {
  let s = typed.trim();
  if (!s) return { outcome: 'empty' };
  if (q.form === 'percent') s = s.replace(/\s*%$/, '');
  else if (s.includes('%')) return { outcome: 'invalid', note: 'A number, not a percentage' };
  const v = parseNumeric(s);
  if (!v) return { outcome: 'invalid', note: NOT_A_NUMBER };
  if (q.form === 'fraction' && v.form !== 'fraction')
    return { outcome: 'invalid', note: 'As a fraction, like 3/8' };
  if (q.form === 'decimal' && v.form === 'fraction')
    return { outcome: 'invalid', note: 'As a decimal, like 0.375' };
  const expected: NumericValue = {
    num: q.answer.num,
    den: q.answer.den,
    form: isInteger(q.answer) ? 'integer' : 'fraction',
  };
  // `abs: 0` makes an exact question exact: without a tolerance `numericMatches` would accept a
  // decimal within half a percent of a non-integer answer.
  const ok = numericMatches(expected, v, q.tolerance === null ? { abs: 0 } : { rel: q.tolerance });
  return { outcome: ok ? 'right' : 'wrong' };
}

/** The answer as the review shows it: `7/12`, `3/4 = 0.75`, `12.5%`, `≈ 15,370`. */
export function answerDisplay(q: DrillQuestion): string {
  if (q.tolerance !== null) return `≈ ${displayNumber(roundSig(q.answer, 4))}`;
  if (q.form === 'percent') return `${displayNumber(q.answer)}%`;
  if (q.form === 'decimal') return displayNumber(q.answer);
  if (q.form === 'fraction') return displayFraction(q.answer);
  if (q.category === 'fractions' && !isInteger(q.answer))
    return decimalPlaces(q.answer) === null
      ? displayFraction(q.answer)
      : `${displayFraction(q.answer)} = ${displayNumber(q.answer)}`;
  return displayNumber(q.answer);
}

/** The question with its answer, for the mark under the field and the review: `6 × 7 = 42`. */
export function worked(q: DrillQuestion): string {
  const a = answerDisplay(q);
  return a.startsWith('≈') ? `${q.text} ${a}` : `${q.text} = ${a}`;
}

/** The range an estimate accepts, for the review: [low, high] to 3 significant figures. */
export function estimateRange(q: DrillQuestion): [string, string] | null {
  if (q.tolerance === null) return null;
  const t = rat(Math.round(q.tolerance * 1000), 1000);
  return [
    displayNumber(roundSig(mul(q.answer, sub(rat(1), t)), 3)),
    displayNumber(roundSig(mul(q.answer, add(rat(1), t)), 3)),
  ];
}

/** The question as a screen reader should say it. */
export function spokenQuestion(q: DrillQuestion): string {
  const text = q.text
    .replace(/ × /g, ' times ')
    .replace(/ ÷ /g, ' divided by ')
    .replace(/ − /g, ' minus ')
    .replace(/ \+ /g, ' plus ')
    .replace(/ → /g, ' to ')
    .replace(/−/g, 'minus ')
    .replace(/(\d)\/(\d)/g, '$1 over $2');
  return q.ask ? `${q.ask}: ${text}` : text;
}

// ---------------------------------------------------------------- a run

export const COUNTDOWN_MS = 3000;

export type Outcome = 'right' | 'wrong' | 'skipped';

export interface Answered {
  question: DrillQuestion;
  /** What was typed; null when skipped. */
  typed: string | null;
  outcome: Outcome;
  /** Time on the question, ms. */
  ms: number;
}

export interface RunState {
  phase: 'countdown' | 'running' | 'over';
  deck: DrillDeck;
  durationMs: number;
  /** `performance.now()` when the countdown began. */
  createdAt: number;
  /** When the first question was shown; null during the countdown. */
  startedAt: number | null;
  /** When the current question was shown. */
  shownAt: number;
  /** The last time seen (for the clock). Updated only when what the clock shows changes. */
  now: number;
  index: number;
  draft: string;
  /** Why the last Enter was not taken; `count` grows so the field shakes again each time. */
  invalid: { note: string; count: number } | null;
  answers: Answered[];
  endedBy: 'time' | 'stop' | null;
  /** Time actually played, once over. */
  elapsedMs: number;
}

export type RunAction =
  | { type: 'tick'; now: number }
  | { type: 'edit'; text: string }
  | { type: 'submit'; now: number }
  | { type: 'skip'; now: number }
  | { type: 'stop'; now: number };

export function initRun(deck: DrillDeck, durationSec: DrillDuration, now: number): RunState {
  return {
    phase: 'countdown',
    deck,
    durationMs: durationSec * 1000,
    createdAt: now,
    startedAt: null,
    shownAt: now,
    now,
    index: 0,
    draft: '',
    invalid: null,
    answers: [],
    endedBy: null,
    elapsedMs: 0,
  };
}

export const currentQuestion = (s: RunState) => s.deck.at(s.index);

/** Milliseconds left on the clock. */
export function remainingMs(s: RunState, now = s.now): number {
  if (s.phase === 'over') return Math.max(0, s.durationMs - s.elapsedMs);
  if (s.startedAt === null) return s.durationMs;
  return Math.max(0, s.startedAt + s.durationMs - now);
}

/** The clock's whole seconds, rounded up (a run of 60 s shows 1:00 until a second has gone). */
export const clockSeconds = (s: RunState, now = s.now) => Math.ceil(remainingMs(s, now) / 1000);

/** 3, 2, 1 during the countdown. */
export const countdownDigit = (s: RunState, now = s.now) =>
  Math.min(3, Math.max(1, 3 - Math.floor((now - s.createdAt) / 1000)));

const over = (s: RunState, endedBy: 'time' | 'stop', elapsedMs: number): RunState => ({
  ...s,
  phase: 'over',
  endedBy,
  elapsedMs: Math.min(s.durationMs, Math.max(0, Math.round(elapsedMs))),
  draft: '',
  invalid: null,
});

function advance(s: RunState, outcome: Outcome, now: number): RunState {
  const answered: Answered = {
    question: currentQuestion(s),
    typed: outcome === 'skipped' ? null : s.draft.trim(),
    outcome,
    ms: Math.max(0, now - s.shownAt),
  };
  return {
    ...s,
    answers: [...s.answers, answered],
    index: s.index + 1,
    shownAt: now,
    now,
    draft: '',
    invalid: null,
  };
}

/**
 * The run as a pure state machine over real time. Time is only ever read from the actions'
 * `now` (`performance.now()`), never counted in ticks, so a background tab or a slow frame cannot
 * stretch the clock: the first action after the deadline ends the run, and an answer sent then
 * is not counted.
 */
export function runReducer(s: RunState, a: RunAction): RunState {
  if (s.phase === 'over') return s;
  if (a.type === 'edit') {
    if (s.phase !== 'running') return s;
    return { ...s, draft: a.text, invalid: null };
  }
  const now = a.now;
  if (s.phase === 'countdown') {
    if (a.type === 'stop') return over(s, 'stop', 0);
    if (now - s.createdAt < COUNTDOWN_MS) {
      if (a.type === 'tick' && countdownDigit(s, now) !== countdownDigit(s)) return { ...s, now };
      return s;
    }
    // The countdown is over: the clock starts now, whenever this tick came.
    s = { ...s, phase: 'running', startedAt: now, shownAt: now, now };
    if (a.type === 'tick') return s;
  }
  const deadline = (s.startedAt ?? now) + s.durationMs;
  if (now >= deadline) return over(s, 'time', s.durationMs);
  switch (a.type) {
    case 'tick':
      return clockSeconds(s, now) === clockSeconds(s) ? s : { ...s, now };
    case 'stop':
      return over(s, 'stop', now - (s.startedAt ?? now));
    case 'skip':
      return advance(s, 'skipped', now);
    case 'submit': {
      const v = markAnswer(currentQuestion(s), s.draft);
      if (v.outcome === 'empty') return s;
      if (v.outcome === 'invalid')
        return { ...s, now, invalid: { note: v.note, count: (s.invalid?.count ?? 0) + 1 } };
      return advance(s, v.outcome, now);
    }
  }
}

export const runScore = (answers: readonly Answered[]) =>
  drillScore({
    correct: answers.filter((x) => x.outcome === 'right').length,
    wrong: answers.filter((x) => x.outcome === 'wrong').length,
  });

// ---------------------------------------------------------------- results

export interface CategorySummary extends DrillCategoryResult {
  /** Questions shown (answered or skipped). */
  total: number;
  /** Mean time on a question of this category, ms. */
  meanMs: number;
  /** correct / (correct + wrong); null when none was answered. */
  accuracy: number | null;
}

export interface RunSummary {
  correct: number;
  wrong: number;
  skipped: number;
  /** `drillScore`: correct minus wrong. */
  score: number;
  /** correct / (correct + wrong): skipping is not a mistake. Null when nothing was answered. */
  accuracy: number | null;
  /** Answers (right or wrong) per minute of play; null for a run under a second. */
  perMinute: number | null;
  /** Categories that came up, in setup order. */
  byCategory: CategorySummary[];
  /** The category with the longest mean time per question, when more than one came up. */
  slowest: DrillCategory | null;
  /** Questions answered wrong or skipped, in order. */
  review: Answered[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function summarize(answers: readonly Answered[], elapsedMs: number): RunSummary {
  const byCategory: CategorySummary[] = [];
  for (const category of DRILL_CATEGORIES) {
    const xs = answers.filter((x) => x.question.category === category);
    if (xs.length === 0) continue;
    const correct = xs.filter((x) => x.outcome === 'right').length;
    const wrong = xs.filter((x) => x.outcome === 'wrong').length;
    byCategory.push({
      category,
      correct,
      wrong,
      skipped: xs.length - correct - wrong,
      total: xs.length,
      meanMs: xs.reduce((s, x) => s + x.ms, 0) / xs.length,
      accuracy: ratio(correct, correct + wrong),
    });
  }
  const correct = byCategory.reduce((s, c) => s + c.correct, 0);
  const wrong = byCategory.reduce((s, c) => s + c.wrong, 0);
  const skipped = byCategory.reduce((s, c) => s + c.skipped, 0);
  let slowest: CategorySummary | null = null;
  if (byCategory.length > 1)
    for (const c of byCategory) if (!slowest || c.meanMs > slowest.meanMs) slowest = c;
  return {
    correct,
    wrong,
    skipped,
    score: drillScore({ correct, wrong }),
    accuracy: ratio(correct, correct + wrong),
    perMinute: elapsedMs >= 1000 ? (correct + wrong) / (elapsedMs / 60_000) : null,
    byCategory,
    slowest: slowest?.category ?? null,
    review: answers.filter((x) => x.outcome !== 'right'),
  };
}

/** `POST /api/drill/runs` for a finished run. */
export function recordRequest(
  config: DrillConfig,
  answers: readonly Answered[],
  elapsedMs: number,
): RecordDrillRunRequest {
  return {
    config: {
      durationSec: config.durationSec,
      level: config.level,
      categories: DRILL_CATEGORIES.filter((c) => config.categories.includes(c)),
    },
    byCategory: summarize(answers, elapsedMs).byCategory.map(
      ({ category, correct, wrong, skipped }) => ({ category, correct, wrong, skipped }),
    ),
    elapsedMs: Math.round(elapsedMs),
  };
}

/** A run with no answer at all (stopped at once) is shown but not recorded. */
export const worthRecording = (answers: readonly Answered[]) => answers.length > 0;

// ---------------------------------------------------------------- setup and history

export const DEFAULT_CONFIG: DrillConfig = {
  durationSec: 120,
  level: 'standard',
  categories: [...DRILL_CATEGORIES],
};

/** The setup remembered in this browser, read defensively: anything unusable is the default. */
export function parseSetup(raw: unknown): DrillConfig {
  const r = DrillConfig.safeParse(raw);
  return r.success ? r.data : DEFAULT_CONFIG;
}

export function toggleCategory(config: DrillConfig, c: DrillCategory, on: boolean): DrillConfig {
  const next = on
    ? DRILL_CATEGORIES.filter((k) => k === c || config.categories.includes(k))
    : config.categories.filter((k) => k !== c);
  return next.length === 0 ? config : { ...config, categories: next };
}

export const bestFor = (
  bests: readonly DrillBest[],
  durationSec: DrillDuration,
  level: DrillLevel,
): DrillBest | null =>
  bests.find((b) => b.durationSec === durationSec && b.level === level) ?? null;

export const runAccuracy = (r: Pick<DrillRun, 'correct' | 'wrong'>) =>
  ratio(r.correct, r.correct + r.wrong);

/** `2 min · Standard · All categories`, `1 min · Hard · Fractions`, `5 min · Warm-up · 3 categories`. */
export function setupLabel(c: Pick<DrillConfig, 'durationSec' | 'level' | 'categories'>): string {
  const cats =
    c.categories.length === DRILL_CATEGORIES.length
      ? 'All categories'
      : c.categories.length === 1 && c.categories[0]
        ? DRILL_CATEGORY_INFO[c.categories[0]].label
        : `${c.categories.length} categories`;
  return `${DURATION_LABEL[c.durationSec]} · ${DRILL_LEVEL_LABEL[c.level]} · ${cats}`;
}

/** Answers a minute: one decimal under ten, whole above. */
export const formatPace = (perMinute: number) =>
  perMinute < 10 ? perMinute.toFixed(1) : String(Math.round(perMinute));

/** Seconds per question: `2.4 s`. */
export const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export const DURATION_LABEL: Record<DrillDuration, string> = {
  60: '1 min',
  120: '2 min',
  300: '5 min',
};

/** What each level asks, for the setup. */
export const LEVEL_HINT: Record<DrillLevel, string> = {
  warmup: 'Times tables, two-digit sums, simple fractions, round percentages.',
  standard: 'Three-digit sums, two-digit products, one-place decimals, any whole percentage.',
  hard: 'Four-digit sums with negatives, two-digit by two-digit, division by decimals.',
};

/**
 * What each category asks, for the setup. (The contract's descriptions mention comparing
 * fractions, which the drill does not ask: an answer here is always a typed number.)
 */
export const CATEGORY_HINT: Record<DrillCategory, string> = {
  'add-subtract': 'Whole numbers and decimals, with carries; negatives above warm-up.',
  multiply: 'From times tables up to two-digit by two-digit and decimals.',
  divide: 'Always exact, including division by a decimal.',
  fractions: 'Add, subtract, multiply, divide; to and from decimals.',
  percentages: 'A percentage of a number, a change, and reversing one.',
  estimation: 'Awkward products and quotients, to within a few percent.',
};
