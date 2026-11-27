/**
 * Postgres schema. Better Auth owns `user`, `session`, `account`, `verification` (text ids, shapes
 * dictated by Better Auth's core schema); everything else is the application's.
 *
 * Column names are snake_case; the Drizzle field names are what Better Auth's adapter uses.
 */
import type {
  DiscussionTurn,
  DrillCategory,
  DrillCategoryResult,
  DrillLevel,
  InterviewerSettings,
  InterviewSettings,
  InterviewStage,
  JudgeResult,
  Language,
  PadFormat,
  ProblemCategory,
  ProblemLimits,
  ProblemSignature,
  QuantGame,
  QuantRoundState,
  QuizDifficulty,
  QuizQuestion,
  QuizResponse,
  QuizRoadmapNode,
  QuizTrack,
  Report,
  ReportAssessment,
  TestCase,
  TimelineEvent,
  Track,
} from '@ipp/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength),
  fromDriver: (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
});

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ---------------------------------------------------------------- Better Auth

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /** Better Auth's anonymous plugin: a guest who joined a room by its link with just a name. */
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  /**
   * The site track the user chose in the header switch (`PUT /api/me/track`); null until they
   * choose. Ours, not Better Auth's: its adapter ignores it (it is not declared to Better Auth).
   */
  track: text('track').$type<Track>(),
  createdAt: tsz('created_at').notNull().defaultNow(),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: tsz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tsz('access_token_expires_at'),
    refreshTokenExpiresAt: tsz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tsz('expires_at').notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

// ---------------------------------------------------------------- problems

export const problems = pgTable('problems', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  difficulty: text('difficulty').$type<'easy' | 'medium' | 'hard'>().notNull(),
  /** Default only so the column can be added to a populated table; the seed writes the real one. */
  category: text('category').$type<ProblemCategory>().notNull().default('dsa'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  statement: text('statement').notNull(),
  signature: jsonb('signature').$type<ProblemSignature>().notNull(),
  limits: jsonb('limits').$type<ProblemLimits>().notNull(),
  interviewerNotes: text('interviewer_notes').notNull(),
  referenceSolutions: jsonb('reference_solutions')
    .$type<Partial<Record<Language, string>>>()
    .notNull(),
  /** The languages the problem offers (defaults: every language, no starter code, no harness). */
  languages: text('languages')
    .array()
    .$type<Language[]>()
    .notNull()
    .default(sql`'{cpp,python,java}'::text[]`),
  /** Editor starter code per language, instead of the generated scaffold. */
  starterCode: jsonb('starter_code')
    .$type<Partial<Record<Language, string>>>()
    .notNull()
    .default({}),
  /** Server-only: test harness per language, appended to the candidate's source for judged runs. */
  harness: jsonb('harness').$type<Partial<Record<Language, string>>>().notNull().default({}),
  source: jsonb('source').$type<{ name: string; url?: string; license?: string } | null>(),
  /** false when the problem has disappeared from content; existing pads keep working. */
  active: boolean('active').notNull().default(true),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
});

export const problemTests = pgTable(
  'problem_tests',
  {
    problemSlug: text('problem_slug')
      .notNull()
      .references(() => problems.slug, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    hidden: boolean('hidden').notNull(),
    data: jsonb('data').$type<TestCase>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.problemSlug, t.idx] })],
);

// ---------------------------------------------------------------- pads

export type PadStatus = 'active' | 'ended';
export type PadRole = 'owner' | 'collaborator';
export type PadKind = 'practice' | 'room';

/**
 * A staged interview (@ipp/contracts `interview.ts`): the plan and which stage is under way. Each
 * stage that has started is a pad (`pads.interview_id`, `pads.stage_index`).
 */
export const interviews = pgTable(
  'interviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** The site track whose Interviews tab it was built in. */
    track: text('track').$type<Track>().notNull(),
    /** The preset it started from; null when built from nothing. */
    preset: text('preset'),
    stages: jsonb('stages').$type<InterviewStage[]>().notNull(),
    interviewer: jsonb('interviewer').$type<InterviewSettings>().notNull(),
    status: text('status').$type<PadStatus>().notNull().default('active'),
    /** The index of the latest stage started. */
    current: integer('current').notNull().default(0),
    startedAt: tsz('started_at').notNull().defaultNow(),
    endedAt: tsz('ended_at'),
  },
  (t) => [index('interviews_owner_idx').on(t.ownerId, t.startedAt)],
);

/** A plan saved under a name, to start staged interviews from (`InterviewTemplate`). */
export const interviewTemplates = pgTable(
  'interview_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    track: text('track').$type<Track>().notNull(),
    name: text('name').notNull(),
    stages: jsonb('stages').$type<InterviewStage[]>().notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // A name is unique per user and track, whatever its case.
    uniqueIndex('interview_templates_name_idx').on(t.ownerId, t.track, sql`lower(${t.name})`),
  ],
);

export const pads = pgTable(
  'pads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** practice: the owner is the candidate; room: the owner hosts and interviews whoever joins. */
    kind: text('kind').$type<PadKind>().notNull().default('practice'),
    /** coding: a problem in the editor; quant: a live quant round (`quant_rounds`). */
    format: text('format').$type<PadFormat>().notNull().default('coding'),
    /** null: a room with a blank editor. A room's host can change it during the interview. */
    problemSlug: text('problem_slug').references(() => problems.slug),
    language: text('language').$type<Language>().notNull(),
    status: text('status').$type<PadStatus>().notNull().default('active'),
    /** null: no time limit. */
    durationMin: integer('duration_min'),
    interviewer: jsonb('interviewer').$type<InterviewerSettings>().notNull(),
    shareToken: text('share_token').notNull().unique(),
    /** Rooms: the host's private notes on the interview. Never sent to anyone else. */
    hostNotes: text('host_notes').notNull().default(''),
    startedAt: tsz('started_at').notNull().defaultNow(),
    endedAt: tsz('ended_at'),
    /** Set when session_started was sent to the interviewer (first time the pad is opened). */
    sessionStartedAt: tsz('session_started_at'),
    /** The staged interview this pad is a stage of, and which stage; both null otherwise. */
    interviewId: uuid('interview_id').references(() => interviews.id, { onDelete: 'cascade' }),
    stageIndex: integer('stage_index'),
  },
  (t) => [
    index('pads_owner_idx').on(t.ownerId, t.startedAt),
    // One pad per stage: a stage started twice at once loses the race instead of forking.
    uniqueIndex('pads_interview_stage_idx')
      .on(t.interviewId, t.stageIndex)
      .where(sql`${t.interviewId} is not null`),
  ],
);

/**
 * A quant pad's round, one row per pad of format `quant`, written with it. SERVER-ONLY: the state
 * holds the question ids and the interviewer's verdicts; the browser gets `publicRound(state,
 * version)`. Every change goes through `advanceRound` (@ipp/contracts) and a compare-and-swap on
 * `version`.
 */
export const quantRounds = pgTable('quant_rounds', {
  padId: uuid('pad_id')
    .primaryKey()
    .references(() => pads.id, { onDelete: 'cascade' }),
  state: jsonb('state').$type<QuantRoundState>().notNull(),
  version: integer('version').notNull().default(0),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
});

export const padMembers = pgTable(
  'pad_members',
  {
    padId: uuid('pad_id')
      .notNull()
      .references(() => pads.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<PadRole>().notNull(),
    joinedAt: tsz('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.padId, t.userId] }), index('pad_members_user_idx').on(t.userId)],
);

export const padDocs = pgTable('pad_docs', {
  padId: uuid('pad_id')
    .primaryKey()
    .references(() => pads.id, { onDelete: 'cascade' }),
  state: bytea('state').notNull(),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
});

export const padUpdates = pgTable(
  'pad_updates',
  {
    padId: uuid('pad_id')
      .notNull()
      .references(() => pads.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    at: tsz('at').notNull().defaultNow(),
    update: bytea('update').notNull(),
  },
  (t) => [primaryKey({ columns: [t.padId, t.seq] })],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    padId: uuid('pad_id')
      .notNull()
      .references(() => pads.id, { onDelete: 'cascade' }),
    role: text('role').$type<'interviewer' | 'candidate'>().notNull(),
    kind: text('kind').$type<'chat' | 'proactive'>().notNull(),
    intent: text('intent'),
    text: text('text').notNull(),
    via: text('via').$type<'text' | 'voice'>().notNull().default('text'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_pad_idx').on(t.padId, t.createdAt)],
);

export const interviewerNotes = pgTable(
  'interviewer_notes',
  {
    id: serial('id').primaryKey(),
    padId: uuid('pad_id')
      .notNull()
      .references(() => pads.id, { onDelete: 'cascade' }),
    at: tsz('at').notNull().defaultNow(),
    note: text('note').notNull(),
  },
  (t) => [index('interviewer_notes_pad_idx').on(t.padId, t.at)],
);

export const timelineEvents = pgTable(
  'timeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    padId: uuid('pad_id')
      .notNull()
      .references(() => pads.id, { onDelete: 'cascade' }),
    at: tsz('at').notNull().defaultNow(),
    event: jsonb('event').$type<TimelineEvent['event']>().notNull(),
  },
  (t) => [index('timeline_events_pad_idx').on(t.padId, t.at)],
);

// ---------------------------------------------------------------- runs

export type RunStatus = 'queued' | 'running' | 'finished';

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    padId: uuid('pad_id')
      .notNull()
      .references(() => pads.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The pad's problem when the run was queued (a room's problem can change). */
    problemSlug: text('problem_slug'),
    mode: text('mode').$type<'file' | 'samples' | 'custom' | 'submit'>().notNull(),
    language: text('language').$type<Language>().notNull(),
    source: text('source').notNull(),
    status: text('status').$type<RunStatus>().notNull().default('queued'),
    verdict: text('verdict'),
    /** Full, unredacted JudgeResult. Never sent to a client as-is. */
    result: jsonb('result').$type<JudgeResult>(),
    /** Ids of the job's tests that are hidden. */
    hiddenIds: text('hidden_ids').array().notNull().default(sql`'{}'::text[]`),
    /** Number of tests in the job (0 for file mode). */
    testCount: integer('test_count').notNull().default(0),
    /** When the watchdog gives up waiting for the judge. */
    deadlineAt: tsz('deadline_at').notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    finishedAt: tsz('finished_at'),
  },
  (t) => [
    index('runs_pad_idx').on(t.padId, t.createdAt),
    index('runs_user_idx').on(t.userId, t.createdAt),
    index('runs_pending_idx').on(t.deadlineAt).where(sql`status <> 'finished'`),
  ],
);

// ---------------------------------------------------------------- reports

export const reports = pgTable('reports', {
  padId: uuid('pad_id')
    .primaryKey()
    .references(() => pads.id, { onDelete: 'cascade' }),
  status: text('status').$type<Report['status']>().notNull(),
  stats: jsonb('stats').$type<Report['stats']>().notNull(),
  assessment: jsonb('assessment').$type<ReportAssessment | null>(),
  generatedAt: tsz('generated_at'),
});

// ---------------------------------------------------------------- quizzes

export const quizTopics = pgTable('quiz_topics', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  /** Study order (the order of quiz/topics.yaml); the roadmap lists topics by it. */
  position: integer('position').notNull().default(0),
  /** The topic's home (`QUIZ_TRACKS`), from quiz/topics.yaml: its content rules and quant rounds. */
  track: text('track').$type<QuizTrack>().notNull().default('fundamentals'),
  /** The other site tracks the topic also shows in (`QuizTopic.also`), from quiz/topics.yaml. */
  also: text('also').array().$type<Track[]>().notNull().default(sql`'{}'::text[]`),
  /** The topic's study areas from quiz/roadmap.yaml; empty when it has none. */
  roadmap: jsonb('roadmap').$type<QuizRoadmapNode[]>().notNull().default([]),
});

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: text('id').primaryKey(),
    topic: text('topic')
      .notNull()
      .references(() => quizTopics.slug),
    subtopic: text('subtopic').notNull(),
    difficulty: text('difficulty').$type<'easy' | 'medium' | 'hard'>().notNull(),
    type: text('type').$type<QuizQuestion['type']>().notNull(),
    data: jsonb('data').$type<QuizQuestion>().notNull(),
    /** false when the question was removed from content (answers that reference it are kept). */
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('quiz_questions_topic_idx').on(t.topic)],
);

/**
 * Market-making games (packages/content/games, ARCHITECTURE §8.3), played in quant rounds. Not
 * quiz questions: never in the question bank, a quiz attempt or the stats. SERVER-ONLY (`data`
 * holds the counterparty notes, hints and figures). A round snapshots what it plays, so a game
 * removed from content is only marked inactive, like a quiz question.
 */
export const quantGames = pgTable(
  'quant_games',
  {
    id: text('id').primaryKey(),
    topic: text('topic')
      .notNull()
      .references(() => quizTopics.slug),
    difficulty: text('difficulty').$type<QuizDifficulty>().notNull(),
    data: jsonb('data').$type<QuantGame>().notNull(),
    /** false when the game was removed from content. */
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('quant_games_topic_idx').on(t.topic)],
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<'practice' | 'exam' | 'discussion'>().notNull(),
    /** discussion mode: questionId -> turns so far (candidate replies and interviewer follow-ups). */
    transcript: jsonb('transcript').$type<Record<string, DiscussionTurn[]>>().notNull().default({}),
    topics: text('topics').array().notNull(),
    questionIds: text('question_ids').array().notNull(),
    status: text('status').$type<'active' | 'finished'>().notNull().default('active'),
    score: real('score'),
    startedAt: tsz('started_at').notNull().defaultNow(),
    finishedAt: tsz('finished_at'),
  },
  (t) => [index('quiz_attempts_user_idx').on(t.userId, t.startedAt)],
);

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => quizAttempts.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => quizQuestions.id),
    response: jsonb('response').$type<QuizResponse>().notNull(),
    score: real('score').notNull(),
    correct: boolean('correct').notNull(),
    feedback: text('feedback'),
    gradedBy: text('graded_by').$type<'auto' | 'ai' | 'self'>().notNull(),
    /** Short answer recorded without a model and without a self-grade yet. */
    needsSelfGrade: boolean('needs_self_grade').notNull().default(false),
    answeredAt: tsz('answered_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.attemptId, t.questionId] }),
    index('quiz_answers_question_idx').on(t.questionId),
  ],
);

/**
 * Answers given in the question bank, outside any attempt: the latest one per user and question
 * (answering again replaces it). Same grading columns as `quiz_answers`.
 */
export const quizStandaloneAnswers = pgTable(
  'quiz_standalone_answers',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => quizQuestions.id),
    response: jsonb('response').$type<QuizResponse>().notNull(),
    score: real('score').notNull(),
    correct: boolean('correct').notNull(),
    feedback: text('feedback'),
    gradedBy: text('graded_by').$type<'auto' | 'ai' | 'self'>().notNull(),
    /** Short answer recorded without a model and without a self-grade yet. */
    needsSelfGrade: boolean('needs_self_grade').notNull().default(false),
    answeredAt: tsz('answered_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionId] }),
    index('quiz_standalone_answers_question_idx').on(t.questionId),
  ],
);

/**
 * A quant round's judged questions as quiz answers of the pad's owner (ARCHITECTURE §8.2):
 * written when the pad has ended, in the transaction that finishes its round, and by any
 * `verdict` step after that; once per pad and question. Same grading columns as `quiz_answers`
 * (always AI-graded). The pad may be deleted later; the answer stays, like any quiz answer.
 */
export const quantRoundAnswers = pgTable(
  'quant_round_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** null once the pad was deleted. */
    padId: uuid('pad_id').references(() => pads.id, { onDelete: 'set null' }),
    questionId: text('question_id')
      .notNull()
      .references(() => quizQuestions.id),
    /** What the owner said while the question was open, as a short answer. */
    response: jsonb('response').$type<QuizResponse>().notNull(),
    score: real('score').notNull(),
    correct: boolean('correct').notNull(),
    feedback: text('feedback'),
    gradedBy: text('graded_by').$type<'auto' | 'ai' | 'self'>().notNull(),
    needsSelfGrade: boolean('needs_self_grade').notNull().default(false),
    /** When the question was closed. */
    answeredAt: tsz('answered_at').notNull(),
  },
  (t) => [
    uniqueIndex('quant_round_answers_pad_question_idx').on(t.padId, t.questionId),
    index('quant_round_answers_user_idx').on(t.userId, t.questionId),
    index('quant_round_answers_question_idx').on(t.questionId),
  ],
);

// ---------------------------------------------------------------- mental math drill

/**
 * One finished drill run. Questions are generated and marked in the browser, so this is the
 * client's result (checked for consistency by the contract); the totals and score are computed
 * by the API. `full_mix` (every category) marks the runs that count towards a best.
 */
export const drillRuns = pgTable(
  'drill_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    durationSec: integer('duration_sec').notNull(),
    level: text('level').$type<DrillLevel>().notNull(),
    /** In `DRILL_CATEGORIES` order. */
    categories: text('categories').array().$type<DrillCategory[]>().notNull(),
    fullMix: boolean('full_mix').notNull(),
    byCategory: jsonb('by_category').$type<DrillCategoryResult[]>().notNull(),
    correct: integer('correct').notNull(),
    wrong: integer('wrong').notNull(),
    skipped: integer('skipped').notNull(),
    score: integer('score').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
    finishedAt: tsz('finished_at').notNull().defaultNow(),
  },
  (t) => [index('drill_runs_user_idx').on(t.userId, t.finishedAt.desc())],
);

// ---------------------------------------------------------------- spend guard

export const aiUsage = pgTable(
  'ai_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    messages: integer('messages').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    /** Estimated cost in micro-dollars, from list prices or the provider's reported cost. */
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    /** Tokens of calls whose model had no known price (left out of `costMicros`). */
    unpricedTokens: bigint('unpriced_tokens', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/**
 * A user's own daily caps (`AiDailyLimits`), replacing the server defaults for them; no row means
 * the defaults apply. At least one cap is set (the API refuses a row with none).
 */
export const aiLimits = pgTable('ai_limits', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  dailyCostMicros: integer('daily_cost_micros'),
  dailyTokens: integer('daily_tokens'),
  dailyMessages: integer('daily_messages'),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
});

export const authSchema = { user, session, account, verification };
