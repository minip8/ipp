import type { AnswerFeedback, PublicQuizQuestion, QuizBank, QuizBankItem } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  bankHref,
  bankSearch,
  bankWithFeedback,
  DEFAULT_DISCLOSURE,
  DEFAULT_FILTERS,
  filterItems,
  groupBySubtopic,
  neighbours,
  nextToPractise,
  OUTLINE_ABOVE,
  parseFilters,
  sectionOpen,
  startsOpen,
  statusCounts,
  statusFromFeedback,
  withSection,
} from './bank-logic';

const q = (id: string, over: Partial<PublicQuizQuestion> = {}): PublicQuizQuestion => ({
  id,
  topic: 'os',
  subtopic: 'Paging',
  difficulty: 'easy',
  type: 'single',
  prompt: id,
  choices: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  code: null,
  ...over,
});
const item = (
  id: string,
  status: QuizBankItem['status'] = 'unanswered',
  over: Partial<PublicQuizQuestion> = {},
): QuizBankItem => ({
  question: q(id, over),
  status,
  score: status === 'correct' ? 1 : status === 'unanswered' ? null : 0,
  answeredAt: status === 'unanswered' ? null : '2026-01-01T00:00:00.000Z',
});

const items = [
  item('p1', 'correct'),
  item('p2', 'incorrect', { difficulty: 'hard' }),
  item('p3', 'unanswered', { type: 'short', choices: null }),
  item('s1', 'partial', { subtopic: 'Scheduling' }),
  item('s2', 'pending', { subtopic: 'Scheduling', type: 'short', choices: null }),
  item('s3', 'unanswered', { subtopic: 'Scheduling', difficulty: 'hard' }),
];
const ids = (xs: QuizBankItem[]) => xs.map((i) => i.question.id);

const fb = (over: Partial<AnswerFeedback>): AnswerFeedback => ({
  questionId: 'p3',
  score: 1,
  correct: true,
  correctAnswer: 'x',
  explanation: '',
  feedback: null,
  gradedBy: 'auto',
  needsSelfGrade: false,
  ...over,
});

describe('filters in the URL', () => {
  it('parses known values and ignores the rest', () => {
    expect(parseFilters(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
    expect(
      parseFilters(new URLSearchParams('status=missed&difficulty=hard&type=output&x=1')),
    ).toEqual({ status: 'missed', difficulty: 'hard', type: 'output' });
    expect(parseFilters(new URLSearchParams('status=bogus&difficulty=HARD&type=')).status).toBe(
      'all',
    );
  });

  it('round-trips and deep-links a question', () => {
    const f = { status: 'new', difficulty: 'all', type: 'short' } as const;
    expect(bankSearch(DEFAULT_FILTERS, null)).toBe('');
    expect(bankSearch(f, 'p3')).toBe('?status=new&type=short&question=p3');
    expect(parseFilters(new URLSearchParams(bankSearch(f, 'p3')))).toEqual(f);
    expect(bankHref('operating-systems', DEFAULT_FILTERS, 'p1')).toBe(
      '/quiz/topics/operating-systems?question=p1',
    );
  });
});

describe('filtering and grouping', () => {
  it('filters by status group, difficulty and type', () => {
    expect(ids(filterItems(items, DEFAULT_FILTERS))).toEqual(ids(items));
    expect(ids(filterItems(items, { ...DEFAULT_FILTERS, status: 'new' }))).toEqual(['p3', 's3']);
    // missed = anything answered but not fully right, including a pending self-grade
    expect(ids(filterItems(items, { ...DEFAULT_FILTERS, status: 'missed' }))).toEqual([
      'p2',
      's1',
      's2',
    ]);
    expect(ids(filterItems(items, { ...DEFAULT_FILTERS, status: 'correct' }))).toEqual(['p1']);
    expect(ids(filterItems(items, { status: 'all', difficulty: 'hard', type: 'single' }))).toEqual([
      'p2',
      's3',
    ]);
  });

  it('keeps pinned questions listed after they stop matching', () => {
    const answered = items.map((i) =>
      i.question.id === 'p3' ? { ...i, status: 'correct' as const } : i,
    );
    const f = { ...DEFAULT_FILTERS, status: 'new' as const };
    expect(ids(filterItems(answered, f))).toEqual(['s3']);
    expect(ids(filterItems(answered, f, new Set(['p3'])))).toEqual(['p3', 's3']);
  });

  it('groups consecutive subtopics and counts statuses', () => {
    expect(groupBySubtopic(items).map((g) => [g.subtopic, ids(g.items)])).toEqual([
      ['Paging', ['p1', 'p2', 'p3']],
      ['Scheduling', ['s1', 's2', 's3']],
    ]);
    expect(statusCounts(items)).toEqual({ total: 6, new: 2, missed: 3, correct: 1 });
    expect(groupBySubtopic([])).toEqual([]);
  });
});

describe('subtopic sections', () => {
  const long = (subtopics: string[]) =>
    groupBySubtopic(
      subtopics.flatMap((subtopic) =>
        Array.from({ length: OUTLINE_ABOVE }, (_, n) =>
          item(`${subtopic}-${n}`, 'unanswered', { subtopic }),
        ),
      ),
    );

  it('start open in a short list or a single subtopic, closed in a long list', () => {
    expect(startsOpen(groupBySubtopic(items))).toBe(true);
    expect(startsOpen(long(['Paging']))).toBe(true);
    expect(startsOpen(long(['Paging', 'Scheduling']))).toBe(false);
    expect(startsOpen([])).toBe(true);
  });

  it('follow the last choice: one section, then all of them, then the default', () => {
    expect(sectionOpen(DEFAULT_DISCLOSURE, 'Paging', false)).toBe(false);
    expect(sectionOpen(DEFAULT_DISCLOSURE, 'Paging', true)).toBe(true);
    const one = withSection(DEFAULT_DISCLOSURE, 'Paging', true);
    expect(sectionOpen(one, 'Paging', false)).toBe(true);
    expect(sectionOpen(one, 'Scheduling', false)).toBe(false);
    expect(DEFAULT_DISCLOSURE.toggled.size).toBe(0);
    // "Collapse all", then one section opened again
    const collapsed = { all: false, toggled: new Map<string, boolean>() };
    expect(sectionOpen(collapsed, 'Paging', true)).toBe(false);
    const reopened = withSection(collapsed, 'Scheduling', true);
    expect(sectionOpen(reopened, 'Scheduling', true)).toBe(true);
    expect(sectionOpen(reopened, 'Paging', true)).toBe(false);
  });
});

describe('moving between questions', () => {
  it('finds neighbours in the filtered list', () => {
    expect(neighbours(items, 'p1')).toEqual({ index: 0, prev: null, next: 'p2' });
    expect(neighbours(items, 's1')).toEqual({ index: 3, prev: 'p3', next: 's2' });
    expect(neighbours(items, 's3')).toEqual({ index: 5, prev: 's2', next: null });
    // Not in the list (filtered out or unknown): next starts at the top.
    expect(neighbours(items, 'gone')).toEqual({ index: -1, prev: null, next: 'p1' });
    expect(neighbours([], null)).toEqual({ index: -1, prev: null, next: null });
  });

  it('finds the next question that is not answered correctly, wrapping', () => {
    expect(nextToPractise(items, null)).toBe('p2');
    expect(nextToPractise(items, 'p3')).toBe('s1');
    expect(nextToPractise(items, 's3')).toBe('p2');
    expect(nextToPractise([item('a', 'correct'), item('b', 'correct')], 'a')).toBeNull();
    expect(nextToPractise([item('a', 'incorrect')], 'a')).toBeNull();
  });
});

describe('recording an answer', () => {
  it('maps feedback to a status like an attempt outcome', () => {
    expect(statusFromFeedback(fb({}))).toBe('correct');
    expect(statusFromFeedback(fb({ correct: false, score: 0.5 }))).toBe('partial');
    expect(statusFromFeedback(fb({ correct: false, score: 0 }))).toBe('incorrect');
    expect(statusFromFeedback(fb({ correct: false, score: 0, needsSelfGrade: true }))).toBe(
      'pending',
    );
  });

  it('updates only the answered item in the cached bank', () => {
    const bank: QuizBank = { topic: { slug: 'os', title: 'OS', description: '' }, items };
    const at = '2026-02-02T00:00:00.000Z';
    const next = bankWithFeedback(bank, fb({ correct: false, score: 0.5 }), at);
    expect(next.items.find((i) => i.question.id === 'p3')).toMatchObject({
      status: 'partial',
      score: 0.5,
      answeredAt: at,
    });
    expect(next.items.filter((i, k) => i !== items[k]).map((i) => i.question.id)).toEqual(['p3']);
    const pending = bankWithFeedback(bank, fb({ needsSelfGrade: true, correct: false, score: 0 }));
    expect(pending.items.find((i) => i.question.id === 'p3')).toMatchObject({
      status: 'pending',
      score: null,
    });
  });
});
