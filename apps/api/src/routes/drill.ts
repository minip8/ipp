/**
 * The mental math drill: the browser plays and marks a run, the API stores its result for the
 * user's own history and bests. The request is the contract's word for what is consistent and
 * humanly possible; totals and score are computed here.
 */
import {
  DRILL_HISTORY_LIMIT,
  type DrillHistory,
  type DrillRun,
  isFullMix,
  RecordDrillRunRequest,
  type RecordDrillRunResponse,
} from '@ipp/contracts';
import { drillRuns } from '@ipp/db';
import { and, count, desc, eq, max, min } from '@ipp/db/orm';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { drillBests, drillTotals, isNewBest, orderByCategory } from '../drill/bests';
import { type Env, parseBody, requireAccount } from '../http/app';
import { notFound, rateLimited } from '../http/errors';

type DrillRow = typeof drillRuns.$inferSelect;

const view = (r: DrillRow): DrillRun => ({
  id: r.id,
  config: {
    durationSec: r.durationSec as DrillRun['config']['durationSec'],
    level: r.level,
    categories: r.categories,
  },
  byCategory: r.byCategory,
  correct: r.correct,
  wrong: r.wrong,
  skipped: r.skipped,
  score: r.score,
  elapsedMs: r.elapsedMs,
  finishedAt: r.finishedAt.toISOString(),
});

export function drillRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  const { db } = ctx;

  r.post('/drill/runs', async (c) => {
    const user = requireAccount(c);
    const body = await parseBody(c, RecordDrillRunRequest);
    const l = ctx.config.limits.drillRuns;
    const wait = await ctx.limiter.hit([
      { key: `drill:u:${user.id}:burst`, ...l.userBurst },
      { key: `drill:u:${user.id}:day`, ...l.userDaily },
    ]);
    if (wait > 0) throw rateLimited(wait);
    const { durationSec, level, categories } = body.config;
    const fullMix = isFullMix(body.config);
    const totals = drillTotals(body.byCategory);

    let previousBest: number | null = null;
    if (fullMix) {
      const [prev] = await db
        .select({ best: max(drillRuns.score) })
        .from(drillRuns)
        .where(
          and(
            eq(drillRuns.userId, user.id),
            eq(drillRuns.fullMix, true),
            eq(drillRuns.durationSec, durationSec),
            eq(drillRuns.level, level),
          ),
        );
      previousBest = prev?.best ?? null;
    }
    const [row] = await db
      .insert(drillRuns)
      .values({
        userId: user.id,
        durationSec,
        level,
        categories,
        fullMix,
        byCategory: orderByCategory(body.byCategory),
        ...totals,
        elapsedMs: body.elapsedMs,
      })
      .returning();
    if (!row) throw new Error('drill run insert returned nothing');
    const res: RecordDrillRunResponse = {
      run: view(row),
      newBest: fullMix && isNewBest(totals.score, previousBest),
    };
    return c.json(res);
  });

  /** The caller's recent runs, bests and count (`GET`, and the answer to a delete). */
  async function historyOf(userId: string): Promise<DrillHistory> {
    const mine = eq(drillRuns.userId, userId);
    const [rows, candidates, [total]] = await Promise.all([
      db
        .select()
        .from(drillRuns)
        .where(mine)
        .orderBy(desc(drillRuns.finishedAt), desc(drillRuns.id))
        .limit(DRILL_HISTORY_LIMIT),
      // One row per duration, level and score (its earliest run); drillBests picks the top one.
      db
        .select({
          durationSec: drillRuns.durationSec,
          level: drillRuns.level,
          score: drillRuns.score,
          finishedAt: min(drillRuns.finishedAt),
        })
        .from(drillRuns)
        .where(and(mine, eq(drillRuns.fullMix, true)))
        .groupBy(drillRuns.durationSec, drillRuns.level, drillRuns.score),
      db.select({ n: count() }).from(drillRuns).where(mine),
    ]);
    return {
      runs: rows.map(view),
      bests: drillBests(
        candidates.flatMap((b) => (b.finishedAt ? [{ ...b, finishedAt: b.finishedAt }] : [])),
      ),
      totalRuns: total?.n ?? 0,
    };
  }

  r.get('/drill/runs', async (c) => {
    const user = requireAccount(c);
    return c.json(await historyOf(user.id));
  });

  async function deleteLimit(userId: string) {
    const wait = await ctx.limiter.hit([
      { key: `histdel:u:${userId}`, ...ctx.config.limits.historyDeletes.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);
  }

  /**
   * Deletes one of the caller's runs and answers with the history as it now is: a run that held
   * a best hands it to the next highest run of its duration and level, or to none. Someone
   * else's id is a 404.
   */
  r.delete('/drill/runs/:id', async (c) => {
    const user = requireAccount(c);
    await deleteLimit(user.id);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Run');
    const [row] = await db
      .delete(drillRuns)
      .where(and(eq(drillRuns.id, id), eq(drillRuns.userId, user.id)))
      .returning({ id: drillRuns.id });
    if (!row) throw notFound('Run');
    return c.json(await historyOf(user.id));
  });

  /** Deletes every run of the caller's, and so every best. */
  r.delete('/drill/runs', async (c) => {
    const user = requireAccount(c);
    await deleteLimit(user.id);
    await db.delete(drillRuns).where(eq(drillRuns.userId, user.id));
    return c.json(await historyOf(user.id));
  });

  return r;
}
