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

/**
 * practice = feedback after each answer; exam = feedback only after finishing. Both draw only on
 * questions that are graded automatically (never `short`).
 * discussion = `short` questions only, each talked through with the AI interviewer, who asks
 * follow-ups before the answer is graded. It needs the user's own AI key.
 */
export const QuizMode = z.enum(['practice', 'exam', 'discussion']);
export type QuizMode = z.infer<typeof QuizMode>;

/** How many times the candidate may speak on one discussion question before it is graded. */
export const DISCUSSION_MAX_TURNS = 3;
/** One candidate turn; three of them still fit a `short` response (4000). */
export const DISCUSSION_TURN_MAX_CHARS = 1200;

/** What was said about one discussion question after its prompt: the candidate and the follow-ups. */
export const DiscussionTurn = z.object({
  role: z.enum(['interviewer', 'candidate']),
  text: z.string(),
});
export type DiscussionTurn = z.infer<typeof DiscussionTurn>;

export const CreateAttemptRequest = z.object({
  topics: z.array(Slug).min(1),
  difficulty: QuizDifficulty.optional(),
  count: z.int().min(1).max(50).default(10),
  mode: QuizMode.default('practice'),
  /** Prefer questions the user has missed or never seen. */
  focusWeak: z.boolean().default(true),
  /**
   * Roadmap nodes (`QuizRoadmapNode.id`) to narrow the topics to: each must be on the roadmap of
   * one of `topics`, and narrows that topic to its subtopics. A topic none of them is on is taken
   * whole, as is every topic when this is absent.
   */
  nodes: z.array(Slug).min(1).max(20).optional(),
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
  /** discussion mode: questionId -> the turns so far (empty for the other modes) */
  discussion: z.record(z.string(), z.array(DiscussionTurn)).default({}),
  score: z.number().nullable(),
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
});
export type QuizAttempt = z.infer<typeof QuizAttempt>;

/** `POST /api/quiz/attempts/:id/discussion`: the candidate's next turn on one question. */
export const DiscussionReplyRequest = z.object({
  questionId: Slug,
  text: z.string().trim().min(1).max(DISCUSSION_TURN_MAX_CHARS),
});
export type DiscussionReplyRequest = z.infer<typeof DiscussionReplyRequest>;

/** The question's turns after the reply, and its feedback once the interviewer has closed it. */
export const DiscussionReplyResponse = z.object({
  turns: z.array(DiscussionTurn),
  feedback: AnswerFeedback.nullable(),
});
export type DiscussionReplyResponse = z.infer<typeof DiscussionReplyResponse>;

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
  /** how many of them are `short` (discussion) questions; the rest are graded automatically */
  shortCount: z.int().default(0),
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

// ---------------------------------------------------------------- roadmap (study areas per topic)

/** A node's title is drawn inside a box on the roadmap, so it stays short. */
export const ROADMAP_TITLE_MAX = 28;

/**
 * One study area on a topic's roadmap (authored in `packages/content/quiz/roadmap.yaml`). It
 * groups one or more question subtopics; `requires` names the nodes of the same topic worth
 * learning first. Prerequisites are advice: nothing is ever locked.
 */
export const QuizRoadmapNode = z.object({
  /** Globally unique, e.g. "cpp-move-semantics". */
  id: Slug,
  title: z.string().trim().min(1).max(ROADMAP_TITLE_MAX),
  /** One line: what the area covers. */
  description: z.string().trim().min(1).max(200),
  /** Exactly the `subtopic` strings of the questions this node covers. */
  subtopics: z.array(z.string().min(1)).min(1),
  requires: z.array(Slug).default([]),
});
export type QuizRoadmapNode = z.infer<typeof QuizRoadmapNode>;

/** The authoring format: topic slug -> that topic's nodes. */
export const QuizRoadmapFile = z.record(Slug, z.array(QuizRoadmapNode).min(1));
export type QuizRoadmapFile = z.infer<typeof QuizRoadmapFile>;

/**
 * The signed-in user's progress over some questions, from their latest graded answer to each
 * (the same answers the topic stats count; a short answer waiting for a self-grade is not one).
 */
export const QuizProgress = z.object({
  questionCount: z.int(),
  /** how many of them are open (`short`) questions, answered in a discussion or the bank */
  shortCount: z.int(),
  answered: z.int(),
  /** answered questions whose latest answer counts as correct */
  correct: z.int(),
  /** 0..1, mean score over the answered questions; null if none */
  accuracy: z.number().nullable(),
});
export type QuizProgress = z.infer<typeof QuizProgress>;

export const QuizRoadmapSubtopic = QuizProgress.extend({ subtopic: z.string() });
export type QuizRoadmapSubtopic = z.infer<typeof QuizRoadmapSubtopic>;

export const QuizRoadmapNodeProgress = QuizRoadmapNode.extend({
  subtopics: z.array(QuizRoadmapSubtopic),
}).extend(QuizProgress.shape);
export type QuizRoadmapNodeProgress = z.infer<typeof QuizRoadmapNodeProgress>;

/** `GET /api/quiz/roadmap`: every topic in study order, with its nodes and the caller's progress. */
export const QuizRoadmapTopic = QuizTopic.extend(QuizProgress.shape).extend({
  nodes: z.array(QuizRoadmapNodeProgress),
});
export type QuizRoadmapTopic = z.infer<typeof QuizRoadmapTopic>;
