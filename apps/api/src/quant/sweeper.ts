/**
 * The quant round's clock when nobody is there (ARCHITECTURE §8.2). The interviewer applies a
 * round's clock (nudge, close for `timeout`, close for `round_time`) on its ticks, which reach
 * only pads someone is connected to; without this a round left alone would stand still and then
 * jump when someone came back. Every `timing.quantSweepMs` the API closes, in each active quant
 * pad nobody is connected to, the question whose budget and grace are up, or the open one once
 * the round's clock has run out: the same close the interviewer's failure path makes, with the
 * same canned line and no verdict, and no model call, so nobody's key is spent while nobody is
 * there. There is no nudge: nobody would hear it.
 *
 * - One clock: the sweeper decides on the database's clock (`Ctx.dbNow`), the one `applyStep`
 *   judges on, so its closes are never refused as `too_early`.
 * - Never against a live interviewer: a pad someone is connected to (the set the tick loop
 *   reaches) is skipped, checked again just before each close, so the sweeper never pre-empts a
 *   turn the interviewer has in flight there. A pad nobody is connected to gets no ticks, and
 *   the last event socket closing releases its interviewer (aborting a call in flight). Any race
 *   left is settled by the round's compare-and-swap: a step on an older version is `stale` and
 *   posts nothing, so a question is never closed twice.
 * - An unattended round runs to its end question by question: each close poses the next with a
 *   fresh budget, which the sweeper closes in turn once it is up, until the round's clock runs
 *   out. A pending round (never started) is left alone: it starts when someone comes.
 * - When someone comes back, the interviewer's mirror of the round (version, phase, clock) is
 *   rebuilt from the context it loads (a new runtime hydrates; one still held refreshes on its
 *   next load), so it carries on from the round as it now is.
 *
 * The API is a single instance (pad rooms are in memory), so one sweeper sees every live pad.
 */
import { quantClock, quantRoundEndsAt } from '@ipp/contracts';
import { pads, quantRounds } from '@ipp/db';
import { and, eq, sql } from '@ipp/db/orm';
import { cannedCloseLine, quantDue } from '@ipp/interviewer';
import type { Ctx } from '../context';
import { applyStep } from './round';

/**
 * One pass: closes what the clock requires in every active, unattended quant pad. `isLive` says
 * whether someone is connected to a pad. Returns how many questions it closed.
 */
export async function sweepQuantRounds(
  ctx: Ctx,
  isLive: (padId: string) => boolean,
): Promise<number> {
  const current = sql`(${quantRounds.state}->>'current')::int`;
  const rows = await ctx.db
    .select({
      padId: pads.id,
      startedAt: pads.startedAt,
      state: quantRounds.state,
      version: quantRounds.version,
    })
    .from(pads)
    .innerJoin(quantRounds, eq(quantRounds.padId, pads.id))
    .where(
      and(
        eq(pads.format, 'quant'),
        eq(pads.status, 'active'),
        // Asking: a question is open.
        sql`${current} >= 0 and ${current} < jsonb_array_length(${quantRounds.state}->'questions')`,
      ),
    );
  let closed = 0;
  for (const row of rows) {
    if (isLive(row.padId)) continue;
    const now = (await ctx.dbNow(ctx.db)).getTime();
    const clock = quantClock(row.state, quantRoundEndsAt(row.startedAt, row.state.durationMin));
    const due = quantDue(clock, now);
    if (!clock || (due !== 'timeout' && due !== 'round_time')) continue;
    // Someone may have come back while the pass got here: then the interviewer has it.
    if (isLive(row.padId)) continue;
    let result: Awaited<ReturnType<typeof applyStep>>;
    try {
      result = await applyStep(ctx, row.padId, {
        type: 'close',
        version: row.version,
        index: clock.index,
        kind: 'proactive',
        say: cannedCloseLine(due, clock, row.state.questions.length, now),
        by: due,
        verdict: null,
      });
    } catch (err) {
      // One pad's failure does not hold up the others; the next pass tries it again.
      ctx.log.error({ err, padId: row.padId }, 'unattended quant close failed');
      continue;
    }
    if (result.ok) {
      closed++;
      ctx.log.info({ padId: row.padId, index: clock.index, by: due }, 'unattended quant close');
    } else {
      ctx.log.debug({ padId: row.padId, reason: result.reason }, 'unattended quant close refused');
    }
  }
  return closed;
}

export interface QuantSweeper {
  /** Stops the timer and waits for a pass in progress. */
  stop(): Promise<void>;
}

/**
 * Runs `sweepQuantRounds` every `intervalMs` (never two passes at once). The timer does not
 * keep the process alive; a failed pass is logged and the next one runs as usual.
 */
export function startQuantSweeper(
  ctx: Ctx,
  isLive: (padId: string) => boolean,
  intervalMs: number,
): QuantSweeper {
  let running: Promise<void> | null = null;
  let stopped = false;
  const timer = setInterval(() => {
    if (running || stopped) return;
    running = sweepQuantRounds(ctx, isLive)
      .then(() => undefined)
      .catch((err) => ctx.log.error({ err }, 'quant sweep failed'))
      .finally(() => {
        running = null;
      });
  }, intervalMs);
  timer.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
