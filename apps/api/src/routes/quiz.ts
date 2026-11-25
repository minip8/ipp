import {
  type AnswerFeedback,
  CreateAttemptRequest,
  DISCUSSION_MAX_TURNS,
  DiscussionReplyRequest,
  type DiscussionReplyResponse,
  type DiscussionTurn,
  type QuizAttempt,
  type QuizAttemptSummary,
  type QuizQuestion,
  type QuizResponse,
  type QuizTopicStats,
  SubmitAnswerRequest,
} from '@ipp/contracts';
import { quizAnswers, quizAttempts, quizQuestions, quizTopics } from '@ipp/db';
import { and, desc, eq, inArray, ne, sql } from '@ipp/db/orm';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireAccount } from '../http/app';
import { badRequest, conflict, HttpError, notFound, rateLimited } from '../http/errors';
import {
  type AnswerRow,
  applySelfGrade,
  feedbackOf,
  gradeResponse,
  latestAnswerMap,
  latestAnswers,
} from '../quiz/answers';
import { CORRECT_THRESHOLD, publicQuestion } from '../quiz/grade';
import { quizBankRoutes } from './quiz-bank';

type AttemptRow = typeof quizAttempts.$inferSelect;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function quizRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  const { db } = ctx;
  // The question bank: browse a topic and answer questions outside any attempt.
  r.route('/', quizBankRoutes(ctx));

  async function loadAttempt(id: string, userId: string): Promise<AttemptRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Attempt');
    const [row] = await db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.id, id), eq(quizAttempts.userId, userId)));
    if (!row) throw notFound('Attempt');
    return row;
  }

  async function questionsOf(ids: string[]): Promise<Map<string, QuizQuestion>> {
    if (ids.length === 0) return new Map();
    const rows = await db.select().from(quizQuestions).where(inArray(quizQuestions.id, ids));
    return new Map(rows.map((q) => [q.id, q.data]));
  }

  async function answersOf(attemptId: string): Promise<Map<string, AnswerRow>> {
    const rows = await db.select().from(quizAnswers).where(eq(quizAnswers.attemptId, attemptId));
    return new Map(rows.map((a) => [a.questionId, a]));
  }

  async function view(attempt: AttemptRow): Promise<QuizAttempt> {
    const [qs, answers] = await Promise.all([
      questionsOf(attempt.questionIds),
      answersOf(attempt.id),
    ]);
    const ordered = attempt.questionIds
      .map((id) => qs.get(id))
      .filter((q): q is QuizQuestion => q !== undefined);
    const responses: Record<string, QuizResponse> = {};
    for (const [id, a] of answers) responses[id] = a.response;
    let feedback: AnswerFeedback[] = [];
    if (attempt.status === 'finished')
      feedback = ordered.map((q) => feedbackOf(q, answers.get(q.id)));
    else if (attempt.mode !== 'exam') {
      feedback = ordered
        .filter((q) => answers.has(q.id))
        .map((q) => feedbackOf(q, answers.get(q.id)));
    }
    return {
      id: attempt.id,
      mode: attempt.mode,
      topics: attempt.topics,
      status: attempt.status,
      questions: ordered.map(publicQuestion),
      responses,
      feedback,
      discussion: attempt.transcript,
      score: attempt.score,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
    };
  }

  async function recomputeScore(attempt: AttemptRow): Promise<number> {
    const answers = await answersOf(attempt.id);
    const total = attempt.questionIds.reduce((s, id) => s + (answers.get(id)?.score ?? 0), 0);
    return attempt.questionIds.length ? total / attempt.questionIds.length : 0;
  }

  r.get('/quiz/topics', async (c) => {
    const user = requireAccount(c);
    // Latest graded answer per question, from attempts and the question bank.
    const latest = db.$with('latest').as(latestAnswers(db, user.id, { graded: true }));
    const rows = await db
      .with(latest)
      .select({
        slug: quizTopics.slug,
        title: quizTopics.title,
        description: quizTopics.description,
        questionCount:
          sql<number>`count(${quizQuestions.id}) filter (where ${quizQuestions.active})`.mapWith(
            Number,
          ),
        shortCount:
          sql<number>`count(${quizQuestions.id}) filter (where ${quizQuestions.active} and ${quizQuestions.type} = 'short')`.mapWith(
            Number,
          ),
        answered: sql<number>`count(${latest.questionId})`.mapWith(Number),
        accuracy: sql<number | null>`avg(${latest.score})`.mapWith((v) =>
          v === null ? null : Number(v),
        ),
      })
      .from(quizTopics)
      .leftJoin(quizQuestions, eq(quizQuestions.topic, quizTopics.slug))
      .leftJoin(latest, eq(latest.questionId, quizQuestions.id))
      .groupBy(quizTopics.slug)
      .orderBy(quizTopics.title);
    const out: QuizTopicStats[] = rows.map((t) => ({
      ...t,
      accuracy: t.answered > 0 ? t.accuracy : null,
    }));
    return c.json(out);
  });

  r.post('/quiz/attempts', async (c) => {
    const user = requireAccount(c);
    const body = await parseBody(c, CreateAttemptRequest);
    const topics = [...new Set(body.topics)];
    const known = await db
      .select({ slug: quizTopics.slug })
      .from(quizTopics)
      .where(inArray(quizTopics.slug, topics));
    if (known.length !== topics.length) throw badRequest('Unknown topic', 'unknown_topic');
    const pool = await db
      .select({ id: quizQuestions.id })
      .from(quizQuestions)
      .where(
        and(
          inArray(quizQuestions.topic, topics),
          eq(quizQuestions.active, true),
          // Practice and exam are graded automatically; open questions belong to a discussion.
          body.mode === 'discussion'
            ? eq(quizQuestions.type, 'short')
            : ne(quizQuestions.type, 'short'),
          body.difficulty ? eq(quizQuestions.difficulty, body.difficulty) : undefined,
        ),
      );
    if (pool.length === 0) throw notFound('Questions for these topics');

    let chosen: string[];
    if (!body.focusWeak) chosen = shuffle(pool.map((p) => p.id)).slice(0, body.count);
    else {
      // Latest countable answer per question for this user (attempts and question bank).
      const seen = await latestAnswerMap(db, user.id, { questionIds: pool.map((p) => p.id) });
      // Missed or never seen first (mixed), then ones answered correctly, least recently first.
      const weak = shuffle(pool.filter((p) => !seen.get(p.id)?.correct).map((p) => p.id));
      const strong = pool
        .filter((p) => seen.get(p.id)?.correct)
        .map((p) => p.id)
        .sort(
          (a, b) =>
            (seen.get(a)?.answeredAt.getTime() ?? 0) - (seen.get(b)?.answeredAt.getTime() ?? 0),
        );
      chosen = [...weak, ...strong].slice(0, body.count);
      chosen = shuffle(chosen);
    }
    const [attempt] = await db
      .insert(quizAttempts)
      .values({ userId: user.id, mode: body.mode, topics, questionIds: chosen })
      .returning();
    if (!attempt) throw new Error('attempt insert failed');
    return c.json(await view(attempt));
  });

  r.get('/quiz/attempts', async (c) => {
    const user = requireAccount(c);
    const rows = await db
      .select()
      .from(quizAttempts)
      .where(eq(quizAttempts.userId, user.id))
      .orderBy(desc(quizAttempts.startedAt))
      .limit(200);
    const out: QuizAttemptSummary[] = rows.map((a) => ({
      id: a.id,
      mode: a.mode,
      topics: a.topics,
      status: a.status,
      score: a.score,
      startedAt: a.startedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      questionCount: a.questionIds.length,
    }));
    return c.json(out);
  });

  r.get('/quiz/attempts/:id', async (c) => {
    const user = requireAccount(c);
    return c.json(await view(await loadAttempt(c.req.param('id'), user.id)));
  });

  r.post('/quiz/attempts/:id/answers', async (c) => {
    const user = requireAccount(c);
    const attempt = await loadAttempt(c.req.param('id'), user.id);
    const body = await parseBody(c, SubmitAnswerRequest);
    if (!attempt.questionIds.includes(body.questionId))
      throw badRequest('Question is not part of this attempt');
    if (attempt.mode === 'discussion')
      throw badRequest('A discussion is answered in conversation', 'discussion_attempt');
    const wait = await ctx.limiter.hit([
      { key: `quiz:u:${user.id}`, ...ctx.config.limits.quizAnswers.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);
    const q = (await questionsOf([body.questionId])).get(body.questionId);
    if (!q) throw notFound('Question');
    if (q.type !== body.response.type)
      throw badRequest('Response type does not match the question');
    const [existing] = await db
      .select()
      .from(quizAnswers)
      .where(and(eq(quizAnswers.attemptId, attempt.id), eq(quizAnswers.questionId, q.id)));

    // A self-grade for a short answer recorded without a model; allowed after an exam is finished.
    const selfGrade = applySelfGrade(existing, body.response);
    if (attempt.status === 'finished' && !selfGrade)
      throw conflict('attempt_finished', 'This attempt is finished');
    if (existing && attempt.mode === 'practice' && !selfGrade) {
      throw conflict('already_answered', 'This question has already been answered');
    }

    // A self-grade keeps the originally submitted text; only the grade changes.
    const response = selfGrade?.response ?? body.response;
    const graded = selfGrade?.graded ?? (await gradeResponse(ctx, user.id, q, body.response));
    const values = {
      attemptId: attempt.id,
      questionId: q.id,
      response,
      ...graded,
      answeredAt: new Date(),
    };
    const [saved] = await db
      .insert(quizAnswers)
      .values(values)
      .onConflictDoUpdate({ target: [quizAnswers.attemptId, quizAnswers.questionId], set: values })
      .returning();
    if (attempt.status === 'finished') {
      await db
        .update(quizAttempts)
        .set({ score: await recomputeScore(attempt) })
        .where(eq(quizAttempts.id, attempt.id));
    }
    if (attempt.mode === 'exam' && attempt.status === 'active')
      return c.json({ recorded: true as const });
    return c.json(feedbackOf(q, saved));
  });

  /**
   * Discussion mode: the candidate's next turn on one question. The interviewer (on the user's
   * own key) either asks a follow-up or closes the question, which records the graded answer.
   * Nothing is stored when the model cannot answer, so the same turn can be sent again.
   */
  r.post('/quiz/attempts/:id/discussion', async (c) => {
    const user = requireAccount(c);
    const attempt = await loadAttempt(c.req.param('id'), user.id);
    const body = await parseBody(c, DiscussionReplyRequest);
    if (attempt.mode !== 'discussion')
      throw badRequest('This attempt is not a discussion', 'not_a_discussion');
    if (attempt.status === 'finished')
      throw conflict('attempt_finished', 'This attempt is finished');
    if (!attempt.questionIds.includes(body.questionId))
      throw badRequest('Question is not part of this attempt');
    const wait = await ctx.limiter.hit([
      { key: `quiz:u:${user.id}`, ...ctx.config.limits.quizAnswers.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);
    const q = (await questionsOf([body.questionId])).get(body.questionId);
    if (q?.type !== 'short') throw notFound('Question');
    if ((await answersOf(attempt.id)).has(q.id))
      throw conflict('already_answered', 'This question has already been answered');

    const turns: DiscussionTurn[] = [
      ...(attempt.transcript[q.id] ?? []),
      { role: 'candidate', text: body.text },
    ];
    const said = turns.filter((t) => t.role === 'candidate');
    const final = said.length >= DISCUSSION_MAX_TURNS;
    const step = await ctx.ai.discussShortAnswer(user.id, q, turns, final);
    if (!step) {
      if ((await ctx.ai.keyState(user.id)) !== 'active')
        throw conflict('ai_key_missing', 'Add your AI API key first');
      throw new HttpError(
        503,
        'interviewer_unavailable',
        'The interviewer could not reply. Try again.',
      );
    }
    const closed = final || !step.followUp;
    if (!closed) turns.push({ role: 'interviewer', text: step.followUp });
    await db
      .update(quizAttempts)
      .set({ transcript: { ...attempt.transcript, [q.id]: turns } })
      .where(eq(quizAttempts.id, attempt.id));
    const out: DiscussionReplyResponse = { turns, feedback: null };
    if (closed) {
      const score = Math.max(0, Math.min(1, step.score));
      const [saved] = await db
        .insert(quizAnswers)
        .values({
          attemptId: attempt.id,
          questionId: q.id,
          // Everything the candidate said, so results and the question bank read like any answer.
          response: { type: 'short', text: said.map((t) => t.text).join('\n\n') },
          score,
          correct: score >= CORRECT_THRESHOLD,
          feedback: step.feedback,
          gradedBy: 'ai',
          needsSelfGrade: false,
        })
        .returning();
      out.feedback = feedbackOf(q, saved);
    }
    return c.json(out);
  });

  r.post('/quiz/attempts/:id/finish', async (c) => {
    const user = requireAccount(c);
    const attempt = await loadAttempt(c.req.param('id'), user.id);
    if (attempt.status === 'finished') return c.json(await view(attempt));
    const score = await recomputeScore(attempt);
    const [row] = await db
      .update(quizAttempts)
      .set({ status: 'finished', score, finishedAt: new Date() })
      .where(and(eq(quizAttempts.id, attempt.id), eq(quizAttempts.status, 'active')))
      .returning();
    return c.json(await view(row ?? (await loadAttempt(attempt.id, user.id))));
  });

  return r;
}
