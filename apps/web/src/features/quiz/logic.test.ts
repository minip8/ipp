import { type AnswerFeedback, type PublicQuizQuestion, STAGE_TOPICS_MAX } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  attemptsInTrack,
  choiceIndexForKey,
  DEFAULT_SETUP,
  draftForKey,
  draftFromResponse,
  emptyDraft,
  formatCorrect,
  formatResponse,
  interviewLabel,
  interviewTopics,
  isUnsendable,
  modeHint,
  NUMERIC_HINT,
  numericProblem,
  outcomeOf,
  outputKindsFor,
  parseSetup,
  promptSummary,
  quizQuestionCount,
  resumeIndex,
  setupStorageKey,
  summarySegments,
  TYPE_LABEL,
  toResponse,
  withUnit,
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
  unit: null,
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

describe('quiz setup', () => {
  it('keeps what is valid in a stored setup and defaults the rest', () => {
    expect(parseSetup(null)).toEqual(DEFAULT_SETUP);
    expect(parseSetup('nonsense')).toEqual(DEFAULT_SETUP);
    expect(
      parseSetup({
        topics: ['cpp', 'cpp', 7, 'python'],
        mode: 'exam',
        difficulty: 'hard',
        count: '30',
        focusWeak: false,
      }),
    ).toEqual({
      topics: ['cpp', 'python'],
      mode: 'exam',
      difficulty: 'hard',
      count: '30',
      focusWeak: false,
    });
    expect(parseSetup({ mode: 'speedrun', count: 10, difficulty: 'easy' })).toEqual({
      ...DEFAULT_SETUP,
      difficulty: 'easy',
    });
  });

  it('falls back to practice for a setup remembered on a discussion', () => {
    // Discussions left the setup; one stored before then (with its own count) is a quiz again.
    expect(
      parseSetup({ topics: ['networking'], mode: 'discussion', discussionCount: '3', count: '5' }),
    ).toEqual({ ...DEFAULT_SETUP, topics: ['networking'], mode: 'practice', count: '5' });
  });

  it('counts the questions a quiz draws on: not the open ones', () => {
    expect(quizQuestionCount({ questionCount: 84, shortCount: 20 })).toBe(64);
    expect(quizQuestionCount({ questionCount: 6, shortCount: 6 })).toBe(0);
  });
});

describe('interviews on open questions', () => {
  it('takes each topic once, in order, without those that have no open questions', () => {
    expect(
      interviewTopics([
        { slug: 'probability', shortCount: 4 },
        { slug: 'brainteasers', shortCount: 0 },
        { slug: 'options', shortCount: 7 },
        { slug: 'probability', shortCount: 4 },
      ]),
    ).toEqual(['probability', 'options']);
    // Bare slugs (an attempt's topics) are taken as they are.
    expect(interviewTopics(['cpp', 'networking', 'cpp'])).toEqual(['cpp', 'networking']);
    expect(interviewTopics([])).toEqual([]);
  });

  it('takes no more topics than one questions stage', () => {
    const many = Array.from({ length: STAGE_TOPICS_MAX + 3 }, (_, i) => `t${i}`);
    expect(interviewTopics(many)).toEqual(many.slice(0, STAGE_TOPICS_MAX));
  });

  it('says this topic or these topics', () => {
    expect(interviewLabel(1)).toBe('Interview on this topic');
    expect(interviewLabel(3)).toBe('Interview on these topics');
  });
});

const numeric: PublicQuizQuestion = {
  ...single,
  id: 'q-num',
  type: 'numeric',
  prompt: 'Two dice: what is $P(\\text{sum} = 8)$?',
  choices: null,
};
const rolls: PublicQuizQuestion = { ...numeric, id: 'q-rolls', unit: 'rolls' };

describe('numeric answers', () => {
  it('starts empty and restores what was typed', () => {
    expect(emptyDraft(numeric)).toEqual({ type: 'numeric', value: '' });
    expect(draftFromResponse(numeric, { type: 'numeric', value: '5/36' })).toEqual({
      type: 'numeric',
      value: '5/36',
    });
  });

  it('sends a number in any accepted form, trimmed', () => {
    for (const value of ['5/36', ' 0.139 ', '13.9%', '-7', '1,000', '1.5e-3'])
      expect(toResponse({ type: 'numeric', value })).toEqual({
        type: 'numeric',
        value: value.trim(),
      });
  });

  it('sends nothing while empty or not a number, and says why only for the latter', () => {
    for (const value of ['', '   ']) {
      expect(toResponse({ type: 'numeric', value })).toBeNull();
      expect(numericProblem(value)).toBeNull();
      expect(isUnsendable({ type: 'numeric', value })).toBe(false);
    }
    for (const value of ['abc', '5/', '1/0', '0.1.2', 'e5']) {
      expect(toResponse({ type: 'numeric', value })).toBeNull();
      expect(numericProblem(value)).toMatch(/^Enter a number/);
      expect(isUnsendable({ type: 'numeric', value })).toBe(true);
    }
    expect(isUnsendable({ type: 'short', text: 'abc' })).toBe(false);
  });

  it('takes a percentage as the fraction it is', () => {
    expect(toResponse({ type: 'numeric', value: '12.5%' })).toEqual({
      type: 'numeric',
      value: '12.5%',
    });
    expect(numericProblem('12.5 %')).toBeNull();
    expect(NUMERIC_HINT).toBe('A fraction, a decimal to 3 significant figures, or a percentage.');
  });

  it('shows values with their unit', () => {
    expect(withUnit('6', 'rolls')).toBe('6 rolls');
    expect(withUnit('6', null)).toBe('6');
    expect(formatResponse(rolls, { type: 'numeric', value: '6' })).toBe('6 rolls');
  });

  it('adds the unit to a bare correct number, not to answer text', () => {
    expect(formatCorrect(rolls, fb({ correctAnswer: '6' }))).toBe('6 rolls');
    expect(formatCorrect(numeric, fb({ correctAnswer: '$1/e \\approx 0.368$' }))).toBe(
      '$1/e \\approx 0.368$',
    );
    expect(formatCorrect(rolls, fb({ correctAnswer: '$6$ on average' }))).toBe('$6$ on average');
  });

  it('labels the type and has no letter shortcuts', () => {
    expect(TYPE_LABEL.numeric).toBe('Numeric answer');
    expect(draftForKey(numeric, emptyDraft(numeric), '1')).toBeNull();
    expect(draftForKey(numeric, emptyDraft(numeric), 'a')).toBeNull();
  });
});

describe('summaries with math', () => {
  it('keeps math as one inline segment and code dollars as text', () => {
    expect(summarySegments('Find $\\mathbb{E}[N]$ when `echo $X` runs.')).toEqual([
      { kind: 'text', text: 'Find ' },
      { kind: 'math', text: '$\\mathbb{E}[N]$' },
      { kind: 'text', text: ' when echo $X runs.' },
    ]);
  });

  it('turns display math inline and collapses whitespace', () => {
    expect(promptSummary('What is\n\n$$\n\\frac{5}{36}\n$$\n\nas a decimal?')).toBe(
      'What is $\\frac{5}{36}$ as a decimal?',
    );
  });

  it('never cuts inside a formula', () => {
    const md = `${'a'.repeat(8)} $x^2 + y^2$ tail`;
    expect(promptSummary(md, 12)).toBe('aaaaaaaa…');
    expect(promptSummary(md, 21)).toBe('aaaaaaaa $x^2 + y^2$…');
    // Text is still cut mid-word, as before.
    expect(promptSummary('a'.repeat(200), 10)).toHaveLength(10);
  });

  it('leaves text without math as it was', () => {
    expect(summarySegments('Costs $5 and $10, **really**')).toEqual([
      { kind: 'text', text: 'Costs $5 and $10, really' },
    ]);
  });
});

describe('tracks', () => {
  const topics = [
    { slug: 'cpp', track: 'fundamentals', also: [] },
    { slug: 'python', track: 'fundamentals', also: ['quant'] },
    { slug: 'probability', track: 'quant', also: [] },
  ] as const;
  const attempt = (id: string, ...slugs: string[]) => ({ id, topics: slugs });

  it('lists an attempt in every track one of its topics is in', () => {
    const attempts = [
      attempt('a', 'cpp'),
      attempt('b', 'python'),
      attempt('c', 'probability'),
      attempt('d', 'cpp', 'probability'),
      attempt('e', 'gone'),
    ];
    expect(attemptsInTrack(attempts, topics, 'software').map((a) => a.id)).toEqual(['a', 'b', 'd']);
    expect(attemptsInTrack(attempts, topics, 'quant').map((a) => a.id)).toEqual(['b', 'c', 'd']);
  });

  it('names the drill only in Quant', () => {
    expect(modeHint('practice', 'software')).not.toMatch(/drill/);
    expect(modeHint('practice', 'quant')).toMatch(/mental math drill/);
    expect(modeHint('exam', 'quant')).toBe(modeHint('exam', 'software'));
  });

  it('keeps one setup per track', () => {
    expect(setupStorageKey('software')).not.toBe(setupStorageKey('quant'));
  });
});
