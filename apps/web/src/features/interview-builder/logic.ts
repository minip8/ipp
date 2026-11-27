/**
 * Pure rules of the interview builder (the Interviews tab's "Practise with the AI"): the plan
 * (an ordered list of stages, `interview-stage.ts`) and how it is edited, which preset it still
 * is, what each stage is called, the request that starts it and why that could fail. What is
 * selected, the custom draft, saved plans, links in and what is remembered are `selection.ts`.
 */
import {
  type CreateInterviewRequest,
  INTERVIEW_STAGES_MAX,
  type InterviewPreset,
  type InterviewSettings,
  type InterviewStage,
  LANGUAGE_TOPIC,
  LANGUAGES,
  type Language,
  type ProblemSummary,
  presetStages,
  presetsOf,
  type QuizTrack,
  quantQuestionCount,
  STAGE_TOPICS_MAX,
  type StageKind,
  type Track,
} from '@ipp/contracts';
import { type Names, problemLabel } from '@/features/interview/logic';
import { effectiveLanguage } from '@/features/new/logic';
import { ApiRequestError, errorMessage, formatRetry } from '@/lib/api';
import { plural } from '@/lib/format';
import { topicsOf } from '@/lib/track';

export type Plan = {
  /** The preset the plan started from, changed or not (`CreateInterviewRequest.preset`). */
  preset: string | null;
  stages: InterviewStage[];
};

// ---------------------------------------------------------------- presets

/** A preset as a plan, its coding stages in `language`. */
export const presetPlan = (preset: InterviewPreset, language: Language): Plan => ({
  preset: preset.id,
  stages: presetStages(preset, language),
});

/** The track's first preset: where the builder starts. */
export function defaultPlan(track: Track, language: Language): Plan {
  const [first] = presetsOf(track);
  if (!first) throw new Error(`no preset for ${track}`);
  return presetPlan(first, language);
}

/** A stage without its unset fields, so two stages compare by what they say. */
function canonical(stage: InterviewStage): string {
  const entries = Object.entries(stage).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

export const sameStages = (a: readonly InterviewStage[], b: readonly InterviewStage[]) =>
  a.length === b.length && a.every((s, i) => canonical(s) === canonical(b[i] as InterviewStage));

/**
 * The preset of this track that the stages still are, in any one language (a coding round in
 * Python is still the coding round), or null once they have been changed into something else.
 */
export function matchingPreset(
  stages: readonly InterviewStage[],
  track: Track,
): InterviewPreset | null {
  return (
    presetsOf(track).find((p) => LANGUAGES.some((l) => sameStages(stages, presetStages(p, l)))) ??
    null
  );
}

// ---------------------------------------------------------------- editing the plan

export const canAddStage = (stages: readonly InterviewStage[]) =>
  stages.length < INTERVIEW_STAGES_MAX;
export const canRemoveStage = (stages: readonly InterviewStage[]) => stages.length > 1;

/** What a stage added to the plan starts as. */
export type StageDefaults = { language: Language; topics: string[] };

export function newStage(kind: StageKind, d: StageDefaults): InterviewStage {
  if (kind === 'coding')
    return { kind, difficulty: 'medium', language: d.language, durationMin: 45 };
  if (kind === 'questions') return { kind, topics: [...d.topics], durationMin: 20 };
  return { kind, durationMin: 15 };
}

export function addStage(
  stages: readonly InterviewStage[],
  kind: StageKind,
  d: StageDefaults,
): InterviewStage[] {
  return canAddStage(stages) ? [...stages, newStage(kind, d)] : [...stages];
}

export function removeStage(stages: readonly InterviewStage[], index: number): InterviewStage[] {
  return canRemoveStage(stages) ? stages.filter((_, i) => i !== index) : [...stages];
}

/** Swaps the stage with its neighbour (`by` -1: earlier); a move past either end changes nothing. */
export function moveStage(
  stages: readonly InterviewStage[],
  index: number,
  by: -1 | 1,
): InterviewStage[] {
  const to = index + by;
  const next = [...stages];
  const a = next[index];
  const b = next[to];
  if (!a || !b) return next;
  next[index] = b;
  next[to] = a;
  return next;
}

export const replaceStage = (
  stages: readonly InterviewStage[],
  index: number,
  stage: InterviewStage,
): InterviewStage[] => stages.map((s, i) => (i === index ? stage : s));

/**
 * A topic chosen or not in a questions stage: at least one stays chosen, and no more than
 * `STAGE_TOPICS_MAX`, so either edit past a limit changes nothing.
 */
export function toggleTopic(topics: readonly string[], slug: string): string[] {
  if (topics.includes(slug))
    return topics.length > 1 ? topics.filter((t) => t !== slug) : [...topics];
  return topics.length < STAGE_TOPICS_MAX ? [...topics, slug] : [...topics];
}

/** Each coding stage on a specific problem in a language the problem offers. */
export function fitLanguages(
  stages: readonly InterviewStage[],
  problems: readonly Pick<ProblemSummary, 'slug' | 'languages'>[],
): InterviewStage[] {
  return stages.map((s) => {
    if (s.kind !== 'coding' || !s.problemSlug) return s;
    const p = problems.find((x) => x.slug === s.problemSlug);
    const language = effectiveLanguage(s.language, p);
    return language === s.language ? s : { ...s, language };
  });
}

/**
 * Each questions stage on topics that exist (a remembered plan may name one since removed); a
 * stage left with none takes `fallback`.
 */
export function fitTopics(
  stages: readonly InterviewStage[],
  topics: readonly { slug: string }[],
  fallback: readonly string[],
): InterviewStage[] {
  const known = new Set(topics.map((t) => t.slug));
  return stages.map((s) => {
    if (s.kind !== 'questions' || s.topics.every((t) => known.has(t))) return s;
    const kept = s.topics.filter((t) => known.has(t));
    return { ...s, topics: kept.length > 0 ? kept : [...fallback] };
  });
}

// ---------------------------------------------------------------- topics

type TopicLike = { slug: string; track: QuizTrack; also?: readonly Track[] };

/** The topic picker's two lists: the track's own topics, then every other one. */
export function topicChoices<T extends TopicLike>(
  topics: readonly T[],
  track: Track,
): { mine: T[]; more: T[] } {
  const mine = topicsOf(topics, track);
  const inMine = new Set(mine.map((t) => t.slug));
  return { mine, more: topics.filter((t) => !inMine.has(t.slug)) };
}

/**
 * The topic a new questions stage starts on: on Software the user's language's topic when there
 * is one, else the track's first topic (Probability on Quant).
 */
export function defaultTopics(
  topics: readonly TopicLike[],
  track: Track,
  language: Language,
): string[] {
  const mine = topicsOf(topics, track);
  const own = LANGUAGE_TOPIC[language];
  if (track === 'software' && own && mine.some((t) => t.slug === own)) return [own];
  const first = mine[0]?.slug;
  if (first) return [first];
  return [track === 'quant' ? 'probability' : (own ?? 'operating-systems')];
}

/** "3 questions, about 7 minutes each" */
export function questionsShape(durationMin: number): string {
  const n = Math.max(1, quantQuestionCount(durationMin));
  return `${plural(n, 'question')}, about ${plural(Math.round(durationMin / n), 'minute')} each`;
}

/**
 * The interview's title: the preset it still is, a lone problem's title, else "Custom interview".
 */
export function interviewTitle(plan: Plan, track: Track, names: Names): string {
  const preset = matchingPreset(plan.stages, track);
  if (preset) return preset.label;
  const [only, ...rest] = plan.stages;
  if (only?.kind === 'coding' && only.problemSlug && rest.length === 0)
    return problemLabel(only, names);
  return 'Custom interview';
}

/** The request that starts `plan` under `title` (`startPlan` in selection.ts gives both). */
export function createRequest(
  track: Track,
  { plan, title }: { plan: Plan; title: string },
  interviewer: InterviewSettings,
): CreateInterviewRequest {
  return { track, preset: plan.preset, title, stages: plan.stages, interviewer };
}

// ---------------------------------------------------------------- starting it

/**
 * Why the interview could not start, in words: the key every stage runs on, a stage whose topics
 * are short of questions (the server's message names it), the start allowance used up. Anything
 * else is the server's own message.
 */
export function startError(e: unknown): string {
  if (!(e instanceof ApiRequestError)) return errorMessage(e);
  if (e.code === 'ai_key_missing')
    return 'Every stage runs on your own AI API key. Add a working key, then start again.';
  if (e.isRateLimited)
    return e.retryAfter
      ? `You have started a lot of interviews in a short time. You can start another in ${formatRetry(e.retryAfter)}.`
      : 'You have started a lot of interviews in a short time. Try again in a few minutes.';
  if (e.code === 'account_required') return 'Sign in with an account to start an interview.';
  return e.message;
}
