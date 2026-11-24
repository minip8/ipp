import { z } from 'zod';
import { Id, IsoDate, Language, Slug } from './common';

export const QuizTopic = z.object({ slug: Slug, title: z.string(), description: z.string() });
export type QuizTopic = z.infer<typeof QuizTopic>;

export const QuizDifficulty = z.enum(['easy', 'medium', 'hard']);

export const ContentSource = z.object({
  name: z.string(),
  url: z.url().optional(),
  license: z.string().optional(),
});
export type ContentSource = z.infer<typeof ContentSource>;

const Choice = z.object({ id: z.string().min(1).max(8), text: z.string() });

const QuestionBase = z.object({
  /** Stable id, e.g. "cpp-move-semantics-003". */
  id: Slug,
  topic: Slug,
  subtopic: z.string(),
  difficulty: QuizDifficulty,
  /** Markdown; may contain fenced code. */
  prompt: z.string(),
  /** Markdown shown after answering: why the answer is right and the distractors are wrong. */
  explanation: z.string(),
  tags: z.array(Slug).default([]),
  /** Where the idea came from. Wording is always our own unless the licence permits reuse. */
  source: ContentSource.optional(),
});

/** What a program does, in the style of cppquiz.org. */
export const OutputAnswer = z.discriminatedUnion('kind', [
  /** well-defined: prints exactly this (compared after trimming and collapsing whitespace) */
  z.object({ kind: z.literal('output'), output: z.string() }),
  z.object({ kind: z.literal('compile_error') }),
  z.object({ kind: z.literal('undefined') }),
  /** unspecified or implementation-defined */
  z.object({ kind: z.literal('unspecified') }),
  /** Python and Java: raises / throws at runtime */
  z.object({ kind: z.literal('runtime_error') }),
]);
export type OutputAnswer = z.infer<typeof OutputAnswer>;

/** Authoring format in packages/content. Answers never leave the server before a response is recorded. */
export const QuizQuestion = z.discriminatedUnion('type', [
  QuestionBase.extend({
    type: z.literal('single'),
    choices: z.array(Choice).min(2),
    answer: z.string(),
  }),
  QuestionBase.extend({
    type: z.literal('multiple'),
    choices: z.array(Choice).min(2),
    answer: z.array(z.string()).min(1),
  }),
  /** "What does this program print?" The program is in `code`, not in the prompt. */
  QuestionBase.extend({
    type: z.literal('output'),
    language: Language,
    /** e.g. "C++20", "Python 3.12" */
    standard: z.string(),
    code: z.string(),
    answer: OutputAnswer,
  }),
  /** Free-form answer graded against key points by the AI, or self-graded when no model is configured. */
  QuestionBase.extend({
    type: z.literal('short'),
    reference: z.string(),
    keyPoints: z.array(z.string()).min(1),
  }),
]);
export type QuizQuestion = z.infer<typeof QuizQuestion>;

export const PublicQuizQuestion = z.object({
  id: Slug,
  topic: Slug,
  subtopic: z.string(),
  difficulty: QuizDifficulty,
  type: z.enum(['single', 'multiple', 'short', 'output']),
  prompt: z.string(),
  choices: z.array(Choice).nullable(),
  /** output questions only */
  code: z.object({ language: Language, standard: z.string(), source: z.string() }).nullable(),
});
export type PublicQuizQuestion = z.infer<typeof PublicQuizQuestion>;

/** practice = feedback after each answer; exam = feedback only after finishing */
export const QuizMode = z.enum(['practice', 'exam']);

export const CreateAttemptRequest = z.object({
  topics: z.array(Slug).min(1),
  difficulty: QuizDifficulty.optional(),
  count: z.int().min(1).max(50).default(10),
  mode: QuizMode.default('practice'),
  /** Prefer questions the user has missed or never seen. */
  focusWeak: z.boolean().default(true),
});
export type CreateAttemptRequest = z.infer<typeof CreateAttemptRequest>;

export const QuizResponse = z.discriminatedUnion('type', [
  z.object({ type: z.literal('single'), choice: z.string() }),
  z.object({ type: z.literal('multiple'), choices: z.array(z.string()) }),
  z.object({ type: z.literal('output'), answer: OutputAnswer }),
  z.object({
    type: z.literal('short'),
    text: z.string().max(4000),
    selfGrade: z.number().min(0).max(1).optional(),
  }),
]);
export type QuizResponse = z.infer<typeof QuizResponse>;

export const SubmitAnswerRequest = z.object({ questionId: Slug, response: QuizResponse });

export const AnswerFeedback = z.object({
  questionId: Slug,
  /** 0..1; partial credit for multiple-select and short answers */
  score: z.number(),
  correct: z.boolean(),
  /** single: choice id; multiple: choice ids; short: reference answer; output: OutputAnswer */
  correctAnswer: z.union([z.string(), z.array(z.string()), OutputAnswer]),
  explanation: z.string(),
  /** short answers: which key points were covered or missed */
  feedback: z.string().nullable(),
  gradedBy: z.enum(['auto', 'ai', 'self']),
  /** short answer with no model configured: the client shows the reference and asks for a self-grade */
  needsSelfGrade: z.boolean(),
});
export type AnswerFeedback = z.infer<typeof AnswerFeedback>;

export const QuizAttempt = z.object({
  id: Id,
  mode: QuizMode,
  topics: z.array(Slug),
  status: z.enum(['active', 'finished']),
  questions: z.array(PublicQuizQuestion),
  /** questionId -> recorded response (so a reload can resume) */
  responses: z.record(z.string(), QuizResponse),
  /** practice: feedback for answered questions; exam: empty until finished */
  feedback: z.array(AnswerFeedback),
  score: z.number().nullable(),
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
});
export type QuizAttempt = z.infer<typeof QuizAttempt>;

export const QuizAttemptSummary = QuizAttempt.pick({
  id: true,
  mode: true,
  topics: true,
  status: true,
  score: true,
  startedAt: true,
  finishedAt: true,
}).extend({
  questionCount: z.int(),
});
export type QuizAttemptSummary = z.infer<typeof QuizAttemptSummary>;

export const QuizTopicStats = QuizTopic.extend({
  questionCount: z.int(),
  answered: z.int(),
  /** 0..1 over the user's answered questions, null if none */
  accuracy: z.number().nullable(),
});
export type QuizTopicStats = z.infer<typeof QuizTopicStats>;

// ---------------------------------------------------------------- question bank (browse and answer)

/**
 * Where the user stands on one question, from their latest countable answer: a standalone answer
 * given in the question bank, a practice-attempt answer, or an answer in a finished exam.
 * `pending` = a short answer recorded without a model that still waits for a self-grade.
 */
export const QuizQuestionStatus = z.enum([
  'unanswered',
  'correct',
  'partial',
  'incorrect',
  'pending',
]);
export type QuizQuestionStatus = z.infer<typeof QuizQuestionStatus>;

export const QuizBankItem = z.object({
  question: PublicQuizQuestion,
  status: QuizQuestionStatus,
  /** 0..1 of the latest answer; null when unanswered or waiting for a self-grade */
  score: z.number().nullable(),
  answeredAt: IsoDate.nullable(),
});
export type QuizBankItem = z.infer<typeof QuizBankItem>;

/** `GET /api/quiz/topics/:slug/questions`: a topic's active questions, never with answers. */
export const QuizBank = z.object({ topic: QuizTopic, items: z.array(QuizBankItem) });
export type QuizBank = z.infer<typeof QuizBank>;

/**
 * `GET /api/quiz/questions/:id`: one question with the user's latest recorded response and its
 * feedback. Both are null until a response is recorded, so nothing is revealed before answering.
 */
export const QuizBankQuestion = QuizBankItem.extend({
  response: QuizResponse.nullable(),
  feedback: AnswerFeedback.nullable(),
}).refine((q) => (q.response === null) === (q.feedback === null), {
  message: 'feedback is present exactly when a response is',
});
export type QuizBankQuestion = z.infer<typeof QuizBankQuestion>;

/** `POST /api/quiz/questions/:id/answers`: answer outside any attempt; returns `AnswerFeedback`. */
export const SubmitStandaloneAnswerRequest = z.object({ response: QuizResponse });
export type SubmitStandaloneAnswerRequest = z.infer<typeof SubmitStandaloneAnswerRequest>;
