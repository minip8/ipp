/**
 * Pure rules about a staged interview (`interview.ts` in the contracts) shared by the builder,
 * a stage's pad, the interview page and the Interviews tab's lists: what a stage is called, where
 * an interview is, what to do next in it, and how long it took.
 */
import {
  activeStage,
  type Interview,
  type InterviewStage,
  type InterviewStageView,
  interviewMinutes,
  LANGUAGE_LABELS,
  type ProblemCategory,
  type Recommendation,
  STAGE_KIND_INFO,
  type StageStatus,
  stageQuestionCount,
  upcomingStage,
} from '@ipp/contracts';
import { DIFFICULTY_LABEL, plural } from '@/lib/format';

// ---------------------------------------------------------------- what a stage is called

/** Problem and topic titles by slug (unknown while loading: the slug is shown readably). */
export type Names = {
  problem: (slug: string) => string | undefined;
  topic: (slug: string) => string | undefined;
};

/** No titles known: every slug shown readably. */
export const NO_NAMES: Names = { problem: () => undefined, topic: () => undefined };

const readable = (slug: string) => {
  const s = slug.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const CATEGORY_WORD: Record<ProblemCategory, string> = {
  dsa: 'DSA',
  implementation: 'implementation',
  'data-structure': 'data structure',
};

type CodingStage = Extract<InterviewStage, { kind: 'coding' }>;

/** "Random medium problem", "Random hard DSA problem", or the chosen problem's title. */
export function problemLabel(stage: CodingStage, names: Names): string {
  if (stage.problemSlug) return names.problem(stage.problemSlug) ?? readable(stage.problemSlug);
  const words = [
    'Random',
    stage.difficulty && DIFFICULTY_LABEL[stage.difficulty].toLowerCase(),
    stage.category && CATEGORY_WORD[stage.category],
    'problem',
  ];
  return words.filter(Boolean).join(' ');
}

/** "Probability, Brainteasers"; past three topics the first two and how many more. */
export function topicsLabel(topics: readonly string[], names: Names): string {
  const titles = topics.map((t) => names.topic(t) ?? readable(t));
  if (titles.length <= 3) return titles.join(', ');
  return `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`;
}

/**
 * A stage in one line: "Random medium problem · Python · 45 min", "Two Sum · C++ · 45 min",
 * "Probability, Brainteasers · 3 questions · 20 min", "Market-making game · 15 min". A started
 * coding stage may give the problem it drew (`problemTitle`).
 */
export function stageSummary(
  stage: InterviewStage,
  names: Names,
  problemTitle?: string | null,
): string {
  const min = `${stage.durationMin} min`;
  if (stage.kind === 'coding')
    return `${problemTitle ?? problemLabel(stage, names)} · ${LANGUAGE_LABELS[stage.language]} · ${min}`;
  if (stage.kind === 'questions')
    return `${topicsLabel(stage.topics, names)} · ${plural(stageQuestionCount(stage) ?? 0, 'question')} · ${min}`;
  return `${STAGE_KIND_INFO.game.label} · ${min}`;
}

/**
 * The summary under a stage's own title (the kind's label), which a game's summary would only
 * repeat: "One game against the interviewer · 15 min".
 */
export function stageDetail(
  stage: InterviewStage,
  names: Names,
  problemTitle?: string | null,
): string {
  return stage.kind === 'game'
    ? `One game against the interviewer · ${stage.durationMin} min`
    : stageSummary(stage, names, problemTitle);
}

/** "3 stages · 55 min" */
export const planTotal = (stages: readonly Pick<InterviewStage, 'durationMin'>[]) =>
  `${plural(stages.length, 'stage')} · ${interviewMinutes(stages)} min`;

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  upcoming: 'Up next',
  active: 'Under way',
  done: 'Done',
  skipped: 'Skipped',
};

const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  no_hire: 'No hire',
  lean_no_hire: 'Lean no hire',
  lean_hire: 'Lean hire',
  hire: 'Hire',
  strong_hire: 'Strong hire',
};
export const recommendationLabel = (r: Recommendation) => RECOMMENDATION_LABEL[r];

// ---------------------------------------------------------------- where an interview is

/** "Stage 2 of 3": the stage under way, else the latest one started. */
export function stagePosition(interview: Pick<Interview, 'stages' | 'current'>): string {
  const active = activeStage(interview);
  const index = active ? active.index : interview.current;
  return `Stage ${index + 1} of ${interview.stages.length}`;
}

/**
 * What the interview asks for now: open the stage under way, start the next one (between
 * stages), or nothing (it has ended, or every stage is done and only the end is left).
 */
export type HubAction =
  | { kind: 'continue'; stage: InterviewStageView; padId: string }
  | { kind: 'start'; stage: InterviewStageView; from: number }
  | { kind: 'none' };

export function hubAction(interview: Interview): HubAction {
  if (interview.status !== 'active') return { kind: 'none' };
  const active = activeStage(interview);
  if (active?.pad) return { kind: 'continue', stage: active, padId: active.pad.id };
  const next = upcomingStage(interview);
  // `next` moves on from the latest stage started (the one just finished).
  if (next) return { kind: 'start', stage: next, from: interview.current };
  return { kind: 'none' };
}

/** Where an interview in a list opens: the stage under way, else the interview's page. */
export const interviewHref = (interview: Interview): string => {
  const a = hubAction(interview);
  return a.kind === 'continue' ? `/pads/${a.padId}` : `/interviews/${interview.id}`;
};

/** Seconds spent in the stages' pads (an open one up to `now`). */
export function timeSpentSec(interview: Pick<Interview, 'stages'>, now = Date.now()): number {
  return interview.stages.reduce((sum, s) => {
    if (!s.pad) return sum;
    const end = s.pad.endedAt ? Date.parse(s.pad.endedAt) : now;
    return sum + Math.max(0, (end - Date.parse(s.pad.startedAt)) / 1000);
  }, 0);
}

/** Whether any done stage's report is still being written (the page polls until none is). */
export const reportsPending = (interview: Pick<Interview, 'stages'>) =>
  interview.stages.some((s) => s.result?.report === 'pending');
