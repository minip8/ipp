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
import { rateLimited } from '../http/errors';

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

  r.get('/drill/runs', async (c) => {
    const user = requireAccount(c);
    const mine = eq(drillRuns.userId, user.id);
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
    const res: DrillHistory = {
      runs: rows.map(view),
      bests: drillBests(
        candidates.flatMap((b) => (b.finishedAt ? [{ ...b, finishedAt: b.finishedAt }] : [])),
      ),
      totalRuns: total?.n ?? 0,
    };
    return c.json(res);
  });

  return r;
}
