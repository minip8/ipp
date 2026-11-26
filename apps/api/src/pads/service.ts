import {
  LANGUAGE_LABELS,
  type Language,
  type PadMember,
  type PadProblem,
  type PadRole,
  type Report,
} from '@ipp/contracts';
import {
  messages,
  padMembers,
  pads,
  problems,
  problemTests,
  reports,
  runs,
  timelineEvents,
  user,
} from '@ipp/db';
import { and, asc, count, eq, inArray, ne, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { badRequest, conflict, notFound } from '../http/errors';
import { isForeignKeyViolation } from '../pg';
import { finishRound } from '../quant/round';
import { padView, problemDetail } from '../views';

export type PadRow = typeof pads.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;

/** Everyone in the pad, the owner first, then in the order they joined. */
export async function padMembersOf(ctx: Ctx, padId: string): Promise<PadMember[]> {
  const rows = await ctx.db
    .select({
      userId: padMembers.userId,
      name: user.name,
      role: padMembers.role,
      guest: user.isAnonymous,
    })
    .from(padMembers)
    .innerJoin(user, eq(user.id, padMembers.userId))
    .where(eq(padMembers.padId, padId))
    .orderBy(asc(padMembers.joinedAt));
  return [...rows.filter((m) => m.role === 'owner'), ...rows.filter((m) => m.role !== 'owner')];
}

/** The problem as a member sees it (no server-only fields); null for a blank room. */
export async function publicProblem(ctx: Ctx, problem: ProblemRow | null) {
  if (!problem) return null;
  const tests = await ctx.db
    .select()
    .from(problemTests)
    .where(eq(problemTests.problemSlug, problem.slug));
  return problemDetail(problem, tests);
}

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

/** 409 `wrong_format`: what a coding pad has (code, runs, a language, a problem) and a quant pad does not. */
export const wrongFormat = (what: string) =>
  conflict('wrong_format', `A quant round has no ${what}`);

/**
 * Changes the pad language (any member, active pads only); timeline, broadcast, trigger.
 * Throws `language_unavailable` when the pad's problem does not offer the language, and
 * `wrong_format` for a quant pad.
 */
export async function changeLanguage(
  ctx: Ctx,
  padId: string,
  language: Language,
): Promise<PadRow | null> {
  const [pad] = await ctx.db.select({ format: pads.format }).from(pads).where(eq(pads.id, padId));
  if (pad?.format === 'quant') throw wrongFormat('language');
  // A blank room has no problem, so every language is available.
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

/** A report's figures. A quant pad has no runs, so its run figures are null (`Report.stats`). */
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
      // What the interviewer said; a round's questions are posted by the platform, not said.
      interviewer:
        sql<number>`count(*) filter (where ${messages.role} = 'interviewer' and ${messages.intent} is distinct from 'question')`.mapWith(
          Number,
        ),
    })
    .from(messages)
    .where(eq(messages.padId, pad.id));
  const end = pad.endedAt ?? new Date();
  const quant = pad.format === 'quant';
  return {
    durationSec: Math.max(0, Math.round((end.getTime() - pad.startedAt.getTime()) / 1000)),
    runs: quant ? null : (runAgg?.runs ?? 0),
    submissions: quant ? null : (runAgg?.submissions ?? 0),
    accepted: quant ? null : Boolean(runAgg?.accepted),
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
  // A quant round ends with its pad: the open question is closed and the rest are never posed.
  if (row.format === 'quant')
    await finishRound(ctx, padId).catch((err) =>
      ctx.log.error({ err, padId }, 'finishing the quant round failed'),
    );
  ctx.ai.trigger(padId, { type: 'session_ended' });
  const stats = await computeStats(ctx, row);
  if (row.kind === 'room') {
    // A room's report is ready at once: the AI assessment is written only if the host asks.
    await ctx.db
      .insert(reports)
      .values({ padId, status: 'ready', stats, assessment: null, generatedAt: new Date() })
      .onConflictDoNothing();
    return row;
  }
  await ctx.db
    .insert(reports)
    .values({ padId, status: 'pending', stats, assessment: null })
    .onConflictDoNothing();
  void generateAssessment(ctx, row).catch((err) =>
    ctx.log.error({ err, padId }, 'report generation failed'),
  );
  return row;
}

/**
 * A room's host changes its problem (null = a blank editor). The editor keeps one buffer per
 * language; the code of the problem being left is stashed in the document and comes back when
 * the host returns to it. The pad's language follows when the new problem does not offer it.
 * Returns null when the pad ended or its problem changed in the meantime.
 */
export async function changeProblem(
  ctx: Ctx,
  pad: PadRow,
  next: ProblemRow | null,
): Promise<PadProblem | null> {
  const language: Language =
    !next || next.languages.includes(pad.language)
      ? pad.language
      : (next.languages[0] ?? pad.language);
  const row = await ctx.collab.switchProblem(pad.id, pad.problemSlug, next, async () => {
    const [updated] = await ctx.db
      .update(pads)
      .set({ problemSlug: next?.slug ?? null, language })
      .where(
        and(
          eq(pads.id, pad.id),
          eq(pads.status, 'active'),
          sql`${pads.problemSlug} is not distinct from ${pad.problemSlug}`,
        ),
      )
      .returning();
    return updated ?? null;
  });
  if (!row) return null;
  await ctx.db.insert(timelineEvents).values({
    padId: pad.id,
    event: { type: 'problem', problemSlug: next?.slug ?? null, title: next?.title ?? 'Blank' },
  });
  ctx.ai.invalidate(pad.id);
  const problem = await publicProblem(ctx, next);
  ctx.rooms.broadcast(pad.id, { type: 'pad.problem', pad: padView(row, null), problem });
  return { pad: padView(row, null), problem };
}

/** Fills in the report: stats always; the assessment when the interviewer can produce one. */
export async function generateAssessment(ctx: Ctx, pad: PadRow): Promise<void> {
  const stats = await computeStats(ctx, pad);
  let status: Report['status'] = 'ready';
  let assessment: Report['assessment'] = null;
  // Runs on the pad owner's key; without a usable one the report has stats only, and the owner
  // can ask for the assessment later (POST /api/pads/:id/report/assessment). A room has no AI
  // interviewer: its assessment is an observer's, written for the host when they ask.
  if (pad.kind === 'room' || pad.interviewer.enabled) {
    try {
      // A quant pad's is over the quant dimensions, and first judges any question closed
      // without a verdict (written back to the round with `verdict` steps).
      // A quant room's is the host's adviser's, over the questions the host posed and the
      // host's verdicts (it never writes a verdict back).
      assessment =
        pad.kind === 'room'
          ? pad.format === 'quant'
            ? await ctx.ai.interviewer.generateQuantRoomAssessment(pad.id)
            : await ctx.ai.interviewer.generateRoomAssessment(pad.id)
          : pad.format === 'quant'
            ? await ctx.ai.interviewer.generateQuantAssessment(pad.id)
            : await ctx.ai.interviewer.generateAssessment(pad.id);
      if (pad.kind === 'room' && !assessment) status = 'failed';
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
  const guests = await ctx.db
    .select({ id: user.id })
    .from(padMembers)
    .innerJoin(user, eq(user.id, padMembers.userId))
    .where(and(eq(padMembers.padId, padId), eq(user.isAnonymous, true)));
  const deleted = await ctx.db.delete(pads).where(eq(pads.id, padId)).returning({ id: pads.id });
  if (deleted.length === 0) return false;
  // Guests exist only for the rooms they joined: one left in no room goes with this one.
  if (guests.length)
    await ctx.db
      .delete(user)
      .where(
        and(
          inArray(
            user.id,
            guests.map((g) => g.id),
          ),
          eq(user.isAnonymous, true),
          sql`not exists (select 1 from pad_members m where m.user_id = ${user.id})`,
        ),
      )
      .catch((err) => ctx.log.warn({ err, padId }, 'removing guests of a deleted pad failed'));
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
