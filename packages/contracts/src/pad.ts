/** A pad is one interview session: a shared editor, a problem, a transcript and a timeline. */
import { z } from 'zod';
import { AiKeyState } from './ai';
import { Id, IsoDate, Language, Slug } from './common';
import { Difficulty, ProblemDetail } from './problem';
import { Run } from './run';

export const InterviewerSettings = z.object({
  enabled: z.boolean().default(true),
  style: z.enum(['supportive', 'neutral', 'tough']).default('neutral'),
  /** How readily the interviewer speaks without being addressed. */
  proactivity: z.enum(['low', 'normal', 'high']).default('normal'),
  voice: z.boolean().default(false),
});
export type InterviewerSettings = z.infer<typeof InterviewerSettings>;

export const PadRole = z.enum(['owner', 'collaborator']);
export type PadRole = z.infer<typeof PadRole>;

export const Pad = z.object({
  id: Id,
  ownerId: z.string(),
  title: z.string(),
  problemSlug: Slug,
  language: Language,
  status: z.enum(['active', 'ended']),
  durationMin: z.int(),
  interviewer: InterviewerSettings,
  /** Present only for the owner. Anyone signed in with the link can join as a collaborator. */
  shareToken: z.string().nullable(),
  startedAt: IsoDate,
  endedAt: IsoDate.nullable(),
});
export type Pad = z.infer<typeof Pad>;

export const CreatePadRequest = z.object({
  /** Either a specific problem or a random pick. */
  problemSlug: Slug.optional(),
  random: z.object({ difficulty: Difficulty.optional(), tag: Slug.optional() }).optional(),
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
  /** null while pending, when the interviewer was off, without a usable key, or when generation failed. */
  assessment: ReportAssessment.nullable(),
  /**
   * Why there is no assessment (null when there is one or it is still being written). Computed
   * when the report is read: `no_key` / `key_rejected` describe the pad owner's key now, so the
   * owner can add one and ask for the assessment (`POST /api/pads/:id/report/assessment`);
   * `failed` means the owner has a usable key and can retry.
   */
  assessmentUnavailable: z.enum(['interviewer_off', 'no_key', 'key_rejected', 'failed']).nullable(),
});
export type Report = z.infer<typeof Report>;

export const PadDetail = z.object({
  pad: Pad,
  role: PadRole,
  problem: ProblemDetail,
  messages: z.array(Message),
  runs: z.array(Run),
  /** true when the pad owner has a usable Anthropic API key (the interviewer runs on it). */
  interviewerAvailable: z.boolean(),
  /** The pad owner's key state; collaborators see this, never anything about the key itself. */
  interviewerKey: AiKeyState,
});
export type PadDetail = z.infer<typeof PadDetail>;

export const PadSummary = Pad.pick({
  id: true,
  title: true,
  problemSlug: true,
  language: true,
  status: true,
  startedAt: true,
  endedAt: true,
}).extend({
  problemTitle: z.string(),
  difficulty: Difficulty,
  accepted: z.boolean(),
});
export type PadSummary = z.infer<typeof PadSummary>;

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
 */
export const YDOC = {
  name: (padId: string) => `pad:${padId}`,
  code: (language: Language) => `code:${language}`,
  notes: 'notes',
  drawing: 'drawing',
} as const;
