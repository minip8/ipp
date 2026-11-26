import { z } from 'zod';
import { Id, IsoDate, Language, Slug } from './common';
import { NUMERIC_INPUT_MAX, parseNumeric } from './numeric';
import { Track } from './track';

/**
 * A quiz topic's home (`track` in `quiz/topics.yaml`, `quiz_topics.track`). It decides the
 * topic's content rules (a quant topic's Markdown must typeset as maths and every numeric answer
 * is recomputed by a quant check; a fundamentals topic has no maths at all), what the seed treats
 * as quant, and what a quant round may draw from: only home `quant` topics. The site track the
 * header switch chooses is `Track` in `track.ts`; `homeTrack` maps a home to it, and a topic's
 * `also` lists the other site tracks it shows in. The values are stored, so they stay as they are.
 */
export const QUIZ_TRACKS = ['fundamentals', 'quant'] as const;
export const QuizTrack = z.enum(QUIZ_TRACKS);
export type QuizTrack = z.infer<typeof QuizTrack>;

export const QUIZ_TRACK_INFO: Record<QuizTrack, { label: string; description: string }> = {
  fundamentals: {
    label: 'Fundamentals',
    description:
      'Languages and systems: what a developer interview asks beyond the coding problem.',
  },
  quant: {
    label: 'Quant',
    description:
      'Probability, statistics, markets and puzzles for trading and research interviews.',
  },
};

/**
 * The Quant page's guided paths through the quant track: topic slugs in the order to study them.
 * A topic the server does not have is skipped by the page, so a path may name one before its
 * content is loaded.
 */
export const QUANT_PATHS = ['trader', 'researcher'] as const;
export const QuantPath = z.enum(QUANT_PATHS);
export type QuantPath = z.infer<typeof QuantPath>;

export const QUANT_PATH_INFO: Record<
  QuantPath,
  { label: string; description: string; topics: readonly string[] }
> = {
  trader: {
    label: 'Trader',
    description:
      'Probability and puzzles first, then betting, market making and options: what trading interviews lean on.',
    topics: ['probability', 'brainteasers', 'betting-market-making', 'options'],
  },
  researcher: {
    label: 'Researcher',
    description:
      'Probability, then statistics and linear algebra, then options: the maths research interviews build on.',
    topics: ['probability', 'statistics', 'algebra-calculus', 'options'],
  },
};

export const QuizTopic = z.object({
  slug: Slug,
  title: z.string(),
  description: z.string(),
  track: QuizTrack.default('fundamentals'),
  /** The other site tracks this topic also shows in, beside its home's (see `topicTracks`). */
  also: z.array(Track).default([]),
});
export type QuizTopic = z.infer<typeof QuizTopic>;

export const QuizDifficulty = z.enum(['easy', 'medium', 'hard']);
export type QuizDifficulty = z.infer<typeof QuizDifficulty>;

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

/**
 * What an interviewer needs beyond the answer to run a question live. Server-only, like the
 * reference answer: never sent to the browser, not even after answering.
 */
const InterviewExtras = {
  /** A hint ladder, the gentlest first; each gives away a little more, none the answer. */
  hints: z.array(z.string().trim().min(1)).max(8).default([]),
  /** Questions to ask once the candidate has the answer: generalisations, variations, "why". */
  followUps: z.array(z.string().trim().min(1)).max(8).default([]),
};

/**
 * A number as `parseNumeric` reads it: `1/3`, `0.25`, `42`, `12.5%`. YAML numbers are accepted and
 * kept as text, so an exact fraction never goes through a float.
 */
export const NumericLiteral = z
  .union([
    z.string(),
    // An unquoted YAML integer beyond 2^53 has already lost digits by the time it gets here.
    z.number().refine((n) => !Number.isInteger(n) || Number.isSafeInteger(n), {
      message: 'too large for a YAML number: quote it',
    }),
  ])
  .transform((v) => String(v).trim())
  .refine((v) => parseNumeric(v) !== null, {
    message: 'not a number: write an integer, a fraction like 5/36 or a decimal',
  });

export const NumericToleranceSpec = z
  .object({ abs: z.number().positive().optional(), rel: z.number().positive().optional() })
  .refine((t) => t.abs !== undefined || t.rel !== undefined, {
    message: 'a tolerance needs abs, rel or both',
  });
export type NumericToleranceSpec = z.infer<typeof NumericToleranceSpec>;

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
    ...InterviewExtras,
  }),
  /**
   * The answer is one number, typed as an integer, fraction, decimal or percentage and graded
   * automatically by `numericMatches` (packages/contracts/src/numeric.ts).
   */
  QuestionBase.extend({
    type: z.literal('numeric'),
    /** The exact value where there is one (`5/36`), otherwise at least six significant figures. */
    answer: NumericLiteral,
    /**
     * Markdown shown as the correct answer when the bare number is not the best way to say it,
     * e.g. "$1/e \approx 0.368$". Defaults to `answer`.
     */
    answerText: z.string().trim().min(1).optional(),
    /**
     * Absent: an exact answer, where a decimal or whole number correct to three significant
     * figures also counts (whole-number answers must be exact). Present: anything within it counts, for estimates.
     */
    tolerance: NumericToleranceSpec.optional(),
    /**
     * Shown after the input, e.g. "flips" or "dollars". The answer is in this unit. Never a
     * percent sign: a typed `12.5%` is read as 0.125, so a percentage answer is authored as the
     * fraction it is (`1/8`) and needs no unit.
     */
    unit: z
      .string()
      .trim()
      .min(1)
      .max(24)
      .refine((u) => !u.includes('%'), { message: 'a unit cannot be a percent sign' })
      .optional(),
    ...InterviewExtras,
  }),
]);
export type QuizQuestion = z.infer<typeof QuizQuestion>;

export const PublicQuizQuestion = z.object({
  id: Slug,
  topic: Slug,
  subtopic: z.string(),
  difficulty: QuizDifficulty,
  type: z.enum(['single', 'multiple', 'short', 'output', 'numeric']),
  prompt: z.string(),
  choices: z.array(Choice).nullable(),
  /** output questions only */
  code: z.object({ language: Language, standard: z.string(), source: z.string() }).nullable(),
  /** numeric questions that have one: the unit the answer is in, shown beside the input */
  unit: z.string().nullable().default(null),
});
export type PublicQuizQuestion = z.infer<typeof PublicQuizQuestion>;

/**
 * practice = feedback after each answer; exam = feedback only after finishing. Both draw only on
 * questions that are graded automatically (every type but `short`).
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
  /** `value` is what the user typed; it must be a number `parseNumeric` can read. */
  z.object({
    type: z.literal('numeric'),
    value: z
      .string()
      .trim()
      .min(1)
      .max(NUMERIC_INPUT_MAX)
      .refine((v) => parseNumeric(v) !== null, { message: 'not a number' }),
  }),
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
  /**
   * single: choice id; multiple: choice ids; short: reference answer; output: OutputAnswer;
   * numeric: the answer as Markdown (`answerText`, or the number itself)
   */
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
  /** Questions with a recorded answer (in a running exam too, though those do not count yet). */
  answeredCount: z.int().default(0),
});
export type QuizAttemptSummary = z.infer<typeof QuizAttemptSummary>;

/**
 * `DELETE /api/quiz/attempts/:id`: one of the caller's attempts, of any mode, running or
 * finished, is gone with its answers. Everything that reads the latest countable answer per
 * question (stats, the roadmap, question status, "focus weak") falls back to what is left.
 */
export const DeleteAttemptResponse = z.object({ attemptId: Id });
export type DeleteAttemptResponse = z.infer<typeof DeleteAttemptResponse>;

/**
 * `DELETE /api/quiz/history`: every attempt of the caller's (with its answers) and every answer
 * they gave in the question bank, counted. Judged questions of quant rounds are not touched.
 */
export const ClearQuizHistoryResponse = z.object({
  attempts: z.int().min(0),
  bankAnswers: z.int().min(0),
});
export type ClearQuizHistoryResponse = z.infer<typeof ClearQuizHistoryResponse>;

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
  /**
   * Nodes of *other* topics that go with this one (background it leans on, or the same ground
   * from another side). A link is written on one of its two nodes and shown on both; it draws no
   * edge and has no say in what is "next up".
   */
  related: z.array(Slug).default([]),
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
