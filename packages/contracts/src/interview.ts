/**
 * A staged interview: an ordered list of stages (`interview-stage.ts`) taken in one sitting with
 * the AI interviewer, each stage an ordinary practice pad. The interview is the parent record:
 * it keeps the plan, which stage is under way, and links to the stages' pads; the pad, round and
 * report code know nothing of it beyond a pad's `interviewId`.
 *
 *   POST /api/interviews            create it and start stage 0            -> InterviewStart
 *   GET  /api/interviews            the user's interviews, newest first    -> Interview[]
 *   GET  /api/interviews/:id                                               -> Interview
 *   POST /api/interviews/:id/next   end the stage under way and start the  -> InterviewStart
 *                                   one after it; after the last, end the
 *                                   interview (`padId` null)
 *   POST /api/interviews/:id/end    end it now: the stage under way ends,  -> Interview
 *                                   the stages not started are skipped
 *   DELETE /api/interviews/:id      the interview and every stage's pad    -> { interviewId }
 *
 * A plan a user wants to take again is saved as a template (`InterviewTemplate`):
 *
 *   GET    /api/interview-templates       mine, in every track, by name    -> InterviewTemplate[]
 *   POST   /api/interview-templates       save a plan under a name         -> InterviewTemplate
 *   PUT    /api/interview-templates/:id   rename it and/or replace its plan -> InterviewTemplate
 *   DELETE /api/interview-templates/:id                                    -> { templateId }
 *
 * A template is only a named plan: starting an interview from one sends its stages to
 * `POST /api/interviews` like any other plan, and changing or deleting the template afterwards
 * does nothing to interviews started from it. It holds no interviewer settings (those are chosen
 * at the start). A name is unique per user and track, whatever its case (409
 * `template_name_taken`), and a user keeps at most `INTERVIEW_TEMPLATES_MAX` (409
 * `template_limit`). A plan is checked for its shape when saved, and against the content
 * (problems, topics) only when an interview is started from it.
 *
 * Accounts only, and only the owner. Every stage runs on the owner's AI key, so creating one
 * without a usable key is 409 `ai_key_missing`.
 *
 * A stage's pad is created when the stage starts: its clock starts then, and what it draws (a
 * random problem, the questions, the game) is chosen then, so nothing of a later stage exists
 * to leak. The plan itself is the user's own and holds nothing hidden. Each stage has its own
 * clock (the pad's); the interview has none of its own.
 *
 * A stage's pad cannot be deleted on its own (409 `in_interview`): the interview is deleted as
 * a whole. Ending the last stage's pad ends the interview.
 *
 * Presets (`INTERVIEW_PRESETS`) are starting points per site track; the builder may change
 * anything, and a custom interview may mix stages of both tracks (a quant developer's: a coding
 * problem, probability, then C++). `track` records where it was built, and so which track's
 * Interviews tab lists it.
 */
import { z } from 'zod';
import { Id, IsoDate, type Language, Slug } from './common';
import {
  type CodingStage,
  type GameStage,
  InterviewStage,
  type QuestionsStage,
} from './interview-stage';
import { InterviewerSettings, ReportAssessment } from './pad';
import { quantQuestionCount } from './quant-round';
import { Track } from './track';

/** Stages in one interview. */
export const INTERVIEW_STAGES_MAX = 6;

/** The interviewer's settings for every stage; it is always on. */
export const InterviewSettings = InterviewerSettings.omit({ enabled: true });
export type InterviewSettings = z.infer<typeof InterviewSettings>;

export const CreateInterviewRequest = z.object({
  /** The track's Interviews tab it was built in, and is listed on. */
  track: Track,
  /** The preset it started from (`INTERVIEW_PRESETS`), changed or not; null: built from nothing. */
  preset: Slug.nullable().default(null),
  title: z.string().trim().max(120).optional(),
  stages: z.array(InterviewStage).min(1).max(INTERVIEW_STAGES_MAX),
  interviewer: InterviewSettings.default({
    style: 'neutral',
    proactivity: 'normal',
    voice: false,
  }),
});
export type CreateInterviewRequest = z.infer<typeof CreateInterviewRequest>;

/**
 *  upcoming  not started
 *  active    its pad is open
 *  done      its pad has ended
 *  skipped   never started: the interview ended before it
 */
export const StageStatus = z.enum(['upcoming', 'active', 'done', 'skipped']);
export type StageStatus = z.infer<typeof StageStatus>;

export const Recommendation = ReportAssessment.shape.recommendation;
export type Recommendation = z.infer<typeof Recommendation>;

export const InterviewStageView = z.object({
  index: z.int().min(0),
  stage: InterviewStage,
  status: StageStatus,
  /** The stage's pad once it has started. */
  pad: z
    .object({
      id: Id,
      title: z.string(),
      /** A coding stage's problem, chosen when the stage started. */
      problemTitle: z.string().nullable(),
      startedAt: IsoDate,
      endedAt: IsoDate.nullable(),
    })
    .nullable(),
  /**
   * The headline of the stage's report once its pad has ended (the full report is the pad's own,
   * `GET /api/pads/:id/report`): `pending` while the assessment is being written.
   */
  result: z
    .object({
      report: z.enum(['pending', 'ready', 'failed']),
      recommendation: Recommendation.nullable(),
    })
    .nullable(),
});
export type InterviewStageView = z.infer<typeof InterviewStageView>;

export const Interview = z.object({
  id: Id,
  title: z.string(),
  track: Track,
  preset: Slug.nullable(),
  status: z.enum(['active', 'ended']),
  /** The index of the latest stage started. */
  current: z.int().min(0),
  stages: z.array(InterviewStageView).min(1),
  interviewer: InterviewSettings,
  startedAt: IsoDate,
  endedAt: IsoDate.nullable(),
});
export type Interview = z.infer<typeof Interview>;

// ---------------------------------------------------------------- saved plans

/** Templates one user may keep, over both tracks. */
export const INTERVIEW_TEMPLATES_MAX = 30;
export const INTERVIEW_TEMPLATE_NAME_MAX = 60;

const TemplateName = z.string().trim().min(1).max(INTERVIEW_TEMPLATE_NAME_MAX);
const Plan = z.array(InterviewStage).min(1).max(INTERVIEW_STAGES_MAX);

/** A plan saved under a name, to start interviews from. */
export const InterviewTemplate = z.object({
  id: Id,
  name: z.string(),
  /** The track's builder it was saved in, and is offered in. */
  track: Track,
  stages: Plan,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type InterviewTemplate = z.infer<typeof InterviewTemplate>;

export const SaveInterviewTemplateRequest = z.object({
  name: TemplateName,
  track: Track,
  stages: Plan,
});
export type SaveInterviewTemplateRequest = z.infer<typeof SaveInterviewTemplateRequest>;

/** `PUT /api/interview-templates/:id`: a new name, a new plan, or both. Its track never changes. */
export const UpdateInterviewTemplateRequest = z
  .object({ name: TemplateName.optional(), stages: Plan.optional() })
  .refine((r) => r.name !== undefined || r.stages !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateInterviewTemplateRequest = z.infer<typeof UpdateInterviewTemplateRequest>;

export const DeleteInterviewTemplateResponse = z.object({ templateId: Id });
export type DeleteInterviewTemplateResponse = z.infer<typeof DeleteInterviewTemplateResponse>;

/** `POST /api/interviews/:id/next`: move on from stage `from`. */
export const AdvanceInterviewRequest = z.object({
  /**
   * The stage the caller is leaving. When the interview has already moved past it (a second
   * click, another tab) nothing changes and the answer is the interview as it is.
   */
  from: z.int().min(0),
});
export type AdvanceInterviewRequest = z.infer<typeof AdvanceInterviewRequest>;

/** The interview, and the pad to open: the stage under way; null once it has ended. */
export const InterviewStart = z.object({ interview: Interview, padId: Id.nullable() });
export type InterviewStart = z.infer<typeof InterviewStart>;

export const DeleteInterviewResponse = z.object({ interviewId: Id });
export type DeleteInterviewResponse = z.infer<typeof DeleteInterviewResponse>;

// ---------------------------------------------------------------- pure rules

/** How many questions a stage puts to the candidate; null for a coding stage. */
export function stageQuestionCount(stage: InterviewStage): number | null {
  if (stage.kind === 'questions') return quantQuestionCount(stage.durationMin);
  return stage.kind === 'game' ? 1 : null;
}

/** The planned length of an interview: its stages' minutes. */
export const interviewMinutes = (stages: readonly Pick<InterviewStage, 'durationMin'>[]) =>
  stages.reduce((sum, s) => sum + s.durationMin, 0);

/**
 * Each stage's status, from what is stored: `current` (the latest stage started), whether the
 * interview has ended, and the status of each stage's pad (absent: it has none).
 */
export function stageStatuses(a: {
  count: number;
  current: number;
  ended: boolean;
  pad: (index: number) => 'active' | 'ended' | undefined;
}): StageStatus[] {
  return Array.from({ length: a.count }, (_, i) => {
    const pad = a.pad(i);
    if (pad === 'active') return a.ended ? 'done' : 'active';
    if (pad === 'ended') return 'done';
    return a.ended || i < a.current ? 'skipped' : 'upcoming';
  });
}

/** The stage under way (its pad is open), or null. */
export const activeStage = (interview: Pick<Interview, 'stages'>): InterviewStageView | null =>
  interview.stages.find((s) => s.status === 'active') ?? null;

/** The stage that `next` would start: the first not started, while the interview is active. */
export const upcomingStage = (
  interview: Pick<Interview, 'stages' | 'status'>,
): InterviewStageView | null =>
  interview.status === 'active'
    ? (interview.stages.find((s) => s.status === 'upcoming') ?? null)
    : null;

const RECOMMENDATIONS = ['no_hire', 'lean_no_hire', 'lean_hire', 'hire', 'strong_hire'] as const;

/**
 * The interview's overall recommendation: the mean of its assessed stages', weighted by each
 * stage's planned length, rounded to the nearest step (a tie goes to the lower one). Arithmetic,
 * not a model's judgement: the stages' own reports carry the reasoning. null with no assessed
 * stage.
 */
export function overallRecommendation(
  stages: readonly Pick<InterviewStageView, 'stage' | 'result'>[],
): Recommendation | null {
  let weight = 0;
  let total = 0;
  for (const s of stages) {
    const r = s.result?.recommendation;
    if (!r) continue;
    weight += s.stage.durationMin;
    total += s.stage.durationMin * RECOMMENDATIONS.indexOf(r);
  }
  if (weight === 0) return null;
  const mean = total / weight;
  const lower = Math.floor(mean);
  return RECOMMENDATIONS[mean - lower > 0.5 ? lower + 1 : lower] ?? null;
}

// ---------------------------------------------------------------- presets

/** A preset's coding stage takes the user's language when the plan is made from it. */
type PresetStage =
  | Omit<CodingStage, 'language'>
  | (QuestionsStage & {
      /** Also draw from the topic of the user's language, when it has one (`LANGUAGE_TOPIC`). */
      languageTopic?: boolean;
    })
  | GameStage;

export interface InterviewPreset {
  id: string;
  track: Track;
  label: string;
  description: string;
  stages: readonly PresetStage[];
}

/** The quiz topic about a language, for the languages that have one. */
export const LANGUAGE_TOPIC: Partial<Record<Language, string>> = { cpp: 'cpp', python: 'python' };

const SYSTEMS = ['operating-systems', 'concurrency', 'networking', 'computer-architecture'];

/** In the order the builder offers them; a track's first is its default. */
export const INTERVIEW_PRESETS: readonly InterviewPreset[] = [
  {
    id: 'coding-round',
    track: 'software',
    label: 'Coding round',
    description: 'One problem with the interviewer, as in a phone screen.',
    stages: [{ kind: 'coding', difficulty: 'medium', durationMin: 45 }],
  },
  {
    id: 'fundamentals-round',
    track: 'software',
    label: 'Fundamentals round',
    description: 'Questions on your language and on systems, asked live. No coding problem.',
    stages: [{ kind: 'questions', topics: SYSTEMS, languageTopic: true, durationMin: 30 }],
  },
  {
    id: 'technical-screen',
    track: 'software',
    label: 'Technical screen',
    description: 'Fundamentals questions asked live, then a coding problem.',
    stages: [
      { kind: 'questions', topics: SYSTEMS, languageTopic: true, durationMin: 20 },
      { kind: 'coding', difficulty: 'medium', durationMin: 45 },
    ],
  },
  {
    id: 'onsite-loop',
    track: 'software',
    label: 'Onsite loop',
    description: 'A coding problem, a round of fundamentals, then a harder problem.',
    stages: [
      { kind: 'coding', difficulty: 'medium', durationMin: 45 },
      { kind: 'questions', topics: SYSTEMS, languageTopic: true, durationMin: 30 },
      { kind: 'coding', difficulty: 'hard', durationMin: 60 },
    ],
  },
  {
    id: 'trader',
    track: 'quant',
    label: 'Trader',
    description: 'Probability and brainteasers, a market-making game, then markets and options.',
    stages: [
      { kind: 'questions', topics: ['probability', 'brainteasers'], durationMin: 20 },
      { kind: 'game', durationMin: 15 },
      { kind: 'questions', topics: ['betting-market-making', 'options'], durationMin: 20 },
    ],
  },
  {
    id: 'researcher',
    track: 'quant',
    label: 'Researcher',
    description: 'Probability and statistics, then linear algebra, calculus and options.',
    stages: [
      { kind: 'questions', topics: ['probability', 'statistics'], durationMin: 30 },
      { kind: 'questions', topics: ['algebra-calculus', 'options'], durationMin: 20 },
    ],
  },
  {
    id: 'quant-developer',
    track: 'quant',
    label: 'Quant developer',
    description: 'A coding problem, probability and puzzles, then language and systems questions.',
    stages: [
      { kind: 'coding', difficulty: 'medium', durationMin: 45 },
      { kind: 'questions', topics: ['probability', 'brainteasers'], durationMin: 20 },
      {
        kind: 'questions',
        topics: ['concurrency', 'operating-systems', 'computer-architecture'],
        languageTopic: true,
        durationMin: 15,
      },
    ],
  },
  {
    id: 'quant-round',
    track: 'quant',
    label: 'Single round',
    description: 'One round of questions across probability, puzzles, markets and options.',
    stages: [
      {
        kind: 'questions',
        topics: ['probability', 'brainteasers', 'betting-market-making', 'options'],
        durationMin: 30,
      },
    ],
  },
];

export const presetsOf = (track: Track): InterviewPreset[] =>
  INTERVIEW_PRESETS.filter((p) => p.track === track);

export const presetById = (id: string | null | undefined): InterviewPreset | null =>
  INTERVIEW_PRESETS.find((p) => p.id === id) ?? null;

/**
 * A preset as a plan for someone who codes in `language`: its coding stages take the language,
 * and a questions stage that asks for it gains the language's own topic, first.
 */
export function presetStages(preset: InterviewPreset, language: Language): InterviewStage[] {
  return preset.stages.map((s): InterviewStage => {
    if (s.kind === 'coding') return { ...s, language };
    if (s.kind === 'game') return { ...s };
    const { languageTopic, ...stage } = s;
    const own = languageTopic ? LANGUAGE_TOPIC[language] : undefined;
    return own && !stage.topics.includes(own)
      ? { ...stage, topics: [own, ...stage.topics] }
      : { ...stage, topics: [...stage.topics] };
  });
}
