import type { AnswerFeedback, PublicQuizQuestion } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  choiceIndexForKey,
  draftForKey,
  draftFromResponse,
  emptyDraft,
  formatCorrect,
  formatResponse,
  outcomeOf,
  outputKindsFor,
  promptSummary,
  resumeIndex,
  toResponse,
} from './logic';

const single: PublicQuizQuestion = {
  id: 'q-single',
  topic: 'os',
  subtopic: 'x',
  difficulty: 'easy',
  type: 'single',
  prompt: 'Pick **one**',
  choices: [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Beta' },
  ],
  code: null,
};
const multiple: PublicQuizQuestion = { ...single, id: 'q-multi', type: 'multiple' };
const output: PublicQuizQuestion = {
  ...single,
  id: 'q-out',
  type: 'output',
  choices: null,
  code: { language: 'cpp', standard: 'C++20', source: 'int main(){}' },
};
const short: PublicQuizQuestion = { ...single, id: 'q-short', type: 'short', choices: null };

const fb = (over: Partial<AnswerFeedback>): AnswerFeedback => ({
  questionId: 'q-single',
  score: 1,
  correct: true,
  correctAnswer: 'a',
  explanation: '',
  feedback: null,
  gradedBy: 'auto',
  needsSelfGrade: false,
  ...over,
});

describe('drafts and responses', () => {
  it('builds responses only when complete', () => {
    expect(toResponse(emptyDraft(single))).toBeNull();
    expect(toResponse({ type: 'single', choice: 'b' })).toEqual({ type: 'single', choice: 'b' });
    expect(toResponse({ type: 'multiple', choices: ['c', 'a'] })).toEqual({
      type: 'multiple',
      choices: ['a', 'c'],
    });
    expect(toResponse({ type: 'multiple', choices: [] })).toBeNull();
    expect(toResponse({ type: 'output', kind: 'output', output: '  ' })).toBeNull();
    expect(toResponse({ type: 'output', kind: 'output', output: 'a|d' })).toEqual({
      type: 'output',
      answer: { kind: 'output', output: 'a|d' },
    });
    expect(toResponse({ type: 'output', kind: 'undefined', output: 'ignored' })).toEqual({
      type: 'output',
      answer: { kind: 'undefined' },
    });
    expect(toResponse({ type: 'short', text: '  hi  ' })).toEqual({ type: 'short', text: 'hi' });
  });

  it('restores drafts from recorded responses', () => {
    expect(
      draftFromResponse(output, { type: 'output', answer: { kind: 'output', output: 'x' } }),
    ).toEqual({
      type: 'output',
      kind: 'output',
      output: 'x',
    });
    expect(draftFromResponse(single, { type: 'short', text: 'mismatch' })).toEqual(
      emptyDraft(single),
    );
    expect(draftFromResponse(short, undefined)).toEqual({ type: 'short', text: '' });
  });
});

describe('formatting', () => {
  it('labels choices with letters', () => {
    expect(formatResponse(single, { type: 'single', choice: 'b' })).toBe('B. Beta');
    expect(formatResponse(multiple, { type: 'multiple', choices: ['a', 'b'] })).toBe(
      'A. Alpha\nB. Beta',
    );
    expect(formatCorrect(multiple, fb({ correctAnswer: ['b'] }))).toBe('B. Beta');
    expect(formatCorrect(output, fb({ correctAnswer: { kind: 'compile_error' } }))).toBe(
      'Compile error',
    );
    expect(formatCorrect(short, fb({ correctAnswer: 'Reference text' }))).toBe('Reference text');
  });

  it('summarises markdown prompts', () => {
    expect(promptSummary('Why does **TCP** need `TIME_WAIT`?\n\n```cpp\nint x;\n```')).toBe(
      'Why does TCP need TIME_WAIT?',
    );
    expect(promptSummary('a'.repeat(200), 10)).toHaveLength(10);
  });
});

describe('outcomes and navigation', () => {
  it('classifies feedback', () => {
    expect(outcomeOf(undefined)).toBeNull();
    expect(outcomeOf(fb({}))).toBe('correct');
    expect(outcomeOf(fb({ correct: false, score: 0.5 }))).toBe('partial');
    expect(outcomeOf(fb({ correct: false, score: 0 }))).toBe('incorrect');
    expect(outcomeOf(fb({ needsSelfGrade: true }))).toBe('pending');
  });

  it('maps keys to choices', () => {
    expect(choiceIndexForKey('1', 4)).toBe(0);
    expect(choiceIndexForKey('d', 4)).toBe(3);
    expect(choiceIndexForKey('E', 4)).toBeNull();
    expect(choiceIndexForKey('Enter', 4)).toBeNull();
  });

  it('offers language-appropriate output kinds', () => {
    expect(outputKindsFor('cpp').map((k) => k.kind)).toEqual([
      'output',
      'compile_error',
      'undefined',
      'unspecified',
    ]);
    expect(outputKindsFor('python').map((k) => k.kind)).toEqual(['output', 'runtime_error']);
  });

  it('resumes at the first unfinished question', () => {
    const qs = [single, multiple, output];
    expect(resumeIndex(qs, {}, [], 'practice')).toBe(0);
    expect(
      resumeIndex(qs, { 'q-single': { type: 'single', choice: 'a' } }, [fb({})], 'practice'),
    ).toBe(1);
    expect(resumeIndex(qs, { 'q-single': { type: 'single', choice: 'a' } }, [], 'exam')).toBe(1);
    expect(
      resumeIndex(
        qs,
        { 'q-single': { type: 'single', choice: 'a' } },
        [fb({ needsSelfGrade: true })],
        'practice',
      ),
    ).toBe(0);
  });
});

describe('choice shortcuts', () => {
  it('picks, toggles and ignores keys', () => {
    expect(draftForKey(single, emptyDraft(single), 'b')).toEqual({ type: 'single', choice: 'b' });
    expect(draftForKey(single, emptyDraft(single), '1')).toEqual({ type: 'single', choice: 'a' });
    expect(draftForKey(single, emptyDraft(single), 'c')).toBeNull();
    const picked = draftForKey(multiple, emptyDraft(multiple), 'a');
    expect(picked).toEqual({ type: 'multiple', choices: ['a'] });
    expect(draftForKey(multiple, picked ?? emptyDraft(multiple), 'a')).toEqual({
      type: 'multiple',
      choices: [],
    });
    expect(draftForKey(output, emptyDraft(output), '3')).toMatchObject({ kind: 'undefined' });
    expect(draftForKey(output, emptyDraft(output), '9')).toBeNull();
    expect(draftForKey(short, emptyDraft(short), 'a')).toBeNull();
  });
});
