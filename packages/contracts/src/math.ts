/**
 * Which `$…$` spans of quiz Markdown are mathematics. Shared so that the site (a rehype step
 * before KaTeX, apps/web/src/components/math-guard.ts) and the content check
 * (packages/content/src/math.ts) cannot disagree about what a learner will see.
 *
 * remark-math reads any pair of dollars as math, so "costs $5 and $10" would turn into a formula.
 * As in Pandoc, a single-dollar span is math only when the opening `$` is followed by a non-space,
 * the closing `$` follows a non-space and is not followed by a digit; otherwise the site shows the
 * span as written, dollars and all. `$$…$$` is always math.
 */

/** Whether `raw` (a span with its dollars, as written) is math, given the character after it. */
export function isMathSpan(raw: string, after = ''): boolean {
  if (raw.length >= 4 && raw.startsWith('$$') && raw.endsWith('$$')) return raw.length > 4;
  if (raw.length < 3 || !raw.startsWith('$') || !raw.endsWith('$')) return false;
  const inner = raw.slice(1, -1);
  return !/^\s|\s$/.test(inner) && !/^\d/.test(after);
}
