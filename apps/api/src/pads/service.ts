import type { Language, PadRole, Report } from '@ipp/contracts';
import { messages, padMembers, pads, reports, runs, timelineEvents } from '@ipp/db';
import { and, count, eq, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { notFound } from '../http/errors';
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

/** Changes the pad language (any member, active pads only); timeline, broadcast, trigger. */
export async function changeLanguage(
  ctx: Ctx,
  padId: string,
  language: Language,
): Promise<PadRow | null> {
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
  await ctx.db
    .insert(reports)
    .values({ padId: pad.id, status, stats, assessment, generatedAt: new Date() })
    .onConflictDoUpdate({
      target: reports.padId,
      set: { status, stats, assessment, generatedAt: new Date() },
    });
  ctx.ai.release(pad.id);
}
