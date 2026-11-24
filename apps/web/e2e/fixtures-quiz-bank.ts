/**
 * Question-bank fixtures (GET /api/quiz/topics/:slug/questions and friends), kept apart from
 * fixtures.ts. One topic, in the order the API returns it: by subtopic, then easy to hard.
 */
import { AnswerFeedback, PublicQuizQuestion, type QuizResponse } from '@ipp/contracts';
import { iso, QUIZ_FEEDBACK, QUIZ_QUESTIONS } from './fixtures';

export const QUIZ_BANK_TOPIC = 'operating-systems';

const fromAttempt = (id: string) => {
  const q = QUIZ_QUESTIONS.find((x) => x.id === id);
  if (!q) throw new Error(`no fixture question ${id}`);
  return { ...q, topic: QUIZ_BANK_TOPIC };
};

export const QUIZ_BANK_QUESTIONS = PublicQuizQuestion.array().parse([
  {
    id: 'os-processes-001',
    topic: QUIZ_BANK_TOPIC,
    subtopic: 'Processes',
    difficulty: 'easy',
    type: 'single',
    prompt: 'What does `fork()` return in the **child** process?',
    choices: [
      { id: 'a', text: '`0`' },
      { id: 'b', text: "The child's PID" },
      { id: 'c', text: "The parent's PID" },
      { id: 'd', text: '`-1`' },
    ],
    code: null,
  },
  {
    id: 'os-processes-004',
    topic: QUIZ_BANK_TOPIC,
    subtopic: 'Processes',
    difficulty: 'medium',
    type: 'short',
    prompt: 'What does a thread share with the other threads of its process, and what is its own?',
    choices: null,
    code: null,
  },
  {
    id: 'os-processes-007',
    topic: QUIZ_BANK_TOPIC,
    subtopic: 'Processes',
    difficulty: 'hard',
    type: 'output',
    prompt: 'What does this program print? Assume `fork()` succeeds.',
    choices: null,
    code: {
      language: 'cpp',
      standard: 'C++20',
      source:
        '#include <cstdio>\n#include <unistd.h>\n\nint main() {\n    fork();\n    std::puts("x");\n}',
    },
  },
  { ...fromAttempt('concurrency-primitives-004'), subtopic: 'Synchronisation' },
  {
    id: 'os-virtual-memory-001',
    topic: QUIZ_BANK_TOPIC,
    subtopic: 'Virtual memory',
    difficulty: 'easy',
    type: 'single',
    prompt: 'Which hardware structure caches recent virtual-to-physical translations?',
    choices: [
      { id: 'a', text: 'The page table' },
      { id: 'b', text: 'The TLB' },
      { id: 'c', text: 'The L1 data cache' },
      { id: 'd', text: 'The swap area' },
    ],
    code: null,
  },
  fromAttempt('os-virtual-memory-002'),
]);

const auto = (
  questionId: string,
  correct: boolean,
  correctAnswer: AnswerFeedback['correctAnswer'],
  explanation: string,
  score = correct ? 1 : 0,
) =>
  AnswerFeedback.parse({
    questionId,
    score,
    correct,
    correctAnswer,
    explanation,
    feedback: null,
    gradedBy: 'auto',
    needsSelfGrade: false,
  });

/** How the mock grades each bank question (same shape as QUIZ_FEEDBACK). */
export const QUIZ_BANK_FEEDBACK: Record<string, (r: QuizResponse) => AnswerFeedback> = {
  'os-processes-001': (r) =>
    auto(
      'os-processes-001',
      r.type === 'single' && r.choice === 'a',
      'a',
      '`fork()` returns twice: `0` in the child and the child’s PID in the parent (or `-1` in the parent if it fails).',
    ),
  'os-processes-004': (r) =>
    AnswerFeedback.parse({
      questionId: 'os-processes-004',
      score: r.type === 'short' && r.text.length > 40 ? 0.8 : 0.3,
      correct: r.type === 'short' && r.text.length > 40,
      correctAnswer:
        'Threads share the address space (code, heap, globals), open files and signal handlers; each has its own stack, registers, program counter and thread-local storage.',
      explanation: 'The kernel schedules threads; the process is the unit of resource ownership.',
      feedback: 'Covered: shared address space and own stack. Missed: registers and TLS.',
      gradedBy: 'ai',
      needsSelfGrade: false,
    }),
  'os-processes-007': (r) =>
    auto(
      'os-processes-007',
      r.type === 'output' &&
        r.answer.kind === 'output' &&
        r.answer.output.replace(/\s+/g, ' ').trim() === 'x x',
      { kind: 'output', output: 'x\nx' },
      'After `fork()` both the parent and the child run the rest of `main`, so `x` is printed twice.',
    ),
  'concurrency-primitives-004': (r) => {
    const f = QUIZ_FEEDBACK['concurrency-primitives-004'];
    if (!f) throw new Error('missing feedback fixture');
    return f(r);
  },
  'os-virtual-memory-001': (r) =>
    auto(
      'os-virtual-memory-001',
      r.type === 'single' && r.choice === 'b',
      'b',
      'The **TLB** (translation lookaside buffer) caches page-table entries so most accesses skip the page walk.',
    ),
  'os-virtual-memory-002': (r) => {
    const f = QUIZ_FEEDBACK['os-virtual-memory-002'];
    if (!f) throw new Error('missing feedback fixture');
    return f(r);
  },
};

/** What the signed-in user already answered: one right, one partly, one wrong. */
export const QUIZ_BANK_PRIOR: Record<string, { response: QuizResponse; at: string }> = {
  'os-processes-001': {
    response: { type: 'single', choice: 'a' },
    at: iso(-86400 * 2),
  },
  'concurrency-primitives-004': {
    response: { type: 'multiple', choices: ['a'] },
    at: iso(-86400),
  },
  'os-virtual-memory-001': {
    response: { type: 'single', choice: 'a' },
    at: iso(-3600),
  },
};
