/**
 * Postgres schema. Better Auth owns `user`, `session`, `account`, `verification` (text ids, shapes
 * dictated by Better Auth's core schema); everything else is the application's.
 *
 * Column names are snake_case; the Drizzle field names are what Better Auth's adapter uses.
 */
import type {
  InterviewerSettings,
  JudgeResult,
  Language,
  ProblemLimits,
  ProblemSignature,
  QuizQuestion,
  QuizResponse,
  Report,
  ReportAssessment,
  TestCase,
  TimelineEvent,
} from '@ipp/contracts';
import { sql } from 'drizzle-orm';
import {
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
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  statement: text('statement').notNull(),
  signature: jsonb('signature').$type<ProblemSignature>().notNull(),
  limits: jsonb('limits').$type<ProblemLimits>().notNull(),
  interviewerNotes: text('interviewer_notes').notNull(),
  referenceSolutions: jsonb('reference_solutions')
    .$type<Partial<Record<Language, string>>>()
    .notNull(),
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

export const pads = pgTable(
  'pads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    problemSlug: text('problem_slug')
      .notNull()
      .references(() => problems.slug),
    language: text('language').$type<Language>().notNull(),
    status: text('status').$type<PadStatus>().notNull().default('active'),
    durationMin: integer('duration_min').notNull(),
    interviewer: jsonb('interviewer').$type<InterviewerSettings>().notNull(),
    shareToken: text('share_token').notNull().unique(),
    startedAt: tsz('started_at').notNull().defaultNow(),
    endedAt: tsz('ended_at'),
    /** Set when session_started was sent to the interviewer (first time the pad is opened). */
    sessionStartedAt: tsz('session_started_at'),
  },
  (t) => [index('pads_owner_idx').on(t.ownerId, t.startedAt)],
);

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

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<'practice' | 'exam'>().notNull(),
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

// ---------------------------------------------------------------- spend guard

export const aiUsage = pgTable(
  'ai_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    messages: integer('messages').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const authSchema = { user, session, account, verification };
