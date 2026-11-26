/**
 * Quant room fixtures (ARCHITECTURE §8.4): the bank a quant room's host searches, as the API
 * stores it (`QuizQuestion`, answers and interviewer material included), with every type of
 * question; the AI's second opinion; and ids. The mock that runs a room is mock-quant-room.ts.
 *
 * The same questions are the public question bank in the quant-room specs (`useRoomBank`), so the
 * queue built before the room exists names questions the room's bank knows.
 */
import {
  type PadMember,
  type PublicQuizQuestion,
  type QuantSecondOpinion,
  QuizQuestion,
} from '@ipp/contracts';
import { GUEST, OTHER_USER, QUIZ_TOPICS, USER, uuid } from './fixtures';

export const QROOM_PAD_ID = uuid(1301);
export const QROOM_TOKEN = 'qroom_P3vX7aLm';
/** An ended quant room with its report. */
export const QROOM_ENDED_PAD_ID = uuid(1302);
/** An ended quant room in which nothing happened. */
export const QROOM_EMPTY_PAD_ID = uuid(1303);

export const QROOM_HOST: PadMember = {
  userId: USER.id,
  name: USER.name,
  role: 'owner',
  guest: false,
};
export const QROOM_GUEST: PadMember = {
  userId: GUEST.id,
  name: GUEST.name,
  role: 'collaborator',
  guest: true,
};
/** The host when the signed-in user is the candidate. */
export const QROOM_OTHER_HOST: PadMember = {
  userId: OTHER_USER.id,
  name: OTHER_USER.name,
  role: 'owner',
  guest: false,
};

export const topicTitle = (slug: string) => QUIZ_TOPICS.find((t) => t.slug === slug)?.title ?? slug;

/** The bank, in the API's order for the host's search: quant first, then study order. */
export const ROOM_BANK: QuizQuestion[] = QuizQuestion.array().parse([
  {
    id: 'rb-prob-dice-eight',
    topic: 'probability',
    subtopic: 'Dice and counting',
    difficulty: 'easy',
    type: 'numeric',
    prompt: 'Two fair six-sided dice are rolled. What is the probability that they add up to $8$?',
    answer: '5/36',
    answerText: '$\\frac{5}{36} \\approx 0.139$',
    explanation:
      'Of the $36$ equally likely outcomes, five add up to $8$: $(2,6), (3,5), (4,4), (5,3), (6,2)$.',
    hints: [
      'How many outcomes are there in all?',
      'List the pairs that add up to $8$, in order.',
      'There are five of them.',
    ],
    followUps: ['And for a sum of $7$? Why is it the most likely sum?'],
  },
  {
    id: 'rb-prob-two-children',
    topic: 'probability',
    subtopic: 'Conditioning',
    difficulty: 'medium',
    type: 'single',
    prompt:
      'A family has two children, and at least one of them is a boy. What is the probability that both are boys?',
    choices: [
      { id: 'a', text: '$\\frac{1}{4}$' },
      { id: 'b', text: '$\\frac{1}{3}$' },
      { id: 'c', text: '$\\frac{1}{2}$' },
      { id: 'd', text: '$\\frac{2}{3}$' },
    ],
    answer: 'b',
    explanation:
      'Of the four equally likely families BB, BG, GB, GG, three have a boy, and one of those is BB.',
  },
  {
    id: 'rb-prob-wait-six',
    topic: 'probability',
    subtopic: 'Expectation',
    difficulty: 'medium',
    type: 'numeric',
    prompt: 'A fair die is rolled until a $6$ comes up. What is the expected number of rolls?',
    answer: '6',
    unit: 'rolls',
    explanation: 'The number of rolls is geometric with $p = \\frac{1}{6}$, so $E[N] = 6$.',
    hints: ['What is the chance of stopping on any one roll?'],
    followUps: [],
  },
  {
    id: 'rb-teaser-ropes',
    topic: 'brainteasers',
    subtopic: 'Timing puzzles',
    difficulty: 'medium',
    type: 'short',
    prompt:
      'You have two ropes. Each takes exactly $60$ minutes to burn, but unevenly. How do you measure exactly $45$ minutes?',
    reference:
      'Light rope A at both ends and rope B at one end. When A burns out after $30$ minutes, light the other end of B: it burns out $15$ minutes later.',
    keyPoints: [
      'Lighting both ends halves the time, whatever the unevenness',
      'A burns out at $30$ minutes',
      'Lighting the second end of B then leaves $15$ minutes',
    ],
    explanation:
      'A rope lit at both ends burns out in half its time, because the two flames together cover its whole length.',
    hints: [
      'What happens if you light one rope at both ends?',
      'You can light the two ropes at different times.',
      'When the first rope burns out, how much of the second is left?',
    ],
    followUps: [
      'How would you measure $15$ minutes with one rope?',
      'And $40$ minutes with three?',
    ],
  },
  {
    id: 'rb-mm-capped-doubling',
    topic: 'betting-market-making',
    subtopic: 'Fair value',
    difficulty: 'hard',
    type: 'numeric',
    prompt:
      'A fair coin is flipped until the first head. If that takes $n$ flips you are paid $2^n$ dollars, capped at \\$64. What is the game worth?',
    answer: '7',
    unit: 'dollars',
    tolerance: { abs: 0.01 },
    explanation:
      'For $n \\le 6$ each term adds $1$; from $n = 7$ on the payout is $64$ with probability $2^{-6}$, which adds $1$ more: $E = 7$.',
    hints: ['Write the expectation as a sum over $n$.', 'Split it at $n = 6$.'],
    followUps: ['What would you pay to play it without the cap?'],
  },
  {
    id: 'rb-opt-parity-holds',
    topic: 'options',
    subtopic: 'Parity',
    difficulty: 'medium',
    type: 'multiple',
    prompt: 'Which of these does put-call parity need?',
    choices: [
      { id: 'a', text: 'European exercise' },
      { id: 'b', text: 'The same strike and expiry for the call and the put' },
      { id: 'c', text: 'A lognormal stock price' },
      { id: 'd', text: 'No arbitrage' },
    ],
    answer: ['a', 'b', 'd'],
    explanation:
      'Parity is a static replication: it needs no model of the price, only European options on the same strike and expiry and the absence of arbitrage.',
  },
  {
    id: 'rb-stats-n-minus-one',
    topic: 'statistics',
    subtopic: 'Estimators',
    difficulty: 'medium',
    type: 'short',
    prompt: 'Why does the sample variance divide by $n - 1$ and not by $n$?',
    reference:
      'Deviations are measured from $\\bar{x}$, fitted to the same data, so they are too small on average. Dividing by $n - 1$ makes $E[s^2] = \\sigma^2$.',
    keyPoints: [
      '$\\bar{x}$ minimises the sum of squared deviations',
      '$E\\left[\\sum (x_i - \\bar{x})^2\\right] = (n-1)\\sigma^2$',
    ],
    explanation: 'One degree of freedom is used by estimating the mean.',
    hints: ['Measured from $\\bar{x}$, are the deviations larger or smaller than from $\\mu$?'],
    followUps: ['Is $s$ then an unbiased estimate of $\\sigma$?'],
  },
  {
    id: 'rb-la-eigen-symmetric',
    topic: 'algebra-calculus',
    subtopic: 'Eigenvalues',
    difficulty: 'easy',
    type: 'numeric',
    prompt: 'What is the largest eigenvalue of $\\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}$?',
    answer: '3',
    explanation: 'The trace is $4$ and the determinant $3$, so the eigenvalues are $1$ and $3$.',
    hints: [],
    followUps: [],
  },
  {
    id: 'rb-cpp-vector-reserve',
    topic: 'cpp',
    subtopic: 'Containers',
    difficulty: 'medium',
    type: 'output',
    prompt: 'What does this program print?',
    language: 'cpp',
    standard: 'C++20',
    code: '#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> v;\n    v.reserve(10);\n    std::cout << v.size() << "\\n";\n}\n',
    answer: { kind: 'output', output: '0' },
    explanation: '`reserve` changes the capacity, never the size.',
  },
  {
    id: 'rb-py-default-list',
    topic: 'python',
    subtopic: 'Functions',
    difficulty: 'medium',
    type: 'output',
    prompt: 'What does this program print?',
    language: 'python',
    standard: 'Python 3.12',
    code: 'def add(x, xs=[]):\n    xs.append(x)\n    return xs\n\nadd(1)\nprint(add(2))\n',
    answer: { kind: 'output', output: '[1, 2]' },
    explanation:
      'The default list is created once, when the function is defined, and shared by every call.',
  },
  {
    id: 'rb-os-fork-child',
    topic: 'operating-systems',
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
    answer: 'a',
    explanation: 'The parent gets the child’s PID; the child gets 0.',
  },
]);

export const ROOM_BANK_BY_ID = new Map(ROOM_BANK.map((q) => [q.id, q]));

/** The public projection of a bank question, as `GET /api/quiz/topics/:slug/questions` serves it. */
export function publicOf(q: QuizQuestion): PublicQuizQuestion {
  return {
    id: q.id,
    topic: q.topic,
    subtopic: q.subtopic,
    difficulty: q.difficulty,
    type: q.type,
    prompt: q.prompt,
    choices:
      q.type === 'single' || q.type === 'multiple'
        ? q.choices.map((c) => ({ id: c.id, text: c.text }))
        : null,
    code:
      q.type === 'output' ? { language: q.language, standard: q.standard, source: q.code } : null,
    unit: q.type === 'numeric' ? (q.unit ?? null) : null,
  };
}

/** The AI's second opinion the mock returns, on the question it was asked about. */
export function makeQuantOpinion(index: number, question?: string): QuantSecondOpinion {
  return {
    index,
    verdict: 'partly_correct',
    summary:
      'Casey has the right sample space, $36$ outcomes, but counted $(4,4)$ twice and said $\\frac{6}{36}$.',
    covered: ['Counted ordered pairs', 'Saw that the outcomes are equally likely'],
    missing: ['Counted $(4,4)$ twice', 'Did not check the answer against the sum of $7$'],
    followUps: ['How many ordered pairs give a sum of $8$ if you list them one by one?'],
    suggestedScore: 0.55,
    answer: question ? 'No: $(4,4)$ is a single outcome, so it is counted once.' : null,
    model: 'claude-opus-5-5',
    createdAt: new Date().toISOString(),
  };
}
