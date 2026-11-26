/**
 * Where `$` means math, for quiz text rendered with LaTeX (math-markdown.tsx). Pure, so the
 * Markdown pipeline (a rehype step before KaTeX) and the one-line summaries agree.
 *
 * remark-math reads any pair of dollars as math, so "costs $5 and $10" or `"$MAX $PERIOD"` would
 * turn into formulas. `isMathSpan` (packages/contracts, shared with the content check) says which
 * pairs really are; `$$…$$` always is, and alone in a paragraph it is display math (remark-math
 * sets it inline unless the dollars are on lines of their own).
 */
import { isMathSpan } from '@ipp/contracts';

export { isMathSpan };

export interface Segment {
  kind: 'text' | 'code' | 'math';
  text: string;
}

/** Inline code, then `$$…$$`, then `$…$`; whichever starts first wins, as in Markdown. */
const TOKEN = /(`+)[\s\S]*?\1|(?<!\\)\$\$[\s\S]+?\$\$|(?<!\\)\$[^$\n]+\$/g;

/** Text split into code spans, math spans and the rest (adjacent text runs merged). */
export function splitMath(text: string): Segment[] {
  const out: Segment[] = [];
  const push = (kind: Segment['kind'], s: string) => {
    if (!s) return;
    const last = out.at(-1);
    if (kind === 'text' && last?.kind === 'text') last.text += s;
    else out.push({ kind, text: s });
  };
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const start = m.index;
    push('text', text.slice(at, start));
    if (raw.startsWith('`')) push('code', raw);
    else push(isMathSpan(raw, text.charAt(start + raw.length)) ? 'math' : 'text', raw);
    at = start + raw.length;
  }
  push('text', text.slice(at));
  return out;
}

/**
 * Segments as Markdown that renders exactly as written, except for the math: every ASCII
 * punctuation character of a text segment is backslash-escaped, `$` included.
 */
export function segmentsToMarkdown(segments: Segment[]): string {
  return segments
    .map((s) => (s.kind === 'text' ? s.text.replace(/[!-/:-@[-`{-~]/g, '\\$&') : s.text))
    .join('');
}

/** Plain text as Markdown that renders as written apart from its `$…$` math. */
export const escapeOutsideMath = (text: string) => segmentsToMarkdown(splitMath(text));

// ---------------------------------------------------------------- the rehype step

/** The few hast fields this step reads (hast's own types are not a dependency of the app). */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const isInlineMath = (n: HastNode) =>
  n.type === 'element' &&
  n.tagName === 'code' &&
  Array.isArray(n.properties?.className) &&
  n.properties.className.includes('math-inline');

function guard(node: HastNode, source: string) {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HastNode;
    if (!isInlineMath(child)) {
      guard(child, source);
      continue;
    }
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const raw = source.slice(start, end);
    if (!isMathSpan(raw, source.charAt(end))) {
      // Not math after all: the text as it was written, dollars and all.
      children[i] = { type: 'text', value: raw };
      continue;
    }
    const alone = children.every(
      (c) => c === child || (c.type === 'text' && !(c.value ?? '').trim()),
    );
    if (raw.startsWith('$$') && node.tagName === 'p' && alone && child.properties)
      child.properties.className = ['math-display'];
  }
}

/** Runs before rehype-katex: drops dollar pairs that are not math, promotes lone `$$…$$`. */
export function rehypeMathGuard() {
  return (tree: object, file: { value?: unknown }) => {
    guard(tree as HastNode, typeof file.value === 'string' ? file.value : '');
  };
}
