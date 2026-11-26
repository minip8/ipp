/**
 * Quant-track fixtures: one topic (probability) whose questions are mostly numeric, with inline
 * and display math in prompts, choices and explanations. Numeric answers are graded with the
 * contract's own `numericMatches`, as the API grades them. Kept apart from fixtures.ts, which
 * imports from here (never the other way round).
 */
import {
  AnswerFeedback,
  type NumericToleranceSpec,
  numericMatches,
  PublicQuizQuestion,
  parseNumeric,
  type QuizResponse,
} from '@ipp/contracts';

export const QUANT_TOPIC = 'probability';

/** What the mock interviewer asks after the first reply in a probability discussion. */
export const QUANT_FOLLOW_UP =
  'And if you only learn that the **older** child is a boy, what is $P(\\text{both boys})$ then?';

/** In the order the API returns a bank: by subtopic, then easy to hard. */
export const QUANT_QUESTIONS = PublicQuizQuestion.array().parse([
  {
    id: 'prob-derangements',
    topic: QUANT_TOPIC,
    subtopic: 'Classic puzzles',
    difficulty: 'medium',
    type: 'numeric',
    prompt:
      '$n$ people check their hats and get them back in a random order. As $n \\to \\infty$, what does the probability that **nobody** gets their own hat back tend to?',
    choices: null,
    code: null,
    unit: null,
  },
  {
    id: 'prob-two-children',
    topic: QUANT_TOPIC,
    subtopic: 'Classic puzzles',
    difficulty: 'medium',
    type: 'short',
    prompt:
      'A family has two children and at least one of them is a boy. Explain why the probability that both are boys is $\\frac{1}{3}$ and not $\\frac{1}{2}$.',
    choices: null,
    code: null,
  },
  {
    id: 'prob-dice-sum',
    topic: QUANT_TOPIC,
    subtopic: 'Dice and counting',
    difficulty: 'easy',
    type: 'numeric',
    prompt: 'Two fair six-sided dice are rolled. What is the probability that they add up to $8$?',
    choices: null,
    code: null,
    unit: null,
  },
  {
    id: 'prob-binomial-variance',
    topic: QUANT_TOPIC,
    subtopic: 'Distributions',
    difficulty: 'easy',
    type: 'single',
    prompt: 'If $X \\sim \\mathrm{Bin}(n, p)$, what is $\\operatorname{Var}(X)$?',
    choices: [
      { id: 'a', text: '$np$' },
      { id: 'b', text: '$np(1-p)$' },
      { id: 'c', text: '$\\sqrt{np(1-p)}$' },
      { id: 'd', text: '$n^2 p(1-p)$' },
    ],
    code: null,
  },
  {
    id: 'prob-uniform-sum',
    topic: QUANT_TOPIC,
    subtopic: 'Distributions',
    difficulty: 'medium',
    type: 'numeric',
    prompt:
      '$X$ and $Y$ are independent and uniform on $[0, 1]$. Find\n\n$$\nP\\left(X + Y > \\tfrac{3}{2}\\right).\n$$',
    choices: null,
    code: null,
    unit: null,
  },
  {
    id: 'prob-first-six',
    topic: QUANT_TOPIC,
    subtopic: 'Expectation',
    difficulty: 'easy',
    type: 'numeric',
    prompt: 'A fair die is rolled until the first six. How many rolls does that take on average?',
    choices: null,
    code: null,
    unit: 'rolls',
  },
]);

const auto = (
  questionId: string,
  correct: boolean,
  correctAnswer: AnswerFeedback['correctAnswer'],
  explanation: string,
) =>
  AnswerFeedback.parse({
    questionId,
    score: correct ? 1 : 0,
    correct,
    correctAnswer,
    explanation,
    feedback: null,
    gradedBy: 'auto',
    needsSelfGrade: false,
  });

/** Graded like the API: `numericMatches` against the exact answer (and its tolerance). */
function numeric(
  questionId: string,
  answer: string,
  explanation: string,
  opts: { answerText?: string; tolerance?: NumericToleranceSpec } = {},
) {
  const expected = parseNumeric(answer);
  if (!expected) throw new Error(`fixture answer is not a number: ${answer}`);
  return (r: QuizResponse) => {
    const given = r.type === 'numeric' ? parseNumeric(r.value) : null;
    const ok = given !== null && numericMatches(expected, given, opts.tolerance);
    return auto(questionId, ok, opts.answerText ?? answer, explanation);
  };
}

export const QUANT_FEEDBACK: Record<string, (r: QuizResponse) => AnswerFeedback> = {
  'prob-derangements': numeric(
    'prob-derangements',
    '0.367879',
    [
      'By inclusion–exclusion over the people who do get their own hat back,',
      '',
      '$$',
      'P(\\text{nobody}) = \\sum_{k=0}^{n} \\frac{(-1)^k}{k!} = 1 - 1 + \\frac{1}{2!} - \\frac{1}{3!} + \\frac{1}{4!} - \\frac{1}{5!} + \\cdots + \\frac{(-1)^n}{n!} \\longrightarrow e^{-1}',
      '$$',
      '',
      'The series settles fast: with $n = 5$ people it is already $0.3667$.',
    ].join('\n'),
    { answerText: '$1/e \\approx 0.368$' },
  ),
  'prob-two-children': (r) =>
    AnswerFeedback.parse({
      questionId: 'prob-two-children',
      score: r.type === 'short' && r.text.length > 40 ? 0.75 : 0.25,
      correct: r.type === 'short' && r.text.length > 40,
      correctAnswer:
        'Of the four equally likely families $BB, BG, GB, GG$, "at least one boy" rules out only $GG$. Both are boys in one of the three that remain: $\\frac{1}{3}$.',
      explanation:
        'Conditioning on "at least one boy" is not the same as learning about one particular child: $P(BB \\mid \\text{older is a boy}) = \\frac{1}{2}$.',
      feedback:
        'Covered: listing the four families. Missed: why $GG$ is the only one ruled out, which gives $\\frac{1}{3}$.',
      gradedBy: 'ai',
      needsSelfGrade: false,
    }),
  'prob-dice-sum': numeric(
    'prob-dice-sum',
    '5/36',
    'There are $6 \\times 6 = 36$ equally likely outcomes, and five of them add up to $8$: $(2,6), (3,5), (4,4), (5,3), (6,2)$. So\n\n$$\nP(\\text{sum} = 8) = \\frac{5}{36} \\approx 0.139.\n$$',
  ),
  'prob-binomial-variance': (r) =>
    auto(
      'prob-binomial-variance',
      r.type === 'single' && r.choice === 'b',
      'b',
      '$X$ is a sum of $n$ independent Bernoulli($p$) variables, each with variance $p(1-p)$, and the variances of independent variables add.',
    ),
  'prob-uniform-sum': numeric(
    'prob-uniform-sum',
    '1/8',
    'The region $x + y > \\frac{3}{2}$ is a triangle in the corner of the unit square with legs of $\\frac{1}{2}$, so its area is $\\frac{1}{2} \\cdot \\frac{1}{2} \\cdot \\frac{1}{2} = \\frac{1}{8}$, or $12.5\\%$.',
  ),
  'prob-first-six': numeric(
    'prob-first-six',
    '6',
    'The number of rolls $N$ is geometric with $p = \\frac{1}{6}$:\n\n$$\n\\mathbb{E}[N] = \\sum_{n \\ge 1} n (1 - p)^{n-1} p = \\frac{1}{p} = 6.\n$$',
  ),
};
