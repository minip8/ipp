import {
  type HostBankPage,
  type HostQuestionMaterial,
  type HostRoundQuestion,
  type HostRoundView,
  hostedPrompt,
  QUANT_HOSTED_HINTS_MAX,
  QUANT_QUEUE_MAX,
  type QuizBank,
  QuizQuestion,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  addToQueue,
  composedPrompt,
  defaultOpinionIndex,
  filtersActive,
  fromHostPage,
  hintLadder,
  hintsSummary,
  hostBankParams,
  hostedEndNote,
  hostedWaiting,
  moveInQueue,
  NO_BANK_FILTERS,
  nearestStep,
  newerHostRound,
  nextInQueue,
  nextRung,
  openQuestion,
  openSeconds,
  pageLabel,
  promptLine,
  removeFromQueue,
  searchPublicBank,
  topicsForTrack,
  verdictEditable,
  verdictOf,
  withFilter,
} from './logic';

const T = Date.parse('2026-03-01T10:00:00.000Z');
const at = (sec: number) => new Date(T + sec * 1000).toISOString();

const QUESTIONS = QuizQuestion.array().parse([
  {
    id: 'q-single',
    topic: 'probability',
    subtopic: 'Conditioning',
    difficulty: 'medium',
    type: 'single',
    prompt: 'Which is it?  ',
    choices: [
      { id: 'a', text: '$\\frac{1}{3}$' },
      { id: 'b', text: ' One half ' },
    ],
    answer: 'a',
    explanation: '',
  },
  {
    id: 'q-multiple',
    topic: 'options',
    subtopic: 'Parity',
    difficulty: 'hard',
    type: 'multiple',
    prompt: 'Which hold?',
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answer: ['a', 'b'],
    explanation: '',
  },
  {
    id: 'q-output',
    topic: 'python',
    subtopic: 'Functions',
    difficulty: 'easy',
    type: 'output',
    prompt: 'What does this print?',
    language: 'python',
    standard: 'Python 3.12',
    code: 'print("```")\n\n',
    answer: { kind: 'output', output: '```' },
    explanation: '',
  },
  {
    id: 'q-numeric',
    topic: 'probability',
    subtopic: 'Dice',
    difficulty: 'easy',
    type: 'numeric',
    prompt: 'Sum of $8$?',
    answer: '5/36',
    explanation: '',
  },
]);

const publicOf = (q: QuizQuestion) => ({
  id: q.id,
  topic: q.topic,
  subtopic: q.subtopic,
  difficulty: q.difficulty,
  type: q.type,
  prompt: q.prompt,
  choices: q.type === 'single' || q.type === 'multiple' ? q.choices : null,
  code: q.type === 'output' ? { language: q.language, standard: q.standard, source: q.code } : null,
  unit: null,
});

const material = (over: Partial<HostQuestionMaterial> = {}): HostQuestionMaterial => ({
  id: 'q-numeric',
  topic: 'probability',
  subtopic: 'Dice',
  difficulty: 'easy',
  type: 'numeric',
  prompt: 'Sum of $8$?',
  choices: null,
  code: null,
  unit: null,
  topicTitle: 'Probability',
  solution: '5/36',
  correctAnswer: '5/36',
  keyPoints: [],
  explanation: 'Five of 36.',
  hints: ['First', 'Second', 'Third'],
  followUps: ['And 7?'],
  tolerance: null,
  ...over,
});

const asked = (index: number, over: Partial<HostRoundQuestion> = {}): HostRoundQuestion => ({
  index,
  questionId: `q-${index}`,
  topic: 'probability',
  topicTitle: 'Probability',
  difficulty: 'easy',
  type: 'numeric',
  prompt: `Q${index + 1}`,
  posedAt: at(index * 300),
  posedMessageId: null,
  closedAt: null,
  closedBy: null,
  timeSec: null,
  hintRungs: [],
  followUpAsked: false,
  verdict: null,
  material: material(),
  ...over,
});

const round = (over: Partial<HostRoundView> = {}): HostRoundView => ({
  version: 3,
  phase: 'pending',
  ended: false,
  open: null,
  questions: [],
  queue: [],
  ...over,
});

describe('what the candidate is shown', () => {
  it('composes every type exactly as the server poses it', () => {
    for (const q of QUESTIONS) expect(composedPrompt(publicOf(q))).toBe(hostedPrompt(q));
  });

  it('summarises a prompt on one line, its code left out', () => {
    expect(promptLine('What does\n\n```py\nprint(1)\n```\nprint?')).toBe('What does [code] print?');
    expect(promptLine('x'.repeat(200), 20)).toHaveLength(20);
    expect(promptLine('x'.repeat(200), 20).endsWith('…')).toBe(true);
  });
});

describe('the queue', () => {
  it('adds once, at the end, and never past the limit', () => {
    expect(addToQueue(['a'], 'b')).toEqual(['a', 'b']);
    expect(addToQueue(['a', 'b'], 'a')).toEqual(['a', 'b']);
    const full = Array.from({ length: QUANT_QUEUE_MAX }, (_, i) => `q${i}`);
    expect(addToQueue(full, 'x')).toHaveLength(QUANT_QUEUE_MAX);
  });

  it('moves within its ends and removes', () => {
    expect(moveInQueue(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveInQueue(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveInQueue(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveInQueue(['a', 'b', 'c'], 'c', 5)).toEqual(['a', 'b', 'c']);
    expect(moveInQueue(['a', 'b'], 'zz', 1)).toEqual(['a', 'b']);
    expect(removeFromQueue(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('skips a question that left the bank for "up next"', () => {
    const r = round({
      queue: [
        { questionId: 'gone', material: null },
        { questionId: 'q-numeric', material: material() },
      ],
    });
    expect(nextInQueue(r)?.questionId).toBe('q-numeric');
    expect(nextInQueue(round())).toBeNull();
  });
});

describe('the round', () => {
  it('finds the open question', () => {
    expect(openQuestion(null)).toBeNull();
    expect(openQuestion(round())).toBeNull();
    const r = round({ open: 1, phase: 'asking', questions: [asked(0), asked(1)] });
    expect(openQuestion(r)?.index).toBe(1);
  });

  it('keeps the newer of two views', () => {
    const a = round({ version: 5 });
    const b = round({ version: 4 });
    expect(newerHostRound(a, b)).toBe(a);
    expect(newerHostRound(b, a)).toBe(a);
    expect(newerHostRound(null, b)).toBe(b);
    expect(newerHostRound(round({ version: 4 }), b)).toBe(b);
  });

  it('reads the ladder: given, next, later, and own hints apart', () => {
    const q = asked(0, { hintRungs: [1, 0] });
    const ladder = ['First', 'Second', 'Third'];
    expect(nextRung(q, ladder)).toBe(2);
    expect(hintLadder(q, ladder).map((r) => r.state)).toEqual(['given', 'next', 'later']);
    expect(nextRung(asked(0, { hintRungs: [1, 2, 3] }), ladder)).toBeNull();
    expect(nextRung(asked(0), [])).toBeNull();
    const capped = asked(0, { hintRungs: Array(QUANT_HOSTED_HINTS_MAX).fill(0) });
    expect(nextRung(capped, ladder)).toBeNull();
  });

  it('times a question while open and after', () => {
    const q = asked(0, { posedAt: at(0) });
    expect(openSeconds(q, T + 75_500)).toBe(75);
    expect(openSeconds({ ...q, closedAt: at(40), timeSec: 40 }, T + 999_000)).toBe(40);
    expect(openSeconds({ ...q, posedAt: at(10) }, T)).toBe(0);
  });

  it('says which hints were given', () => {
    expect(hintsSummary([])).toBe('No hints');
    expect(hintsSummary([1])).toBe('1 hint: rung 1');
    expect(hintsSummary([1, 2, 0])).toBe('3 hints: rungs 1 and 2, and one of your own');
    expect(hintsSummary([0, 0], 'in your own words')).toBe('2 hints: 2 in your own words');
    expect(hintsSummary([1, 2, 3])).toBe('3 hints: rungs 1, 2 and 3');
  });
});

describe('verdicts', () => {
  it('gives no verdict without a score', () => {
    expect(verdictOf({ score: null, summary: 'x' })).toBeNull();
    expect(verdictOf({ score: 0.75, summary: '  ok  ' })).toEqual({ score: 0.75, summary: 'ok' });
  });

  it('rounds the AI’s suggestion to the form’s steps', () => {
    expect(nearestStep(0.55)).toBe(0.5);
    expect(nearestStep(0.9)).toBe(1);
    expect(nearestStep(0.1)).toBe(0);
  });

  it('can be changed until the end, and after it only given', () => {
    const closed = { closedAt: at(60), verdict: { score: 1, summary: '' } };
    expect(verdictEditable(closed, false)).toBe(true);
    expect(verdictEditable(closed, true)).toBe(false);
    expect(verdictEditable({ closedAt: at(60), verdict: null }, true)).toBe(true);
    expect(verdictEditable({ closedAt: null, verdict: null }, false)).toBe(false);
  });

  it('asks the AI about the open question, else the last asked', () => {
    expect(defaultOpinionIndex(null)).toBeNull();
    expect(defaultOpinionIndex(round())).toBeNull();
    expect(defaultOpinionIndex(round({ questions: [asked(0), asked(1)] }))).toBe(1);
    expect(defaultOpinionIndex(round({ open: 0, questions: [asked(0), asked(1)] }))).toBe(0);
  });
});

describe('the candidate between questions', () => {
  it('waits calmly, then between questions, then ends', () => {
    expect(hostedWaiting({ questions: [] }, false).title).toBe(
      'Your interviewer will post a question here',
    );
    expect(hostedWaiting({ questions: [{} as never] }, false).title).toBe(
      'Waiting for the next question',
    );
    expect(hostedWaiting({ questions: [] }, true).body).toBe('No question was asked.');
  });

  it('tells the host what ending does', () => {
    expect(hostedEndNote({ questions: [], phase: 'pending' })).toMatch(/^No question was asked/);
    expect(hostedEndNote({ questions: [{}, {}] as never, phase: 'asking' })).toMatch(
      /^Question 2 is still open/,
    );
    expect(hostedEndNote({ questions: [{}] as never, phase: 'finished' })).toMatch(
      /^1 question asked/,
    );
  });
});

describe('the bank browser', () => {
  it('starts again at the first page and clears what no longer applies', () => {
    const q = { ...NO_BANK_FILTERS, topic: 'probability', subtopic: 'Dice', offset: 60 };
    expect(withFilter(q, { difficulty: 'easy' })).toEqual({
      topic: 'probability',
      subtopic: 'Dice',
      difficulty: 'easy',
      offset: 0,
    });
    expect(withFilter(q, { topic: 'options' })).toEqual({ topic: 'options', offset: 0 });
    expect(withFilter(q, { track: 'quant' })).toEqual({ track: 'quant', offset: 0 });
    expect(withFilter({ offset: 0, track: 'software' }, { track: 'software' })).toEqual({
      track: 'software',
      offset: 0,
    });
    expect(withFilter(q, { q: '' })).not.toHaveProperty('q');
    expect(filtersActive(NO_BANK_FILTERS)).toBe(false);
    expect(filtersActive({ offset: 0, q: '  ' })).toBe(false);
    expect(filtersActive({ offset: 0, type: 'output' })).toBe(true);
    // The track is a scope, not a filter to clear.
    expect(filtersActive({ offset: 0, track: 'quant' })).toBe(false);
  });

  it('builds the host’s search query', () => {
    // The server's track is a topic's home: the desk never sends one.
    expect(hostBankParams({ offset: 0, track: 'quant' })).toEqual({ limit: 30, offset: 0 });
    expect(hostBankParams({ offset: 30, q: ' dice ', type: 'numeric' })).toEqual({
      q: 'dice',
      type: 'numeric',
      limit: 30,
      offset: 30,
    });
  });

  it('reads the host’s page with its material and statuses', () => {
    const page: HostBankPage = {
      total: 1,
      limit: 30,
      offset: 0,
      items: [{ ...material(), status: 'queued' }],
      topics: [{ slug: 'probability', title: 'Probability', track: 'quant', questionCount: 1 }],
      subtopics: [],
    };
    const v = fromHostPage(page);
    expect(v.items[0]?.status).toBe('queued');
    expect(v.items[0]?.material?.solution).toBe('5/36');
    expect(v.items[0]?.question.topicTitle).toBe('Probability');
  });

  it('searches the public bank as the host’s search does', () => {
    const bank = (
      slug: string,
      title: string,
      track: 'quant' | 'fundamentals',
      ids: string[],
      also: ('software' | 'quant')[] = [],
    ) =>
      ({
        topic: { slug, title, description: '', track, also },
        items: QUESTIONS.filter((q) => ids.includes(q.id)).map((q) => ({
          question: publicOf(q),
          status: 'unanswered',
          score: null,
          answeredAt: null,
        })),
      }) as QuizBank;
    const banks = [
      bank('python', 'Python', 'fundamentals', ['q-output'], ['quant']),
      bank('probability', 'Probability', 'quant', ['q-single', 'q-numeric']),
      bank('options', 'Options', 'quant', ['q-multiple']),
      bank('cpp', 'C++', 'fundamentals', []),
    ];
    const all = searchPublicBank(banks, NO_BANK_FILTERS, ['q-numeric']);
    // Quant first, empty topics left out of the filter.
    expect(all.topics.map((t) => t.slug)).toEqual(['probability', 'options', 'python']);
    expect(all.items.map((i) => i.question.id)).toEqual([
      'q-single',
      'q-numeric',
      'q-multiple',
      'q-output',
    ]);
    expect(all.items.find((i) => i.question.id === 'q-numeric')?.status).toBe('queued');
    expect(all.items.every((i) => i.material === null)).toBe(true);
    // By site track: Python is shared into Quant, so it is under both, after Quant's own.
    expect(
      searchPublicBank(banks, { offset: 0, track: 'software' }, []).items.map((i) => i.question.id),
    ).toEqual(['q-output']);
    expect(
      searchPublicBank(banks, { offset: 0, track: 'quant' }, []).items.map((i) => i.question.id),
    ).toEqual(['q-single', 'q-numeric', 'q-multiple', 'q-output']);
    expect(topicsForTrack(all.topics, 'quant').map((t) => t.slug)).toEqual([
      'probability',
      'options',
      'python',
    ]);
    expect(topicsForTrack(all.topics, 'software').map((t) => t.slug)).toEqual(['python']);
    expect(topicsForTrack(all.topics, undefined)).toEqual(all.topics);
    expect(searchPublicBank(banks, { offset: 0, q: 'PARITY' }, []).items[0]?.question.id).toBe(
      'q-multiple',
    );
    expect(searchPublicBank(banks, { offset: 0, q: 'q-out' }, []).total).toBe(1);
    const topic = searchPublicBank(banks, { offset: 0, topic: 'probability' }, []);
    expect(topic.subtopics).toEqual(['Conditioning', 'Dice']);
    expect(searchPublicBank(banks, { offset: 0, type: 'single' }, []).total).toBe(1);
    const paged = searchPublicBank(banks, { offset: 2 }, [], 1);
    expect(paged.items.map((i) => i.question.id)).toEqual(['q-multiple']);
    expect(pageLabel(paged)).toBe('3–3 of 4');
    expect(pageLabel({ total: 0, offset: 0, items: [] })).toBe('No questions');
  });
});
