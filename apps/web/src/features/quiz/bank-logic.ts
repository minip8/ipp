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

/** Query string for the bank page (`?` included, empty when nothing is set). */
export function bankSearch(filters: BankFilters, question: string | null): string {
  const p = new URLSearchParams();
  if (filters.status !== 'all') p.set('status', filters.status);
  if (filters.difficulty !== 'all') p.set('difficulty', filters.difficulty);
  if (filters.type !== 'all') p.set('type', filters.type);
  if (question) p.set('question', question);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function bankHref(topic: string, filters = DEFAULT_FILTERS, question: string | null = null) {
  return `/quiz/topics/${encodeURIComponent(topic)}${bankSearch(filters, question)}`;
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

/**
 * Items matching the filters, in bank order. `keep` holds ids that stay listed even when they no
 * longer match (a question answered under "New" should not vanish while the user is on it).
 */
export function filterItems(
  items: QuizBankItem[],
  f: BankFilters,
  keep: ReadonlySet<string> = new Set(),
): QuizBankItem[] {
  return items.filter((i) => keep.has(i.question.id) || matches(i, f));
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
