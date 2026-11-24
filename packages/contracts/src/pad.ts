/** A pad is one interview session: a shared editor, a problem, a transcript and a timeline. */
import { z } from 'zod';
import { AiKeyState, AiModelChoice, InterviewerModel } from './ai';
import { Id, IsoDate, Language, Slug } from './common';
import { Difficulty, ProblemDetail } from './problem';
import { Run } from './run';

export const InterviewerSettings = z.object({
  enabled: z.boolean().default(true),
  style: z.enum(['supportive', 'neutral', 'tough']).default('neutral'),
  /** How readily the interviewer speaks without being addressed. */
  proactivity: z.enum(['low', 'normal', 'high']).default('normal'),
  voice: z.boolean().default(false),
  /**
   * The model the user chose for this interview; null/absent = the provider default. Used only
   * while the pad owner's key is from the same provider (`effectiveModel`).
   */
  model: AiModelChoice.nullable().optional(),
});
export type InterviewerSettings = z.infer<typeof InterviewerSettings>;

export const PadRole = z.enum(['owner', 'collaborator']);
export type PadRole = z.infer<typeof PadRole>;

/**
 *  practice  the owner is the candidate and the AI interviews them (the default)
 *  room      the owner is the interviewer (the host); whoever joins by the invite link is a
 *            candidate, with or without an account. No AI in the conversation.
 */
export const PadKind = z.enum(['practice', 'room']);
export type PadKind = z.infer<typeof PadKind>;

export const HOST_NOTES_MAX = 20_000;
export const GUEST_NAME_MAX = 60;
/** People who can join one pad by its invite link (the owner not counted). */
export const PAD_MEMBERS_MAX = 12;

export const Pad = z.object({
  id: Id,
  ownerId: z.string(),
  title: z.string(),
  kind: PadKind.default('practice'),
  /** null: a room with no library problem (a blank editor, runs as plain programs). */
  problemSlug: Slug.nullable(),
  language: Language,
  status: z.enum(['active', 'ended']),
  durationMin: z.int(),
  interviewer: InterviewerSettings,
  /**
   * Present only for the owner. A practice pad: anyone signed in with the link joins as a
   * collaborator. A room: anyone with the link joins as a candidate, a name is enough.
   */
  shareToken: z.string().nullable(),
  startedAt: IsoDate,
  endedAt: IsoDate.nullable(),
});
export type Pad = z.infer<typeof Pad>;

export const CreatePadRequest = z.object({
  kind: PadKind.default('practice'),
  /** Either a specific problem or a random pick. */
  problemSlug: Slug.optional(),
  random: z.object({ difficulty: Difficulty.optional(), tag: Slug.optional() }).optional(),
  /** Rooms only: start without a problem. */
  blank: z.boolean().optional(),
  language: Language,
  durationMin: z.int().min(5).max(180).default(45),
  interviewer: InterviewerSettings.default({
    enabled: true,
    style: 'neutral',
    proactivity: 'normal',
    voice: false,
  }),
  title: z.string().max(120).optional(),
});
export type CreatePadRequest = z.infer<typeof CreatePadRequest>;

export const UpdatePadRequest = z.object({
  language: Language.optional(),
  title: z.string().max(120).optional(),
  interviewer: InterviewerSettings.partial().optional(),
});
export type UpdatePadRequest = z.infer<typeof UpdatePadRequest>;

/** POST /api/pads/:id/problem (room host): another library problem, or null for a blank editor. */
export const ChangeProblemRequest = z.object({ problemSlug: Slug.nullable() });
export type ChangeProblemRequest = z.infer<typeof ChangeProblemRequest>;

/** The pad and its problem after a change; also what `pad.problem` carries to everyone in the room. */
export const PadProblem = z.object({ pad: Pad, problem: ProblemDetail.nullable() });
export type PadProblem = z.infer<typeof PadProblem>;

export const PadMember = z.object({
  userId: z.string(),
  name: z.string(),
  role: PadRole,
  /** Joined by the invite link without an account. */
  guest: z.boolean(),
});
export type PadMember = z.infer<typeof PadMember>;

/** GET /api/pads/invite/:token, readable without a session: enough to greet whoever was invited. */
export const InviteInfo = z.object({
  kind: PadKind,
  title: z.string(),
  hostName: z.string(),
  status: z.enum(['active', 'ended']),
});
export type InviteInfo = z.infer<typeof InviteInfo>;

/** POST /api/pads/join-guest: enter a room by its link with just a name (no account). */
export const JoinGuestRequest = z.object({
  shareToken: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(GUEST_NAME_MAX),
});
export type JoinGuestRequest = z.infer<typeof JoinGuestRequest>;

/** What only a room's host may read (GET /api/pads/:id/host). Never sent to a candidate. */
export const HostView = z.object({
  /** The current problem's private material; null in a blank room. */
  problem: z
    .object({
      slug: Slug,
      interviewerNotes: z.string(),
      referenceSolutions: z.partialRecord(Language, z.string()),
    })
    .nullable(),
  /** The host's own notes on this interview. */
  notes: z.string(),
});
export type HostView = z.infer<typeof HostView>;

export const UpdateHostNotesRequest = z.object({ notes: z.string().max(HOST_NOTES_MAX) });
export type UpdateHostNotesRequest = z.infer<typeof UpdateHostNotesRequest>;

/** POST /api/pads/:id/review: the AI's second opinion on the code as it is now, for the host. */
export const ReviewRequest = z.object({
  /** Something specific the host wants checked, in their own words. */
  question: z.string().trim().max(1000).optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const SolutionReview = z.object({
  /**
   *  correct     solves the problem as written
   *  incorrect   has a bug or fails on some input
   *  incomplete  not finished yet
   *  unclear     not enough to judge (e.g. a blank room with no stated task)
   */
  verdict: z.enum(['correct', 'incorrect', 'incomplete', 'unclear']),
  summary: z.string(),
  /** Concrete problems, each with the input or line it shows up on. */
  issues: z.array(z.string()),
  complexity: z.string().nullable(),
  /** Things worth asking the candidate next. */
  followUps: z.array(z.string()),
  /** The answer to the host's own question, when one was asked. */
  answer: z.string().nullable(),
  language: Language,
  model: z.string(),
  createdAt: IsoDate,
});
export type SolutionReview = z.infer<typeof SolutionReview>;

export const MessageIntent = z.enum([
  'greeting',
  'clarify',
  'nudge',
  'hint',
  'probe',
  'feedback',
  'time_check',
  'wrap_up',
  'answer',
]);
export type MessageIntent = z.infer<typeof MessageIntent>;

export const Message = z.object({
  id: Id,
  padId: Id,
  role: z.enum(['interviewer', 'candidate']),
  /** proactive = the interviewer spoke without being addressed */
  kind: z.enum(['chat', 'proactive']),
  intent: MessageIntent.nullable(),
  text: z.string(),
  via: z.enum(['text', 'voice']),
  userId: z.string().nullable(),
  createdAt: IsoDate,
});
export type Message = z.infer<typeof Message>;

/** Things that happened in a pad, for playback markers and the interviewer's context. */
export const TimelineEvent = z.object({
  id: Id,
  padId: Id,
  at: IsoDate,
  event: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('run'),
      runId: Id,
      mode: z.string(),
      verdict: z.string().nullable(),
      passed: z.int(),
      total: z.int(),
    }),
    z.object({ type: z.literal('language'), language: Language }),
    z.object({ type: z.literal('paste'), chars: z.int() }),
    z.object({ type: z.literal('blur'), ms: z.int() }),
    z.object({ type: z.literal('joined'), userId: z.string() }),
    /** The host changed the room's problem (null = blank). */
    z.object({ type: z.literal('problem'), problemSlug: Slug.nullable(), title: z.string() }),
    z.object({ type: z.literal('ended') }),
  ]),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const REPORT_DIMENSIONS = [
  'problem_solving',
  'coding',
  'communication',
  'testing',
  'complexity_analysis',
] as const;

export const ReportAssessment = z.object({
  recommendation: z.enum(['strong_hire', 'hire', 'lean_hire', 'lean_no_hire', 'no_hire']),
  summary: z.string(),
  scores: z.array(
    z.object({
      dimension: z.enum(REPORT_DIMENSIONS),
      score: z.int().min(1).max(4),
      evidence: z.string(),
    }),
  ),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
});
export type ReportAssessment = z.infer<typeof ReportAssessment>;

export const Report = z.object({
  padId: Id,
  status: z.enum(['pending', 'ready', 'failed']),
  generatedAt: IsoDate.nullable(),
  stats: z.object({
    durationSec: z.int(),
    runs: z.int(),
    submissions: z.int(),
    accepted: z.boolean(),
    candidateMessages: z.int(),
    interviewerMessages: z.int(),
  }),
  /**
   * null while pending, when the interviewer was off, without a usable key, when generation
   * failed, or in a room whose host has not asked for one.
   */
  assessment: ReportAssessment.nullable(),
  /**
   * Why there is no assessment (null when there is one or it is still being written). Computed
   * when the report is read: `no_key` / `key_rejected` describe the pad owner's key now, so the
   * owner can add one and ask for the assessment (`POST /api/pads/:id/report/assessment`);
   * `failed` means the owner has a usable key and can retry. `not_requested`: a room, where the
   * assessment is written only when the host asks for it (same endpoint).
   */
  assessmentUnavailable: z
    .enum(['interviewer_off', 'no_key', 'key_rejected', 'failed', 'not_requested'])
    .nullable(),
  /** A room's report, which only its host can read: the host's own notes. */
  hostNotes: z.string().nullable().default(null),
});
export type Report = z.infer<typeof Report>;

export const PadDetail = z.object({
  pad: Pad,
  role: PadRole,
  /** null in a blank room. */
  problem: ProblemDetail.nullable(),
  /** Everyone in the pad, the owner first. */
  members: z.array(PadMember).default([]),
  messages: z.array(Message),
  runs: z.array(Run),
  /** true when the pad owner has a usable AI provider API key (the interviewer runs on it). */
  interviewerAvailable: z.boolean(),
  /** The pad owner's key state; collaborators see this, never anything about the key itself. */
  interviewerKey: AiKeyState,
  /** The model the interviewer runs on now (null without a usable owner key). */
  interviewerModel: InterviewerModel.nullable().default(null),
});
export type PadDetail = z.infer<typeof PadDetail>;

export const PadSummary = Pad.pick({
  id: true,
  title: true,
  kind: true,
  problemSlug: true,
  language: true,
  status: true,
  startedAt: true,
  endedAt: true,
}).extend({
  /** null for a blank room. */
  problemTitle: z.string().nullable(),
  difficulty: Difficulty.nullable(),
  accepted: z.boolean(),
  /** The viewer's role: deleting an owned pad deletes it; a collaborator only leaves it. */
  role: PadRole,
});
export type PadSummary = z.infer<typeof PadSummary>;

/** DELETE /api/pads/:id. `pad`: the owner deleted it for everyone; `membership`: a collaborator left. */
export const DeletePadResponse = z.object({ padId: Id, removed: z.enum(['pad', 'membership']) });
export type DeletePadResponse = z.infer<typeof DeletePadResponse>;

/** Editor history for replay: Yjs updates in order, applied to an empty doc. */
export const Playback = z.object({
  updates: z.array(
    z.object({ seq: z.int(), at: IsoDate, update: z.string().describe('base64 Yjs update') }),
  ),
  events: z.array(TimelineEvent),
  messages: z.array(Message),
});
export type Playback = z.infer<typeof Playback>;

/**
 * Shared Yjs document for a pad. Document name: `pad:<padId>`.
 *   Y.Text  code:cpp | code:python | code:java   one buffer per language, seeded with the scaffold
 *   Y.Text  notes                                 candidate scratch notes
 *   Y.Map   drawing                               whiteboard scene (owned by the web app)
 *   Y.Map   stash                                 rooms: the code of problems the host switched
 *                                                 away from, `<slug>:<language>` -> string (the
 *                                                 slug is empty for the blank editor); written
 *                                                 by the server only
 */
export const YDOC = {
  name: (padId: string) => `pad:${padId}`,
  code: (language: Language) => `code:${language}`,
  notes: 'notes',
  drawing: 'drawing',
  stash: 'stash',
  stashKey: (problemSlug: string | null, language: Language) => `${problemSlug ?? ''}:${language}`,
} as const;
