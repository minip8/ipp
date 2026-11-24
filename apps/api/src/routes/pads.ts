import { randomBytes } from 'node:crypto';
import {
  ChangeProblemRequest,
  CreatePadRequest,
  type DeletePadResponse,
  type HostView,
  type InviteInfo,
  JoinGuestRequest,
  PAD_MEMBERS_MAX,
  type PadDetail,
  type PadSummary,
  type Playback,
  type Report,
  ReviewRequest,
  UpdateHostNotesRequest,
  UpdatePadRequest,
} from '@ipp/contracts';
import {
  messages,
  padMembers,
  pads,
  padUpdates,
  problems,
  reports,
  runs,
  timelineEvents,
  user as users,
} from '@ipp/db';
import { and, arrayContains, asc, count, desc, eq, exists, ne, type SQL, sql } from '@ipp/db/orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SessionUser } from '../auth';
import type { Ctx } from '../context';
import { type C, type Env, parseBody, requireAccount, requireUser } from '../http/app';
import { badRequest, conflict, forbidden, HttpError, notFound, rateLimited } from '../http/errors';
import type { PadRow } from '../pads/service';
import {
  assertLanguageOffered,
  changeLanguage,
  changeProblem,
  computeStats,
  deletePad,
  endPad,
  generateAssessment,
  leavePad,
  padForMember,
  padMembersOf,
  publicProblem,
} from '../pads/service';
import { toPublicRun } from '../runs/redact';
import { eventView, messageView, padView, storedRun } from '../views';

const JoinRequest = z.object({ shareToken: z.string().min(1).max(200) });

type ReportRow = typeof reports.$inferSelect;

/** A guest's display name: one line, no control characters. */
const cleanName = (name: string) =>
  name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function padRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  const { db } = ctx;

  /** The pad, for its owner, when it is a room: everything under "host" is theirs alone. */
  async function roomForHost(c: C): Promise<{ pad: PadRow; user: SessionUser }> {
    const user = requireAccount(c);
    const { pad, role } = await padForMember(ctx, c.req.param('id') ?? '', user.id);
    if (pad.kind !== 'room' || role !== 'owner')
      throw forbidden('Only the host of a room can do this');
    return { pad, user };
  }

  /** Invite links are guessed at or read by anyone: limit them per client address. */
  async function inviteLimit(c: C): Promise<void> {
    const l = ctx.config.limits.invites;
    const ip = c.get('ip');
    const wait = await ctx.limiter.hit([
      { key: `invite:ip:${ip}:burst`, ...l.ipBurst },
      { key: `invite:ip:${ip}:day`, ...l.ipDaily },
    ]);
    if (wait > 0) throw rateLimited(wait);
  }

  /** Adds `userId` to the pad as a collaborator (a room's candidate) and tells the room. */
  async function addMember(pad: PadRow, userId: string): Promise<void> {
    const [existing] = await db
      .select({ role: padMembers.role })
      .from(padMembers)
      .where(and(eq(padMembers.padId, pad.id), eq(padMembers.userId, userId)));
    if (existing) return;
    if (pad.kind === 'room' && pad.status !== 'active')
      throw conflict('pad_ended', 'This interview has ended');
    const [n] = await db
      .select({ n: count() })
      .from(padMembers)
      .where(and(eq(padMembers.padId, pad.id), ne(padMembers.role, 'owner')));
    if ((n?.n ?? 0) >= PAD_MEMBERS_MAX) throw conflict('pad_full', 'This interview is full');
    const inserted = await db
      .insert(padMembers)
      .values({ padId: pad.id, userId, role: 'collaborator' })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;
    await db.insert(timelineEvents).values({ padId: pad.id, event: { type: 'joined', userId } });
    const member = (await padMembersOf(ctx, pad.id)).find((m) => m.userId === userId);
    if (member) ctx.rooms.broadcast(pad.id, { type: 'member.joined', member });
  }

  r.post('/pads', async (c) => {
    const user = requireAccount(c);
    const body = await parseBody(c, CreatePadRequest);
    if (body.blank && body.kind !== 'room')
      throw badRequest('Only an interview room can start without a problem', 'validation_error');
    if (body.blank && (body.problemSlug || body.random))
      throw badRequest('A blank room takes no problem', 'validation_error');
    const l = ctx.config.limits.padCreate;
    const wait = await ctx.limiter.hit([
      { key: `pads:u:${user.id}:burst`, ...l.userBurst },
      { key: `pads:u:${user.id}:day`, ...l.userDaily },
    ]);
    if (wait > 0) throw rateLimited(wait);

    let problem: typeof problems.$inferSelect | undefined;
    if (body.blank) {
      // no problem: a blank editor
    } else if (body.problemSlug) {
      [problem] = await db
        .select()
        .from(problems)
        .where(and(eq(problems.slug, body.problemSlug), eq(problems.active, true)));
    } else {
      const where: SQL[] = [eq(problems.active, true)];
      if (body.random?.difficulty) where.push(eq(problems.difficulty, body.random.difficulty));
      if (body.random?.tag) where.push(arrayContains(problems.tags, [body.random.tag]));
      // Only problems that can be solved in the chosen language.
      where.push(arrayContains(problems.languages, [body.language]));
      [problem] = await db
        .select()
        .from(problems)
        .where(and(...where))
        .orderBy(sql`random()`)
        .limit(1);
    }
    if (!problem && !body.blank) throw notFound('Problem');
    if (problem) assertLanguageOffered(problem, body.language);

    const row = await db.transaction(async (tx) => {
      const [pad] = await tx
        .insert(pads)
        .values({
          ownerId: user.id,
          title:
            body.title?.trim() || problem?.title || (body.kind === 'room' ? 'Interview room' : ''),
          kind: body.kind,
          problemSlug: problem?.slug ?? null,
          language: body.language,
          durationMin: body.durationMin,
          // A room has no AI in the conversation: the host is the interviewer.
          interviewer:
            body.kind === 'room'
              ? { ...body.interviewer, enabled: false, voice: false }
              : body.interviewer,
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
    const user = requireAccount(c);
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
        role: padMembers.role,
      })
      .from(pads)
      .innerJoin(padMembers, and(eq(padMembers.padId, pads.id), eq(padMembers.userId, user.id)))
      .leftJoin(problems, eq(problems.slug, pads.problemSlug))
      .orderBy(desc(pads.startedAt))
      .limit(200);
    const out: PadSummary[] = rows.map(({ pad, problemTitle, difficulty, accepted, role }) => ({
      id: pad.id,
      title: pad.title,
      kind: pad.kind,
      problemSlug: pad.problemSlug,
      language: pad.language,
      status: pad.status,
      startedAt: pad.startedAt.toISOString(),
      endedAt: pad.endedAt?.toISOString() ?? null,
      problemTitle,
      difficulty,
      accepted: Boolean(accepted),
      role,
    }));
    return c.json(out);
  });

  // Who is inviting and to what: shown before joining, to people without a session too.
  r.get('/pads/invite/:token', async (c) => {
    await inviteLimit(c);
    const token = c.req.param('token');
    if (token.length > 200) throw notFound('Invite');
    const [row] = await db
      .select({ pad: pads, hostName: users.name })
      .from(pads)
      .innerJoin(users, eq(users.id, pads.ownerId))
      .where(eq(pads.shareToken, token));
    if (!row) throw notFound('Invite');
    const info: InviteInfo = {
      kind: row.pad.kind,
      title: row.pad.title,
      hostName: row.hostName,
      status: row.pad.status,
    };
    return c.json(info);
  });

  // With a session (an account, or a guest already in another room).
  r.post('/pads/join', async (c) => {
    const user = requireUser(c);
    await inviteLimit(c);
    const { shareToken } = await parseBody(c, JoinRequest);
    const [pad] = await db.select().from(pads).where(eq(pads.shareToken, shareToken));
    if (!pad) throw notFound('Pad');
    // Practice pads are shared between accounts; only a room takes guests.
    if (user.guest && pad.kind !== 'room')
      throw new HttpError(403, 'account_required', 'Sign in with an account to join this pad');
    await addMember(pad, user.id);
    return c.json({ padId: pad.id });
  });

  // Without an account: a name is enough to enter a room. This is the only place guest users
  // are created, and only for a link that leads to an active room.
  r.post('/pads/join-guest', async (c) => {
    await inviteLimit(c);
    const body = await parseBody(c, JoinGuestRequest);
    const name = cleanName(body.name);
    if (!name) throw badRequest('Enter your name', 'validation_error');
    const [pad] = await db.select().from(pads).where(eq(pads.shareToken, body.shareToken));
    if (pad?.kind !== 'room') throw notFound('Invite');
    const current = c.get('user');
    if (current) {
      // Already signed in: join as that user. A guest may change the name they go by.
      if (current.guest && current.name !== name)
        await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, current.id));
      await addMember(pad, current.id);
      return c.json({ padId: pad.id });
    }
    if (pad.status !== 'active') throw conflict('pad_ended', 'This interview has ended');
    const l = ctx.config.limits.auth;
    const wait = await ctx.limiter.hit([
      { key: `auth:ip:${c.get('ip')}:burst`, ...l.ipBurst },
      { key: `auth:ip:${c.get('ip')}:day`, ...l.ipDaily },
    ]);
    if (wait > 0) throw rateLimited(wait);
    const res = await ctx.auth.api.signInAnonymous({
      headers: c.req.raw.headers,
      asResponse: true,
    });
    const created = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
    const guestId = created?.user?.id;
    if (!res.ok || !guestId) {
      ctx.log.error({ status: res.status }, 'creating a guest failed');
      throw new HttpError(500, 'internal', 'Could not join the interview');
    }
    await db.update(users).set({ name }).where(eq(users.id, guestId));
    try {
      await addMember(pad, guestId);
    } catch (err) {
      // Full or just ended: do not leave a guest behind that belongs to no room.
      await db.delete(users).where(and(eq(users.id, guestId), eq(users.isAnonymous, true)));
      throw err;
    }
    for (const cookie of res.headers.getSetCookie())
      c.header('set-cookie', cookie, { append: true });
    return c.json({ padId: pad.id });
  });

  r.get('/pads/:id', async (c) => {
    const user = requireUser(c);
    const { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    const [row] = pad.problemSlug
      ? await db.select().from(problems).where(eq(problems.slug, pad.problemSlug))
      : [];
    if (pad.problemSlug && !row) throw notFound('Problem');
    // A room's candidates learn nothing about the host's key: the AI there is the host's alone.
    const hideKey = pad.kind === 'room' && role !== 'owner';
    const [problem, members, msgs, runRows, key] = await Promise.all([
      publicProblem(ctx, row ?? null),
      padMembersOf(ctx, pad.id),
      db.select().from(messages).where(eq(messages.padId, pad.id)).orderBy(asc(messages.createdAt)),
      db.select().from(runs).where(eq(runs.padId, pad.id)).orderBy(asc(runs.createdAt)),
      hideKey
        ? ({ key: 'missing', model: null } as const)
        : ctx.ai.padModel(pad.ownerId, pad.interviewer),
    ]);
    const detail: PadDetail = {
      pad: padView(pad, user.id),
      role,
      problem,
      members,
      messages: msgs.map(messageView),
      runs: runRows.map((r) => toPublicRun(storedRun(r))),
      interviewerAvailable: key.key === 'active',
      interviewerKey: key.key,
      interviewerModel: key.model,
    };
    return c.json(detail);
  });

  // A room's host moves on to another problem (or to a blank editor).
  r.post('/pads/:id/problem', async (c) => {
    const { pad, user } = await roomForHost(c);
    const body = await parseBody(c, ChangeProblemRequest);
    if (pad.status !== 'active') throw conflict('pad_ended', 'This pad has ended');
    const [next] = body.problemSlug
      ? await db
          .select()
          .from(problems)
          .where(and(eq(problems.slug, body.problemSlug), eq(problems.active, true)))
      : [];
    if (body.problemSlug && !next) throw notFound('Problem');
    if ((next?.slug ?? null) === pad.problemSlug)
      return c.json({
        pad: padView(pad, user.id),
        problem: await publicProblem(ctx, next ?? null),
      });
    const wait = await ctx.limiter.hit([
      { key: `problem:u:${user.id}`, ...ctx.config.limits.problemChange.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);
    const changed = await changeProblem(ctx, pad, next ?? null);
    if (!changed) throw conflict('pad_changed', 'The pad changed in the meantime; try again');
    const [row] = await db.select().from(pads).where(eq(pads.id, pad.id));
    return c.json({ pad: row ? padView(row, user.id) : changed.pad, problem: changed.problem });
  });

  // What only the host sees: the problem's interviewer notes and reference solutions, and
  // their own notes on the interview.
  r.get('/pads/:id/host', async (c) => {
    const { pad } = await roomForHost(c);
    const [problem] = pad.problemSlug
      ? await db
          .select({
            slug: problems.slug,
            interviewerNotes: problems.interviewerNotes,
            referenceSolutions: problems.referenceSolutions,
          })
          .from(problems)
          .where(eq(problems.slug, pad.problemSlug))
      : [];
    const view: HostView = { problem: problem ?? null, notes: pad.hostNotes };
    return c.json(view);
  });

  // Also after the room ended, so the notes can be finished once the candidate has left.
  r.put('/pads/:id/host/notes', async (c) => {
    const { pad } = await roomForHost(c);
    const { notes } = await parseBody(c, UpdateHostNotesRequest);
    await db.update(pads).set({ hostNotes: notes }).where(eq(pads.id, pad.id));
    return c.json({ notes });
  });

  // The AI's second opinion on the code as it is now: for the host only, on the host's key,
  // never broadcast or stored.
  r.post('/pads/:id/review', async (c) => {
    const { pad, user } = await roomForHost(c);
    const body = await parseBody(c, ReviewRequest);
    if ((await ctx.ai.keyState(user.id)) !== 'active')
      throw conflict('ai_key_missing', 'Add your AI API key first');
    const l = ctx.config.limits.review;
    const wait = await ctx.limiter.hit([
      { key: `review:u:${user.id}:burst`, ...l.userBurst },
      { key: `review:u:${user.id}:day`, ...l.userDaily },
    ]);
    if (wait > 0) throw rateLimited(wait);
    const out = await ctx.ai.interviewer.reviewSolution(pad.id, body.question || undefined);
    if (out.ok) return c.json(out.review);
    if (out.reason === 'no_key') throw conflict('ai_key_missing', 'Add your AI API key first');
    if (out.reason === 'budget')
      throw new HttpError(429, 'ai_budget', out.message ?? 'The daily AI limit has been reached');
    throw new HttpError(502, 'review_failed', 'The AI could not review the code just now');
  });

  r.patch('/pads/:id', async (c) => {
    const user = requireUser(c);
    const body = await parseBody(c, UpdatePadRequest);
    let { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    if ((body.title !== undefined || body.interviewer !== undefined) && role !== 'owner') {
      throw forbidden('Only the owner can change the title or interviewer settings');
    }
    if (pad.status !== 'active') throw conflict('pad_ended', 'This pad has ended');
    if (body.language !== undefined && body.language !== pad.language) {
      // Refuse before changing anything else (changeLanguage checks again for the WS path).
      const [problem] = pad.problemSlug
        ? await db
            .select({ title: problems.title, languages: problems.languages })
            .from(problems)
            .where(eq(problems.slug, pad.problemSlug))
        : [];
      if (problem) assertLanguageOffered(problem, body.language);
    }
    if (body.title !== undefined || body.interviewer !== undefined) {
      const [row] = await db
        .update(pads)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() || pad.title } : {}),
          ...(body.interviewer !== undefined
            ? {
                interviewer: {
                  ...pad.interviewer,
                  ...body.interviewer,
                  // The AI never joins a room's conversation.
                  ...(pad.kind === 'room' ? { enabled: false, voice: false } : {}),
                },
              }
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

  // Owner: deletes the pad for everyone. Collaborator: removes it from their own history only.
  // Active pads may be deleted too (that ends the session). A repeat after success is a 404.
  r.delete('/pads/:id', async (c) => {
    const user = requireUser(c);
    const { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    if (role === 'owner') await deletePad(ctx, pad.id);
    else await leavePad(ctx, pad.id, user.id);
    const res: DeletePadResponse = {
      padId: pad.id,
      removed: role === 'owner' ? 'pad' : 'membership',
    };
    return c.json(res);
  });

  r.get('/pads/:id/report', async (c) => {
    const user = requireUser(c);
    const { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    assertMayReview(pad, role);
    if (pad.status === 'active')
      throw conflict('pad_active', 'The report is available after the pad ends');
    let [row] = await db.select().from(reports).where(eq(reports.padId, pad.id));
    if (!row) {
      // Ended without a report (e.g. crash mid-end): create it now.
      const stats = await computeStats(ctx, pad);
      const room = pad.kind === 'room';
      [row] = await db
        .insert(reports)
        .values({
          padId: pad.id,
          status: room ? 'ready' : 'pending',
          stats,
          assessment: null,
          ...(room ? { generatedAt: new Date() } : {}),
        })
        .onConflictDoNothing()
        .returning();
      if (!room)
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
      // A room: nothing was asked for yet, unless an attempt failed.
      if (pad.kind === 'room' && row.status !== 'failed') unavailable = 'not_requested';
      else if (pad.kind !== 'room' && !pad.interviewer.enabled) unavailable = 'interviewer_off';
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
      // Only a room's host gets this far (assertMayReview).
      hostNotes: pad.kind === 'room' ? pad.hostNotes : null,
    };
  }

  /** A room's report and playback are the host's: the candidate does not get to read them. */
  function assertMayReview(pad: PadRow, role: string): void {
    if (pad.kind === 'room' && role !== 'owner')
      throw forbidden('Only the host can open the report of an interview room');
  }

  // The owner asks for the assessment again, typically right after adding their API key.
  r.post('/pads/:id/report/assessment', async (c) => {
    const user = requireUser(c);
    const { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    if (role !== 'owner') throw forbidden('Only the pad owner can request the assessment');
    if (pad.status === 'active')
      throw conflict('pad_active', 'The report is available after the pad ends');
    if (pad.kind !== 'room' && !pad.interviewer.enabled)
      throw conflict('interviewer_off', 'The interviewer was off for this interview');
    const [row] = await db.select().from(reports).where(eq(reports.padId, pad.id));
    if (!row) throw notFound('Report');
    if (row.assessment || row.status === 'pending') return c.json(await reportView(pad, row));
    if ((await ctx.ai.keyState(user.id)) !== 'active')
      throw conflict('ai_key_missing', 'Add your AI API key first');
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
    const { pad, role } = await padForMember(ctx, c.req.param('id'), user.id);
    assertMayReview(pad, role);
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
