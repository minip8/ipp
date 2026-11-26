/**
 * Mathematics in quiz Markdown. The site renders quiz text with remark-math, so `$...$` (inline)
 * and `$$...$$` (display) are LaTeX, typeset by KaTeX, and a dollar meant as a dollar is `\$`.
 *
 *   - fundamentals topics have no mathematics: a math node there is a stray pair of dollars.
 *   - quant topics may use it: every pair of dollars must be one the site reads as a formula
 *     (`isMathSpan`: `$x$`, never `$ x $`, and no digit straight after), and must typeset with KaTeX.
 *   - in either track a bare `$` left in the text is an error: it is either an unclosed formula or
 *     a dollar that the next `$` in the paragraph would turn into one.
 *
 * Not part of index.ts: it needs katex and remark, which only the checks (tests, `check`) load.
 */
import { isMathSpan, type QuantGame, type QuizQuestion, type QuizTrack } from '@ipp/contracts';
import katex from 'katex';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

/** One Markdown field of a question as the site renders it, e.g. `explanation` or `choices.b`. */
export interface MarkdownField {
  field: string;
  text: string;
}

/** Every field of a question that the site renders as Markdown. */
export function quizMarkdownFields(q: QuizQuestion): MarkdownField[] {
  const out: MarkdownField[] = [
    { field: 'prompt', text: q.prompt },
    { field: 'explanation', text: q.explanation },
  ];
  if (q.type === 'single' || q.type === 'multiple')
    for (const c of q.choices) out.push({ field: `choices.${c.id}`, text: c.text });
  if (q.type === 'short') {
    out.push({ field: 'reference', text: q.reference });
    q.keyPoints.forEach((k, i) => {
      out.push({ field: `keyPoints.${i}`, text: k });
    });
  }
  if (q.type === 'numeric' && q.answerText !== undefined)
    out.push({ field: 'answerText', text: q.answerText });
  return out;
}

const parser = unified().use(remarkParse).use(remarkMath);

interface Point {
  offset?: number | undefined;
}
interface MdNode {
  type: string;
  value?: string;
  position?: { start: Point; end: Point } | undefined;
}

/** Offsets in `source` of each `$` not escaped by a backslash. */
function bareDollars(source: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '$') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && source[j] === '\\'; j--) slashes++;
    if (slashes % 2 === 0) out.push(i);
  }
  return out;
}

const excerpt = (s: string) => JSON.stringify(s.length > 60 ? `${s.slice(0, 57)}...` : s);

/** What is wrong with the mathematics in one Markdown text of a topic of `track` (empty: nothing). */
export function markdownMathErrors(text: string, track: QuizTrack): string[] {
  const errors: string[] = [];
  visit(parser.parse(text), (node: MdNode) => {
    if (node.type === 'inlineMath' || node.type === 'math') {
      const tex = node.value ?? '';
      if (track !== 'quant') {
        errors.push(
          `${excerpt(tex)} is read as mathematics; this topic has none, so write each dollar as \\$`,
        );
        return;
      }
      // The site typesets a `$…$` pair only when `isMathSpan` says it is one; any other pair is
      // shown as written, dollars and all.
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (node.type === 'inlineMath' && from !== undefined && to !== undefined) {
        const raw = text.slice(from, to);
        if (raw.includes('\n')) {
          // One-line summaries (the bank's rows) cut a prompt at its first line break.
          errors.push(`${excerpt(raw)} runs over a line break: keep an inline formula on one line`);
          return;
        }
        if (!isMathSpan(raw, text.charAt(to))) {
          errors.push(
            `${excerpt(raw)} is shown as plain text, not as a formula: no space just inside the dollars, and no digit straight after the closing one`,
          );
          return;
        }
      }
      try {
        // `strict: 'ignore'` as on the site: only a real error fails, not a style warning.
        katex.renderToString(tex, {
          throwOnError: true,
          strict: 'ignore',
          displayMode: node.type === 'math',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${excerpt(tex)} does not typeset: ${msg}`);
      }
      return;
    }
    if (node.type !== 'text') return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const source = text.slice(start, end);
    for (const at of bareDollars(source)) {
      const around = source.slice(Math.max(0, at - 20), at + 20);
      errors.push(
        track === 'quant'
          ? `unmatched $ in ${excerpt(around)}: close the formula, or write a dollar as \\$`
          : `bare $ in ${excerpt(around)}: write a dollar as \\$`,
      );
    }
  });
  return errors;
}

/**
 * Math problems across questions, as "question-id field: message" strings. A question whose topic
 * has no known track is checked as `fundamentals`.
 */
export function quizMathErrors(
  questions: readonly QuizQuestion[],
  trackOf: ReadonlyMap<string, QuizTrack>,
): string[] {
  const errors: string[] = [];
  for (const q of questions) {
    const track = trackOf.get(q.topic) ?? 'fundamentals';
    for (const { field, text } of quizMarkdownFields(q))
      for (const e of markdownMathErrors(text, track)) errors.push(`${q.id} ${field}: ${e}`);
  }
  return errors;
}

/**
 * Math problems in market-making games (ARCHITECTURE §8.3), as "game-id field: message" strings.
 * A game belongs to a quant topic, so its prompt (posted word for word as the question) and its
 * explanation (shown in the report) are checked as quant Markdown: every formula must typeset.
 */
export function quantGameMathErrors(
  games: readonly Pick<QuantGame, 'id' | 'prompt' | 'explanation'>[],
): string[] {
  const errors: string[] = [];
  for (const g of games)
    for (const field of ['prompt', 'explanation'] as const)
      for (const e of markdownMathErrors(g[field], 'quant')) errors.push(`${g.id} ${field}: ${e}`);
  return errors;
}
