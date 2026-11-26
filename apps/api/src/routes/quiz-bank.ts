/**
 * The question bank: browse a topic's questions and answer any of them outside an attempt.
 * Answers go to `quiz_standalone_answers` (latest per user and question) and count toward stats
 * and the "focus weak" selection like attempt answers do (see quiz/answers.ts).
 */
import {
  type AnswerFeedback,
  type QuizBank,
  type QuizBankItem,
  type QuizBankQuestion,
  type QuizQuestion,
  Slug,
  SubmitStandaloneAnswerRequest,
} from '@ipp/contracts';
import { quizQuestions, quizStandaloneAnswers, quizTopics } from '@ipp/db';
import { and, eq } from '@ipp/db/orm';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireAccount } from '../http/app';
import { badRequest, notFound, rateLimited } from '../http/errors';
import {
  applySelfGrade,
  feedbackOf,
  gradeResponse,
  latestAnswerMap,
  type RecordedAnswer,
  statusOf,
} from '../quiz/answers';
import { publicQuestion } from '../quiz/grade';

const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 } as const;

/** Grouped by subtopic, easy to hard within each, then by id: a stable order to work through. */
export function bankOrder(a: QuizQuestion, b: QuizQuestion): number {
  return (
    a.subtopic.localeCompare(b.subtopic) ||
    DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] ||
    a.id.localeCompare(b.id)
  );
}

function itemOf(q: QuizQuestion, a: RecordedAnswer | undefined): QuizBankItem {
  return {
    question: publicQuestion(q),
    status: statusOf(a),
    score: a && !a.needsSelfGrade ? a.score : null,
    answeredAt: a?.answeredAt.toISOString() ?? null,
  };
}

export function quizBankRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  const { db } = ctx;

  /** An active question, or 404 (unknown ids and questions removed from content alike). */
  async function activeQuestion(id: string): Promise<QuizQuestion> {
    if (!Slug.safeParse(id).success) throw notFound('Question');
    const [row] = await db
      .select({ data: quizQuestions.data })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.id, id), eq(quizQuestions.active, true)));
    if (!row) throw notFound('Question');
    return row.data;
  }

  r.get('/quiz/topics/:slug/questions', async (c) => {
    const user = requireAccount(c);
    const slug = c.req.param('slug');
    if (!Slug.safeParse(slug).success) throw notFound('Topic');
    const [topic] = await db.select().from(quizTopics).where(eq(quizTopics.slug, slug));
    if (!topic) throw notFound('Topic');
    const rows = await db
      .select({ data: quizQuestions.data })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.topic, slug), eq(quizQuestions.active, true)));
    const questions = rows.map((q) => q.data).sort(bankOrder);
    const latest = await latestAnswerMap(db, user.id, { questionIds: questions.map((q) => q.id) });
    // Public projection and status only: answers and explanations come with a recorded response.
    const out: QuizBank = {
      topic: {
        slug: topic.slug,
        title: topic.title,
        description: topic.description,
        track: topic.track,
        also: topic.also,
      },
      items: questions.map((q) => itemOf(q, latest.get(q.id))),
    };
    return c.json(out);
  });

  r.get('/quiz/questions/:id', async (c) => {
    const user = requireAccount(c);
    const q = await activeQuestion(c.req.param('id'));
    const a = (await latestAnswerMap(db, user.id, { questionIds: [q.id] })).get(q.id);
    const out: QuizBankQuestion = {
      ...itemOf(q, a),
      response: a?.response ?? null,
      feedback: a ? feedbackOf(q, a) : null,
    };
    return c.json(out);
  });

  r.post('/quiz/questions/:id/answers', async (c) => {
    const user = requireAccount(c);
    const body = await parseBody(c, SubmitStandaloneAnswerRequest);
    // Same budget as attempt answers: short answers are graded on the user's own key.
    const wait = await ctx.limiter.hit([
      { key: `quiz:u:${user.id}`, ...ctx.config.limits.quizAnswers.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);
    const q = await activeQuestion(c.req.param('id'));
    if (q.type !== body.response.type)
      throw badRequest('Response type does not match the question');
    const [existing] = await db
      .select()
      .from(quizStandaloneAnswers)
      .where(
        and(eq(quizStandaloneAnswers.userId, user.id), eq(quizStandaloneAnswers.questionId, q.id)),
      );
    // Grading a pending short answer keeps its text; anything else is a fresh answer that replaces
    // the previous one.
    const selfGrade = applySelfGrade(existing, body.response);
    const response = selfGrade?.response ?? body.response;
    const graded = selfGrade?.graded ?? (await gradeResponse(ctx, user.id, q, body.response));
    const values = {
      userId: user.id,
      questionId: q.id,
      response,
      ...graded,
      answeredAt: new Date(),
    };
    const [saved] = await db
      .insert(quizStandaloneAnswers)
      .values(values)
      .onConflictDoUpdate({
        target: [quizStandaloneAnswers.userId, quizStandaloneAnswers.questionId],
        set: values,
      })
      .returning();
    const out: AnswerFeedback = feedbackOf(q, saved);
    return c.json(out);
  });

  return r;
}
