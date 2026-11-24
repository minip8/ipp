import { Difficulty, ProblemCategory, Slug, WsTicketRequest } from '@ipp/contracts';
import { problems, problemTests } from '@ipp/db';
import { and, arrayContains, asc, eq, ilike, or, type SQL } from '@ipp/db/orm';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireUser } from '../http/app';
import { badRequest, notFound, rateLimited } from '../http/errors';
import { padForMember } from '../pads/service';
import { problemDetail, problemSummary } from '../views';

export function miscRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.get('/me', (c) => {
    const user = requireUser(c);
    return c.json({ user: { id: user.id, name: user.name, email: user.email, image: user.image } });
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
