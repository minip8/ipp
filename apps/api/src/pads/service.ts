import { LANGUAGE_LABELS, type Language, type PadRole, type Report } from '@ipp/contracts';
import { messages, padMembers, pads, problems, reports, runs, timelineEvents } from '@ipp/db';
import { and, count, eq, ne, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { badRequest, notFound } from '../http/errors';
import { isForeignKeyViolation } from '../pg';
import { padView } from '../views';

export type PadRow = typeof pads.$inferSelect;

/** The pad if the user is a member. Non-members get 404 so pad ids cannot be probed. */
export async function padForMember(
  ctx: Ctx,
  padId: string,
  userId: string,
): Promise<{ pad: PadRow; role: PadRole }> {
  if (!/^[0-9a-f-]{36}$/i.test(padId)) throw notFound('Pad');
  const [row] = await ctx.db
    .select({ pad: pads, role: padMembers.role })
    .from(pads)
    .innerJoin(padMembers, and(eq(padMembers.padId, pads.id), eq(padMembers.userId, userId)))
    .where(eq(pads.id, padId));
  if (!row) throw notFound('Pad');
  return row;
}

/** 400 `language_unavailable` unless the problem can be solved in `language`. */
export function assertLanguageOffered(
  problem: { title: string; languages: Language[] },
  language: Language,
): void {
  if (problem.languages.includes(language)) return;
  const offered = problem.languages.map((l) => LANGUAGE_LABELS[l]).join(', ');
  throw badRequest(
    `${problem.title} can only be solved in ${offered}, not ${LANGUAGE_LABELS[language]}`,
    'language_unavailable',
  );
}

/**
 * Changes the pad language (any member, active pads only); timeline, broadcast, trigger.
 * Throws `language_unavailable` when the pad's problem does not offer the language.
 */
export async function changeLanguage(
  ctx: Ctx,
  padId: string,
  language: Language,
): Promise<PadRow | null> {
  const [problem] = await ctx.db
    .select({ title: problems.title, languages: problems.languages })
    .from(pads)
    .innerJoin(problems, eq(problems.slug, pads.problemSlug))
    .where(eq(pads.id, padId));
  if (problem) assertLanguageOffered(problem, language);
  const [row] = await ctx.db
    .update(pads)
    .set({ language })
    .where(and(eq(pads.id, padId), eq(pads.status, 'active'), sql`${pads.language} <> ${language}`))
    .returning();
  if (!row) return null;
  await ctx.db.insert(timelineEvents).values({ padId, event: { type: 'language', language } });
  ctx.rooms.broadcast(padId, { type: 'pad.updated', pad: padView(row, null) });
  ctx.ai.trigger(padId, { type: 'language_changed', language });
  return row;
}

export async function computeStats(ctx: Ctx, pad: PadRow): Promise<Report['stats']> {
  const [runAgg] = await ctx.db
    .select({
      runs: count(),
      submissions: sql<number>`count(*) filter (where ${runs.mode} = 'submit')`.mapWith(Number),
      accepted: sql<boolean>`coalesce(bool_or(${runs.mode} = 'submit' and ${runs.verdict} = 'accepted'), false)`,
    })
    .from(runs)
    .where(eq(runs.padId, pad.id));
  const [msgAgg] = await ctx.db
    .select({
      candidate: sql<number>`count(*) filter (where ${messages.role} = 'candidate')`.mapWith(
        Number,
      ),
      interviewer: sql<number>`count(*) filter (where ${messages.role} = 'interviewer')`.mapWith(
        Number,
      ),
    })
    .from(messages)
    .where(eq(messages.padId, pad.id));
  const end = pad.endedAt ?? new Date();
  return {
    durationSec: Math.max(0, Math.round((end.getTime() - pad.startedAt.getTime()) / 1000)),
    runs: runAgg?.runs ?? 0,
    submissions: runAgg?.submissions ?? 0,
    accepted: Boolean(runAgg?.accepted),
    candidateMessages: msgAgg?.candidate ?? 0,
    interviewerMessages: msgAgg?.interviewer ?? 0,
  };
}

/** Ends an active pad. Returns the row, or null if it was already ended. */
export async function endPad(ctx: Ctx, padId: string): Promise<PadRow | null> {
  const [row] = await ctx.db
    .update(pads)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(pads.id, padId), eq(pads.status, 'active')))
    .returning();
  if (!row) return null;
  ctx.ai.invalidate(padId);
  await ctx.db.insert(timelineEvents).values({ padId, event: { type: 'ended' } });
  ctx.rooms.broadcast(padId, { type: 'pad.updated', pad: padView(row, null) });
  await ctx.collab.endPad(padId).catch((err) => ctx.log.error({ err, padId }, 'collab end failed'));
  ctx.ai.trigger(padId, { type: 'session_ended' });
  const stats = await computeStats(ctx, row);
  await ctx.db
    .insert(reports)
    .values({ padId, status: 'pending', stats, assessment: null })
    .onConflictDoNothing();
  void generateAssessment(ctx, row).catch((err) =>
    ctx.log.error({ err, padId }, 'report generation failed'),
  );
  return row;
}

/** Fills in the report: stats always; the assessment when the interviewer can produce one. */
export async function generateAssessment(ctx: Ctx, pad: PadRow): Promise<void> {
  const stats = await computeStats(ctx, pad);
  let status: Report['status'] = 'ready';
  let assessment: Report['assessment'] = null;
  // Runs on the pad owner's key; without a usable one the report has stats only, and the owner
  // can ask for the assessment later (POST /api/pads/:id/report/assessment).
  if (pad.interviewer.enabled) {
    try {
      assessment = await ctx.ai.interviewer.generateAssessment(pad.id);
    } catch (err) {
      ctx.log.error({ err, padId: pad.id }, 'assessment failed');
      status = 'failed';
    }
  }
  try {
    await ctx.db
      .insert(reports)
      .values({ padId: pad.id, status, stats, assessment, generatedAt: new Date() })
      .onConflictDoUpdate({
        target: reports.padId,
        set: { status, stats, assessment, generatedAt: new Date() },
      });
  } catch (err) {
    // The pad was deleted while the assessment was being written.
    if (!isForeignKeyViolation(err)) throw err;
  }
  ctx.ai.release(pad.id);
}

/** Close codes for live sockets of a pad that is gone for that user (the web treats 4404 as final). */
export const PAD_GONE = { code: 4404, reason: 'pad-deleted' } as const;

/**
 * The owner deletes a pad: the row goes, and the FK cascades take its members, editor state and
 * history, transcript, notes, timeline, runs and report. Then its live state is let go: open
 * sockets are closed (clients see 4404 and stop reconnecting; tickets and collab auth fail as
 * for any non-member), buffered history is dropped, the interviewer releases the pad, and
 * unfinished runs give back their owners' in-flight slot. Writes still in flight for the pad
 * (a judge result, a debounced editor save, an assessment) find no row and are dropped where
 * they land. Returns false if the pad was already gone.
 */
export async function deletePad(ctx: Ctx, padId: string): Promise<boolean> {
  const unfinished = await ctx.db
    .select({ id: runs.id, userId: runs.userId })
    .from(runs)
    .where(and(eq(runs.padId, padId), ne(runs.status, 'finished')));
  const deleted = await ctx.db.delete(pads).where(eq(pads.id, padId)).returning({ id: pads.id });
  if (deleted.length === 0) return false;
  ctx.rooms.close(padId, PAD_GONE.code, PAD_GONE.reason);
  ctx.collab.deletePad(padId);
  ctx.ai.forget(padId);
  await ctx.runs
    .forget(unfinished)
    .catch((err) => ctx.log.warn({ err, padId }, 'releasing runs of a deleted pad failed'));
  ctx.log.info({ padId, unfinishedRuns: unfinished.length }, 'pad deleted');
  return true;
}

/**
 * A collaborator removes a pad from their own history: only their membership goes. Their open
 * sockets for the pad are closed, since membership is what let them in.
 */
export async function leavePad(ctx: Ctx, padId: string, userId: string): Promise<void> {
  await ctx.db
    .delete(padMembers)
    .where(
      and(
        eq(padMembers.padId, padId),
        eq(padMembers.userId, userId),
        eq(padMembers.role, 'collaborator'),
      ),
    );
  ctx.rooms.close(padId, PAD_GONE.code, PAD_GONE.reason, userId);
  ctx.collab.closeUser(padId, userId);
}
