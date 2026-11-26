export const QUIZ_TOPIC = {
  slug: 'test-topic',
  title: 'Test topic',
  description: 'Questions for the API tests',
  track: 'fundamentals' as const,
  also: [],
};

const base = { topic: 'test-topic', subtopic: 'basics', difficulty: 'easy', tags: [] };

export const QUIZ_FIXTURE = [
  {
    ...base,
    id: 'tq-single',
    type: 'single',
    prompt: 'Pick b',
    explanation: 'EXPLAIN-SINGLE',
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answer: 'b',
  },
  {
    ...base,
    id: 'tq-multiple',
    type: 'multiple',
    prompt: 'Pick a and c',
    explanation: 'EXPLAIN-MULTIPLE',
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ],
    answer: ['a', 'c'],
  },
  {
    ...base,
    id: 'tq-output',
    type: 'output',
    prompt: 'What does it print?',
    explanation: 'EXPLAIN-OUTPUT',
    language: 'cpp',
    standard: 'C++20',
    code: '#include <cstdio>\nint main() { std::puts("1 2\\n3"); }',
    answer: { kind: 'output', output: '1 2\n3' },
  },
  {
    ...base,
    id: 'tq-short',
    type: 'short',
    prompt: 'Explain RAII',
    explanation: 'EXPLAIN-SHORT',
    reference: 'REFERENCE-SHORT',
    keyPoints: ['destructor releases'],
  },
];
