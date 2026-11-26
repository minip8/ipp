/**
 * Quant rooms (ARCHITECTURE §8.4): a pad of kind `room` and format `quant` whose round is
 * hosted. Its host lines questions of the bank up (the queue), poses them one by one, records
 * the hints and follow-ups they give, closes each question with their own verdict, and searches
 * the bank with the solutions shown to choose what to ask next. Every change to the round goes
 * through `advanceRound` (`applyHostStep` in ./round.ts); this module is the bank lookups around
 * those steps and what the host reads.
 *
 * Everything this module returns is HOST-ONLY (answers, key points, explanations, hint ladders,
 * follow-ups, verdicts, the queue): the routes that call it check the caller is the room's host.
 * What a candidate sees of the round is `publicRound`, and nothing here.
 */
import {
  type HostBankItem,
  type HostBankPage,
  type HostBankQuery,
  type HostBankStatus,
  type HostQuestionMaterial,
  type HostRoundQuestion,
  type HostRoundView,
  hostedPick,
  type QuantRoundState,
  type QuizQuestion,
  quantMode,
  quantPhase,
  quantTimeSec,
  quizSolution,
} from '@ipp/contracts';
import { messages, quizQuestions, quizTopics } from '@ipp/db';
import { and, asc, count, eq, ilike, inArray, or, type SQL, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { badRequest, notFound } from '../http/errors';
import { correctAnswer, publicQuestion } from '../quiz/grade';
import { loadRound } from './round';

/** A bank question with its topic's title, as the host's material needs it. */
export interface BankEntry {
  question: QuizQuestion;
  topicTitle: string;
  active: boolean;
}

/** The bank questions `ids` (inactive ones too: a posed question that left the bank since). */
export async function bankEntries(
  ctx: Ctx,
  ids: readonly string[],
): Promise<Map<string, BankEntry>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({ data: quizQuestions.data, active: quizQuestions.active, title: quizTopics.title })
    .from(quizQuestions)
    .innerJoin(quizTopics, eq(quizTopics.slug, quizQuestions.topic))
    .where(inArray(quizQuestions.id, [...new Set(ids)]));
  return new Map(
    rows.map((r) => [r.data.id, { question: r.data, topicTitle: r.title, active: r.active }]),
  );
}

/** One active bank question, or 404. */
export async function activeBankQuestion(ctx: Ctx, id: string): Promise<BankEntry> {
  const entry = (await bankEntries(ctx, [id])).get(id);
  if (!entry?.active) throw notFound('Question');
  return entry;
}

/**
 * 400 `unknown_question` unless every id is an active bank question (a queue may only hold
 * questions that can be posed), and `validation_error` when one appears twice.
 */
export async function assertQueueable(ctx: Ctx, ids: readonly string[]): Promise<void> {
  if (new Set(ids).size !== ids.length)
    throw badRequest('A question can be queued only once', 'validation_error');
  const entries = await bankEntries(ctx, ids);
  const missing = ids.filter((id) => !entries.get(id)?.active);
  if (missing.length)
    throw badRequest(`Not a question of the bank: ${missing.join(', ')}`, 'unknown_question');
}

/** What the host may read of a bank question: everything, solution and interviewer material. */
export function hostMaterial(q: QuizQuestion, topicTitle: string): HostQuestionMaterial {
  const live = q.type === 'short' || q.type === 'numeric' ? q : null;
  return {
    ...publicQuestion(q),
    topicTitle,
    solution: quizSolution(q),
    correctAnswer: correctAnswer(q),
    keyPoints: q.type === 'short' ? [...q.keyPoints] : [],
    explanation: q.explanation,
    // Rows stored before these existed lack them.
    hints: [...(live?.hints ?? [])],
    followUps: [...(live?.followUps ?? [])],
    tolerance: q.type === 'numeric' ? (q.tolerance ?? null) : null,
  };
}

/** The host's view of a hosted round (`HostView.round`); null for a pad without one. */
export async function hostRoundView(ctx: Ctx, padId: string): Promise<HostRoundView | null> {
  const row = await loadRound(ctx, padId);
  if (!row || quantMode(row.state) !== 'hosted') return null;
  return buildHostRoundView(row.state, row.version, await roundBank(ctx, row.state));
}

/** The bank entries a round's view needs: its questions and its queue. */
export async function roundBank(ctx: Ctx, state: QuantRoundState): Promise<Map<string, BankEntry>> {
  return bankEntries(ctx, [...state.questions.map((q) => q.questionId), ...(state.queue ?? [])]);
}

export function buildHostRoundView(
  state: QuantRoundState,
  version: number,
  bank: ReadonlyMap<string, BankEntry>,
): HostRoundView {
  const phase = quantPhase(state);
  const material = (id: string) => {
    const b = bank.get(id);
    return b ? hostMaterial(b.question, b.topicTitle) : null;
  };
  const questions = state.questions.flatMap((q, index): HostRoundQuestion[] =>
    q.posedAt === null
      ? []
      : [
          {
            index,
            questionId: q.questionId,
            topic: q.topic,
            topicTitle: q.topicTitle ?? q.topic,
            difficulty: q.difficulty,
            type: q.type ?? bank.get(q.questionId)?.question.type ?? 'short',
            prompt: q.prompt,
            posedAt: q.posedAt,
            posedMessageId: q.posedMessageId,
            closedAt: q.closedAt,
            closedBy: q.closedBy,
            timeSec: quantTimeSec(q),
            hintRungs: [...q.hintRungs],
            followUpAsked: q.followUpAsked,
            verdict: q.verdict ? { score: q.verdict.score, summary: q.verdict.summary } : null,
            material: material(q.questionId),
          },
        ],
  );
  return {
    version,
    phase,
    ended: state.ended === true,
    open: phase === 'asking' ? state.current : null,
    questions,
    queue: (state.queue ?? []).map((id) => {
      const b = bank.get(id);
      return {
        questionId: id,
        material: b?.active ? hostMaterial(b.question, b.topicTitle) : null,
      };
    }),
  };
}

/** The pick a `pose` step takes for an active bank question. */
export const poseOf = (entry: BankEntry) => hostedPick(entry.question, entry.topicTitle);

const TRACK_RANK = sql`case ${quizTopics.track} when 'quant' then 0 else 1 end`;
const DIFFICULTY_RANK = sql`case ${quizQuestions.difficulty} when 'easy' then 0 when 'medium' then 1 else 2 end`;

/** `q` as a literal ILIKE pattern: its own `%`, `_` and `\` match themselves. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The host's search of the bank (`GET …/host/round/bank`): every active question, quant and
 * fundamentals alike, filtered and paged, with its solution and material, and whether it is
 * queued or already posed in this room. Quant topics first, then each track in study order.
 */
export async function searchBank(
  ctx: Ctx,
  state: QuantRoundState,
  query: HostBankQuery,
): Promise<HostBankPage> {
  const { db } = ctx;
  const where: SQL[] = [eq(quizQuestions.active, true)];
  if (query.track) where.push(eq(quizTopics.track, query.track));
  if (query.topic) where.push(eq(quizQuestions.topic, query.topic));
  if (query.subtopic) where.push(eq(quizQuestions.subtopic, query.subtopic));
  if (query.difficulty) where.push(eq(quizQuestions.difficulty, query.difficulty));
  if (query.type) where.push(eq(quizQuestions.type, query.type));
  if (query.q) {
    const p = likePattern(query.q);
    const text = or(
      ilike(sql`${quizQuestions.data}->>'prompt'`, p),
      ilike(quizQuestions.subtopic, p),
      ilike(quizQuestions.id, p),
    );
    if (text) where.push(text);
  }
  const filter = and(...where);
  const [rows, [n], topics, subtopics] = await Promise.all([
    db
      .select({ data: quizQuestions.data, title: quizTopics.title })
      .from(quizQuestions)
      .innerJoin(quizTopics, eq(quizTopics.slug, quizQuestions.topic))
      .where(filter)
      .orderBy(
        TRACK_RANK,
        asc(quizTopics.position),
        asc(quizTopics.slug),
        asc(quizQuestions.subtopic),
        DIFFICULTY_RANK,
        asc(quizQuestions.id),
      )
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ n: count() })
      .from(quizQuestions)
      .innerJoin(quizTopics, eq(quizTopics.slug, quizQuestions.topic))
      .where(filter),
    db
      .select({
        slug: quizTopics.slug,
        title: quizTopics.title,
        track: quizTopics.track,
        questionCount: sql<number>`count(${quizQuestions.id})`.mapWith(Number),
      })
      .from(quizTopics)
      .innerJoin(
        quizQuestions,
        and(eq(quizQuestions.topic, quizTopics.slug), eq(quizQuestions.active, true)),
      )
      .groupBy(quizTopics.slug)
      .orderBy(TRACK_RANK, asc(quizTopics.position), asc(quizTopics.slug)),
    query.topic
      ? db
          .selectDistinct({ subtopic: quizQuestions.subtopic })
          .from(quizQuestions)
          .where(and(eq(quizQuestions.topic, query.topic), eq(quizQuestions.active, true)))
          .orderBy(asc(quizQuestions.subtopic))
      : Promise.resolve([] as { subtopic: string }[]),
  ]);
  const posed = new Set(state.questions.map((q) => q.questionId));
  const queued = new Set(state.queue ?? []);
  const status = (id: string): HostBankStatus =>
    posed.has(id) ? 'posed' : queued.has(id) ? 'queued' : 'available';
  const items: HostBankItem[] = rows.map((r) => ({
    ...hostMaterial(r.data, r.title),
    status: status(r.data.id),
  }));
  return {
    total: n?.n ?? 0,
    limit: query.limit,
    offset: query.offset,
    items,
    topics,
    subtopics: subtopics.map((s) => s.subtopic),
  };
}

/**
 * Whether a quant room left anything to assess: a question posed, a word from a candidate, or
 * something on the scratchpad. An empty room is refused an assessment (`nothing_to_assess`); one
 * where the host only talked over the scratchpad is assessed on its conversation.
 */
export async function quantRoomHasRecord(ctx: Ctx, padId: string): Promise<boolean> {
  const row = await loadRound(ctx, padId);
  if (row?.state.questions.some((q) => q.posedAt !== null)) return true;
  const [said] = await ctx.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.padId, padId), eq(messages.role, 'candidate')))
    .limit(1);
  if (said) return true;
  const { notes } = await ctx.collab.readTexts(padId);
  return notes.trim() !== '';
}
