/**
 * An interviewer message of a quant round as words a speech synthesiser can say. The prompt asks
 * the model to say mathematics in words on voice, but that is a request, not a guarantee, and a
 * synthesiser reading `$\frac{5}{36}$` or `\$10` aloud is useless. This is the backstop, applied
 * where the text is handed to speech (`spokenText`); the chat keeps showing the original.
 *
 * - `$…$` and `$$…$$` (the spans the chat typesets, `splitMath`) are read as words: fractions,
 *   binomials, roots, powers, subscripts, sums and products, Greek letters, the usual operators
 *   and relations, factorials, percent, and expectation, probability, variance and covariance
 *   notation ("the probability that X is greater than 3"). A command it does not know is dropped
 *   and its arguments are read as they are, and any other symbol becomes a pause, so nothing is
 *   ever spelled out symbol by symbol.
 * - Outside math: `\$10` (or a bare `$10`) is "10 dollars", Markdown escapes, emphasis, headings,
 *   bullets, links and inline code lose their markup, and a code block is pointed to.
 * - Text with none of that (no `$`, backslash, backtick or Markdown markup) is returned exactly as
 *   it is, so a message the model already wrote for speech is untouched.
 */
import { splitMath } from '@/components/math-guard';

/** A character that could make a message more than plain words. */
const MARKUP = /[$\\`*_#[\]>~]/;

export function speechOf(text: string): string {
  if (!MARKUP.test(text)) return text;
  const out = splitMath(text).map((s) => {
    if (s.kind === 'math') return ` ${readMath(stripDollars(s.text))} `;
    if (s.kind === 'code')
      return s.text.startsWith('```')
        ? ' (see the code in the chat) '
        : s.text.replace(/^`+|`+$/g, '');
    return plainText(s.text);
  });
  return tidy(out.join(''));
}

const stripDollars = (raw: string) => raw.replace(/^\$\$?|\$\$?$/g, '');

/** Prose around the math: dollars said as dollars, and the Markdown markup dropped. */
function plainText(s: string): string {
  return (
    s
      // \$10, $10, \$1.5 million: the amount, then the currency.
      .replace(
        /\\?\$\s?(\d[\d,]*(?:\.\d+)?)(\s?(?:thousand|million|billion|trillion|bn|k|m)\b)?/gi,
        (_m, n: string, scale = '') => `${n}${scale} dollars`,
      )
      .replace(/\\\$/g, 'dollars')
      // A formula left open at the end, and LaTeX written without dollars, are math all the same.
      .replace(/(?<!\\)\$\$?(?=\S)(?=[^$]*[\\^_{])([^$]*)$/, (_m, f: string) => ` ${readMath(f)} `)
      .replace(/\\[A-Za-z]+(?:\{[^{}]*\})*/g, (f) => ` ${readMath(f)} `)
      // Markdown escapes (`\*`, `\_`) stand for the character itself.
      .replace(/\\([!-/:-@[-`{-~])/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?![\w*])/g, '$1$2')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
      .replace(/[*_~#`{}^\\]+/g, ' ')
  );
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(\d), (\d{3})(?!\d)/g, '$1,$2')
    .replace(/,(\s*,)+/g, ',')
    .trim();
}

// ---------------------------------------------------------------- LaTeX as words

const GREEK = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'rho',
  'sigma',
  'tau',
  'upsilon',
  'phi',
  'chi',
  'psi',
  'omega',
]);
const UPPER_GREEK = new Set([
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
]);

/** Commands that are a word or a phrase on their own. */
const WORDS: Record<string, string> = {
  times: 'times',
  cdot: 'times',
  ast: 'times',
  div: 'divided by',
  pm: 'plus or minus',
  mp: 'minus or plus',
  le: 'is at most',
  leq: 'is at most',
  leqslant: 'is at most',
  ge: 'is at least',
  geq: 'is at least',
  geqslant: 'is at least',
  ll: 'is much less than',
  gg: 'is much greater than',
  ne: 'is not equal to',
  neq: 'is not equal to',
  approx: 'is approximately',
  simeq: 'is approximately',
  approxeq: 'is approximately',
  doteq: 'is approximately',
  cong: 'is approximately',
  sim: 'is distributed as',
  equiv: 'is equivalent to',
  propto: 'is proportional to',
  to: 'goes to',
  rightarrow: 'goes to',
  longrightarrow: 'goes to',
  mapsto: 'maps to',
  Rightarrow: 'implies',
  implies: 'implies',
  iff: 'if and only if',
  Leftrightarrow: 'if and only if',
  infty: 'infinity',
  in: 'in',
  notin: 'not in',
  subset: 'is a subset of',
  subseteq: 'is a subset of',
  cup: 'union',
  cap: 'intersect',
  setminus: 'minus',
  emptyset: 'the empty set',
  varnothing: 'the empty set',
  forall: 'for all',
  exists: 'there is',
  neg: 'not',
  lnot: 'not',
  land: 'and',
  wedge: 'and',
  lor: 'or',
  vee: 'or',
  mid: 'given',
  vert: 'given',
  partial: 'partial',
  nabla: 'gradient',
  cdots: 'and so on',
  ldots: 'and so on',
  dots: 'and so on',
  dotsc: 'and so on',
  dotsb: 'and so on',
  vdots: 'and so on',
  prime: 'prime',
  circ: 'degrees',
  degree: 'degrees',
  choose: 'choose',
  log: 'log',
  ln: 'natural log',
  lg: 'log',
  sin: 'sine',
  cos: 'cosine',
  tan: 'tangent',
  max: 'max',
  min: 'min',
  arg: 'arg',
  argmax: 'arg max',
  argmin: 'arg min',
  sup: 'supremum',
  inf: 'infimum',
  det: 'determinant',
  gcd: 'g c d',
  mod: 'mod',
  bmod: 'mod',
  pmod: 'mod',
  '%': 'percent',
  $: 'dollars',
  '&': 'and',
  '#': 'number',
};

/** Commands that only typeset: nothing to say (after `\left` / `\right` a `.` is no bracket). */
const SIZES = /^(?:left|right|middle|[bB]igg?[lr]?)$/;

/** Notation applied to an argument in brackets: `E[X]`, `\mathbb{P}(A)`, `\operatorname{Var}(X)`. */
const FUNCTIONS: Record<string, (inner: string) => string> = {
  E: (x) => `the expected value of ${x}`,
  P: (x) => (RELATION.test(x) ? `the probability that ${x}` : `the probability of ${x}`),
  Pr: (x) => (RELATION.test(x) ? `the probability that ${x}` : `the probability of ${x}`),
  Var: (x) => `the variance of ${x}`,
  var: (x) => `the variance of ${x}`,
  Cov: (x) => `the covariance of ${and(x)}`,
  cov: (x) => `the covariance of ${and(x)}`,
  Corr: (x) => `the correlation of ${and(x)}`,
  corr: (x) => `the correlation of ${and(x)}`,
  SD: (x) => `the standard deviation of ${x}`,
  sd: (x) => `the standard deviation of ${x}`,
  exp: (x) => `e to the power of ${x}`,
};
/** Words that make `P(…)` read "the probability that …". */
const RELATION =
  /\b(equals|is (?:at|less|greater|not|approximately|much|distributed|equivalent|proportional|a subset)|in|not in)\b/;
const and = (x: string) => x.replace(/\s*,\s*/, ' and ');

/** Multi-letter runs in math that are one word (otherwise `np` is "n p"). */
const NAMES = new Set([
  ...Object.keys(FUNCTIONS),
  'log',
  'ln',
  'max',
  'min',
  'exp',
  'sin',
  'cos',
  'tan',
]);

const CHARS: Record<string, string> = {
  '+': 'plus',
  '-': 'minus',
  '=': 'equals',
  '<': 'is less than',
  '>': 'is greater than',
  '!': 'factorial',
  '|': 'given',
  '/': 'over',
  '*': 'times',
  '%': 'percent',
  ',': ',',
  ';': ',',
  ':': ',',
  "'": 'prime',
  '.': '.',
};

interface Src {
  s: string;
  i: number;
}

/** A formula's source (without its dollars) as words. Exported for tests. */
export function readMath(src: string): string {
  // `\$5` in math is an amount too: the number, then the currency.
  const s = src.replace(/\\\$\s*(\d[\d,]*(?:\.\d+)?)/g, '$1\\text{ dollars}');
  return tidy(expr({ s, i: 0 }, ''));
}

const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);
const isDigit = (c: string | undefined) => !!c && /[0-9]/.test(c);

function skipSpace(p: Src) {
  while (p.i < p.s.length && /\s/.test(p.s[p.i] as string)) p.i++;
}

/** Words until `stop` (one of `}`, `)`, `]`, or '' for the end), which is consumed. */
function expr(p: Src, stop: string): string {
  const parts: string[] = [];
  while (p.i < p.s.length) {
    const c = p.s[p.i] as string;
    if (stop && c === stop) {
      p.i++;
      break;
    }
    if (c === '}' || c === ')' || c === ']') {
      // Unbalanced: say nothing for it.
      p.i++;
      continue;
    }
    const part = atom(p);
    if (part === null) continue;
    parts.push(postfix(p, part));
  }
  return parts.join(' ');
}

/** `^…`, `_…` and `!` after an atom. */
function postfix(p: Src, base: { words: string; raw: string; fn?: string }): string {
  let words = base.words;
  for (;;) {
    skipSpace(p);
    const c = p.s[p.i];
    if (c === '_') {
      p.i++;
      const sub = argument(p);
      // `\log_2` is a base; anything else is an index (`x_1` is "x 1").
      words = base.fn === 'log' ? `${words} base ${sub.words}` : `${words} ${sub.words}`;
    } else if (c === '^') {
      p.i++;
      words = `${words} ${power(argument(p))}`;
    } else if (c === '!') {
      p.i++;
      words = `${words} factorial`;
    } else if (c === "'") {
      p.i++;
      words = `${words} prime`;
    } else return words;
  }
}

function power(e: { words: string; raw: string }): string {
  const raw = e.raw.replace(/^\{|\}$/g, '').trim();
  if (raw === '2') return 'squared';
  if (raw === '3') return 'cubed';
  if (raw === '\\circ' || raw === '\\degree') return 'degrees';
  if (raw === '\\prime' || raw === "'") return 'prime';
  if (raw === 'T' || raw === '\\top') return 'transpose';
  return `to the power of ${e.words}`;
}

/** One argument: a group, a command with its own arguments, or a single character. */
function argument(p: Src): { words: string; raw: string } {
  skipSpace(p);
  const start = p.i;
  if (p.s[p.i] === '{') {
    p.i++;
    const words = expr(p, '}');
    return { words, raw: p.s.slice(start, p.i) };
  }
  const c = p.s[p.i];
  if (c === '\\') {
    const a = atom(p);
    return { words: a ? postfix(p, a) : '', raw: p.s.slice(start, p.i) };
  }
  p.i++;
  return { words: c === undefined ? '' : (CHARS[c] ?? c), raw: c ?? '' };
}

/** Raw text of a `{…}` argument (for `\text`), with nested braces kept. */
function rawGroup(p: Src): string {
  skipSpace(p);
  if (p.s[p.i] !== '{') {
    const c = p.s[p.i] ?? '';
    p.i++;
    return c;
  }
  let depth = 0;
  const start = p.i + 1;
  for (; p.i < p.s.length; p.i++) {
    const c = p.s[p.i];
    if (c === '\\') {
      p.i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      p.i++;
      return p.s.slice(start, p.i - 1);
    }
  }
  return p.s.slice(start);
}

/** A bracketed argument right after a function name, or null (and nothing consumed). */
function bracketed(p: Src): string | null {
  const save = p.i;
  skipSpace(p);
  // `\left(` and the like.
  const m = /^\\(?:left|big|Big|bigg|Bigg|bigl|Bigl)\b/.exec(p.s.slice(p.i));
  if (m) p.i += m[0].length;
  const open = p.s[p.i];
  if (open !== '(' && open !== '[') {
    p.i = save;
    return null;
  }
  p.i++;
  return expr(p, open === '(' ? ')' : ']');
}

/** A function name, applied to what follows in brackets when there is something. */
function applied(p: Src, name: string, fallback: string) {
  const fn = FUNCTIONS[name];
  if (fn) {
    const inner = bracketed(p);
    if (inner !== null) return { words: fn(inner.trim()), raw: name };
  }
  return { words: fallback, raw: name, fn: name };
}

function atom(p: Src): { words: string; raw: string; fn?: string } | null {
  const c = p.s[p.i] as string;
  if (/\s/.test(c)) {
    p.i++;
    return null;
  }
  if (isDigit(c) || (c === '.' && isDigit(p.s[p.i + 1]))) {
    const m = /^\d*\.?\d+(?:\{,\}\d{3})*/.exec(p.s.slice(p.i)) as RegExpExecArray;
    p.i += m[0].length;
    const n = m[0].replace(/\{,\}/g, ',');
    return { words: n, raw: n };
  }
  if (isLetter(c)) {
    const m = /^[A-Za-z]+/.exec(p.s.slice(p.i)) as RegExpExecArray;
    const run = m[0];
    // A known name (`Var`, `E`, `max`), else each letter is a variable of its own.
    if (NAMES.has(run)) {
      p.i += run.length;
      return applied(p, run, WORDS[run] ?? run);
    }
    p.i += 1;
    if (c === 'E' || c === 'P') return applied(p, c, c);
    return { words: c, raw: c };
  }
  if (c === '{') {
    p.i++;
    const words = expr(p, '}');
    return { words, raw: '{}' };
  }
  if (c === '(' || c === '[') {
    p.i++;
    const inner = expr(p, c === '(' ? ')' : ']');
    skipSpace(p);
    // `(a + b)^2`: the bracket is one quantity.
    const grouped = p.s[p.i] === '^' && /\s/.test(inner.trim());
    return { words: grouped ? `the quantity ${inner},` : inner, raw: c };
  }
  if (c === '\\') return command(p);
  p.i++;
  if (c === '&' || c === '~' || c === '#') return { words: ' ', raw: c };
  return { words: CHARS[c] ?? ' ', raw: c };
}

function command(p: Src): { words: string; raw: string; fn?: string } | null {
  const rest = p.s.slice(p.i + 1);
  const m = /^[A-Za-z]+/.exec(rest);
  if (!m) {
    // `\,` `\;` `\!` `\ ` `\\` `\{` `\}` `\|` `\%` `\$`
    const sym = rest[0] ?? '';
    p.i += 2;
    if (sym === '%' || sym === '$' || sym === '&' || sym === '#')
      return { words: WORDS[sym] as string, raw: sym };
    if (sym === '\\') return { words: ',', raw: sym };
    return null;
  }
  const name = m[0];
  p.i += 1 + name.length;
  if (name === 'begin' || name === 'end') {
    rawGroup(p);
    return null;
  }
  if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
    const a = argument(p);
    const b = argument(p);
    return { words: fraction(a.words, b.words), raw: name };
  }
  if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
    const a = argument(p);
    const b = argument(p);
    return { words: `${a.words} choose ${b.words}`, raw: name };
  }
  if (name === 'sqrt') {
    skipSpace(p);
    let index: string | null = null;
    if (p.s[p.i] === '[') {
      p.i++;
      index = expr(p, ']').trim();
    }
    const a = argument(p);
    const root =
      index === null || index === '2'
        ? 'the square root'
        : index === '3'
          ? 'the cube root'
          : `the ${index}th root`;
    return { words: `${root} of ${a.words}`, raw: name };
  }
  if (name === 'sum' || name === 'prod' || name === 'int' || name === 'lim') {
    let from = '';
    let to = '';
    for (;;) {
      skipSpace(p);
      if (/^\\(?:limits|nolimits)\b/.test(p.s.slice(p.i))) {
        p.i = p.s.indexOf('limits', p.i) + 'limits'.length;
        continue;
      }
      const c = p.s[p.i];
      if (c !== '_' && c !== '^') break;
      p.i++;
      const a = argument(p).words;
      if (c === '_') from = a;
      else to = a;
    }
    const what = BIG_OPERATORS[name] as string;
    if (name === 'lim') return { words: from ? `${what} as ${from} of` : `${what} of`, raw: name };
    const range = from && to ? ` from ${from} to ${to}` : from ? ` over ${from}` : '';
    return { words: `${what}${range} of`, raw: name };
  }
  if (/^(?:text|textrm|textit|textbf|textsf|texttt|mbox|textnormal)$/.test(name)) {
    const t = rawGroup(p).trim();
    return FUNCTIONS[t] ? applied(p, t, t) : { words: plainText(t), raw: name };
  }
  if (name === 'operatorname' || name === 'mathrm' || name === 'mathbb' || name === 'mathbf') {
    skipSpace(p);
    if (p.s[p.i] !== '{') return null;
    const inner = rawGroup(p).replace(/\s+/g, '');
    if (name === 'mathbb') {
      const sets: Record<string, string> = {
        R: 'the real numbers',
        N: 'the natural numbers',
        Z: 'the integers',
        Q: 'the rationals',
        '1': 'the indicator of',
      };
      if (sets[inner]) return { words: sets[inner] as string, raw: name };
    }
    if (FUNCTIONS[inner]) return applied(p, inner, inner);
    // A variable or a word in a roman font, or a formula in bold.
    return { words: /^[A-Za-z]+$/.test(inner) ? inner : readMath(inner), raw: name };
  }
  if (/^(?:bar|overline|hat|widehat|tilde|widetilde|vec|dot|ddot)$/.test(name)) {
    const a = argument(p);
    const mark = name.replace(/^(?:over|wide)/, '');
    return { words: mark === 'vec' ? `vector ${a.words}` : `${a.words} ${mark}`, raw: name };
  }
  if (GREEK.has(name)) return { words: name, raw: name };
  if (name.startsWith('var') && GREEK.has(name.slice(3)))
    return { words: name.slice(3), raw: name };
  if (UPPER_GREEK.has(name)) return { words: `capital ${name.toLowerCase()}`, raw: name };
  if (FUNCTIONS[name]) return applied(p, name, WORDS[name] ?? name);
  const word = WORDS[name];
  if (word) return { words: word, raw: name, fn: name };
  if (SIZES.test(name) && p.s[p.i] === '.') p.i++;
  // Typesetting only (sizes, spacing, styles), or a command this does not know: nothing to say
  // for it, and its arguments, if any, are read as they come.
  return null;
}

const BIG_OPERATORS: Record<string, string> = {
  sum: 'the sum',
  prod: 'the product',
  int: 'the integral',
  lim: 'the limit',
};

function fraction(a: string, b: string): string {
  const simple = (x: string) => !/\s/.test(x.trim());
  if (simple(a) && simple(b)) return `${a} over ${b}`;
  return `${a}, all over ${b},`;
}
