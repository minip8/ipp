/**
 * Grading and answer history shared by attempts and the question bank.
 *
 * A user's answers live in two tables: `quiz_answers` (inside an attempt) and
 * `quiz_standalone_answers` (the question bank, latest answer per question). Stats, the
 * "focus weak" selection and per-question status all read the latest *countable* answer per
 * question across both: standalone answers, practice-attempt answers, and exam answers once the
 * exam is finished (an exam still running must not reveal correctness).
 */
import type {
  AnswerFeedback,
  QuizQuestion,
  QuizQuestionStatus,
  QuizResponse,
} from '@ipp/contracts';
import { type Db, quizAnswers, quizAttempts, quizStandaloneAnswers } from '@ipp/db';
import { and, type Column, desc, eq, inArray, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { badRequest } from '../http/errors';
import { CORRECT_THRESHOLD, correctAnswer, gradeAuto } from './grade';

export type AnswerRow = typeof quizAnswers.$inferSelect;
export type Graded = Pick<
  AnswerRow,
  'score' | 'correct' | 'feedback' | 'gradedBy' | 'needsSelfGrade'
>;
/** The grading columns both answer tables share. */
export type RecordedAnswer = Graded & Pick<AnswerRow, 'questionId' | 'response' | 'answeredAt'>;

/**
 * Attempt answers that may influence stats and selection: practice and discussion answers (their
 * feedback is given at once), and exam answers once the exam is finished.
 */
export const COUNTABLE = sql`(${quizAttempts.mode} <> 'exam' or ${quizAttempts.status} = 'finished')`;

export function feedbackOf(q: QuizQuestion, a: Graded | undefined): AnswerFeedback {
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

export function statusOf(a: Graded | undefined): QuizQuestionStatus {
  if (!a) return 'unanswered';
  if (a.needsSelfGrade) return 'pending';
  if (a.correct) return 'correct';
  return a.score > 0 ? 'partial' : 'incorrect';
}

/**
 * Grades a response: auto for single / multiple / output; short answers on the user's own key,
 * falling back to their self-grade (or asking for one) without a key or when the model fails.
 */
export async function gradeResponse(
  ctx: Ctx,
  userId: string,
  q: QuizQuestion,
  response: QuizResponse,
): Promise<Graded> {
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

/**
 * A self-grade for a short answer that was recorded without a model: keeps the originally
 * submitted text and only changes the grade. Null when `body` is not such a self-grade.
 */
export function applySelfGrade(
  existing: Pick<AnswerRow, 'response' | 'needsSelfGrade'> | undefined,
  body: QuizResponse,
): { response: QuizResponse; graded: Graded } | null {
  if (!existing?.needsSelfGrade || body.type !== 'short' || body.selfGrade === undefined)
    return null;
  if (existing.response.type !== 'short') return null;
  const s = body.selfGrade;
  return {
    response: { type: 'short', text: existing.response.text, selfGrade: s },
    graded: {
      score: s,
      correct: s >= CORRECT_THRESHOLD,
      feedback: null,
      gradedBy: 'self',
      needsSelfGrade: false,
    },
  };
}

/**
 * The latest countable answer per question for one user, across attempts and the question bank.
 * `graded` leaves out short answers still waiting for a self-grade (what stats count).
 */
export function latestAnswers(
  db: Db,
  userId: string,
  opts: { graded?: boolean; questionIds?: string[] } = {},
) {
  const ids = opts.questionIds;
  const only = (col: Column) => (ids ? (ids.length ? inArray(col, ids) : sql`false`) : undefined);
  const fromAttempts = db
    .select({
      questionId: quizAnswers.questionId,
      response: quizAnswers.response,
      score: quizAnswers.score,
      correct: quizAnswers.correct,
      feedback: quizAnswers.feedback,
      gradedBy: quizAnswers.gradedBy,
      needsSelfGrade: quizAnswers.needsSelfGrade,
      answeredAt: quizAnswers.answeredAt,
    })
    .from(quizAnswers)
    .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
    .where(
      and(
        eq(quizAttempts.userId, userId),
        COUNTABLE,
        opts.graded ? eq(quizAnswers.needsSelfGrade, false) : undefined,
        only(quizAnswers.questionId),
      ),
    );
  const s = quizStandaloneAnswers;
  const standalone = db
    .select({
      questionId: s.questionId,
      response: s.response,
      score: s.score,
      correct: s.correct,
      feedback: s.feedback,
      gradedBy: s.gradedBy,
      needsSelfGrade: s.needsSelfGrade,
      answeredAt: s.answeredAt,
    })
    .from(s)
    .where(
      and(
        eq(s.userId, userId),
        opts.graded ? eq(s.needsSelfGrade, false) : undefined,
        only(s.questionId),
      ),
    );
  const all = fromAttempts.unionAll(standalone).as('countable_answers');
  return db
    .selectDistinctOn([all.questionId], {
      questionId: all.questionId,
      response: all.response,
      score: all.score,
      correct: all.correct,
      feedback: all.feedback,
      gradedBy: all.gradedBy,
      needsSelfGrade: all.needsSelfGrade,
      answeredAt: all.answeredAt,
    })
    .from(all)
    .orderBy(all.questionId, desc(all.answeredAt));
}

export async function latestAnswerMap(
  db: Db,
  userId: string,
  opts: { graded?: boolean; questionIds?: string[] } = {},
): Promise<Map<string, RecordedAnswer>> {
  const rows = await latestAnswers(db, userId, opts);
  return new Map(rows.map((r) => [r.questionId, r]));
}
