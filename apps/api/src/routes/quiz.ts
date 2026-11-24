import {
  type AnswerFeedback,
  CreateAttemptRequest,
  type QuizAttempt,
  type QuizAttemptSummary,
  type QuizQuestion,
  type QuizResponse,
  type QuizTopicStats,
  SubmitAnswerRequest,
} from '@ipp/contracts';
import { quizAnswers, quizAttempts, quizQuestions, quizTopics } from '@ipp/db';
import { and, desc, eq, inArray, sql } from '@ipp/db/orm';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireUser } from '../http/app';
import { badRequest, conflict, notFound, rateLimited } from '../http/errors';
import { CORRECT_THRESHOLD, correctAnswer, gradeAuto, publicQuestion } from '../quiz/grade';

type AttemptRow = typeof quizAttempts.$inferSelect;
type AnswerRow = typeof quizAnswers.$inferSelect;

/** Answers that may influence stats and selection: practice answers, and exam answers once finished. */
const COUNTABLE = sql`(${quizAttempts.mode} = 'practice' or ${quizAttempts.status} = 'finished')`;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function feedbackOf(q: QuizQuestion, a: AnswerRow | undefined): AnswerFeedback {
  return {
    questionId: q.id,
    score: a?.score ?? 0,
    correct: a?.correct ?? false,
    correctAnswer: correctAnswer(q),
    explanation: q.explanation,
    feedback: a ? (a.feedback ?? null) : 'Not answered.',
    gradedBy: a?.gradedBy ?? 'auto',
    needsSelfGrade: a?.needsSelfGrade ?? false,
  };
}

export function quizRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  const { db } = ctx;

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
    else if (attempt.mode === 'practice') {
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

  async function grade(
    userId: string,
    q: QuizQuestion,
    response: QuizResponse,
  ): Promise<Pick<AnswerRow, 'score' | 'correct' | 'feedback' | 'gradedBy' | 'needsSelfGrade'>> {
    const auto = gradeAuto(q, response);
    if (auto) return { ...auto, feedback: null, gradedBy: 'auto', needsSelfGrade: false };
    if (q.type !== 'short' || response.type !== 'short')
      throw badRequest('Response type does not match the question');
    // On the quiz taker's own key; without one (or if it fails) the user grades themselves.
    try {
      const g = await ctx.ai.gradeShortAnswer(userId, q, response.text);
      if (g) {
        const score = Math.max(0, Math.min(1, g.score));
        return {
          score,
          correct: score >= CORRECT_THRESHOLD,
          feedback: g.feedback,
          gradedBy: 'ai',
          needsSelfGrade: false,
        };
      }
    } catch (err) {
      ctx.log.warn(
        { err: String(err), questionId: q.id },
        'short-answer grading failed; falling back to self-grade',
      );
    }
    if (response.selfGrade !== undefined) {
      return {
        score: response.selfGrade,
        correct: response.selfGrade >= CORRECT_THRESHOLD,
        feedback: null,
        gradedBy: 'self',
        needsSelfGrade: false,
      };
    }
    return { score: 0, correct: false, feedback: null, gradedBy: 'self', needsSelfGrade: true };
  }

  r.get('/quiz/topics', async (c) => {
    const user = requireUser(c);
    const latest = db.$with('latest').as(
      db
        .selectDistinctOn([quizAnswers.questionId], {
          questionId: quizAnswers.questionId,
          score: quizAnswers.score,
        })
        .from(quizAnswers)
        .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
        .where(
          and(eq(quizAttempts.userId, user.id), eq(quizAnswers.needsSelfGrade, false), COUNTABLE),
        )
        .orderBy(quizAnswers.questionId, desc(quizAnswers.answeredAt)),
    );
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
    const user = requireUser(c);
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
          body.difficulty ? eq(quizQuestions.difficulty, body.difficulty) : undefined,
        ),
      );
    if (pool.length === 0) throw notFound('Questions for these topics');

    let chosen: string[];
    if (!body.focusWeak) chosen = shuffle(pool.map((p) => p.id)).slice(0, body.count);
    else {
      // Latest countable answer per question for this user.
      const history = await db
        .selectDistinctOn([quizAnswers.questionId], {
          questionId: quizAnswers.questionId,
          correct: quizAnswers.correct,
          at: quizAnswers.answeredAt,
        })
        .from(quizAnswers)
        .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
        .where(
          and(
            eq(quizAttempts.userId, user.id),
            inArray(
              quizAnswers.questionId,
              pool.map((p) => p.id),
            ),
            COUNTABLE,
          ),
        )
        .orderBy(quizAnswers.questionId, desc(quizAnswers.answeredAt));
      const seen = new Map(history.map((h) => [h.questionId, h]));
      // Missed or never seen first (mixed), then ones answered correctly, least recently first.
      const weak = shuffle(pool.filter((p) => !seen.get(p.id)?.correct).map((p) => p.id));
      const strong = pool
        .filter((p) => seen.get(p.id)?.correct)
        .map((p) => p.id)
        .sort((a, b) => (seen.get(a)?.at.getTime() ?? 0) - (seen.get(b)?.at.getTime() ?? 0));
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
    const user = requireUser(c);
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
    const user = requireUser(c);
    return c.json(await view(await loadAttempt(c.req.param('id'), user.id)));
  });

  r.post('/quiz/attempts/:id/answers', async (c) => {
    const user = requireUser(c);
    const attempt = await loadAttempt(c.req.param('id'), user.id);
    const body = await parseBody(c, SubmitAnswerRequest);
    if (!attempt.questionIds.includes(body.questionId))
      throw badRequest('Question is not part of this attempt');
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
    const isSelfGrade =
      existing?.needsSelfGrade === true &&
      body.response.type === 'short' &&
      body.response.selfGrade !== undefined;
    if (attempt.status === 'finished' && !isSelfGrade)
      throw conflict('attempt_finished', 'This attempt is finished');
    if (existing && attempt.mode === 'practice' && !isSelfGrade) {
      throw conflict('already_answered', 'This question has already been answered');
    }

    let graded: Awaited<ReturnType<typeof grade>>;
    let response = body.response;
    if (isSelfGrade && body.response.type === 'short' && existing?.response.type === 'short') {
      const s = body.response.selfGrade ?? 0;
      // Keep the originally submitted text; only the grade changes.
      response = { type: 'short', text: existing.response.text, selfGrade: s };
      graded = {
        score: s,
        correct: s >= CORRECT_THRESHOLD,
        feedback: null,
        gradedBy: 'self',
        needsSelfGrade: false,
      };
    } else {
      graded = await grade(user.id, q, body.response);
    }
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

  r.post('/quiz/attempts/:id/finish', async (c) => {
    const user = requireUser(c);
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
