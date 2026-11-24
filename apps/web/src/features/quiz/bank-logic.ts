/** Pure helpers for the question bank: URL filters, grouping, navigation, cache updates. */
import type {
  AnswerFeedback,
  PublicQuizQuestion,
  QuizBank,
  QuizBankItem,
  QuizQuestionStatus,
} from '@ipp/contracts';
import { outcomeOf } from './logic';

export type DifficultyFilter = 'all' | PublicQuizQuestion['difficulty'];
export type TypeFilter = 'all' | PublicQuizQuestion['type'];
/** new = never answered; missed = latest answer not fully correct (or waiting for a self-grade). */
export type StatusFilter = 'all' | 'new' | 'missed' | 'correct';

export interface BankFilters {
  difficulty: DifficultyFilter;
  type: TypeFilter;
  status: StatusFilter;
}

export const DEFAULT_FILTERS: BankFilters = { difficulty: 'all', type: 'all', status: 'all' };

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const TYPES = ['single', 'multiple', 'output', 'short'] as const;
const STATUSES = ['new', 'missed', 'correct'] as const;

const oneOf = <T extends string>(xs: readonly T[], v: string | null): T | 'all' =>
  v !== null && (xs as readonly string[]).includes(v) ? (v as T) : 'all';

export function parseFilters(params: Pick<URLSearchParams, 'get'>): BankFilters {
  return {
    difficulty: oneOf(DIFFICULTIES, params.get('difficulty')),
    type: oneOf(TYPES, params.get('type')),
    status: oneOf(STATUSES, params.get('status')),
  };
}

/**
 * Query string for the bank page (`?` included, empty when nothing is set). The page is at one
 * place: an open question, else a subtopic's question list, else the overview of subtopics. A
 * question says which subtopic it is in, so `subtopic` is only written without one.
 */
export function bankSearch(
  filters: BankFilters,
  question: string | null,
  subtopic: string | null = null,
): string {
  const p = new URLSearchParams();
  if (filters.status !== 'all') p.set('status', filters.status);
  if (filters.difficulty !== 'all') p.set('difficulty', filters.difficulty);
  if (filters.type !== 'all') p.set('type', filters.type);
  if (question) p.set('question', question);
  else if (subtopic) p.set('subtopic', subtopic);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function bankHref(
  topic: string,
  filters = DEFAULT_FILTERS,
  question: string | null = null,
  subtopic: string | null = null,
) {
  return `/quiz/topics/${encodeURIComponent(topic)}${bankSearch(filters, question, subtopic)}`;
}

export const STATUS_LABEL: Record<QuizQuestionStatus, string> = {
  unanswered: 'Not answered',
  correct: 'Correct',
  partial: 'Partly correct',
  incorrect: 'Incorrect',
  pending: 'Waiting for your self-grade',
};

export function statusGroup(s: QuizQuestionStatus): Exclude<StatusFilter, 'all'> {
  if (s === 'unanswered') return 'new';
  return s === 'correct' ? 'correct' : 'missed';
}

export function matches(item: QuizBankItem, f: BankFilters): boolean {
  const q = item.question;
  return (
    (f.difficulty === 'all' || q.difficulty === f.difficulty) &&
    (f.type === 'all' || q.type === f.type) &&
    (f.status === 'all' || statusGroup(item.status) === f.status)
  );
}

/** Search text as it is compared: lower case, runs of spaces collapsed. */
export function normalizeQuery(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Free-text search: every word must appear in the question's subtopic, prompt, code or choices.
 * A subtopic's name therefore finds all of its questions.
 */
export function matchesQuery(item: QuizBankItem, query: string): boolean {
  const words = normalizeQuery(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const q = item.question;
  const text = [q.subtopic, q.prompt, q.code?.source ?? '', ...(q.choices ?? []).map((c) => c.text)]
    .join('\n')
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * Items matching the filters and the search text, in bank order. `keep` holds ids that stay
 * listed even when they no longer match (a question answered under "New" should not vanish while
 * the user is on it).
 */
export function filterItems(
  items: QuizBankItem[],
  f: BankFilters,
  keep: ReadonlySet<string> = new Set(),
  query = '',
): QuizBankItem[] {
  return items.filter((i) => keep.has(i.question.id) || (matches(i, f) && matchesQuery(i, query)));
}

export interface SubtopicGroup {
  subtopic: string;
  items: QuizBankItem[];
}

/** Consecutive runs of the same subtopic (the API already orders the bank by subtopic). */
export function groupBySubtopic(items: QuizBankItem[]): SubtopicGroup[] {
  const groups: SubtopicGroup[] = [];
  for (const i of items) {
    const last = groups.at(-1);
    if (last && last.subtopic === i.question.subtopic) last.items.push(i);
    else groups.push({ subtopic: i.question.subtopic, items: [i] });
  }
  return groups;
}

export interface StatusCounts {
  total: number;
  new: number;
  missed: number;
  correct: number;
}

export function statusCounts(items: QuizBankItem[]): StatusCounts {
  const c: StatusCounts = { total: items.length, new: 0, missed: 0, correct: 0 };
  for (const i of items) c[statusGroup(i.status)]++;
  return c;
}

/** A subtopic as the overview shows it: what the filters leave, against everything it holds. */
export interface SubtopicSummary {
  subtopic: string;
  /** the questions the filters and the search leave, in bank order */
  items: QuizBankItem[];
  /** progress over every question of the subtopic, whatever the filters */
  overall: StatusCounts;
}

/** The subtopics that still have a listed question, in bank order. */
export function summariseSubtopics(all: QuizBankItem[], list: QuizBankItem[]): SubtopicSummary[] {
  const bySubtopic = new Map<string, QuizBankItem[]>();
  for (const i of all) {
    const of = bySubtopic.get(i.question.subtopic);
    if (of) of.push(i);
    else bySubtopic.set(i.question.subtopic, [i]);
  }
  return groupBySubtopic(list).map((g) => ({
    ...g,
    overall: statusCounts(bySubtopic.get(g.subtopic) ?? g.items),
  }));
}

/** The subtopics on either side of `subtopic`; a missing one has no neighbours. */
export function subtopicNeighbours<G extends SubtopicGroup>(
  groups: G[],
  subtopic: string | null,
): { index: number; prev: G | null; next: G | null } {
  const index = subtopic === null ? -1 : groups.findIndex((g) => g.subtopic === subtopic);
  return {
    index,
    prev: index > 0 ? (groups[index - 1] ?? null) : null,
    next: index === -1 ? null : (groups[index + 1] ?? null),
  };
}

/** Where opening a list of questions lands: the first one still to get right, else the first. */
export function entryQuestion(items: QuizBankItem[]): string | null {
  return nextToPractise(items, null) ?? items[0]?.question.id ?? null;
}

/** Previous and next question ids around `id` in `list`; a missing id starts from the top. */
export function neighbours(
  list: QuizBankItem[],
  id: string | null,
): { index: number; prev: string | null; next: string | null } {
  const index = id === null ? -1 : list.findIndex((i) => i.question.id === id);
  return {
    index,
    prev: index > 0 ? (list[index - 1]?.question.id ?? null) : null,
    next: index === -1 ? (list[0]?.question.id ?? null) : (list[index + 1]?.question.id ?? null),
  };
}

/** The first question after `id` (wrapping) that has not been answered correctly. */
export function nextToPractise(list: QuizBankItem[], id: string | null): string | null {
  const start = id === null ? -1 : list.findIndex((i) => i.question.id === id);
  for (let k = 1; k <= list.length; k++) {
    const item = list[(start + k + list.length) % list.length];
    if (item && item.question.id !== id && item.status !== 'correct') return item.question.id;
  }
  return null;
}

/** Same mapping as an attempt's per-question outcome. */
export function statusFromFeedback(f: AnswerFeedback): QuizQuestionStatus {
  return outcomeOf(f) ?? 'unanswered';
}

/** The bank item after an answer was recorded. */
export function itemWithFeedback(
  item: QuizBankItem,
  f: AnswerFeedback,
  at = new Date().toISOString(),
): QuizBankItem {
  return {
    ...item,
    status: statusFromFeedback(f),
    score: f.needsSelfGrade ? null : f.score,
    answeredAt: at,
  };
}

export function bankWithFeedback(bank: QuizBank, f: AnswerFeedback, at?: string): QuizBank {
  return {
    ...bank,
    items: bank.items.map((i) => (i.question.id === f.questionId ? itemWithFeedback(i, f, at) : i)),
  };
}
