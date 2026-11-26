import {
  DRILL_CATEGORIES,
  DRILL_LEVELS,
  type DrillCategory,
  type DrillConfig,
  type DrillLevel,
  parseNumeric,
  RecordDrillRunRequest,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  add,
  answerDisplay,
  bestFor,
  COUNTDOWN_MS,
  clockSeconds,
  countdownDigit,
  currentQuestion,
  DEFAULT_CONFIG,
  DrillDeck,
  type DrillQuestion,
  dec,
  decimalPlaces,
  decimalText,
  displayNumber,
  div,
  ESTIMATE_TOLERANCE,
  estimateRange,
  formatPace,
  formatSeconds,
  initRun,
  MAX_CATEGORY_STREAK,
  markAnswer,
  mul,
  mulberry32,
  NOT_A_NUMBER,
  parseSeed,
  parseSetup,
  type Rational,
  Rng,
  type RunState,
  rat,
  ratEq,
  recordRequest,
  remainingMs,
  roundSig,
  runAccuracy,
  runReducer,
  setupLabel,
  spokenQuestion,
  sub,
  summarize,
  toggleCategory,
  toNumber,
  worked,
  worthRecording,
} from './logic';

// ---------------------------------------------------------------- helpers

/** Seeds for the property tests: each (category, level) deck is run for each. */
const SEEDS = Array.from({ length: 120 }, (_, i) => (i * 2_654_435_761 + 17) >>> 0);
const PER_DECK = 40;

function questions(category: DrillCategory, level: DrillLevel): DrillQuestion[] {
  const out: DrillQuestion[] = [];
  for (const seed of SEEDS) {
    const deck = new DrillDeck(seed, level, [category]);
    for (let i = 0; i < PER_DECK; i++) out.push(deck.at(i));
  }
  return out;
}
const ALL: Record<string, DrillQuestion[]> = {};
for (const c of DRILL_CATEGORIES) for (const l of DRILL_LEVELS) ALL[`${c}/${l}`] = questions(c, l);
const each = (fn: (q: DrillQuestion, c: DrillCategory, l: DrillLevel) => void) => {
  for (const c of DRILL_CATEGORIES)
    for (const l of DRILL_LEVELS) for (const q of ALL[`${c}/${l}`] ?? []) fn(q, c, l);
};

/** A displayed number read back exactly (thousands separators, a real minus sign, fractions). */
function readDisplayed(text: string): Rational {
  const v = parseNumeric(text.replace(/−/g, '-'));
  if (!v) throw new Error(`cannot read "${text}"`);
  return rat(v.num, v.den);
}

/** The displayed arithmetic, recomputed exactly from the text alone. */
function evaluate(q: DrillQuestion): Rational {
  const t = q.text;
  let m = /^(.+)% of (.+)$/.exec(t);
  if (m) return div(mul(readDisplayed(m[1] ?? ''), readDisplayed(m[2] ?? '')), rat(100));
  m = /^(.+)% (rise|fall) → (.+)$/.exec(t);
  if (m) {
    const p = div(readDisplayed(m[1] ?? ''), rat(100));
    const factor = m[2] === 'rise' ? add(rat(1), p) : sub(rat(1), p);
    return div(readDisplayed(m[3] ?? ''), factor);
  }
  m = /^(.+) → (.+)$/.exec(t);
  if (m) {
    const a = readDisplayed(m[1] ?? '');
    const b = readDisplayed(m[2] ?? '');
    const change = mul(div(sub(b, a), a), rat(100));
    return q.kind === 'pct-fall' ? sub(rat(0), change) : change;
  }
  m = /^(\S+) ([+−×÷]) (\S+)$/.exec(t);
  if (m) {
    const a = readDisplayed(m[1] ?? '');
    const b = readDisplayed(m[3] ?? '');
    return { '+': add, '−': sub, '×': mul, '÷': div }[m[2] as '+' | '−' | '×' | '÷'](a, b);
  }
  // A conversion shows only the number.
  return readDisplayed(t);
}

const abs = (r: Rational) => Math.abs(toNumber(r));
const places = (r: Rational) => decimalPlaces(r) ?? Number.POSITIVE_INFINITY;

/**
 * The stated ranges (what the report and the setup's level hints say), checked against every
 * operand generated: [smallest |operand|, largest |operand|, most decimal places, negatives].
 * Fractions and percentages have their own checks below.
 */
const RANGES: Partial<
  Record<DrillCategory, Record<DrillLevel, [number, number, number, boolean]>>
> = {
  'add-subtract': {
    warmup: [11, 99, 0, false],
    standard: [1.1, 999, 1, false],
    hard: [1.01, 9999, 2, true],
  },
  multiply: { warmup: [2, 12, 0, false], standard: [3, 99, 0, false], hard: [1.1, 99, 1, false] },
  divide: {
    warmup: [2, 144, 0, false],
    standard: [0.2, 1188, 1, false],
    hard: [0.12, 4851, 2, false],
  },
  estimation: {
    warmup: [11, 9999, 0, false],
    standard: [0.101, 99_999, 3, false],
    hard: [0.0101, 999_999, 4, false],
  },
};

// ---------------------------------------------------------------- random numbers

describe('the PRNG', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c())).not.toEqual(xs);
  });

  it('stays in [0, 1) and covers integer ranges evenly enough', () => {
    const rng = new Rng(7);
    const counts = new Map<number, number>();
    for (let i = 0; i < 60_000; i++) {
      const f = rng.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(1, 6);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const n of counts.values()) expect(Math.abs(n - 10_000)).toBeLessThan(600);
  });

  it('reads a seed from the URL only when it is a 32-bit whole number', () => {
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed('12345')).toBe(12345);
    expect(parseSeed('4294967295')).toBe(4294967295);
    for (const bad of [null, '', '-1', '1.5', 'abc', '4294967296', '1e5', '99999999999'])
      expect(parseSeed(bad)).toBeNull();
  });
});

// ---------------------------------------------------------------- rationals

describe('exact rationals', () => {
  it('reduce, add and divide exactly', () => {
    expect(rat(6, 8)).toEqual({ num: 3n, den: 4n });
    expect(rat(3, -6)).toEqual({ num: -1n, den: 2n });
    expect(add(rat(1, 3), rat(1, 6))).toEqual(rat(1, 2));
    expect(div(dec(864, 2), dec(24, 2))).toEqual(rat(36));
    expect(() => rat(1, 0)).toThrow();
  });

  it('write terminating decimals exactly and show numbers as a question does', () => {
    expect(decimalText(rat(3, 8))).toBe('0.375');
    expect(decimalText(rat(-1234, 100))).toBe('-12.34');
    expect(decimalText(rat(7))).toBe('7');
    expect(decimalPlaces(rat(1, 3))).toBeNull();
    expect(decimalPlaces(rat(1, 80))).toBe(4);
    expect(displayNumber(rat(-12_345_678, 10))).toBe('−1,234,567.8');
    expect(displayNumber(rat(999))).toBe('999');
    expect(displayNumber(rat(1, 3))).toBe('1/3');
  });

  it('round to significant figures exactly', () => {
    expect(roundSig(rat(9340, 31), 3)).toEqual(rat(301));
    expect(roundSig(dec(15_370_3, 1), 3)).toEqual(rat(15_400));
    expect(roundSig(dec(213_49, 6), 3)).toEqual(dec(213, 4));
    expect(roundSig(dec(1235, 3), 3)).toEqual(dec(124, 2));
  });
});

// ---------------------------------------------------------------- the generator

describe(`generated questions (${SEEDS.length} seeds × ${PER_DECK} per category and level)`, () => {
  it('each answer is exact, and its canonical form is accepted', () => {
    each((q) => {
      expect(markAnswer(q, q.answerText), `${q.text} = ${q.answerText}`).toEqual({
        outcome: 'right',
      });
      if (q.tolerance !== null) return;
      // The canonical form is the answer itself, not a rounding of it.
      const v = parseNumeric(q.form === 'percent' ? q.answerText.replace(/%$/, '') : q.answerText);
      expect(v && ratEq(rat(v.num, v.den), q.answer), q.text).toBe(true);
      // Only a fractions answer may be a fraction with no exact decimal.
      if (q.category !== 'fractions') expect(decimalPlaces(q.answer), q.text).not.toBeNull();
    });
  });

  it('the arithmetic shown really equals the answer (recomputed from the text)', () => {
    each((q) => {
      expect(ratEq(evaluate(q), q.answer), `${q.text} ≠ ${q.answerText}`).toBe(true);
    });
  });

  it('operands stay within the level’s ranges', () => {
    each((q, c, l) => {
      const range = RANGES[c]?.[l];
      if (!range) return;
      const [lo, hi, dp, negatives] = range;
      for (const o of q.operands) {
        expect(abs(o), `${q.text}`).toBeGreaterThanOrEqual(lo);
        expect(abs(o), `${q.text}`).toBeLessThanOrEqual(hi);
        expect(places(o), `${q.text}`).toBeLessThanOrEqual(dp);
        if (!negatives) expect(toNumber(o), q.text).toBeGreaterThan(0);
      }
      if (c === 'add-subtract' && l === 'warmup') expect(toNumber(q.answer)).toBeGreaterThan(0);
      // Times tables leave out the first rows (2 × 3).
      if ((c === 'multiply' || c === 'divide') && l === 'warmup')
        expect(
          Math.max(
            toNumber(q.answer),
            ...(c === 'multiply' ? q.operands.map(abs) : [abs(q.operands[1] ?? rat(0))]),
          ),
          q.text,
        ).toBeGreaterThanOrEqual(5);
    });
  });

  it('fractions use the level’s denominators, proper until hard', () => {
    const maxDen = { warmup: 10, standard: 12, hard: 16 };
    const conversions = {
      warmup: [2, 4, 5, 8, 20],
      standard: [8, 16, 20, 25, 40],
      hard: [16, 32, 40, 80, 125],
    };
    each((q, c, l) => {
      if (c !== 'fractions') return;
      if (q.kind === 'frac-to-dec' || q.kind === 'dec-to-frac') {
        expect(conversions[l]).toContain(Number(q.answer.den));
        expect(toNumber(q.answer)).toBeLessThan(1);
        return;
      }
      for (const o of q.operands) {
        expect(Number(o.den), q.text).toBeLessThanOrEqual(maxDen[l]);
        expect(o.den, q.text).toBeGreaterThan(1n);
        expect(toNumber(o)).toBeLessThan(l === 'hard' ? 2 : 1);
        expect(toNumber(o)).toBeGreaterThan(0);
      }
    });
  });

  it('percentages stay in range and come out exact', () => {
    const pMax = { warmup: 100, standard: 95, hard: 99.5 };
    const valueMax = { warmup: 800, standard: 1000, hard: 10_000 };
    each((q, c, l) => {
      if (c !== 'percentages') return;
      const [first, second] = q.operands as [Rational, Rational];
      const p = q.kind === 'pct-rise' || q.kind === 'pct-fall' ? q.answer : first;
      expect(toNumber(p), q.text).toBeGreaterThan(0);
      expect(toNumber(p), q.text).toBeLessThanOrEqual(pMax[l]);
      const value = q.kind === 'pct-of' ? second : q.kind.startsWith('pct-before') ? second : first;
      expect(toNumber(value), q.text).toBeLessThanOrEqual(valueMax[l]);
      // Warm-up and standard answers are whole or one place; hard at most two.
      expect(places(q.answer), q.text).toBeLessThanOrEqual(l === 'hard' ? 2 : 1);
      if (l === 'warmup') expect(places(q.answer), q.text).toBe(0);
    });
  });

  it('no question is degenerate', () => {
    each((q) => {
      for (const o of q.operands) expect(o.num, q.text).not.toBe(0n);
      const [a, b] = q.operands as [Rational, Rational];
      switch (q.kind) {
        case 'add':
        case 'sub':
        case 'frac-add':
        case 'frac-sub':
        case 'frac-div':
          expect(ratEq(a, b), q.text).toBe(false);
          break;
        case 'mul':
        case 'frac-mul':
        case 'est-mul':
          expect(ratEq(a, rat(1)) || ratEq(b, rat(1)), q.text).toBe(false);
          break;
        case 'div':
        case 'est-div':
          expect(ratEq(b, rat(1)), q.text).toBe(false);
          expect(ratEq(q.answer, rat(1)), q.text).toBe(false);
          break;
        case 'pct-of':
          expect(toNumber(a), q.text).toBeLessThan(100);
          break;
        case 'pct-rise':
        case 'pct-fall':
          expect(ratEq(a, b), q.text).toBe(false);
          break;
      }
      if (q.kind === 'frac-add' || q.kind === 'frac-sub') expect(q.answer.den).toBeGreaterThan(1n);
      if (q.kind === 'frac-sub' || q.kind === 'sub') {
        if (q.category === 'fractions') expect(toNumber(q.answer)).toBeGreaterThan(0);
        expect(q.answer.num).not.toBe(0n);
      }
    });
  });

  it('the keyboard offers what the answer needs', () => {
    each((q) => {
      if (q.answer.num < 0n) expect(q.inputMode, q.text).toBe('text');
      // (An estimate is typed as a decimal whatever its exact value.)
      if (q.form === 'fraction' || (q.tolerance === null && decimalPlaces(q.answer) === null))
        expect(q.inputMode, q.text).toBe('text');
      if (q.inputMode === 'decimal') {
        expect(q.answer.num, q.text).toBeGreaterThan(0n);
        expect(q.answerText, q.text).toMatch(/^[\d.]+%?$/);
      }
    });
  });

  it('estimates are marked as such, with a tolerance that tightens with the level', () => {
    expect(ESTIMATE_TOLERANCE).toEqual({ warmup: 0.1, standard: 0.05, hard: 0.03 });
    each((q, c, l) => {
      if (c !== 'estimation') {
        expect(q.tolerance).toBeNull();
        return;
      }
      expect(q.tolerance).toBe(ESTIMATE_TOLERANCE[l]);
      expect(q.ask).toBe(`Estimate, within ${ESTIMATE_TOLERANCE[l] * 100}%`);
    });
  });

  it('difficulty rises across the levels', () => {
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
    for (const c of ['add-subtract', 'multiply', 'divide', 'estimation'] as const) {
      const size = DRILL_LEVELS.map((l) =>
        median(
          (ALL[`${c}/${l}`] ?? []).map(
            (q) => Math.max(...q.operands.map(abs)) * 10 ** Math.min(4, places(q.answer)),
          ),
        ),
      );
      expect(size[0], c).toBeLessThan(size[1] ?? 0);
      expect(size[1], c).toBeLessThan(size[2] ?? 0);
    }
    // Fractions: bigger denominators; percentages: more decimal places in the answers.
    const meanDen = DRILL_LEVELS.map((l) => {
      const qs = ALL[`fractions/${l}`] ?? [];
      return qs.reduce((s, q) => s + Number(q.answer.den), 0) / qs.length;
    });
    expect(meanDen[0]).toBeLessThan(meanDen[1] ?? 0);
    expect(meanDen[1]).toBeLessThan(meanDen[2] ?? 0);
    const pctPlaces = DRILL_LEVELS.map((l) => {
      const qs = ALL[`percentages/${l}`] ?? [];
      return (
        qs.reduce((s, q) => s + places(q.answer) + Math.log10(abs(q.operands[1] ?? rat(1))), 0) /
        qs.length
      );
    });
    expect(pctPlaces[0]).toBeLessThan(pctPlaces[1] ?? 0);
    expect(pctPlaces[1]).toBeLessThan(pctPlaces[2] ?? 0);
  });

  it('covers every kind of question in its category', () => {
    const kinds = (c: DrillCategory) =>
      new Set(DRILL_LEVELS.flatMap((l) => (ALL[`${c}/${l}`] ?? []).map((q) => q.kind)));
    expect([...kinds('add-subtract')].sort()).toEqual(['add', 'sub']);
    expect([...kinds('fractions')].sort()).toEqual([
      'dec-to-frac',
      'frac-add',
      'frac-div',
      'frac-mul',
      'frac-sub',
      'frac-to-dec',
    ]);
    expect([...kinds('percentages')].sort()).toEqual([
      'pct-before-fall',
      'pct-before-rise',
      'pct-fall',
      'pct-of',
      'pct-rise',
    ]);
    expect([...kinds('estimation')].sort()).toEqual(['est-div', 'est-mul']);
    // Negatives only above warm-up; decimals in division only above warm-up.
    expect((ALL['add-subtract/warmup'] ?? []).some((q) => q.answer.num < 0n)).toBe(false);
    expect((ALL['add-subtract/standard'] ?? []).some((q) => q.answer.num < 0n)).toBe(true);
    expect((ALL['add-subtract/hard'] ?? []).some((q) => (q.operands[0]?.num ?? 0n) < 0n)).toBe(
      true,
    );
    expect((ALL['divide/hard'] ?? []).some((q) => (q.operands[1]?.den ?? 1n) > 1n)).toBe(true);
    expect((ALL['divide/hard'] ?? []).some((q) => q.answer.den > 1n)).toBe(true);
  });
});

describe('a run’s sequence', () => {
  const key = (q: DrillQuestion) => `${q.category}|${q.text}|${q.answerText}`;

  it('is the same for the same seed and setup, and differs for another seed', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const a = new DrillDeck(seed, 'standard', DRILL_CATEGORIES);
      const b = new DrillDeck(seed, 'standard', [...DRILL_CATEGORIES].reverse());
      const c = new DrillDeck(seed + 1, 'standard', DRILL_CATEGORIES);
      const xs = Array.from({ length: 60 }, (_, i) => key(a.at(i)));
      // Asked for out of order, or twice: still the same questions.
      expect(key(b.at(59))).toBe(xs[59]);
      expect(Array.from({ length: 60 }, (_, i) => key(b.at(i)))).toEqual(xs);
      expect(key(a.at(3))).toBe(xs[3]);
      expect(Array.from({ length: 60 }, (_, i) => key(c.at(i)))).not.toEqual(xs);
    }
  });

  it('does not ask a category more than twice in a row, nor the same question twice', () => {
    for (const seed of SEEDS) {
      for (const cats of [
        DRILL_CATEGORIES,
        ['multiply', 'divide'],
        ['fractions', 'estimation', 'add-subtract'],
      ] as const) {
        const deck = new DrillDeck(seed, 'hard', cats);
        const seen = new Set<string>();
        let streak = 0;
        for (let i = 0; i < 300; i++) {
          const q = deck.at(i);
          expect(cats).toContain(q.category);
          streak = i > 0 && deck.at(i - 1).category === q.category ? streak + 1 : 1;
          expect(streak).toBeLessThanOrEqual(MAX_CATEGORY_STREAK);
          expect(seen.has(q.key), q.text).toBe(false);
          seen.add(q.key);
        }
      }
    }
  });

  it('with one small category, avoids recent repeats once new questions run out', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const deck = new DrillDeck(seed, 'warmup', ['multiply']);
      const keys = Array.from({ length: 400 }, (_, i) => deck.at(i).key);
      expect(new Set(keys.slice(0, 40)).size).toBe(40);
      for (let i = 0; i < keys.length; i++)
        expect(keys.slice(Math.max(0, i - 20), i)).not.toContain(keys[i]);
    }
  });

  it('every category comes up in a full mix', () => {
    const deck = new DrillDeck(1, 'standard', DRILL_CATEGORIES);
    const cats = new Set(Array.from({ length: 60 }, (_, i) => deck.at(i).category));
    expect(cats.size).toBe(DRILL_CATEGORIES.length);
    expect(() => new DrillDeck(1, 'standard', [])).toThrow();
  });
});

// ---------------------------------------------------------------- marking

/** The first question of a kind, from a deck of one category. */
function find(category: DrillCategory, level: DrillLevel, ok: (q: DrillQuestion) => boolean) {
  const q = (ALL[`${category}/${level}`] ?? []).find(ok);
  if (!q) throw new Error(`no ${category} question matches`);
  return q;
}

describe('marking', () => {
  it('right, wrong, empty and not a number', () => {
    const q = find('multiply', 'standard', (x) => x.answer.den === 1n && x.answer.num > 100n);
    expect(markAnswer(q, q.answerText)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, `  ${q.answerText} `)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, String(q.answer.num + 1n))).toEqual({ outcome: 'wrong' });
    expect(markAnswer(q, '')).toEqual({ outcome: 'empty' });
    expect(markAnswer(q, '   ')).toEqual({ outcome: 'empty' });
    for (const t of ['abc', '12a', '1/0', '--3', '3..2', '1 2'])
      expect(markAnswer(q, t)).toEqual({ outcome: 'invalid', note: NOT_A_NUMBER });
    // Thousands separators and a written-out form are read as the same number.
    const big = find('multiply', 'hard', (x) => x.answer.num >= 1000n && x.answer.den === 1n);
    expect(markAnswer(big, big.answer.num.toLocaleString('en-US'))).toEqual({ outcome: 'right' });
    expect(markAnswer(big, `${big.answer.num}.0`)).toEqual({ outcome: 'right' });
  });

  it('an exact decimal answer must be exact, not within half a percent', () => {
    const q = find('multiply', 'hard', (x) => x.answer.den > 1n && toNumber(x.answer) > 10);
    const off = decimalText(add(q.answer, rat(1, 100)));
    expect(markAnswer(q, off)).toEqual({ outcome: 'wrong' });
  });

  it('a negative answer, with either minus sign', () => {
    const q = find('add-subtract', 'standard', (x) => x.answer.num < 0n);
    expect(markAnswer(q, q.answerText)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, q.answerText.replace('-', '−'))).toEqual({ outcome: 'right' });
    expect(markAnswer(q, q.answerText.replace('-', ''))).toEqual({ outcome: 'wrong' });
  });

  it('a fraction answer in any exact form', () => {
    const q = find(
      'fractions',
      'standard',
      (x) => x.kind === 'frac-mul' && decimalPlaces(x.answer) !== null && x.answer.den > 1n,
    );
    const { num, den } = q.answer;
    expect(markAnswer(q, `${num}/${den}`)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, `${num * 2n}/${den * 2n}`)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, decimalText(q.answer))).toEqual({ outcome: 'right' });
    expect(markAnswer(q, `${num} / ${den}`)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, `${num + 1n}/${den}`)).toEqual({ outcome: 'wrong' });
    // One with no exact decimal: a rounding is not the answer.
    const third = find(
      'fractions',
      'standard',
      (x) => x.form === 'any' && decimalPlaces(x.answer) === null,
    );
    expect(markAnswer(third, fractionLike(third))).toEqual({ outcome: 'right' });
    expect(markAnswer(third, toNumber(third.answer).toFixed(3))).toEqual({ outcome: 'wrong' });
  });

  it('a conversion asks for the other form', () => {
    const toFrac = find('fractions', 'standard', (x) => x.kind === 'dec-to-frac');
    expect(markAnswer(toFrac, fractionLike(toFrac))).toEqual({ outcome: 'right' });
    expect(markAnswer(toFrac, `${toFrac.answer.num * 3n}/${toFrac.answer.den * 3n}`)).toEqual({
      outcome: 'right',
    });
    expect(markAnswer(toFrac, decimalText(toFrac.answer))).toEqual({
      outcome: 'invalid',
      note: 'As a fraction, like 3/8',
    });
    const toDec = find('fractions', 'standard', (x) => x.kind === 'frac-to-dec');
    expect(markAnswer(toDec, decimalText(toDec.answer))).toEqual({ outcome: 'right' });
    expect(markAnswer(toDec, fractionLike(toDec))).toEqual({
      outcome: 'invalid',
      note: 'As a decimal, like 0.375',
    });
  });

  it('a percentage answer is the figure, with or without the % sign', () => {
    const q = find('percentages', 'hard', (x) => x.form === 'percent' && x.answer.den === 2n);
    const figure = decimalText(q.answer); // e.g. 12.5
    expect(markAnswer(q, figure)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, `${figure}%`)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, `${figure} %`)).toEqual({ outcome: 'right' });
    expect(markAnswer(q, `${q.answer.num}/2`)).toEqual({ outcome: 'right' });
    // The fraction of a whole is not the figure asked for.
    expect(markAnswer(q, decimalText(div(q.answer, rat(100))))).toEqual({ outcome: 'wrong' });
    expect(markAnswer(q, '%')).toEqual({ outcome: 'invalid', note: NOT_A_NUMBER });
    // A number answer refuses a % sign rather than reading 30% as 0.3.
    const of = find('percentages', 'standard', (x) => x.kind === 'pct-of');
    expect(markAnswer(of, `${of.answerText}%`)).toEqual({
      outcome: 'invalid',
      note: 'A number, not a percentage',
    });
    expect(markAnswer(of, of.answerText)).toEqual({ outcome: 'right' });
  });

  it('an estimate within its tolerance is right, outside it wrong', () => {
    for (const level of DRILL_LEVELS) {
      const tol = ESTIMATE_TOLERANCE[level];
      for (const q of (ALL[`estimation/${level}`] ?? []).slice(0, 200)) {
        const x = toNumber(q.answer);
        expect(markAnswer(q, (x * (1 + tol * 0.9)).toFixed(4))).toEqual({ outcome: 'right' });
        expect(markAnswer(q, (x * (1 - tol * 0.9)).toFixed(4))).toEqual({ outcome: 'right' });
        expect(markAnswer(q, (x * (1 + tol * 1.1)).toFixed(4))).toEqual({ outcome: 'wrong' });
        expect(markAnswer(q, (x * (1 - tol * 1.1)).toFixed(4))).toEqual({ outcome: 'wrong' });
      }
    }
  });

  it('shows answers in the review as they are best read', () => {
    const third = find(
      'fractions',
      'standard',
      (x) => x.form === 'any' && decimalPlaces(x.answer) === null,
    );
    expect(answerDisplay(third)).toBe(`${third.answer.num}/${third.answer.den}`);
    const quarter = find(
      'fractions',
      'standard',
      (x) => x.kind === 'frac-mul' && decimalPlaces(x.answer) !== null && x.answer.den > 1n,
    );
    expect(answerDisplay(quarter)).toBe(
      `${quarter.answer.num}/${quarter.answer.den} = ${decimalText(quarter.answer)}`,
    );
    const p = find('percentages', 'hard', (x) => x.form === 'percent');
    expect(answerDisplay(p)).toBe(`${displayNumber(p.answer)}%`);
    const e = find('estimation', 'standard', () => true);
    expect(answerDisplay(e)).toMatch(/^≈ [\d,.]+$/);
    const [lo, hi] = estimateRange(e) ?? ['', ''];
    expect(readDisplayed(lo)).toEqual(roundSig(mul(e.answer, rat(95, 100)), 3));
    expect(readDisplayed(hi)).toEqual(roundSig(mul(e.answer, rat(105, 100)), 3));
    expect(estimateRange(third)).toBeNull();
  });

  it('writes out a question with its answer', () => {
    const m = { ...find('multiply', 'warmup', () => true), text: '6 × 7', answer: rat(42) };
    expect(worked(m)).toBe('6 × 7 = 42');
    const e = find('estimation', 'warmup', () => true);
    expect(worked(e)).toBe(`${e.text} ${answerDisplay(e)}`);
  });

  it('says questions in words for a screen reader', () => {
    const q = {
      ...find('fractions', 'standard', (x) => x.kind === 'frac-sub'),
      text: '3/4 − 1/6',
      ask: null,
    };
    expect(spokenQuestion(q)).toBe('3 over 4 minus 1 over 6');
    const e = { ...q, text: '9,340 ÷ 31', ask: 'Estimate, within 5%' };
    expect(spokenQuestion(e)).toBe('Estimate, within 5%: 9,340 divided by 31');
    expect(spokenQuestion({ ...q, text: '−37 + 85' })).toBe('minus 37 plus 85');
  });
});

function fractionLike(q: DrillQuestion) {
  return `${q.answer.num}/${q.answer.den}`;
}

// ---------------------------------------------------------------- the run

const CONFIG: DrillConfig = {
  durationSec: 60,
  level: 'standard',
  categories: [...DRILL_CATEGORIES],
};

function started(seed = 5, t0 = 1000): RunState {
  const s = initRun(new DrillDeck(seed, CONFIG.level, CONFIG.categories), 60, t0);
  return runReducer(s, { type: 'tick', now: t0 + COUNTDOWN_MS });
}
const type = (s: RunState, text: string) => runReducer(s, { type: 'edit', text });
const enter = (s: RunState, now: number) => runReducer(s, { type: 'submit', now });
const wrongFor = (q: DrillQuestion) =>
  q.tolerance !== null
    ? decimalText(roundSig(mul(q.answer, rat(2)), 3))
    : decimalPlaces(q.answer) === null
      ? `${q.answer.num + 1n}/${q.answer.den}`
      : `${decimalText(add(q.answer, rat(1)))}${q.form === 'percent' ? '%' : ''}`;

describe('the run', () => {
  it('counts down 3, 2, 1, ignoring typing and Enter, then starts the clock', () => {
    let s = initRun(new DrillDeck(5, 'standard', DRILL_CATEGORIES), 60, 1000);
    expect(s.phase).toBe('countdown');
    expect(countdownDigit(s)).toBe(3);
    s = runReducer(s, { type: 'tick', now: 2100 });
    expect(countdownDigit(s)).toBe(2);
    s = type(s, '12');
    expect(s.draft).toBe('');
    s = enter(s, 3100);
    expect(s.phase).toBe('countdown');
    expect(countdownDigit(s, 3500)).toBe(1);
    expect(clockSeconds(s)).toBe(60);
    // The first tick after three seconds starts it, at that tick's time.
    s = runReducer(s, { type: 'tick', now: 4250 });
    expect(s.phase).toBe('running');
    expect(s.startedAt).toBe(4250);
    expect(remainingMs(s, 4250 + 10_500)).toBe(49_500);
    expect(clockSeconds(s, 4250 + 10_500)).toBe(50);
  });

  it('a tick that changes nothing on screen changes nothing', () => {
    const s = started();
    expect(runReducer(s, { type: 'tick', now: 4000 + 300 })).toBe(s);
    expect(runReducer(s, { type: 'tick', now: 4000 + 1200 })).not.toBe(s);
  });

  it('marks answers, keeps text that is not a number, and skips', () => {
    let s = started();
    const q0 = currentQuestion(s);
    s = enter(s, 5000);
    expect(s.index).toBe(0); // empty Enter does nothing
    s = enter(type(s, 'twelve'), 5100);
    expect(s.index).toBe(0);
    expect(s.draft).toBe('twelve');
    expect(s.invalid).toEqual({ note: NOT_A_NUMBER, count: 1 });
    s = enter(s, 5200);
    expect(s.invalid?.count).toBe(2);
    s = type(s, q0.answerText);
    expect(s.invalid).toBeNull();
    s = enter(s, 6000);
    expect(s.index).toBe(1);
    expect(s.draft).toBe('');
    expect(s.answers[0]).toMatchObject({ outcome: 'right', typed: q0.answerText, ms: 2000 });
    const q1 = currentQuestion(s);
    s = enter(type(s, wrongFor(q1)), 7500);
    expect(s.answers[1]).toMatchObject({ outcome: 'wrong', ms: 1500 });
    s = runReducer(type(s, '4'), { type: 'skip', now: 8000 });
    expect(s.answers[2]).toMatchObject({ outcome: 'skipped', typed: null, ms: 500 });
    expect(s.index).toBe(3);
    expect(s.draft).toBe('');
  });

  it('ends when the clock runs out; an answer sent after it is not counted', () => {
    let s = started(5, 0); // starts at 3000, ends at 63000
    s = enter(type(s, currentQuestion(s).answerText), 10_000);
    expect(s.answers).toHaveLength(1);
    s = type(s, currentQuestion(s).answerText);
    s = enter(s, 63_000);
    expect(s.phase).toBe('over');
    expect(s.endedBy).toBe('time');
    expect(s.elapsedMs).toBe(60_000);
    expect(s.answers).toHaveLength(1);
    // Nothing changes it afterwards.
    expect(runReducer(s, { type: 'skip', now: 64_000 })).toBe(s);
  });

  it('a late tick (a background tab) ends the run at its length, not later', () => {
    let s = started(5, 0);
    s = runReducer(s, { type: 'tick', now: 3000 + 10 * 60_000 });
    expect(s.phase).toBe('over');
    expect(s.elapsedMs).toBe(60_000);
    expect(remainingMs(s)).toBe(0);
  });

  it('stopping early ends it with the time played', () => {
    let s = started(5, 0);
    s = enter(type(s, currentQuestion(s).answerText), 8000);
    s = runReducer(s, { type: 'stop', now: 3000 + 21_337.6 });
    expect(s).toMatchObject({ phase: 'over', endedBy: 'stop', elapsedMs: 21_338 });
    expect(s.answers).toHaveLength(1);
    // Stopping in the countdown ends it with nothing played.
    const c = runReducer(initRun(new DrillDeck(5, 'warmup', ['multiply']), 60, 0), {
      type: 'stop',
      now: 500,
    });
    expect(c).toMatchObject({ phase: 'over', endedBy: 'stop', elapsedMs: 0, answers: [] });
    expect(worthRecording(c.answers)).toBe(false);
  });
});

// ---------------------------------------------------------------- results

function play(outcomes: ('right' | 'wrong' | 'skipped')[], msEach = 2000) {
  let s = started(11, 0);
  let t = 3000;
  for (const o of outcomes) {
    t += msEach;
    const q = currentQuestion(s);
    if (o === 'skipped') s = runReducer(s, { type: 'skip', now: t });
    else s = enter(type(s, o === 'right' ? q.answerText : wrongFor(q)), t);
  }
  return s;
}

describe('results', () => {
  it('add up per category, in setup order, with accuracy, pace and the slowest category', () => {
    const s = play(['right', 'right', 'wrong', 'skipped', 'right', 'wrong', 'right', 'right']);
    const sum = summarize(s.answers, 30_000);
    expect(sum).toMatchObject({ correct: 5, wrong: 2, skipped: 1, score: 3 });
    expect(sum.accuracy).toBeCloseTo(5 / 7);
    expect(sum.perMinute).toBeCloseTo(14);
    const order = sum.byCategory.map((c) => DRILL_CATEGORIES.indexOf(c.category));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(sum.byCategory.reduce((n, c) => n + c.total, 0)).toBe(8);
    expect(sum.review.map((a) => a.outcome)).toEqual(['wrong', 'skipped', 'wrong']);
    // Equal times: the first category is the slowest; with one slower, that one.
    const slow = s.answers.map((a, i) => (i === 5 ? { ...a, ms: 9000 } : a));
    expect(summarize(slow, 30_000).slowest).toBe(s.answers[5]?.question.category);
  });

  it('nothing answered: no accuracy, no pace, no slowest', () => {
    const sum = summarize([], 500);
    expect(sum).toMatchObject({
      correct: 0,
      wrong: 0,
      skipped: 0,
      score: 0,
      accuracy: null,
      perMinute: null,
      slowest: null,
    });
    const one = play(['skipped']);
    expect(summarize(one.answers, 5000)).toMatchObject({
      accuracy: null,
      perMinute: 0,
      slowest: null,
    });
  });

  it('build a request the contract accepts', () => {
    const s = play(['right', 'wrong', 'skipped', 'right', 'right']);
    const body = recordRequest(CONFIG, s.answers, 12_345.4);
    expect(RecordDrillRunRequest.safeParse(body).success).toBe(true);
    expect(body.elapsedMs).toBe(12_345);
    expect(body.config).toEqual(CONFIG);
    const totals = body.byCategory.reduce(
      (t, c) => ({
        correct: t.correct + c.correct,
        wrong: t.wrong + c.wrong,
        skipped: t.skipped + c.skipped,
      }),
      { correct: 0, wrong: 0, skipped: 0 },
    );
    expect(totals).toEqual({ correct: 3, wrong: 1, skipped: 1 });
    expect(Object.keys(body.byCategory[0] ?? {}).sort()).toEqual([
      'category',
      'correct',
      'skipped',
      'wrong',
    ]);
    expect(worthRecording(s.answers)).toBe(true);
  });
});

// ---------------------------------------------------------------- setup and history

describe('setup', () => {
  it('reads a remembered setup defensively', () => {
    expect(parseSetup(null)).toEqual(DEFAULT_CONFIG);
    expect(parseSetup('junk')).toEqual(DEFAULT_CONFIG);
    expect(parseSetup({ durationSec: 90, level: 'hard', categories: ['multiply'] })).toEqual(
      DEFAULT_CONFIG,
    );
    expect(parseSetup({ durationSec: 60, level: 'hard', categories: [] })).toEqual(DEFAULT_CONFIG);
    expect(
      parseSetup({ durationSec: 300, level: 'warmup', categories: ['divide', 'multiply'] }),
    ).toEqual({
      durationSec: 300,
      level: 'warmup',
      categories: ['multiply', 'divide'],
    });
    expect(DEFAULT_CONFIG).toEqual({
      durationSec: 120,
      level: 'standard',
      categories: [...DRILL_CATEGORIES],
    });
  });

  it('keeps at least one category on, in setup order', () => {
    let c = toggleCategory(DEFAULT_CONFIG, 'multiply', false);
    expect(c.categories).not.toContain('multiply');
    c = toggleCategory(c, 'multiply', true);
    expect(c.categories).toEqual([...DRILL_CATEGORIES]);
    const one = { ...DEFAULT_CONFIG, categories: ['divide' as const] };
    expect(toggleCategory(one, 'divide', false)).toBe(one);
  });

  it('labels a setup, a pace and a time', () => {
    expect(setupLabel(DEFAULT_CONFIG)).toBe('2 min · Standard · All categories');
    expect(setupLabel({ durationSec: 60, level: 'hard', categories: ['fractions'] })).toBe(
      '1 min · Hard · Fractions',
    );
    expect(
      setupLabel({
        durationSec: 300,
        level: 'warmup',
        categories: ['multiply', 'divide', 'fractions'],
      }),
    ).toBe('5 min · Warm-up · 3 categories');
    expect(formatPace(7.25)).toBe('7.3');
    expect(formatPace(14.6)).toBe('15');
    expect(formatSeconds(2440)).toBe('2.4 s');
  });

  it('finds the best for a duration and level, and a run’s accuracy', () => {
    const bests = [
      {
        durationSec: 60 as const,
        level: 'hard' as const,
        score: 12,
        finishedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        durationSec: 120 as const,
        level: 'standard' as const,
        score: 31,
        finishedAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    expect(bestFor(bests, 120, 'standard')?.score).toBe(31);
    expect(bestFor(bests, 120, 'hard')).toBeNull();
    expect(runAccuracy({ correct: 3, wrong: 1 })).toBe(0.75);
    expect(runAccuracy({ correct: 0, wrong: 0 })).toBeNull();
  });
});
