import {
  Difficulty,
  ProblemCategory,
  type ProblemProgress,
  SetTrackRequest,
  type SetTrackResponse,
  Slug,
  type Track,
  WsTicketRequest,
} from '@ipp/contracts';
import { pads, problems, problemTests, runs, user as users } from '@ipp/db';
import { and, arrayContains, asc, eq, ilike, isNotNull, max, or, type SQL, sql } from '@ipp/db/orm';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireAccount, requireUser } from '../http/app';
import { badRequest, notFound, rateLimited } from '../http/errors';
import { padForMember } from '../pads/service';
import { problemDetail, problemSummary } from '../views';

export function miscRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.get('/me', async (c) => {
    const user = requireUser(c);
    // Read from the row, not the session: the column is ours (Better Auth does not know it), and
    // a choice made a moment ago must show at once. A guest has no track.
    let track: Track | null = null;
    if (!user.guest) {
      const [row] = await ctx.db
        .select({ track: users.track })
        .from(users)
        .where(eq(users.id, user.id));
      track = row?.track ?? null;
    }
    return c.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        guest: user.guest,
        track,
      },
    });
  });

  /** The site track the header switch chose, remembered for the account. */
  r.put('/me/track', async (c) => {
    const user = requireAccount(c);
    const { track } = await parseBody(c, SetTrackRequest);
    const wait = await ctx.limiter.hit([
      { key: `track:u:${user.id}`, ...ctx.config.limits.trackChanges.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);
    await ctx.db.update(users).set({ track, updatedAt: new Date() }).where(eq(users.id, user.id));
    const out: SetTrackResponse = { track };
    return c.json(out);
  });

  // Server facts only. Whether the AI features work is per user (their own key): GET /api/ai-key,
  // and `interviewerAvailable` on a pad (its owner's key).
  r.get('/config', (c) =>
    c.json({
      githubAuth: ctx.config.github !== null,
      googleAuth: ctx.config.google !== null,
      ai: {
        requiresUserKey: true as const,
        model: ctx.config.interviewerModel,
        keyTtlHours: ctx.config.aiKeyTtlHours,
      },
    }),
  );

  r.get('/problems', async (c) => {
    const where: SQL[] = [eq(problems.active, true)];
    const difficulty = c.req.query('difficulty');
    if (difficulty) {
      const d = Difficulty.safeParse(difficulty);
      if (!d.success) throw badRequest('Unknown difficulty', 'validation_error');
      where.push(eq(problems.difficulty, d.data));
    }
    const category = c.req.query('category');
    if (category) {
      const k = ProblemCategory.safeParse(category);
      if (!k.success) throw badRequest('Unknown category', 'validation_error');
      where.push(eq(problems.category, k.data));
    }
    const tag = c.req.query('tag');
    if (tag) {
      if (!Slug.safeParse(tag).success) throw badRequest('Invalid tag', 'validation_error');
      where.push(arrayContains(problems.tags, [tag]));
    }
    const q = c.req.query('q')?.trim().slice(0, 100);
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const match = or(ilike(problems.title, pattern), ilike(problems.slug, pattern));
      if (match) where.push(match);
    }
    const rows = await ctx.db
      .select()
      .from(problems)
      .where(and(...where))
      .orderBy(asc(problems.title));
    return c.json(rows.map(problemSummary));
  });

  /**
   * The caller's own standing on each problem they have touched (`ProblemProgress`): solved with
   * an accepted submission of theirs in any pad, attempted with any other run of theirs or a
   * practice interview of their own on it. Only the caller's rows are read: a room's host does
   * not get their candidate's runs, nor the candidate the host's.
   */
  r.get('/progress/problems', async (c) => {
    const user = requireAccount(c);
    const [ran, started] = await Promise.all([
      ctx.db
        .select({
          slug: runs.problemSlug,
          solved: sql<boolean>`bool_or(${runs.mode} = 'submit' and ${runs.verdict} = 'accepted')`,
          last: max(runs.createdAt),
        })
        .from(runs)
        .where(and(eq(runs.userId, user.id), isNotNull(runs.problemSlug)))
        .groupBy(runs.problemSlug),
      ctx.db
        .select({ slug: pads.problemSlug, last: max(pads.startedAt) })
        .from(pads)
        .where(
          and(
            eq(pads.ownerId, user.id),
            eq(pads.kind, 'practice'),
            eq(pads.format, 'coding'),
            isNotNull(pads.problemSlug),
          ),
        )
        .groupBy(pads.problemSlug),
    ]);
    const bySlug = new Map<string, { solved: boolean; last: Date }>();
    for (const row of [...ran, ...started]) {
      if (!row.slug || !row.last) continue;
      const solved = 'solved' in row && row.solved === true;
      const seen = bySlug.get(row.slug);
      bySlug.set(row.slug, {
        solved: solved || (seen?.solved ?? false),
        last: seen && seen.last > row.last ? seen.last : row.last,
      });
    }
    const out: ProblemProgress = [...bySlug]
      .map(([slug, p]) => ({
        slug,
        status: p.solved ? ('solved' as const) : ('attempted' as const),
        lastActivityAt: p.last.toISOString(),
      }))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    return c.json(out);
  });

  r.get('/problems/:slug', async (c) => {
    const slug = c.req.param('slug');
    if (!Slug.safeParse(slug).success) throw notFound('Problem');
    const [row] = await ctx.db
      .select()
      .from(problems)
      .where(and(eq(problems.slug, slug), eq(problems.active, true)));
    if (!row) throw notFound('Problem');
    const tests = await ctx.db
      .select()
      .from(problemTests)
      .where(eq(problemTests.problemSlug, slug));
    return c.json(problemDetail(row, tests));
  });

  r.post('/ws-ticket', async (c) => {
    const user = requireUser(c);
    const { padId } = await parseBody(c, WsTicketRequest);
    await padForMember(ctx, padId, user.id);
    const wait = await ctx.limiter.hit([
      { key: `wst:u:${user.id}`, ...ctx.config.limits.wsTickets.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);
    return c.json(await ctx.tickets.issue({ userId: user.id, padId }));
  });

  return r;
}
