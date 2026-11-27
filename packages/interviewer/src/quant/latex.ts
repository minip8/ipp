/**
 * LaTeX inside structured output. A quant turn is a JSON object, and the model writes mathematics
 * as LaTeX in its `message` and `summary` strings. When it writes a single backslash where JSON
 * needs two, one of two things happens:
 *
 * - The pair is a valid JSON escape, so the string silently decodes to a control character:
 *   `\frac` → form feed + "rac", `\binom` / `\beta` → backspace + "inom" / "eta",
 *   `\times` / `\text` / `\theta` → tab + "imes", `\rho` / `\right` → carriage return + "ho",
 *   `\nu` / `\neq` → newline + "u".
 * - The pair is not a JSON escape (`\alpha`, `\sigma`, `\$`, `\underbrace`), so the JSON does not
 *   parse at all. Providers with constrained decoding never emit these; others may.
 *
 * `repairJsonEscapes` fixes the second case on the raw text (used only when it does not parse);
 * `repairLatexEscapes` fixes the first on the decoded strings. Both are pure.
 */

/**
 * Commands that start with `n`: a newline is a common real character, so only these count. Not
 * `\ne` or `\ni`: a real line of display math may well start with `e^x` or `i + j`.
 */
const N_COMMANDS = [
  'nu',
  'neq',
  'nabla',
  'neg',
  'not',
  'notin',
  'nmid',
  'nleq',
  'ngeq',
  'nless',
  'ngtr',
  'nsubseteq',
  'nsupseteq',
  'nexists',
  'newline',
  'nolimits',
  'nonumber',
  'natural',
  'nearrow',
  'nwarrow',
  'ncong',
  'nsim',
  'nparallel',
];
/** What follows the newline that `\n` became: the command's name without its `n`. */
const N_COMMAND = new RegExp(
  `^(?:${N_COMMANDS.map((c) => c.slice(1))
    .sort((a, b) => b.length - a.length)
    .join('|')})(?![A-Za-z])`,
);

/**
 * For each character, whether it is inside `$...$` or `$$...$$`. A `\$` (a literal dollar) neither
 * opens nor closes math. Outside math, an inline code span (a run of backticks up to the next run
 * of the same length, as in Markdown and the pad's `splitMath`) is code, not math: a `$HOME` or a
 * `\t` in it is left alone and does not open a formula. A run of backticks that never closes is
 * plain text.
 */
export function mathMask(s: string): boolean[] {
  const mask: boolean[] = new Array(s.length).fill(false);
  let inline = false;
  let display = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`' && !inline && !display) {
      let n = 0;
      while (s[i + n] === '`') n++;
      let close = -1;
      for (let j = i + n; j < s.length; ) {
        if (s[j] !== '`') {
          j++;
          continue;
        }
        let m = 0;
        while (s[j + m] === '`') m++;
        if (m === n) {
          close = j;
          break;
        }
        j += m;
      }
      i = (close >= 0 ? close + n : i + n) - 1;
      continue;
    }
    if (c === '\\' && s[i + 1] === '$') {
      mask[i] = mask[i + 1] = inline || display;
      i++;
      continue;
    }
    if (c === '$') {
      if (s[i + 1] === '$' && !inline) {
        display = !display;
        mask[i] = mask[i + 1] = true;
        i++;
      } else if (!display) {
        inline = !inline;
        mask[i] = true;
      }
      continue;
    }
    mask[i] = inline || display;
  }
  return mask;
}

/**
 * Turns control characters that are really LaTeX commands written with one backslash back into
 * the command. Exactly these, and nothing else:
 *
 * - a backspace (U+0008) anywhere becomes `\b`, and a form feed (U+000C) anywhere becomes `\f`:
 *   neither ever belongs in a chat message;
 * - inside math (`$...$`, `$$...$$`), a tab or a carriage return followed by a letter becomes `\t`
 *   or `\r` followed by that letter (`\times`, `\text`, `\theta`, `\rho`, `\right`);
 * - inside math, a newline followed by one of the `\n…` commands above, as a whole word, becomes
 *   `\n` (`\nu`, `\neq`, `\nabla`).
 *
 * So a real newline between sentences, a newline inside display math before an ordinary line, a
 * tab in a table, a Windows line ending and every character outside math other than the two that
 * are never legitimate are left exactly as they are.
 */
export function repairLatexEscapes(s: string): string {
  if (!/[\t\r\n]/.test(s) && !s.includes('\u0008') && !s.includes('\u000c')) return s;
  const inMath = mathMask(s);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === '\u0008') {
      out += '\\b';
      continue;
    }
    if (c === '\u000c') {
      out += '\\f';
      continue;
    }
    if (inMath[i]) {
      const next = s[i + 1] ?? '';
      if ((c === '\t' || c === '\r') && /[A-Za-z]/.test(next)) {
        out += c === '\t' ? '\\t' : '\\r';
        continue;
      }
      if (c === '\n' && N_COMMAND.test(s.slice(i + 1, i + 16))) {
        out += '\\n';
        continue;
      }
    }
    out += c;
  }
  return out;
}

/**
 * Raw JSON with a backslash that starts no valid escape (`\alpha`, `\$`, `\u` without four hex
 * digits): each such backslash is doubled, so it decodes to itself. Valid escapes, including an
 * escaped backslash, are copied unchanged.
 */
export function repairJsonEscapes(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = raw[i + 1];
    if (n !== undefined && '"\\/bfnrt'.includes(n)) {
      out += c + n;
      i++;
      continue;
    }
    if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
      out += raw.slice(i, i + 6);
      i += 5;
      continue;
    }
    out += '\\\\';
  }
  return out;
}

/** Parses a model's JSON output, repairing stray backslashes and a code fence; null if hopeless. */
export function parseModelJson(text: string): unknown {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1] as string;
  try {
    return JSON.parse(t);
  } catch {
    try {
      return JSON.parse(repairJsonEscapes(t));
    } catch {
      return null;
    }
  }
}
