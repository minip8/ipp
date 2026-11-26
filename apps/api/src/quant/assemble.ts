/**
 * Which questions a quant round asks, and in what order (ARCHITECTURE §8.2).
 *
 * `assembleRound` is pure and seeded (unit-tested over many seeds); `assembleForUser` loads its
 * inputs: the path's eligible questions, the owner's latest quiz answers (weak first, as the
 * quiz's "focus weak" selection) and the questions posed in the owner's last rounds.
 *
 * Rules, in priority order:
 *  - eligible: active `short` questions, and `numeric` ones with a hint ladder or follow-ups, in
 *    the path's topics; fewer than the round's length is `quant_unavailable`
 *  - none posed in the owner's last `RECENT_ROUNDS` rounds (relaxed only when the pool would
 *    otherwise be too small: those come last)
 *  - difficulty slots rise (3: E M H; 4: E M M H; 6: E M M M H H)
 *  - topics round-robin over the path's topics, starting at a random one
 *  - no subtopic twice
 *  - at least one `short` and one `numeric` when the pool has both
 *  - within a cell, weak first: missed or never answered (mixed), then answered correctly, least
 *    recently first
 *  - an empty cell relaxes the topic first, then the difficulty (nearest first), and only then
 *    allows a repeated subtopic
 */
import {
  QUANT_PATH_INFO,
  type QuantPath,
  type QuantPick,
  type QuizDifficulty,
  type QuizQuestion,
  quantQuestionCount,
} from '@ipp/contracts';
import { pads, quantRounds, quizQuestions } from '@ipp/db';
import { and, desc, eq, inArray, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { conflict } from '../http/errors';
import { latestAnswerMap, type RecordedAnswer, weakFirst } from '../quiz/answers';
import { type Rand, shuffle } from '../random';

/** Questions posed in this many of the owner's latest rounds are not asked again. */
export const RECENT_ROUNDS = 5;

export interface PoolQuestion {
  id: string;
  topic: string;
  subtopic: string;
  difficulty: QuizDifficulty;
  type: 'short' | 'numeric';
}

export interface AssembleInput<Q extends PoolQuestion = PoolQuestion> {
  /** Eligible questions of the path (see the module comment). */
  pool: readonly Q[];
  /** The owner's latest answer per question (`latestAnswerMap`). */
  seen: ReadonlyMap<string, Pick<RecordedAnswer, 'correct' | 'answeredAt'>>;
  /** Questions posed in the owner's last rounds. */
  recent: ReadonlySet<string>;
  /** How many questions the round asks. */
  n: number;
  /** The path's topics. */
  topics: readonly string[];
  rand: Rand;
}

const LEVEL: Record<QuizDifficulty, number> = { easy: 0, medium: 1, hard: 2 };

/** The difficulty of each slot, rising: 3 E M H, 4 E M M H, 6 E M M M H H. */
export function difficultySlots(n: number): QuizDifficulty[] {
  if (n <= 0) return [];
  if (n === 1) return ['medium'];
  if (n === 2) return ['easy', 'hard'];
  const hard = n >= 6 ? 2 : 1;
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? 'easy' : i >= n - hard ? 'hard' : 'medium',
  );
}

const subtopicKey = (q: PoolQuestion) => `${q.topic}\u0000${q.subtopic}`;

/** The round's questions in the order they will be asked, or null when the pool is too small. */
export function assembleRound<Q extends PoolQuestion>(input: AssembleInput<Q>): Q[] | null {
  const { pool, seen, recent, n, rand } = input;
  if (n <= 0 || pool.length < n) return null;

  // Recently posed questions are left out while enough others remain; otherwise they come last.
  const fresh = pool.filter((q) => !recent.has(q.id));
  const base = fresh.length >= n ? fresh : [...pool];
  const ordered = weakFirst(
    base.map((q) => q.id),
    seen,
    rand,
  );
  const ranked = [
    ...ordered.filter((id) => !recent.has(id)),
    ...ordered.filter((id) => recent.has(id)),
  ];
  const rank = new Map(ranked.map((id, i) => [id, i]));
  const byRank = (a: Q, b: Q) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);

  const present = input.topics.filter((t) => base.some((q) => q.topic === t));
  // A pool topic the list does not name (none, when loaded from the path) takes part too.
  for (const q of base) if (!present.includes(q.topic)) present.push(q.topic);
  const topicOrder = shuffle(present, rand);
  const slots = difficultySlots(n).map((difficulty, i) => ({
    difficulty,
    topic: topicOrder[i % topicOrder.length] as string,
  }));

  const picks: (Q | undefined)[] = new Array(n).fill(undefined);
  const pickedIds = () => new Set(picks.filter((p): p is Q => !!p).map((p) => p.id));
  const subtopicsExcept = (j: number) =>
    new Set(picks.filter((p, i): p is Q => !!p && i !== j).map(subtopicKey));
  const topicCount = (topic: string, j: number) =>
    picks.filter((p, i) => p && i !== j && p.topic === topic).length;

  /**
   * The best question for slot `j` that passes `ok`, walking the relaxation ladder: the cell
   * itself, then the same difficulty in any topic (the least used topic first), then the nearest
   * difficulty, and last a repeated subtopic.
   */
  const best = (j: number, ok: (q: Q) => boolean): Q | undefined => {
    const slot = slots[j];
    if (!slot) return undefined;
    const taken = pickedIds();
    const current = picks[j];
    if (current) taken.delete(current.id);
    const usedSub = subtopicsExcept(j);
    const open = base.filter((q) => !taken.has(q.id) && ok(q));
    const distinct = open.filter((q) => !usedSub.has(subtopicKey(q)));
    const nearest = (a: Q, b: Q) =>
      Math.abs(LEVEL[a.difficulty] - LEVEL[slot.difficulty]) -
        Math.abs(LEVEL[b.difficulty] - LEVEL[slot.difficulty]) ||
      Number(b.topic === slot.topic) - Number(a.topic === slot.topic) ||
      topicCount(a.topic, j) - topicCount(b.topic, j) ||
      byRank(a, b);
    const ladder: (() => Q[])[] = [
      () =>
        distinct
          .filter((q) => q.topic === slot.topic && q.difficulty === slot.difficulty)
          .sort(byRank),
      () =>
        distinct
          .filter((q) => q.difficulty === slot.difficulty)
          .sort((a, b) => topicCount(a.topic, j) - topicCount(b.topic, j) || byRank(a, b)),
      () => [...distinct].sort(nearest),
      () => [...open].sort(nearest),
    ];
    for (const level of ladder) {
      const found = level()[0];
      if (found) return found;
    }
    return undefined;
  };

  for (let j = 0; j < n; j++) picks[j] = best(j, () => true);
  if (picks.some((p) => !p)) return null;

  // At least one of each type when the pool has it: replace the slot that costs the least.
  for (const type of ['short', 'numeric'] as const) {
    const chosen = picks as Q[];
    if (chosen.some((p) => p.type === type) || !base.some((q) => q.type === type)) continue;
    let replaced = false;
    for (let pass = 0; pass < 2 && !replaced; pass++) {
      for (let j = 0; j < n && !replaced; j++) {
        const old = chosen[j] as Q;
        // Never take away the only question of the other type.
        if (chosen.filter((p) => p.type === old.type).length < 2) continue;
        const candidate = best(j, (q) => q.type === type);
        if (!candidate) continue;
        // First pass: only a replacement that keeps the slot's cell.
        const sameCell =
          candidate.topic === slots[j]?.topic && candidate.difficulty === slots[j]?.difficulty;
        if (pass === 0 && !sameCell) continue;
        picks[j] = candidate;
        replaced = true;
      }
    }
  }

  // Relaxed slots may have moved a difficulty: keep the round rising (stable).
  return (picks as Q[])
    .map((q, i) => ({ q, i }))
    .sort((a, b) => LEVEL[a.q.difficulty] - LEVEL[b.q.difficulty] || a.i - b.i)
    .map(({ q }) => q);
}

type EligibleRow = PoolQuestion & { data: QuizQuestion };

/** The path's eligible questions (see the module comment). */
export async function eligibleQuestions(ctx: Ctx, path: QuantPath): Promise<EligibleRow[]> {
  const topics = [...QUANT_PATH_INFO[path].topics];
  const rows = await ctx.db
    .select({
      id: quizQuestions.id,
      topic: quizQuestions.topic,
      subtopic: quizQuestions.subtopic,
      difficulty: quizQuestions.difficulty,
      type: quizQuestions.type,
      data: quizQuestions.data,
    })
    .from(quizQuestions)
    .where(
      and(
        eq(quizQuestions.active, true),
        inArray(quizQuestions.topic, topics),
        // Rows stored before `hints` and `followUps` existed lack them.
        sql`(${quizQuestions.type} = 'short' or (${quizQuestions.type} = 'numeric' and
          coalesce(jsonb_array_length(${quizQuestions.data}->'hints'), 0) +
          coalesce(jsonb_array_length(${quizQuestions.data}->'followUps'), 0) > 0))`,
      ),
    );
  return rows.filter(
    (r): r is EligibleRow => r.type === 'short' || r.type === 'numeric',
  ) as EligibleRow[];
}

/** Ids of the questions posed in the owner's latest `RECENT_ROUNDS` rounds. */
export async function recentlyPosed(ctx: Ctx, userId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ state: quantRounds.state })
    .from(quantRounds)
    .innerJoin(pads, eq(pads.id, quantRounds.padId))
    .where(eq(pads.ownerId, userId))
    .orderBy(desc(pads.startedAt))
    .limit(RECENT_ROUNDS);
  const ids = new Set<string>();
  for (const { state } of rows)
    for (const q of state.questions) if (q.posedAt !== null) ids.add(q.questionId);
  return ids;
}

/** What the round snapshots of a bank question when it is assembled. */
export function pickOf(q: QuizQuestion): QuantPick {
  if (q.type !== 'short' && q.type !== 'numeric')
    throw new Error(`${q.id} is not a quant question`);
  return {
    questionId: q.id,
    topic: q.topic,
    difficulty: q.difficulty,
    prompt: q.prompt,
    unit: q.type === 'numeric' ? (q.unit ?? null) : null,
    hintsAvailable: (q.hints ?? []).length,
  };
}

/** The questions of a new round for `userId`; 409 `quant_unavailable` when there are too few. */
export async function assembleForUser(
  ctx: Ctx,
  userId: string,
  path: QuantPath,
  durationMin: number,
  rand: Rand = Math.random,
): Promise<QuantPick[]> {
  const n = quantQuestionCount(durationMin);
  const [pool, recent] = await Promise.all([
    eligibleQuestions(ctx, path),
    recentlyPosed(ctx, userId),
  ]);
  const seen =
    pool.length >= n
      ? await latestAnswerMap(ctx.db, userId, { questionIds: pool.map((q) => q.id) })
      : new Map();
  const chosen = assembleRound({
    pool,
    seen,
    recent,
    n,
    topics: QUANT_PATH_INFO[path].topics,
    rand,
  });
  if (!chosen)
    throw conflict(
      'quant_unavailable',
      `There are not enough questions for a ${durationMin}-minute ${QUANT_PATH_INFO[path].label.toLowerCase()} round yet`,
    );
  return chosen.map((q) => pickOf(q.data));
}
