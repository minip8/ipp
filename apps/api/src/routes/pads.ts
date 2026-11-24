import { randomBytes } from 'node:crypto';
import {
  CreatePadRequest,
  type PadDetail,
  type PadSummary,
  type Playback,
  type Report,
  UpdatePadRequest,
} from '@ipp/contracts';
import {
  messages,
  padMembers,
  pads,
  padUpdates,
  problems,
  problemTests,
  reports,
  runs,
  timelineEvents,
} from '@ipp/db';
import { and, arrayContains, asc, desc, eq, exists, type SQL, sql } from '@ipp/db/orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Ctx } from '../context';
import { type Env, parseBody, requireUser } from '../http/app';
import { conflict, forbidden, notFound, rateLimited } from '../http/errors';
import type { PadRow } from '../pads/service';
import {
  changeLanguage,
  computeStats,
  endPad,
  generateAssessment,
  padForMember,
} from '../pads/service';
import { toPublicRun } from '../runs/redact';
import { eventView, messageView, padView, problemDetail, storedRun } from '../views';

const JoinRequest = z.object({ shareToken: z.string().min(1).max(200) });

type ReportRow = typeof reports.$inferSelect;

export function padRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  const { db } = ctx;

  r.post('/pads', async (c) => {
    const user = requireUser(c);
    const body = await parseBody(c, CreatePadRequest);
    const l = ctx.config.limits.padCreate;
    const wait = await ctx.limiter.hit([
      { key: `pads:u:${user.id}:burst`, ...l.userBurst },
      { key: `pads:u:${user.id}:day`, ...l.userDaily },
    ]);
    if (wait > 0) throw rateLimited(wait);

    let problem: typeof problems.$inferSelect | undefined;
    if (body.problemSlug) {
      [problem] = await db
        .select()
        .from(problems)
        .where(and(eq(problems.slug, body.problemSlug), eq(problems.active, true)));
    } else {
      const where: SQL[] = [eq(problems.active, true)];
      if (body.random?.difficulty) where.push(eq(problems.difficulty, body.random.difficulty));
      if (body.random?.tag) where.push(arrayContains(problems.tags, [body.random.tag]));
      [problem] = await db
        .select()
        .from(problems)
        .where(and(...where))
        .orderBy(sql`random()`)
        .limit(1);
    }
    if (!problem) throw notFound('Problem');

    const row = await db.transaction(async (tx) => {
      const [pad] = await tx
        .insert(pads)
        .values({
          ownerId: user.id,
          title: body.title?.trim() || problem.title,
          problemSlug: problem.slug,
          language: body.language,
          durationMin: body.durationMin,
          interviewer: body.interviewer,
          shareToken: randomBytes(18).toString('base64url'),
        })
        .returning();
      if (!pad) throw new Error('pad insert failed');
      await tx.insert(padMembers).values({ padId: pad.id, userId: user.id, role: 'owner' });
      return pad;
    });
    return c.json(padView(row, user.id));
  });

  r.get('/pads', async (c) => {
    const user = requireUser(c);
    const accepted = exists(
      db
        .select({ one: sql`1` })
        .from(runs)
        .where(and(eq(runs.padId, pads.id), eq(runs.mode, 'submit'), eq(runs.verdict, 'accepted'))),
    );
    const rows = await db
      .select({
        pad: pads,
        problemTitle: problems.title,
        difficulty: problems.difficulty,
        accepted,
      })
      .from(pads)
      .innerJoin(padMembers, and(eq(padMembers.padId, pads.id), eq(padMembers.userId, user.id)))
      .innerJoin(problems, eq(problems.slug, pads.problemSlug))
      .orderBy(desc(pads.startedAt))
      .limit(200);
    const out: PadSummary[] = rows.map(({ pad, problemTitle, difficulty, accepted }) => ({
      id: pad.id,
      title: pad.title,
      problemSlug: pad.problemSlug,
      language: pad.language,
      status: pad.status,
      startedAt: pad.startedAt.toISOString(),
      endedAt: pad.endedAt?.toISOString() ?? null,
      problemTitle,
      difficulty,
      accepted: Boolean(accepted),
    }));
    return c.json(out);
  });

  r.post('/pads/join', async (c) => {
    const user = requireUser(c);
    const { shareToken } = await parseBody(c, JoinRequest);
    const [pad] = await db
      .select({ id: pads.id })
      .from(pads)
      .where(eq(pads.shareToken, shareToken));
    if (!pad) throw notFound('Pad');
    const inserted = await db
      .insert(padMembers)
      .values({ padId: pad.id, userId: user.id, role: 'collaborator' })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      await db
        .insert(timelineEvents)
        .values({ padId: pad.id, event: { type: 'joined', userId: user.id } });
    }
    return c.json({ padId: pad.id });
  });

  r.get('/pads/:id', async (c) => {
    const user = requireUser(c);
    const { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    const [problem] = await db.select().from(problems).where(eq(problems.slug, pad.problemSlug));
    if (!problem) throw notFound('Problem');
    const [tests, msgs, runRows, key] = await Promise.all([
      db.select().from(problemTests).where(eq(problemTests.problemSlug, problem.slug)),
      db.select().from(messages).where(eq(messages.padId, pad.id)).orderBy(asc(messages.createdAt)),
      db.select().from(runs).where(eq(runs.padId, pad.id)).orderBy(asc(runs.createdAt)),
      ctx.ai.keyState(pad.ownerId),
    ]);
    const detail: PadDetail = {
      pad: padView(pad, user.id),
      role,
      problem: problemDetail(problem, tests),
      messages: msgs.map(messageView),
      runs: runRows.map((row) => toPublicRun(storedRun(row))),
      interviewerAvailable: key === 'active',
      interviewerKey: key,
    };
    return c.json(detail);
  });

  r.patch('/pads/:id', async (c) => {
    const user = requireUser(c);
    const body = await parseBody(c, UpdatePadRequest);
    let { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    if ((body.title !== undefined || body.interviewer !== undefined) && role !== 'owner') {
      throw forbidden('Only the owner can change the title or interviewer settings');
    }
    if (pad.status !== 'active') throw conflict('pad_ended', 'This pad has ended');
    if (body.title !== undefined || body.interviewer !== undefined) {
      const [row] = await db
        .update(pads)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() || pad.title } : {}),
          ...(body.interviewer !== undefined
            ? { interviewer: { ...pad.interviewer, ...body.interviewer } }
            : {}),
        })
        .where(eq(pads.id, pad.id))
        .returning();
      if (row) pad = row;
      ctx.ai.invalidate(pad.id);
    }
    if (body.language !== undefined && body.language !== pad.language) {
      // Same budget as the event channel's language event (timeline row + trigger each).
      const wait = await ctx.limiter.hit([
        { key: `padev:u:${user.id}:${pad.id}`, ...ctx.config.limits.padEvents.userBurst },
      ]);
      if (wait > 0) throw rateLimited(wait);
      pad = (await changeLanguage(ctx, pad.id, body.language)) ?? pad;
    } else if (body.title !== undefined || body.interviewer !== undefined) {
      ctx.rooms.broadcast(pad.id, { type: 'pad.updated', pad: padView(pad, null) });
    }
    return c.json(padView(pad, user.id));
  });

  r.post('/pads/:id/end', async (c) => {
    const user = requireUser(c);
    const { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    if (role !== 'owner') throw forbidden('Only the owner can end the pad');
    const ended = pad.status === 'active' ? await endPad(ctx, pad.id) : null;
    return c.json(padView(ended ?? pad, user.id));
  });

  r.get('/pads/:id/report', async (c) => {
    const user = requireUser(c);
    const { pad } = await padForMember(ctx, c.req.param('id'), user.id);
    if (pad.status === 'active')
      throw conflict('pad_active', 'The report is available after the pad ends');
    let [row] = await db.select().from(reports).where(eq(reports.padId, pad.id));
    if (!row) {
      // Ended without a report (e.g. crash mid-end): create it now.
      const stats = await computeStats(ctx, pad);
      [row] = await db
        .insert(reports)
        .values({ padId: pad.id, status: 'pending', stats, assessment: null })
        .onConflictDoNothing()
        .returning();
      void generateAssessment(ctx, pad).catch((err) =>
        ctx.log.error({ err, padId: pad.id }, 'report generation failed'),
      );
      if (!row) [row] = await db.select().from(reports).where(eq(reports.padId, pad.id));
    }
    if (!row) throw notFound('Report');
    return c.json(await reportView(pad, row));
  });

  /** Why a finished report has no assessment, from the pad owner's key as it is now. */
  async function reportView(pad: PadRow, row: ReportRow): Promise<Report> {
    let unavailable: Report['assessmentUnavailable'] = null;
    if (!row.assessment && row.status !== 'pending') {
      if (!pad.interviewer.enabled) unavailable = 'interviewer_off';
      else {
        const key = await ctx.ai.keyState(pad.ownerId);
        unavailable = key === 'active' ? 'failed' : key === 'missing' ? 'no_key' : 'key_rejected';
      }
    }
    return {
      padId: pad.id,
      status: row.status,
      generatedAt: row.generatedAt?.toISOString() ?? null,
      stats: row.stats,
      assessment: row.assessment ?? null,
      assessmentUnavailable: unavailable,
    };
  }

  // The owner asks for the assessment again, typically right after adding their API key.
  r.post('/pads/:id/report/assessment', async (c) => {
    const user = requireUser(c);
    const { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    if (role !== 'owner') throw forbidden('Only the pad owner can request the assessment');
    if (pad.status === 'active')
      throw conflict('pad_active', 'The report is available after the pad ends');
    if (!pad.interviewer.enabled)
      throw conflict('interviewer_off', 'The interviewer was off for this interview');
    const [row] = await db.select().from(reports).where(eq(reports.padId, pad.id));
    if (!row) throw notFound('Report');
    if (row.assessment || row.status === 'pending') return c.json(await reportView(pad, row));
    if ((await ctx.ai.keyState(user.id)) !== 'active')
      throw conflict('ai_key_missing', 'Add your Anthropic API key first');
    const wait = await ctx.limiter.hit([
      { key: `assess:u:${user.id}`, ...ctx.config.limits.assessmentRetry.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);
    const [pending] = await db
      .update(reports)
      .set({ status: 'pending' })
      .where(and(eq(reports.padId, pad.id), sql`${reports.status} <> 'pending'`))
      .returning();
    if (pending) {
      void generateAssessment(ctx, pad).catch((err) =>
        ctx.log.error({ err, padId: pad.id }, 'report generation failed'),
      );
    }
    return c.json(await reportView(pad, pending ?? row));
  });

  r.get('/pads/:id/playback', async (c) => {
    const user = requireUser(c);
    const { pad } = await padForMember(ctx, c.req.param('id'), user.id);
    // Make sure buffered history is on disk before reading it.
    await ctx.collab.flushHistory(pad.id).catch(() => {});
    const [updates, events, msgs] = await Promise.all([
      db.select().from(padUpdates).where(eq(padUpdates.padId, pad.id)).orderBy(asc(padUpdates.seq)),
      db
        .select()
        .from(timelineEvents)
        .where(eq(timelineEvents.padId, pad.id))
        .orderBy(asc(timelineEvents.at)),
      db.select().from(messages).where(eq(messages.padId, pad.id)).orderBy(asc(messages.createdAt)),
    ]);
    const playback: Playback = {
      updates: updates.map((u) => ({
        seq: u.seq,
        at: u.at.toISOString(),
        update: Buffer.from(u.update).toString('base64'),
      })),
      events: events.map(eventView),
      messages: msgs.map(messageView),
    };
    return c.json(playback);
  });

  return r;
}
