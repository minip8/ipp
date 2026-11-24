/** Pure helpers for the problem library: filtering, counts, topic options and random picks. */
import {
  type Difficulty,
  groupOfTag,
  groupTags,
  LANGUAGE_LABELS,
  LANGUAGES,
  type Language,
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

// ---------------------------------------------------------------- languages

/** The problem can be solved in fewer than all languages (e.g. a C++ template problem). */
export const isLanguageRestricted = (p: Pick<ProblemSummary, 'languages'>): boolean =>
  LANGUAGES.some((l) => !p.languages.includes(l));

/** "C++ only", "C++ or Python only"; null for a problem that offers every language. */
export function restrictionLabel(p: Pick<ProblemSummary, 'languages'>): string | null {
  if (!isLanguageRestricted(p)) return null;
  return `${p.languages.map((l) => LANGUAGE_LABELS[l]).join(' or ')} only`;
}

/**
 * The language the interview starts in: the user's preference when the problem offers it,
 * otherwise the problem's first language. The saved preference itself is left alone.
 */
export function effectiveLanguage(
  preferred: Language,
  problem: Pick<ProblemSummary, 'languages'> | undefined,
): Language {
  if (!problem || problem.languages.includes(preferred)) return preferred;
  return problem.languages[0] ?? preferred;
}

/** Why the language picker shows fewer languages, or null when it shows them all. */
export function languageNote(
  preferred: Language,
  problem: Pick<ProblemSummary, 'title' | 'languages'> | undefined,
): string | null {
  if (!problem || !isLanguageRestricted(problem)) return null;
  const offered = problem.languages.map((l) => LANGUAGE_LABELS[l]).join(' or ');
  const why = `${problem.title} can only be solved in ${offered}`;
  return problem.languages.includes(preferred)
    ? `${why}.`
    : `${why}, so this interview uses ${LANGUAGE_LABELS[effectiveLanguage(preferred, problem)]} (your usual ${LANGUAGE_LABELS[preferred]} is kept for other problems).`;
}

/** Problems a random pick may choose: those that can be solved in the user's language. */
export const randomPool = (problems: readonly ProblemSummary[], language: Language) =>
  problems.filter((p) => p.languages.includes(language));

const SHOW_TOPICS_KEY = 'ipp:library-show-topics';
export const loadShowTopics = (): boolean => storage.get<unknown>(SHOW_TOPICS_KEY, false) === true;
export const saveShowTopics = (v: boolean) => storage.set(SHOW_TOPICS_KEY, v);
