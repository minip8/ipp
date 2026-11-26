/**
 * The end of a quant round: a verdict for every question closed without one (closed for time, or
 * by the pad's end), then one assessment over the whole round on the five quant dimensions.
 *
 * Both calls see every posed question in full (the round is over, nothing is left to leak), the
 * transcript with platform markers where each question was posted, the final scratchpad, and a
 * table of time, budget, hints and verdict per question built in code from the round's books.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  type Message,
  QUANT_REPORT_DIMENSIONS,
  type QuantVerdict,
  ReportAssessment,
} from '@ipp/contracts';
import { z } from 'zod';
import { clock, duration, neutralise, truncate } from '../prompts';
import type { QuantContext } from '../types';
import {
  entryDifficulty,
  entryHints,
  entryPrompt,
  entryTopic,
  entryType,
  isGameEntry,
} from './entry';
import { repairLatexEscapes } from './latex';
import { QUANT_CORE, QUANT_LIMITS, questionBlock, scratchBlock, topicName } from './prompts';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type TextBlock = Anthropic.Beta.BetaTextBlockParam;
type Entry = QuantContext['questions'][number];

const Dimension = z.object({ score: z.number().int(), evidence: z.string() });
export const QuantAssessmentSchema = z.object({
  recommendation: ReportAssessment.shape.recommendation,
  summary: z.string(),
  scores: z.object({
    structuring: Dimension,
    correctness: Dimension,
    communication: Dimension,
    speed: Dimension,
    independence: Dimension,
  }),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
});
export type QuantAssessmentOutput = z.infer<typeof QuantAssessmentSchema>;

/** The report's assessment: the five quant dimensions in order, scores clamped to 1..4. */
export function toQuantAssessment(out: QuantAssessmentOutput): ReportAssessment {
  const text = (s: string) => repairLatexEscapes(s).trim();
  return ReportAssessment.parse({
    recommendation: out.recommendation,
    summary: text(out.summary),
    scores: QUANT_REPORT_DIMENSIONS.map((d) => ({
      dimension: d,
      score: Math.min(4, Math.max(1, Math.round(out.scores[d].score))),
      evidence: text(out.scores[d].evidence),
    })),
    strengths: out.strengths.map(text).filter(Boolean),
    improvements: out.improvements.map(text).filter(Boolean),
  });
}

// ---------------------------------------------------------------- the transcript, per question

/**
 * Which posted-question message poses which question. The k-th question message poses the k-th
 * posed question when the transcript holds all of them; otherwise a message is matched by its
 * text (exactly the bank prompt), and failing that the last ones are matched to the last ones.
 */
export function questionMessages(transcript: Message[], questions: Entry[]): Map<string, number> {
  const posted = transcript.filter((m) => m.intent === 'question');
  const posed = [...questions].sort((a, b) => a.index - b.index);
  const map = new Map<string, number>();
  if (posted.length === posed.length) {
    for (let i = 0; i < posted.length; i++)
      map.set((posted[i] as Message).id, (posed[i] as Entry).index);
    return map;
  }
  for (const m of posted) {
    const hit = posed.find((p) => entryPrompt(p).trim() === m.text.trim());
    if (hit) map.set(m.id, hit.index);
  }
  if (map.size === 0) {
    const n = Math.min(posted.length, posed.length);
    for (let i = 1; i <= n; i++)
      map.set((posted[posted.length - i] as Message).id, (posed[posed.length - i] as Entry).index);
  }
  return map;
}

/** The messages exchanged while question `index` was open (all of them if it cannot tell). */
export function segmentOf(transcript: Message[], posts: Map<string, number>, index: number) {
  if (![...posts.values()].includes(index))
    return transcript.filter((m) => m.intent !== 'question');
  const out: Message[] = [];
  let current: number | null = null;
  for (const m of transcript) {
    if (m.intent === 'question') {
      current = posts.get(m.id) ?? current;
      continue;
    }
    if (current === index) out.push(m);
  }
  return out;
}

function candidateBlock(c: Message, startedAt: number): string {
  return `<candidate_message at="${clock(Date.parse(c.createdAt) - startedAt)}"${c.via === 'voice' ? ' via="voice"' : ''}>\n${neutralise(truncate(c.text, QUANT_LIMITS.chatChars))}\n</candidate_message>`;
}

function history(
  transcript: Message[],
  startedAt: number,
  markers: Map<string, string>,
): { messages: MessageParam[]; open: Message[]; events: string[] } {
  const messages: MessageParam[] = [];
  let candidate: Message[] = [];
  let events: string[] = [];
  const stamp = (m: Message) => clock(Date.parse(m.createdAt) - startedAt);
  for (const m of transcript.slice(-QUANT_LIMITS.assessmentMessages)) {
    if (m.role === 'candidate') {
      candidate.push(m);
      continue;
    }
    if (m.intent === 'question') {
      const marker = markers.get(m.id);
      if (marker) events.push(`[${stamp(m)}] ${marker}`);
      continue;
    }
    messages.push({
      role: 'user',
      content: candidate.length
        ? candidate.map((c) => candidateBlock(c, startedAt)).join('\n')
        : '(no message from the candidate)',
    });
    if (events.length) messages.push({ role: 'system', content: events.join('\n') });
    messages.push({ role: 'assistant', content: [{ type: 'text', text: m.text }] });
    candidate = [];
    events = [];
  }
  return { messages, open: candidate, events };
}

function finalTurn(
  messages: MessageParam[],
  open: Message[],
  events: string[],
  startedAt: number,
  scratch: string,
  system: string,
): MessageParam[] {
  const said = open.map((c) => candidateBlock(c, startedAt));
  messages.push({
    role: 'user',
    content: [
      ...(said.length ? [said.join('\n')] : []),
      scratchBlock(scratch, 'candidate_final_scratchpad'),
    ].join('\n\n'),
  });
  messages.push({
    role: 'system',
    content: [...(events.length ? [events.join('\n')] : []), system].join('\n\n'),
  });
  return messages;
}

// ---------------------------------------------------------------- the table

const closedByText: Record<string, string> = {
  interviewer: 'answered',
  timeout: 'closed for time',
  round_time: "open when the round's time ran out",
  ended: 'open when the pad was ended',
};

/** One row per posed question, from the books; verdicts as judged (`verdicts` wins). */
export function roundTable(ctx: QuantContext, verdicts: ReadonlyMap<number, QuantVerdict | null>) {
  const posed = [...ctx.questions].sort((a, b) => a.index - b.index);
  const rows = posed.map((e) => {
    const c = ctx.round.closed.find((x) => x.index === e.index);
    const hints = entryHints(e);
    const authored = e.hintRungs.filter((r) => r > 0).length;
    const own = e.hintRungs.length - authored;
    const v = verdicts.get(e.index) ?? c?.verdict ?? null;
    return [
      `Q${e.index + 1}`,
      `${topicName(entryTopic(e))}, ${entryDifficulty(e)}, ${entryType(e)}`,
      c ? duration(c.timeSec * 1000) : 'open',
      c?.budgetSec ? duration(c.budgetSec * 1000) : 'unknown',
      `${authored} of ${hints.length} authored${own ? ` + ${own} own` : ''}`,
      e.followUpAsked ? 'yes' : 'no',
      c?.closedBy ? (closedByText[c.closedBy] ?? c.closedBy) : c ? 'closed' : 'open',
      v ? v.score.toFixed(2) : 'none',
    ].join(' | ');
  });
  const notReached = ctx.round.total - posed.length;
  return [
    `Questions (${posed.length} of ${ctx.round.total} posed${notReached > 0 ? `; ${notReached} never reached` : ''}):`,
    'question | topic, difficulty, type | time used | budget | hints | follow-up asked | how it ended | verdict score',
    ...rows,
  ].join('\n');
}

// ---------------------------------------------------------------- the forced verdict

export const verdictTask = (closedBy: string | null | undefined, game = false) =>
  game
    ? `TASK (verdict): this market-making game was closed without a verdict (${closedBy ? (closedByText[closedBy] ?? closedBy) : 'closed'}). Judge the candidate's decisions in it from the game as played (the code-built review in the system block), the conversation while it was open and the scratchpad, as "The verdict on a game" says: the centring and width of their markets against the public fair value and its standard deviation, how they moved after reveals and fills, size and inventory, what they made of the pattern of trades; never the realised P&L, which is luck plus edge. "score" from 0 to 1 (a game cut short earns credit for what it showed) and "summary", one paragraph for the written report about the candidate in the third person, citing the review's figures where they make the point. Answer with JSON: "score" and "summary"; double every backslash inside the JSON strings.`
    : `TASK (verdict): this question was closed without a verdict (${closedBy ? (closedByText[closedBy] ?? closedBy) : 'closed'}). Judge what the candidate did on it, from the conversation while it was open and the scratchpad, as you would have at a close: "score" from 0 to 1 (as in "Your answer each turn"; work that was on track but unfinished earns partial credit, a committed correct answer full credit less what the hints cost) and "summary", one paragraph for the written report about the candidate in the third person: their approach, what was right, what was missing, the hints they needed. Answer with JSON: "score" and "summary"; double every backslash inside the JSON strings.`;

export function verdictRequest(
  ctx: QuantContext,
  entry: Entry,
  closed: QuantContext['round']['closed'][number] | undefined,
): { system: TextBlock[]; messages: MessageParam[] } {
  const startedAt = Date.parse(ctx.pad.startedAt);
  const posts = questionMessages(ctx.transcript, ctx.questions);
  const segment = segmentOf(ctx.transcript, posts, entry.index);
  const { messages, open, events } = history(segment, startedAt, new Map());
  const books = [
    `This question: ${closed ? `open for ${duration(closed.timeSec * 1000)}` : 'time unknown'}${closed?.budgetSec ? ` of a ${duration(closed.budgetSec * 1000)} budget` : ''}; ${entry.hintRungs.filter((r) => r > 0).length} of ${entryHints(entry).length} authored hints given${entry.hintRungs.some((r) => r === 0) ? `, plus ${entry.hintRungs.filter((r) => r === 0).length} of your own` : ''}; follow-up ${entry.followUpAsked ? 'asked' : 'not asked'}.`,
    'The scratchpad is as the candidate left it at the end of the round, so it may hold working for other questions too.',
    ctx.privateNotes.length
      ? `Your private notes:\n${ctx.privateNotes.map((n) => `- ${truncate(n, 600)}`).join('\n')}`
      : 'No private notes.',
    verdictTask(closed?.closedBy, isGameEntry(entry)),
  ].join('\n\n');
  return {
    system: [
      { type: 'text', text: QUANT_CORE, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: questionBlock(entry, ctx.round.total, 'The question to judge', { startedAt }),
      },
    ],
    messages: finalTurn(messages, open, events, startedAt, ctx.scratch, books),
  };
}

// ---------------------------------------------------------------- the assessment

export function quantAssessmentTask(games = false): string {
  return `TASK (assessment): the round is over. Write the assessment for the candidate's report, as a fair, experienced quant interviewer would after this round. Ground every statement in the transcript, the scratchpad, the table of questions and your private notes, and back each score with evidence: quote what they said, or cite times like [12:30] and questions like Q2. Don't invent things that did not happen; if the round was short or the candidate barely engaged, say so and score accordingly. The round is over, so you may now discuss the solutions.

Scores (1-4) per dimension:
- structuring: setting each problem up before computing: defining the random variables or the state, choosing a method (symmetry, conditioning, linearity of expectation, a recursion, a bound), stating assumptions, breaking the problem into steps.
- correctness: whether the final answers were right and the reasoning sound; slips caught or not; sanity checks on magnitudes and limiting cases.
- communication: thinking aloud so the interviewer could follow, explaining steps clearly, answering the interviewer's questions directly, committing to an answer when asked.
- speed: progress against each question's time budget (see the table): reaching answers in good time, not stalling, prioritising under the clock. Judge against the budgets, not an absolute standard.
- independence: how much help it took: hints used against hints available (see the table), how quickly they recovered from a hint, whether they needed prompting to finish.
Scale: 1 = significant concerns, 2 = below the bar, 3 = meets the bar, 4 = clearly strong. If a dimension could not be judged (e.g. no question was answered), score it 2 and say so.
Recommendation: strong_hire / hire / lean_hire / lean_no_hire / no_hire for a quant role at this level of question.
Summary: three to five sentences, written to the candidate ("you"). Strengths and improvements: two to four specific items each, written to the candidate, each concrete and actionable (a technique to practise, a habit to build). Mathematics as LaTeX between dollar signs, with every backslash doubled inside the JSON strings.${
    games
      ? `

A market-making game (type "game" in the table) has no answer to be right or wrong: judge it from its review (the game as played, in the system block) on its decisions: where the markets were centred against the public fair value at the time, their width against its standard deviation, how far and how fast they moved after reveals and fills, size and inventory, and what was made of the pattern of trades. It counts toward structuring (pricing the contract before quoting), correctness (sound fair values and updates), communication and speed as any question does. The realised P&L is luck plus edge (the review gives both): never score the luck.`
      : ''
  }`;
}

export function quantAssessmentRequest(
  ctx: QuantContext,
  verdicts: ReadonlyMap<number, QuantVerdict | null>,
): { system: TextBlock[]; messages: MessageParam[] } {
  const startedAt = Date.parse(ctx.pad.startedAt);
  const posed = [...ctx.questions].sort((a, b) => a.index - b.index);
  const posts = questionMessages(ctx.transcript, ctx.questions);
  const markers = new Map<string, string>();
  for (const [id, index] of posts) {
    const e = posed.find((p) => p.index === index);
    markers.set(
      id,
      `The platform posted Q${index + 1} of ${ctx.round.total}${e ? ` (${topicName(entryTopic(e))}, ${entryDifficulty(e)})` : ''}.`,
    );
  }
  const { messages, open, events } = history(ctx.transcript, startedAt, markers);
  const verdictLines = posed.map((e) => {
    const v = verdicts.get(e.index) ?? ctx.round.closed.find((c) => c.index === e.index)?.verdict;
    return `- Q${e.index + 1}: ${v ? `${v.score.toFixed(2)}: ${truncate(v.summary, 1200)}` : 'no verdict'}`;
  });
  const endedAt = ctx.pad.endedAt ? Date.parse(ctx.pad.endedAt) : ctx.now.getTime();
  const state = [
    `Round: ${ctx.pad.durationMin ? `${ctx.pad.durationMin} min planned` : 'length unknown'}; the pad ended at [${clock(endedAt - startedAt)}]. Interviewer style was ${ctx.pad.interviewer.style}; voice ${ctx.pad.interviewer.voice ? 'on' : 'off'}.`,
    roundTable(ctx, verdicts),
    `Your verdicts per question:\n${verdictLines.join('\n')}`,
    ctx.privateNotes.length
      ? `Your private notes:\n${ctx.privateNotes.map((n) => `- ${truncate(n, 600)}`).join('\n')}`
      : 'No private notes.',
    quantAssessmentTask(posed.some(isGameEntry)),
  ].join('\n\n');
  const blocks = posed.map((e) => questionBlock(e, ctx.round.total, 'Posed', { startedAt }));
  return {
    system: [
      { type: 'text', text: QUANT_CORE, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: blocks.length
          ? `# The questions of this round, in order\n\n${blocks.join('\n\n')}`
          : '# The questions of this round\n\nNo question was posed.',
      },
    ],
    messages: finalTurn(messages, open, events, startedAt, ctx.scratch, state),
  };
}
