/**
 * A quant pad's round (ARCHITECTURE §8.2): the I/O around the pure `advanceRound` of
 * @ipp/contracts. Every change is one transaction that writes the next state behind a
 * compare-and-swap on `quant_rounds.version` and posts what the step says (the interviewer's
 * message, then the question it reveals, with its timeline event); after the commit everyone in
 * the pad gets `message.created` for each, then `round.updated`. A refused or stale step changes
 * nothing and posts nothing.
 *
 * The state is server-only: what leaves this module for the browser is `publicRound` (and, once
 * the pad has ended, the report's `QuantReport`).
 */
import { randomUUID } from 'node:crypto';
import {
  advanceRound,
  type Message,
  publicRound,
  type QuantQuestionReview,
  type QuantReport,
  type QuantRoundState,
  type QuantRoundStep,
  type QuantRoundView,
  type QuantStepResult,
  type QuizQuestion,
  quantClock,
  quantPhase,
  quantQuestionStatus,
  quantRoundEndsAt,
  quantTimeSec,
} from '@ipp/contracts';
import {
  aiUsage,
  interviewerNotes,
  messages,
  pads,
  quantRounds,
  quizQuestions,
  timelineEvents,
} from '@ipp/db';
import { and, eq, inArray, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { isForeignKeyViolation } from '../pg';
import { messageView } from '../views';

export type QuantRoundRow = typeof quantRounds.$inferSelect;

export async function loadRound(ctx: Ctx, padId: string): Promise<QuantRoundRow | null> {
  const [row] = await ctx.db.select().from(quantRounds).where(eq(quantRounds.padId, padId));
  return row ?? null;
}

/** The round as the browser may see it; null for a pad that has none (a coding pad). */
export async function roundView(ctx: Ctx, padId: string): Promise<QuantRoundView | null> {
  const row = await loadRound(ctx, padId);
  return row ? publicRound(row.state, row.version) : null;
}

/** How many times a step that lost the compare-and-swap to a concurrent write is decided again. */
const CAS_RETRIES = 3;

/**
 * Applies one step to the pad's round. Interviewer steps (`QuantStep`) name the version they
 * were decided on, so losing a race to another write is `stale`, as for any older version.
 * Steps other than `end` and `verdict` are refused as `ended` once the pad has ended.
 */
export async function applyStep(
  ctx: Ctx,
  padId: string,
  step: QuantRoundStep,
): Promise<QuantStepResult> {
  let outcome: Awaited<ReturnType<typeof tryStep>>;
  try {
    outcome = await tryStep(ctx, padId, step);
  } catch (err) {
    // The pad was deleted while the step was written.
    if (isForeignKeyViolation(err)) return { ok: false, reason: 'ended' };
    throw err;
  }
  if (!outcome.ok) return outcome;
  for (const message of outcome.posted)
    ctx.rooms.broadcast(padId, { type: 'message.created', message });
  ctx.rooms.broadcast(padId, { type: 'round.updated', round: outcome.view });
  return outcome.result;
}

type StepOutcome =
  | { ok: true; result: QuantStepResult & { ok: true }; posted: Message[]; view: QuantRoundView }
  | (QuantStepResult & { ok: false });

async function tryStep(ctx: Ctx, padId: string, step: QuantRoundStep): Promise<StepOutcome> {
  return ctx.db.transaction(async (tx) => {
    // Shared lock on the pad: `endPad` (which updates it) waits for this step, or this step
    // waits for it and then sees the pad ended.
    const [pad] = await tx
      .select({ status: pads.status, startedAt: pads.startedAt, ownerId: pads.ownerId })
      .from(pads)
      .where(eq(pads.id, padId))
      .for('share');
    const [row] = await tx.select().from(quantRounds).where(eq(quantRounds.padId, padId));
    if (!pad || !row) return { ok: false, reason: 'ended' } as const;
    if (pad.status !== 'active' && step.type !== 'end' && step.type !== 'verdict')
      return { ok: false, reason: 'ended' } as const;

    const now = new Date();
    const roundEndsAt = quantRoundEndsAt(pad.startedAt, row.state.durationMin);
    const next = advanceRound(row.state, step, {
      version: row.version,
      now,
      roundEndsAt,
      newId: randomUUID,
    });
    if (!next.ok) return next;

    const [written] = await tx
      .update(quantRounds)
      .set({ state: next.state, version: next.version, updatedAt: now })
      .where(and(eq(quantRounds.padId, padId), eq(quantRounds.version, row.version)))
      .returning({ version: quantRounds.version });
    if (!written) return { ok: false, reason: 'stale' } as const;

    const { say, reveal, note } = next.effects;
    const posted: Message[] = [];
    if (say) {
      const [m] = await tx
        .insert(messages)
        .values({
          padId,
          role: 'interviewer',
          kind: say.kind,
          intent: say.intent,
          text: say.text,
          via: 'text',
          userId: null,
          createdAt: now,
        })
        .returning();
      if (m) posted.push(messageView(m));
      // The interviewer's own words count against the owner's daily messages, as saveMessage does.
      await tx
        .insert(aiUsage)
        .values({ userId: pad.ownerId, day: now.toISOString().slice(0, 10), messages: 1 })
        .onConflictDoUpdate({
          target: [aiUsage.userId, aiUsage.day],
          set: { messages: sql`${aiUsage.messages} + 1` },
        });
    }
    if (reveal) {
      // After the interviewer's message, whatever the clock's resolution; posted by the server,
      // so it does not count against anyone's AI allowance.
      const at = new Date(now.getTime() + 1);
      const [m] = await tx
        .insert(messages)
        .values({
          id: reveal.messageId,
          padId,
          role: 'interviewer',
          kind: 'proactive',
          intent: 'question',
          text: reveal.text,
          via: 'text',
          userId: null,
          createdAt: at,
        })
        .returning();
      if (m) posted.push(messageView(m));
      await tx.insert(timelineEvents).values({
        padId,
        at,
        event: { type: 'question', index: reveal.index, total: reveal.total },
      });
    }
    if (note) await tx.insert(interviewerNotes).values({ padId, note: note.slice(0, 4000) });

    return {
      ok: true,
      result: {
        ok: true,
        version: next.version,
        phase: quantPhase(next.state),
        clock: quantClock(next.state, roundEndsAt),
      },
      posted,
      view: publicRound(next.state, next.version),
    } as const;
  });
}

/**
 * The pad ended: the open question is closed as `ended` and the round finishes. Idempotent (a
 * finished round, or a pad without one, is left alone); retried when a concurrent step wins the
 * compare-and-swap.
 */
export async function finishRound(ctx: Ctx, padId: string): Promise<void> {
  for (let i = 0; i < CAS_RETRIES; i++) {
    const r = await applyStep(ctx, padId, { type: 'end' });
    if (r.ok || r.reason !== 'stale') return;
  }
  ctx.log.warn({ padId }, 'could not finish the quant round');
}

async function bankQuestions(ctx: Ctx, ids: readonly string[]): Promise<Map<string, QuizQuestion>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: quizQuestions.id, data: quizQuestions.data })
    .from(quizQuestions)
    .where(inArray(quizQuestions.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.data]));
}

/**
 * `Report.quant`, built when the report is read (only after the pad ended) from the state and
 * the bank: answers, key points and explanations, verdicts, and the hints given as counts. The
 * text of hints and follow-ups never leaves the server.
 */
export async function quantReport(ctx: Ctx, padId: string): Promise<QuantReport | null> {
  const row = await loadRound(ctx, padId);
  if (!row) return null;
  return buildQuantReport(
    row.state,
    await bankQuestions(
      ctx,
      row.state.questions.map((q) => q.questionId),
    ),
  );
}

export function buildQuantReport(
  state: QuantRoundState,
  bank: ReadonlyMap<string, QuizQuestion>,
): QuantReport {
  const questions = state.questions.map((q, index): QuantQuestionReview => {
    const b = bank.get(q.questionId);
    const short = b?.type === 'short' ? b : null;
    const numeric = b?.type === 'numeric' ? b : null;
    return {
      index,
      questionId: q.questionId,
      topic: q.topic,
      subtopic: b?.subtopic ?? '',
      difficulty: q.difficulty,
      type: numeric ? 'numeric' : 'short',
      prompt: q.prompt,
      unit: q.unit,
      solution: short ? short.reference : numeric ? (numeric.answerText ?? numeric.answer) : '',
      keyPoints: short ? [...short.keyPoints] : [],
      explanation: b?.explanation ?? '',
      status: quantQuestionStatus(q),
      verdict: q.verdict ? { score: q.verdict.score, summary: q.verdict.summary } : null,
      hintsGiven: q.hintRungs.length,
      hintsAvailable: q.hintsAvailable,
      timeSec: quantTimeSec(q),
      budgetSec: q.budgetSec,
    };
  });
  return { path: state.path, questions };
}

export { bankQuestions };
