/**
 * Which questions a quant round asks, and in what order (ARCHITECTURE §8.2, §8.3).
 *
 * `assembleRound` and `assembleWithGame` are pure and seeded (unit-tested over many seeds);
 * `assembleForUser` loads their inputs: the path's eligible questions, the active market-making
 * games, the owner's latest quiz answers (weak first, as the quiz's "focus weak" selection) and
 * the questions and games posed in the owner's last rounds.
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
 *
 * A game (§8.3), when the round has one (`CreateQuantPadRequest.includeGame`: absent, a trader
 * round has one and a researcher round none; true, one whenever an active game exists; false,
 * none), takes the second slot (the first in a one-question round): an active game not posed in
 * the owner's last rounds unless no other is left, of the slot's difficulty or else the nearest,
 * at random among equals, its hidden values drawn by the same generator. The other slots are
 * filled by the rules above as a round one question shorter whose slots keep their own
 * difficulties, from the path's other topics (the game is the round's question on its own
 * topic; that topic's bank questions come back only when the others cannot fill the slots).
 * Without a game the round is exactly what it was before games existed.
 */
import {
  QUANT_PATH_INFO,
  type QuantGame,
  type QuantPath,
  type QuantPick,
  type QuizDifficulty,
  type QuizQuestion,
  quantGamePick,
  quantQuestionCount,
} from '@ipp/contracts';
import { pads, quantGames, quantRounds, quizQuestions, quizTopics } from '@ipp/db';
import { and, desc, eq, inArray, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { conflict } from '../http/errors';
import { latestAnswerMap, type RecordedAnswer, weakFirst } from '../quiz/answers';
import { type Rand, secureRand, shuffle } from '../random';

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
  /**
   * The difficulty of each of the `n` slots; `difficultySlots(n)` when absent. A round with a
   * game passes the slots left once the game has taken its own.
   */
  difficulties?: readonly QuizDifficulty[];
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
  const difficulties = input.difficulties ?? difficultySlots(n);
  if (difficulties.length !== n) throw new Error('assembleRound: one difficulty per slot');

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
  const slots = difficulties.map((difficulty, i) => ({
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

/** The slot a game takes: the second, or the first in a one-question round. */
export const gameSlot = (n: number) => (n <= 1 ? 0 : 1);

/**
 * The game for a slot of `difficulty`: none in `recent` while another is left, the slot's
 * difficulty or else the nearest, at random among equals (put in id order first, so the choice
 * depends on the seed and not on the order the database returned them in). Null without games.
 */
export function chooseGame<G extends { id: string; difficulty: QuizDifficulty }>(
  games: readonly G[],
  recent: ReadonlySet<string>,
  difficulty: QuizDifficulty,
  rand: Rand,
): G | null {
  const fresh = games.filter((g) => !recent.has(g.id));
  const base = fresh.length > 0 ? fresh : games;
  if (base.length === 0) return null;
  const distance = (g: G) => Math.abs(LEVEL[g.difficulty] - LEVEL[difficulty]);
  const nearest = Math.min(...base.map(distance));
  const equals = base
    .filter((g) => distance(g) === nearest)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const r = rand();
  const i = Number.isFinite(r) ? Math.floor(r * equals.length) : 0;
  return equals[Math.min(equals.length - 1, Math.max(0, i))] ?? null;
}

export interface AssembleWithGameInput<Q extends PoolQuestion = PoolQuestion>
  extends Omit<AssembleInput<Q>, 'difficulties'> {
  /** The active games (`quant_games`); with none, or `wantGame` false, the round has no game. */
  games: readonly QuantGame[];
  wantGame: boolean;
  /** The title of a game's topic, snapshotted into the round with it. */
  topicTitle: (slug: string) => string;
}

export interface AssembledRound<Q extends PoolQuestion = PoolQuestion> {
  /** The bank questions in the order they are asked, without the game's slot. */
  questions: Q[];
  /** The game and the slot it takes, its hidden values drawn (`quantGamePick`); null: none. */
  game: { index: number; pick: QuantPick } | null;
}

/**
 * The round, with its game when it has one (the module comment gives the rule); null when the
 * bank cannot fill the other slots. Without a game this is `assembleRound` itself, drawing the
 * same numbers from `rand`, so the round is exactly what it was before games existed.
 */
export function assembleWithGame<Q extends PoolQuestion>(
  input: AssembleWithGameInput<Q>,
): AssembledRound<Q> | null {
  const { games, wantGame, topicTitle, ...bank } = input;
  if (!wantGame || games.length === 0) {
    const questions = assembleRound(bank);
    return questions && { questions, game: null };
  }
  const slots = difficultySlots(bank.n);
  const index = gameSlot(bank.n);
  const game = chooseGame(games, bank.recent, slots[index] ?? 'medium', bank.rand);
  if (!game) {
    const questions = assembleRound(bank);
    return questions && { questions, game: null };
  }
  const rest = { ...bank, n: bank.n - 1, difficulties: slots.filter((_, i) => i !== index) };
  // The game is the round's question on its topic: the bank's slots go to the other topics, so
  // a market-making question is not asked back to back with a market-making game. Only when
  // those cannot fill them does the game's own topic come back.
  const elsewhere = {
    ...rest,
    pool: bank.pool.filter((q) => q.topic !== game.topic),
    topics: bank.topics.filter((t) => t !== game.topic),
  };
  const questions = rest.n === 0 ? [] : (assembleRound(elsewhere) ?? assembleRound(rest));
  if (!questions) return null;
  return {
    questions,
    game: { index, pick: quantGamePick(game, topicTitle(game.topic), bank.rand) },
  };
}

/** The round's picks in the order they are asked: the game in its slot. */
export function roundPicks<Q extends PoolQuestion>(
  round: AssembledRound<Q>,
  pickOfQuestion: (q: Q) => QuantPick,
): QuantPick[] {
  const picks = round.questions.map(pickOfQuestion);
  if (round.game) picks.splice(round.game.index, 0, round.game.pick);
  return picks;
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

/**
 * Ids of the questions posed in the owner's last `RECENT_ROUNDS` practice rounds. A quant room
 * the user hosted is not one of them: they asked those questions, they did not answer them.
 */
export async function recentlyPosed(ctx: Ctx, userId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ state: quantRounds.state })
    .from(quantRounds)
    .innerJoin(pads, eq(pads.id, quantRounds.padId))
    .where(and(eq(pads.ownerId, userId), eq(pads.kind, 'practice')))
    .orderBy(desc(pads.startedAt))
    .limit(RECENT_ROUNDS);
  const ids = new Set<string>();
  for (const { state } of rows)
    for (const q of state.questions) if (q.posedAt !== null) ids.add(q.questionId);
  return ids;
}

/**
 * What the round snapshots of a bank question when it is assembled. The topic's title goes with
 * it so the pad and the report need no topic lookup (`topicTitle`, the slug when the topic has
 * no row).
 */
export function pickOf(q: QuizQuestion, topicTitle: string = q.topic): QuantPick {
  if (q.type !== 'short' && q.type !== 'numeric')
    throw new Error(`${q.id} is not a quant question`);
  return {
    questionId: q.id,
    topic: q.topic,
    topicTitle,
    difficulty: q.difficulty,
    prompt: q.prompt,
    unit: q.type === 'numeric' ? (q.unit ?? null) : null,
    hintsAvailable: (q.hints ?? []).length,
  };
}

/** The active market-making games (§8.3), as authored. */
export async function activeGames(ctx: Ctx): Promise<QuantGame[]> {
  const rows = await ctx.db
    .select({ data: quantGames.data })
    .from(quantGames)
    .where(eq(quantGames.active, true));
  return rows.map((r) => r.data);
}

/**
 * The questions of a new round for `userId`, with a game when the round has one (`includeGame`,
 * see the module comment); 409 `quant_unavailable` when there are too few. One generator draws
 * the questions, the game and its hidden values: the tests pass a seeded one, the server a
 * cryptographic one by default, so the dice cannot be worked out from what the round shows.
 */
export async function assembleForUser(
  ctx: Ctx,
  userId: string,
  path: QuantPath,
  durationMin: number,
  opts: { includeGame?: boolean; rand?: Rand } = {},
): Promise<QuantPick[]> {
  const rand = opts.rand ?? secureRand;
  const n = quantQuestionCount(durationMin);
  const wantGame = opts.includeGame ?? path === 'trader';
  const [pool, recent, games] = await Promise.all([
    eligibleQuestions(ctx, path),
    recentlyPosed(ctx, userId),
    wantGame ? activeGames(ctx) : Promise.resolve([] as QuantGame[]),
  ]);
  const titles = await ctx.db
    .select({ slug: quizTopics.slug, title: quizTopics.title })
    .from(quizTopics)
    .where(
      inArray(quizTopics.slug, [
        ...new Set([...QUANT_PATH_INFO[path].topics, ...games.map((g) => g.topic)]),
      ]),
    );
  // With a game the bank fills one slot fewer.
  const needed = wantGame && games.length > 0 ? n - 1 : n;
  const seen =
    pool.length >= needed && pool.length > 0
      ? await latestAnswerMap(ctx.db, userId, { questionIds: pool.map((q) => q.id) })
      : new Map();
  const title = new Map(titles.map((t) => [t.slug, t.title]));
  const round = assembleWithGame({
    pool,
    seen,
    recent,
    n,
    topics: QUANT_PATH_INFO[path].topics,
    rand,
    games,
    wantGame,
    topicTitle: (slug) => title.get(slug) ?? slug,
  });
  if (!round)
    throw conflict(
      'quant_unavailable',
      `There are not enough questions for a ${durationMin}-minute ${QUANT_PATH_INFO[path].label.toLowerCase()} round yet`,
    );
  return roundPicks(round, (q) => pickOf(q.data, title.get(q.data.topic)));
}
