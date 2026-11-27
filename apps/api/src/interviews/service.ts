/**
 * Staged interviews (@ipp/contracts `interview.ts`): an ordered plan of stages taken in one
 * sitting with the AI interviewer, each stage an ordinary practice pad created when it starts.
 *
 * - The plan is checked as a whole before anything is created, so a plan that cannot run fails
 *   at once rather than half way through (`assertPlanStartable`).
 * - A stage's draw (a random problem, the round's questions, the game) is made when the stage
 *   starts (`drawStage`), never before: nothing of a later stage exists to leak.
 * - Moving on is a compare-and-swap on `interviews.current` in the transaction that inserts the
 *   next stage's pad, and the unique index on (interview_id, stage_index) backs it, so a double
 *   click or a second tab never starts a stage twice. The stage being left is ended first, by
 *   `endPad` as any pad is (report, assessment); when the next stage cannot start, the interview
 *   is left at the stage it was on with that pad ended, and `next` can be asked for again.
 * - The last stage's pad ending, by whatever route, ends the interview (`endPad`).
 */
import {
  type CodingStage,
  type CreateInterviewRequest,
  createQuantRound,
  type Interview,
  type InterviewStage,
  type InterviewStart,
  type PadInterview,
  presetById,
  type QuantRoundState,
  quantQuestionCount,
} from '@ipp/contracts';
import { interviews, pads, problems, quantGames, quizTopics, reports } from '@ipp/db';
import { and, arrayContains, desc, eq, exists, inArray, type SQL, sql } from '@ipp/db/orm';
import type { SessionUser } from '../auth';
import type { Ctx } from '../context';
import { conflict, HttpError, notFound } from '../http/errors';
import { insertPad, insertQuantPad, padCreateLimit, type Tx } from '../pads/create';
import { assertLanguageOffered, deletePad, endPad, type PadRow } from '../pads/service';
import { isUniqueViolation } from '../pg';
import { assembleForTopics, assembleGameRound, eligibleCount } from '../quant/assemble';
import { interviewView, type StagePadRow } from '../views';
import { GAME_STAGE_TITLE, interviewTitle, stageName, topicsTitle } from './logic';

export type InterviewRow = typeof interviews.$inferSelect;

/** How many interviews the list returns, newest first. */
export const INTERVIEWS_LIST_LIMIT = 100;

/** A canonical uuid; anything else is 404 before Postgres sees it (it would refuse it: a 500). */
export const isId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** The interview if `userId` owns it; 404 otherwise, so ids cannot be probed. */
export async function ownInterview(ctx: Ctx, userId: string, id: string): Promise<InterviewRow> {
  if (!isId(id)) throw notFound('Interview');
  const [row] = await ctx.db
    .select()
    .from(interviews)
    .where(and(eq(interviews.id, id), eq(interviews.ownerId, userId)));
  if (!row) throw notFound('Interview');
  return row;
}

// ---------------------------------------------------------------- views

/** The stages' pads of these interviews, with their problem titles and reports: one query. */
async function stagePadsOf(ctx: Ctx, ids: readonly string[]): Promise<Map<string, StagePadRow[]>> {
  const out = new Map<string, StagePadRow[]>();
  if (ids.length === 0) return out;
  const rows = await ctx.db
    .select({
      id: pads.id,
      interviewId: pads.interviewId,
      stageIndex: pads.stageIndex,
      title: pads.title,
      format: pads.format,
      status: pads.status,
      startedAt: pads.startedAt,
      endedAt: pads.endedAt,
      problemTitle: problems.title,
      reportStatus: reports.status,
      // The headline only: the rest of the assessment is the pad's report's.
      recommendation: sql<unknown>`${reports.assessment}->'recommendation'`,
    })
    .from(pads)
    .leftJoin(problems, eq(problems.slug, pads.problemSlug))
    .leftJoin(reports, eq(reports.padId, pads.id))
    .where(inArray(pads.interviewId, [...ids]));
  for (const r of rows) {
    if (r.interviewId === null || r.stageIndex === null) continue;
    const list = out.get(r.interviewId) ?? [];
    list.push({
      id: r.id,
      stageIndex: r.stageIndex,
      title: r.title,
      format: r.format,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      problemTitle: r.problemTitle,
      report: r.reportStatus ? { status: r.reportStatus, recommendation: r.recommendation } : null,
    });
    out.set(r.interviewId, list);
  }
  return out;
}

export async function interviewOf(ctx: Ctx, row: InterviewRow): Promise<Interview> {
  const stagePads = await stagePadsOf(ctx, [row.id]);
  return interviewView(row, stagePads.get(row.id) ?? []);
}

/** The user's interviews, newest first. */
export async function interviewsOf(ctx: Ctx, userId: string): Promise<Interview[]> {
  const rows = await ctx.db
    .select()
    .from(interviews)
    .where(eq(interviews.ownerId, userId))
    .orderBy(desc(interviews.startedAt))
    .limit(INTERVIEWS_LIST_LIMIT);
  const stagePads = await stagePadsOf(
    ctx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => interviewView(r, stagePads.get(r.id) ?? []));
}

/** The interview and the pad to open: the stage under way, or null. */
async function startView(ctx: Ctx, id: string): Promise<InterviewStart> {
  const [row] = await ctx.db.select().from(interviews).where(eq(interviews.id, id));
  if (!row) throw notFound('Interview');
  const interview = await interviewOf(ctx, row);
  const active = interview.stages.find((s) => s.status === 'active');
  return { interview, padId: active?.pad?.id ?? null };
}

/**
 * Where the pad sits in its interview, for its owner's page (`PadDetail.interview`); null for a
 * pad of no interview and for anyone but the owner (a collaborator who joined by the link).
 */
export async function padInterviewOf(
  ctx: Ctx,
  pad: Pick<PadRow, 'interviewId' | 'stageIndex' | 'ownerId'>,
  viewerId: string,
): Promise<PadInterview | null> {
  if (pad.interviewId === null || pad.stageIndex === null || pad.ownerId !== viewerId) return null;
  const [row] = await ctx.db
    .select({
      id: interviews.id,
      title: interviews.title,
      stages: interviews.stages,
      status: interviews.status,
    })
    .from(interviews)
    .where(and(eq(interviews.id, pad.interviewId), eq(interviews.ownerId, viewerId)));
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    index: pad.stageIndex,
    total: row.stages.length,
    next: row.stages[pad.stageIndex + 1] ?? null,
    active: row.status === 'active',
  };
}

// ---------------------------------------------------------------- checking the plan

/** Active problems that can be a coding stage's random pick. */
function codingFilter(stage: CodingStage): SQL[] {
  const where: SQL[] = [
    eq(problems.active, true),
    // Only problems that can be solved in the stage's language.
    arrayContains(problems.languages, [stage.language]),
  ];
  if (stage.difficulty) where.push(eq(problems.difficulty, stage.difficulty));
  if (stage.category) where.push(eq(problems.category, stage.category));
  return where;
}

/** The active problem a coding stage names; 404 without one, 400 when it lacks the language. */
async function namedProblem(ctx: Ctx, stage: CodingStage, index: number) {
  const [problem] = await ctx.db
    .select()
    .from(problems)
    .where(and(eq(problems.slug, stage.problemSlug ?? ''), eq(problems.active, true)));
  if (!problem) throw new HttpError(404, 'not_found', `${stageName(index)}: problem not found`);
  assertLanguageOffered(problem, stage.language);
  return problem;
}

/** The titles of a questions stage's topics, in its order; 404 naming the first missing one. */
async function stageTopicTitles(
  ctx: Ctx,
  topics: readonly string[],
  index: number,
): Promise<string[]> {
  const rows = await ctx.db
    .select({ slug: quizTopics.slug, title: quizTopics.title })
    .from(quizTopics)
    .where(inArray(quizTopics.slug, [...topics]));
  const title = new Map(rows.map((r) => [r.slug, r.title]));
  const missing = topics.find((t) => !title.has(t));
  if (missing)
    throw new HttpError(404, 'not_found', `${stageName(index)}: there is no topic "${missing}"`);
  return topics.map((t) => title.get(t) ?? t);
}

const questionsUnavailable = (index: number, titles: readonly string[], durationMin: number) =>
  `${stageName(index)} (${topicsTitle(titles)}): there are not enough questions for a ${durationMin}-minute round yet`;

const gameUnavailable = (index: number) =>
  `${stageName(index)}: there is no market-making game to play yet`;

/**
 * Every stage of the plan can start: a named problem is active and offers the stage's language;
 * a random coding stage has a matching problem; a questions stage's topics exist and hold enough
 * eligible questions for its length; a game stage has an active game. Throws the first failure,
 * naming its stage.
 */
export async function assertPlanStartable(
  ctx: Ctx,
  stages: readonly InterviewStage[],
): Promise<void> {
  for (const [index, stage] of stages.entries()) {
    if (stage.kind === 'coding') {
      if (stage.problemSlug) {
        await namedProblem(ctx, stage, index);
        continue;
      }
      const [any] = await ctx.db
        .select({ slug: problems.slug })
        .from(problems)
        .where(and(...codingFilter(stage)))
        .limit(1);
      if (!any)
        throw new HttpError(
          404,
          'not_found',
          `${stageName(index)}: no problem matches that difficulty, category and language`,
        );
    } else if (stage.kind === 'questions') {
      const titles = await stageTopicTitles(ctx, stage.topics, index);
      if ((await eligibleCount(ctx, stage.topics)) < quantQuestionCount(stage.durationMin))
        throw conflict('quant_unavailable', questionsUnavailable(index, titles, stage.durationMin));
    } else {
      const [game] = await ctx.db
        .select({ id: quantGames.id })
        .from(quantGames)
        .where(eq(quantGames.active, true))
        .limit(1);
      if (!game) throw conflict('quant_unavailable', gameUnavailable(index));
    }
  }
}

// ---------------------------------------------------------------- starting a stage

/** What a stage drew when it started: enough to insert its pad. */
type StageDraw =
  | { format: 'coding'; title: string; problemSlug: string; language: CodingStage['language'] }
  | { format: 'quant'; title: string; state: QuantRoundState };

/**
 * A coding stage's problem: the one it names, or a random active match, preferring one the
 * owner has not had in any earlier pad (any match when every one has been had).
 */
async function drawProblem(ctx: Ctx, userId: string, stage: CodingStage, index: number) {
  if (stage.problemSlug) return namedProblem(ctx, stage, index);
  const had = exists(
    ctx.db
      .select({ one: sql`1` })
      .from(pads)
      .where(and(eq(pads.ownerId, userId), eq(pads.problemSlug, problems.slug))),
  );
  const [problem] = await ctx.db
    .select()
    .from(problems)
    .where(and(...codingFilter(stage)))
    .orderBy(had, sql`random()`)
    .limit(1);
  if (!problem)
    throw new HttpError(
      404,
      'not_found',
      `${stageName(index)}: no problem matches that difficulty, category and language`,
    );
  return problem;
}

/** What the stage draws, chosen now (reads only: nothing is written). */
async function drawStage(
  ctx: Ctx,
  userId: string,
  stage: InterviewStage,
  index: number,
): Promise<StageDraw> {
  if (stage.kind === 'coding') {
    const problem = await drawProblem(ctx, userId, stage, index);
    return {
      format: 'coding',
      title: problem.title,
      problemSlug: problem.slug,
      language: stage.language,
    };
  }
  if (stage.kind === 'questions') {
    const titles = await stageTopicTitles(ctx, stage.topics, index);
    const { picks, subject } = await assembleForTopics(
      ctx,
      userId,
      stage.topics,
      stage.durationMin,
      { unavailable: questionsUnavailable(index, titles, stage.durationMin) },
    );
    return {
      format: 'quant',
      title: topicsTitle(titles),
      state: createQuantRound(null, stage.durationMin, picks, subject),
    };
  }
  const picks = await assembleGameRound(ctx, userId, { unavailable: gameUnavailable(index) });
  return {
    format: 'quant',
    title: GAME_STAGE_TITLE,
    state: createQuantRound(null, stage.durationMin, picks, 'quant'),
  };
}

/** Inserts the stage's pad (and a quant stage's round) in the caller's transaction. */
function insertStagePad(
  tx: Tx,
  interview: InterviewRow,
  index: number,
  draw: StageDraw,
): Promise<PadRow> {
  const stage = interview.stages[index];
  if (!stage) throw new Error(`interview ${interview.id} has no stage ${index}`);
  const common = {
    ownerId: interview.ownerId,
    title: draw.title,
    kind: 'practice' as const,
    durationMin: stage.durationMin,
    // Every stage is run by the interviewer.
    interviewer: { ...interview.interviewer, enabled: true },
    interviewId: interview.id,
    stageIndex: index,
  };
  return draw.format === 'coding'
    ? insertPad(tx, {
        ...common,
        format: 'coding',
        problemSlug: draw.problemSlug,
        language: draw.language,
      })
    : insertQuantPad(tx, common, draw.state);
}

// ---------------------------------------------------------------- the routes' work

/** `POST /api/interviews`: checks the plan, then creates the interview and starts stage 0. */
export async function createInterview(
  ctx: Ctx,
  user: SessionUser,
  body: CreateInterviewRequest,
): Promise<InterviewStart> {
  await padCreateLimit(ctx, user.id);
  if ((await ctx.ai.keyState(user.id)) !== 'active')
    throw conflict('ai_key_missing', 'Add your AI API key first: the interviewer runs every stage');
  await assertPlanStartable(ctx, body.stages);
  const first = body.stages[0];
  if (!first) throw new Error('an interview has at least one stage');
  const draw = await drawStage(ctx, user.id, first, 0);
  // A preset this server does not know is not recorded as one.
  const preset = presetById(body.preset)?.id ?? null;
  const { interview, pad } = await ctx.db.transaction(async (tx) => {
    const [interview] = await tx
      .insert(interviews)
      .values({
        ownerId: user.id,
        title: interviewTitle(body.title, preset),
        track: body.track,
        preset,
        stages: body.stages,
        interviewer: body.interviewer,
        current: 0,
      })
      .returning();
    if (!interview) throw new Error('interview insert failed');
    const pad = await insertStagePad(tx, interview, 0, draw);
    return { interview, pad };
  });
  return { interview: await interviewOf(ctx, interview), padId: pad.id };
}

/**
 * `POST /api/interviews/:id/next`: ends stage `from` and starts the one after it, or after the
 * last ends the interview. When the interview has ended or is not at `from` (a second click,
 * another tab), nothing changes.
 */
export async function advanceInterview(
  ctx: Ctx,
  userId: string,
  id: string,
  from: number,
): Promise<InterviewStart> {
  const row = await ownInterview(ctx, userId, id);
  if (row.status !== 'active' || row.current !== from) return startView(ctx, id);
  const [leaving] = await ctx.db
    .select({ id: pads.id, status: pads.status })
    .from(pads)
    .where(and(eq(pads.interviewId, id), eq(pads.stageIndex, from)));
  if (leaving?.status === 'active') await endPad(ctx, leaving.id);

  const index = from + 1;
  const stage = row.stages[index];
  if (!stage) {
    // That was the last stage: its pad ending has ended the interview already (`endPad`);
    // this covers a pad that had ended before.
    await ctx.db
      .update(interviews)
      .set({ status: 'ended', endedAt: new Date() })
      .where(
        and(eq(interviews.id, id), eq(interviews.status, 'active'), eq(interviews.current, from)),
      );
    return startView(ctx, id);
  }
  // May refuse (`quant_unavailable`): the interview stays at `from`, its pad ended, to retry.
  const draw = await drawStage(ctx, userId, stage, index);
  try {
    await ctx.db.transaction(async (tx) => {
      const [moved] = await tx
        .update(interviews)
        .set({ current: index })
        .where(
          and(eq(interviews.id, id), eq(interviews.status, 'active'), eq(interviews.current, from)),
        )
        .returning();
      // Another call moved it on (or ended it) first: its pad is the one.
      if (!moved) return;
      await insertStagePad(tx, moved, index, draw);
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  return startView(ctx, id);
}

/**
 * `POST /api/interviews/:id/end`: the interview ends (stages never started read as skipped) and
 * the stage under way with it. Idempotent.
 */
export async function endInterview(ctx: Ctx, userId: string, id: string): Promise<Interview> {
  await ownInterview(ctx, userId, id);
  // Ended first, so no stage can start after the pads below are read.
  await ctx.db
    .update(interviews)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(interviews.id, id), eq(interviews.status, 'active')));
  const open = await ctx.db
    .select({ id: pads.id })
    .from(pads)
    .where(and(eq(pads.interviewId, id), eq(pads.status, 'active')));
  for (const pad of open) await endPad(ctx, pad.id);
  const [row] = await ctx.db.select().from(interviews).where(eq(interviews.id, id));
  if (!row) throw notFound('Interview');
  return interviewOf(ctx, row);
}

/**
 * `DELETE /api/interviews/:id`: every stage's pad through `deletePad` (which lets go of its live
 * rooms, editor and interviewer), then the interview.
 */
export async function deleteInterview(ctx: Ctx, userId: string, id: string): Promise<void> {
  await ownInterview(ctx, userId, id);
  // Ended first, so no stage starts while its pads are deleted.
  await ctx.db
    .update(interviews)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(interviews.id, id), eq(interviews.status, 'active')));
  const stagePads = await ctx.db.select({ id: pads.id }).from(pads).where(eq(pads.interviewId, id));
  for (const pad of stagePads) await deletePad(ctx, pad.id);
  await ctx.db.delete(interviews).where(and(eq(interviews.id, id), eq(interviews.ownerId, userId)));
}
