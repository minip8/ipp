/** Pure helpers for the problem library: filtering, counts, topic options and random picks. */
import {
  type Difficulty,
  groupOfTag,
  groupTags,
  PROBLEM_CATEGORIES,
  type ProblemCategory,
  type ProblemSummary,
  type Subtopic,
  subtopicLabel,
  TOPIC_GROUPS,
  type TopicGroup,
  topicGroup,
} from '@ipp/contracts';
import { storage } from '@/lib/storage';

export const ALL = 'all';
export type CategoryFilter = typeof ALL | ProblemCategory;
export type DifficultyFilter = typeof ALL | Difficulty;

export interface LibraryFilters {
  query: string;
  category: CategoryFilter;
  difficulty: DifficultyFilter;
  /** A TOPIC_GROUPS slug, or 'all'. */
  group: string;
  /** A tag of the chosen group, or 'all'. Ignored without a group. */
  subtopic: string;
  /** Tags are spoilers: only searched when the user has chosen to see them. */
  showTopics: boolean;
}

export const NO_FILTERS: Omit<LibraryFilters, 'showTopics'> = {
  query: '',
  category: ALL,
  difficulty: ALL,
  group: ALL,
  subtopic: ALL,
};

export const parseCategory = (v: string | null): CategoryFilter =>
  PROBLEM_CATEGORIES.includes(v as ProblemCategory) ? (v as ProblemCategory) : ALL;

export const parseDifficulty = (v: string | null): DifficultyFilter =>
  v === 'easy' || v === 'medium' || v === 'hard' ? v : ALL;

function matchesTopic(p: ProblemSummary, group: string, subtopic: string): boolean {
  if (group === ALL) return true;
  const g = topicGroup(group);
  if (!g) return true;
  if (subtopic !== ALL) return p.tags.includes(subtopic);
  const tags = groupTags(g);
  return p.tags.some((t) => tags.includes(t));
}

function matchesQuery(p: ProblemSummary, text: string, showTopics: boolean): boolean {
  if (!text) return true;
  if (p.title.toLowerCase().includes(text)) return true;
  if (!showTopics) return false;
  const slug = text.replace(/\s+/g, '-');
  return p.tags.some(
    (t) => t.includes(slug) || subtopicLabel(t)?.toLowerCase().includes(text) === true,
  );
}

export function filterProblems(
  problems: readonly ProblemSummary[],
  f: LibraryFilters,
): ProblemSummary[] {
  const text = f.query.trim().toLowerCase();
  return problems.filter(
    (p) =>
      (f.category === ALL || p.category === f.category) &&
      (f.difficulty === ALL || p.difficulty === f.difficulty) &&
      matchesTopic(p, f.group, f.subtopic) &&
      matchesQuery(p, text, f.showTopics),
  );
}

/** How many problems each category tab would show with the other filters applied. */
export function categoryCounts(
  problems: readonly ProblemSummary[],
  f: LibraryFilters,
): Record<CategoryFilter, number> {
  const rest = filterProblems(problems, { ...f, category: ALL });
  const counts = { all: rest.length } as Record<CategoryFilter, number>;
  for (const c of PROBLEM_CATEGORIES) counts[c] = rest.filter((p) => p.category === c).length;
  return counts;
}

/** Groups that at least one problem in the library belongs to, in taxonomy order. */
export function groupOptions(problems: readonly ProblemSummary[]): TopicGroup[] {
  const used = new Set(problems.flatMap((p) => p.tags.map((t) => groupOfTag(t)?.slug)));
  return TOPIC_GROUPS.filter((g) => used.has(g.slug));
}

/** The group's subtopics that at least one problem in the library has. */
export function subtopicOptions(problems: readonly ProblemSummary[], group: string): Subtopic[] {
  const g = topicGroup(group);
  if (!g) return [];
  const used = new Set(problems.flatMap((p) => p.tags));
  return g.subtopics.filter((s) => used.has(s.tag));
}

/**
 * A random problem from `candidates`, different from `current` whenever there is another one,
 * so "pick another" always changes the selection.
 */
export function pickRandom(
  candidates: readonly ProblemSummary[],
  current?: string | null,
  random: () => number = Math.random,
): ProblemSummary | undefined {
  const pool = candidates.length > 1 ? candidates.filter((p) => p.slug !== current) : candidates;
  return pool[Math.floor(random() * pool.length)] ?? pool[0];
}

const SHOW_TOPICS_KEY = 'ipp:library-show-topics';
export const loadShowTopics = (): boolean => storage.get<unknown>(SHOW_TOPICS_KEY, false) === true;
export const saveShowTopics = (v: boolean) => storage.set(SHOW_TOPICS_KEY, v);
