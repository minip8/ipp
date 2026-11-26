/**
 * Pure helpers for the Roadmap tab's study path: a track's paths (Quant has two curated ones,
 * Software one of all its topics in study order), a path's topics in order with their state, and
 * where each step leads.
 */
import { QUANT_PATH_INFO, QUANT_PATHS, type QuizTopicStats, type Track } from '@ipp/contracts';
import { bankHref } from '@/features/quiz/bank-logic';
import { type NodeState, nodeState } from '@/features/quiz/roadmap-logic';
import { roadmapHref, topicsOf } from '@/lib/track';

export interface StudyPath {
  /** `?path=` value (the first path of a track is the default and leaves it out). */
  id: string;
  label: string;
  description: string;
  /** The topic slugs in order; null: every topic of the track, in the server's study order. */
  topics: readonly string[] | null;
}

const SOFTWARE_PATH: StudyPath = {
  id: 'software',
  label: 'Software',
  description:
    'The languages first, then the machine, the operating system and the network under your code.',
  topics: null,
};

/** A track's study paths, the default first. The path picker shows only when there are two. */
export function trackPaths(track: Track): [StudyPath, ...StudyPath[]] {
  if (track === 'software') return [SOFTWARE_PATH];
  const [first, ...rest] = QUANT_PATHS.map((p) => ({ id: p, ...QUANT_PATH_INFO[p] }));
  if (!first) throw new Error('no quant paths');
  return [first, ...rest];
}

/** The path the URL names, else the track's first. */
export function pickPath(track: Track, id: string | null): StudyPath {
  const paths = trackPaths(track);
  return paths.find((p) => p.id === id) ?? paths[0];
}

/** The slugs a path walks through, in order. */
export function pathTopicSlugs(
  path: StudyPath,
  topics: readonly QuizTopicStats[],
  track: Track,
): readonly string[] {
  return path.topics ?? topicsOf(topics, track).map((t) => t.slug);
}

export interface PathStep {
  topic: QuizTopicStats;
  /** 1-based position on the path, counting only the topics the server has */
  position: number;
  /** complete as a roadmap area is: every question answered, at the roadmap's accuracy */
  state: NodeState;
  /** the first topic on the path that is not complete (and has questions) */
  next: boolean;
}

/**
 * The topics of `slugs`, in that order, each with its state. A slug the server did not return is
 * skipped (and the rest renumbered), so a path can name a topic before its content is loaded.
 */
export function pathSteps(slugs: readonly string[], topics: readonly QuizTopicStats[]): PathStep[] {
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  const found = slugs
    .map((slug) => bySlug.get(slug))
    .filter((t): t is QuizTopicStats => t !== undefined);
  const states = found.map((t) => nodeState(t));
  const next = found.findIndex((t, i) => t.questionCount > 0 && states[i] !== 'complete');
  return found.map((topic, i) => ({
    topic,
    position: i + 1,
    state: states[i] ?? 'not_started',
    next: i === next,
  }));
}

/** How many questions a practice round on the topic can draw on (open ones are discussed). */
export const practiceCount = (t: Pick<QuizTopicStats, 'questionCount' | 'shortCount'>) =>
  t.questionCount - t.shortCount;

/** The open questions along a path, for one discussion: the topics that have any, and how many. */
export function discussionPool(steps: readonly PathStep[]): {
  topics: string[];
  questions: number;
} {
  const open = steps.filter((s) => s.topic.shortCount > 0);
  return {
    topics: open.map((s) => s.topic.slug),
    questions: open.reduce((n, s) => n + s.topic.shortCount, 0),
  };
}

/** "Probability, Statistics and Options" */
export function listTitles(titles: readonly string[]): string {
  if (titles.length <= 1) return titles[0] ?? '';
  return `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
}

/** A topic's whole bank. */
export const topicBankHref = (slug: string) => bankHref(slug);

/** A topic's map: this track's Roadmap on the topic maps, on it. */
export const topicRoadmapHref = (track: Track, slug: string) =>
  roadmapHref(track, { view: 'maps', topic: slug });
