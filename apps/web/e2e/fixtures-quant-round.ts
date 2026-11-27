/**
 * Live quant round fixtures: the bank questions a round is assembled from (with the server-only
 * parts the report reveals: solutions, key points, explanations, hint counts), the picks per
 * path and length, and the interviewer's scripted lines. Kept apart from fixtures.ts; the mock
 * that plays a round is mock-quant-round.ts.
 */
import {
  QuantGame,
  type QuantPath,
  type QuantPick,
  type QuizDifficulty,
  quantGamePick,
} from '@ipp/contracts';
import { iso, QUIZ_TOPICS, uuid } from './fixtures';

/** A question in the bank, as the API reads it when the round is assembled and reported. */
export type BankQuestion = QuantPick & {
  subtopic: string;
  type: 'short' | 'numeric';
  solution: string;
  keyPoints: string[];
  explanation: string;
};

const q = (
  questionId: string,
  topic: string,
  subtopic: string,
  difficulty: QuizDifficulty,
  type: 'short' | 'numeric',
  prompt: string,
  rest: {
    unit?: string;
    hints: number;
    solution: string;
    keyPoints?: string[];
    explanation: string;
  },
): BankQuestion => ({
  questionId,
  topic,
  // Snapshotted when the round is assembled, as the API does.
  topicTitle: QUIZ_TOPICS.find((t) => t.slug === topic)?.title ?? topic,
  subtopic,
  difficulty,
  type,
  prompt,
  unit: rest.unit ?? null,
  hintsAvailable: rest.hints,
  solution: rest.solution,
  keyPoints: rest.keyPoints ?? [],
  explanation: rest.explanation,
});

export const ROUND_BANK: Record<string, BankQuestion> = Object.fromEntries(
  [
    q(
      'prob-dice-eight',
      'probability',
      'Dice and counting',
      'easy',
      'numeric',
      'Two fair six-sided dice are rolled. What is the probability that they add up to $8$?',
      {
        hints: 2,
        solution: '$\\frac{5}{36}$',
        explanation:
          'Of the $36$ equally likely outcomes, five add up to $8$: $(2,6), (3,5), (4,4), (5,3), (6,2)$. So $P = \\frac{5}{36} \\approx 0.139$.',
      },
    ),
    q(
      'teaser-ropes',
      'brainteasers',
      'Timing puzzles',
      'medium',
      'short',
      'You have two ropes. Each takes exactly $60$ minutes to burn, but unevenly, so half a rope does not take half the time. How do you measure exactly $45$ minutes?',
      {
        hints: 3,
        solution:
          'Light rope A at both ends and rope B at one end. When A burns out, $30$ minutes have passed; light the other end of B, which then burns out after $15$ more.',
        keyPoints: [
          'Lighting both ends halves the time, whatever the unevenness',
          'A burns out at $30$ minutes',
          'Lighting the second end of B then leaves $15$ minutes',
        ],
        explanation:
          'A rope lit at both ends burns out in half its time, $30$ minutes, because the two flames together cover its whole length. At that moment B has $30$ minutes of burning left; lit at its other end too, those take $15$ minutes. $30 + 15 = 45$.',
      },
    ),
    q(
      'mm-capped-doubling',
      'betting-market-making',
      'Fair value',
      'medium',
      'numeric',
      'A fair coin is flipped until the first head. If that takes $n$ flips you are paid $2^n$ dollars, capped at \\$64. What is the game worth?',
      {
        unit: 'dollars',
        hints: 3,
        solution: '$7$',
        explanation:
          'For $n \\le 6$ the payout $2^n$ comes with probability $2^{-n}$, so each of the six terms adds $1$. From $n = 7$ on the payout is $64$, with probability $P(n \\ge 7) = 2^{-6}$, which adds $1$ more:\n\n$$\nE = \\sum_{n=1}^{6} 2^{-n} \\cdot 2^n + 64 \\cdot 2^{-6} = 6 + 1 = 7.\n$$',
      },
    ),
    q(
      'opt-put-call-parity',
      'options',
      'Parity',
      'hard',
      'numeric',
      'A European call on a stock that pays no dividends trades at \\$6. The stock is at \\$100, the strike is \\$100 and the discount factor to expiry is $e^{-rT} = 0.95$. What is the put with the same strike and expiry worth?',
      {
        unit: 'dollars',
        hints: 2,
        solution: '$1$',
        explanation:
          'Put-call parity: $C - P = S - K e^{-rT}$, so $P = C - S + K e^{-rT} = 6 - 100 + 95 = 1$.',
      },
    ),
    q(
      'prob-wait-for-six',
      'probability',
      'Expectation',
      'medium',
      'numeric',
      'A fair die is rolled until a $6$ comes up. What is the expected number of rolls?',
      {
        hints: 2,
        solution: '$6$',
        explanation:
          'The number of rolls is geometric with $p = \\frac{1}{6}$, so $E[N] = \\frac{1}{p} = 6$. Or: $E = 1 + \\frac{5}{6} E$.',
      },
    ),
    q(
      'teaser-envelopes',
      'brainteasers',
      'Paradoxes',
      'hard',
      'short',
      'Two envelopes hold $x$ and $2x$. You open one and see \\$100. The argument "the other holds \\$50 or \\$200 with equal chance, so switching is worth \\$125" says you should always switch. Where is it wrong?',
      {
        hints: 3,
        solution:
          'The "equal chance" step assumes a uniform prior over every amount, which cannot exist. With any proper prior the chance of having the smaller envelope depends on what you see, and on average switching gains nothing.',
        keyPoints: [
          'The $\\frac{1}{2}$, $\\frac{1}{2}$ split is a claim about a prior',
          'No uniform prior exists over all amounts',
          'Before looking, both envelopes have the same expected value',
        ],
        explanation:
          'Conditioning on the amount seen needs a prior over $x$. The argument quietly uses one that is uniform over all of $\\mathbb{R}^+$, which is not a probability distribution. With a proper prior, $P(\\text{smaller} \\mid 100)$ is not $\\frac{1}{2}$ in general, and the paradox disappears.',
      },
    ),
    q(
      'stats-n-minus-one',
      'statistics',
      'Estimators',
      'medium',
      'short',
      'Why does the sample variance $s^2 = \\frac{1}{n-1}\\sum_i (x_i - \\bar{x})^2$ divide by $n - 1$ and not by $n$?',
      {
        hints: 2,
        solution:
          'Deviations are measured from $\\bar{x}$, which is fitted to the same data, so they are too small on average. Dividing by $n - 1$ makes $E[s^2] = \\sigma^2$.',
        keyPoints: [
          '$\\bar{x}$ minimises the sum of squared deviations',
          '$E\\left[\\sum (x_i - \\bar{x})^2\\right] = (n-1)\\sigma^2$',
          'One degree of freedom is used by estimating the mean',
        ],
        explanation:
          '$\\sum (x_i - \\bar{x})^2 = \\sum (x_i - \\mu)^2 - n(\\bar{x} - \\mu)^2$, whose expectation is $n\\sigma^2 - \\sigma^2 = (n-1)\\sigma^2$.',
      },
    ),
    q(
      'la-eigen-symmetric',
      'algebra-calculus',
      'Eigenvalues',
      'medium',
      'numeric',
      'What is the largest eigenvalue of $\\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}$?',
      {
        hints: 2,
        solution: '$3$',
        explanation:
          'The trace is $4$ and the determinant $3$, so the eigenvalues solve $\\lambda^2 - 4\\lambda + 3 = 0$: $\\lambda = 1$ and $\\lambda = 3$.',
      },
    ),
    q(
      'stats-uniform-mle',
      'statistics',
      'Estimators',
      'hard',
      'short',
      'You see $n$ draws from $\\mathrm{U}(0, \\theta)$. The maximum likelihood estimate of $\\theta$ is the largest draw. Is it biased, and how would you correct it?',
      {
        hints: 3,
        solution:
          'Yes, it is biased low: $E[\\max] = \\frac{n}{n+1}\\theta$. The estimator $\\frac{n+1}{n}\\max_i x_i$ is unbiased.',
        keyPoints: [
          'The maximum never exceeds $\\theta$',
          '$E[\\max] = \\frac{n}{n+1}\\theta$',
          'Scale by $\\frac{n+1}{n}$',
        ],
        explanation:
          '$P(\\max \\le t) = (t/\\theta)^n$, so the maximum has density $n t^{n-1}/\\theta^n$ and mean $\\frac{n}{n+1}\\theta$.',
      },
    ),
    // More quant questions, so a staged interview's questions stages have enough of each topic.
    q(
      'mm-two-dice-market',
      'betting-market-making',
      'Making markets',
      'easy',
      'numeric',
      'Make me a market on the sum of two fair dice. Where is the middle of your market?',
      {
        hints: 2,
        solution: '$7$',
        explanation:
          'Each die averages $3.5$, so the sum averages $E = 7$: centre the market there.',
      },
    ),
    q(
      'opt-straddle-move',
      'options',
      'Payoffs',
      'medium',
      'short',
      'You buy a straddle at strike \\$100 for \\$8. Where at expiry do you break even?',
      {
        hints: 2,
        solution: 'At \\$92 and \\$108: the move must cover the premium either way.',
        keyPoints: ['A straddle is a call plus a put', 'The premium is paid either way'],
        explanation:
          'The payoff is $|S - 100|$, so the position breaks even where $|S - 100| = 8$.',
      },
    ),
    q(
      'la-det-product',
      'algebra-calculus',
      'Determinants',
      'easy',
      'numeric',
      'If $\\det A = 2$ and $\\det B = 5$ for $3 \\times 3$ matrices, what is $\\det(AB)$?',
      {
        hints: 1,
        solution: '$10$',
        explanation:
          'The determinant is multiplicative: $\\det(AB) = \\det A \\cdot \\det B = 10$.',
      },
    ),
    // Fundamentals questions, for a staged interview's technical questions stages.
    q(
      'os-tlb-miss',
      'operating-systems',
      'Virtual memory',
      'medium',
      'short',
      'What does the TLB do, and what happens on a TLB miss?',
      {
        hints: 2,
        solution:
          'It caches recent virtual-to-physical translations. On a miss the page table is walked (by hardware or the kernel) and the entry is loaded.',
        keyPoints: [
          'Caches page table entries',
          'A miss walks the page table',
          'A page fault is different',
        ],
        explanation:
          'Every memory access needs a translation; the TLB keeps the recent ones so most accesses skip the page table walk.',
      },
    ),
    q(
      'os-fork-exec',
      'operating-systems',
      'Processes',
      'easy',
      'short',
      'Why does a shell call fork and then exec to run a command, rather than one call?',
      {
        hints: 2,
        solution:
          'fork copies the shell so the child can set up redirections and the environment; exec then replaces the child with the program.',
        keyPoints: [
          'fork duplicates the process',
          'The child adjusts its file descriptors',
          'exec replaces the image',
        ],
        explanation: 'Splitting the two lets the child change its own state between them.',
      },
    ),
    q(
      'conc-deadlock',
      'concurrency',
      'Deadlock',
      'medium',
      'short',
      'Two threads each take two locks and sometimes hang forever. What is happening, and how would you fix it?',
      {
        hints: 2,
        solution:
          'A deadlock: they take the locks in opposite orders. Take them in one global order.',
        keyPoints: ['Circular wait', 'A lock order breaks it', 'try-lock with back-off also works'],
        explanation:
          'Each thread holds one lock and waits for the other; a fixed order makes the cycle impossible.',
      },
    ),
    q(
      'net-tcp-handshake',
      'networking',
      'TCP',
      'easy',
      'short',
      'Walk me through the TCP handshake. Why three messages and not two?',
      {
        hints: 2,
        solution: 'SYN, SYN-ACK, ACK: each side must have its own sequence number acknowledged.',
        keyPoints: ['Both directions are set up', 'Each initial sequence number is acknowledged'],
        explanation: 'Two messages would confirm only one direction of the connection.',
      },
    ),
    q(
      'arch-false-sharing',
      'computer-architecture',
      'Caches',
      'hard',
      'short',
      'Two threads update two different counters and the program is slower than with one thread. Why?',
      {
        hints: 2,
        solution:
          'False sharing: the counters sit on one cache line, which bounces between the cores.',
        keyPoints: ['Coherence works per cache line', 'Pad or align the counters apart'],
        explanation:
          'Each write invalidates the line in the other core, so the two never stay cached.',
      },
    ),
    q(
      'cpp-raii',
      'cpp',
      'Resource management',
      'easy',
      'short',
      'What is RAII, and why does it make exception-safe code easier in C++?',
      {
        hints: 2,
        solution:
          'A resource is owned by an object whose destructor releases it, so it is released on every path out of the scope, exceptions included.',
        keyPoints: [
          'Acquire in the constructor',
          'Release in the destructor',
          'Stack unwinding runs destructors',
        ],
        explanation: 'Destructors run during unwinding, so cleanup needs no try/finally.',
      },
    ),
    q(
      'py-gil',
      'python',
      'Concurrency',
      'medium',
      'short',
      'Why do Python threads rarely speed up CPU-bound work, and what would you use instead?',
      {
        hints: 2,
        solution:
          'The GIL lets one thread run Python bytecode at a time. Use processes (multiprocessing) or native code that releases the GIL.',
        keyPoints: [
          'The GIL serialises bytecode',
          'Threads still help with I/O',
          'Processes run in parallel',
        ],
        explanation: 'Only one thread holds the interpreter lock, so CPU-bound threads take turns.',
      },
    ),
  ].map((x) => [x.questionId, x]),
);

/** The questions a round asks, in order, by path and number of questions (3, 4 or 6). */
const PICKS: Record<QuantPath, Record<number, string[]>> = {
  trader: {
    3: ['prob-dice-eight', 'teaser-ropes', 'opt-put-call-parity'],
    4: ['prob-dice-eight', 'teaser-ropes', 'mm-capped-doubling', 'opt-put-call-parity'],
    6: [
      'prob-dice-eight',
      'teaser-ropes',
      'mm-capped-doubling',
      'prob-wait-for-six',
      'opt-put-call-parity',
      'teaser-envelopes',
    ],
  },
  researcher: {
    3: ['prob-dice-eight', 'stats-n-minus-one', 'stats-uniform-mle'],
    4: ['prob-dice-eight', 'stats-n-minus-one', 'la-eigen-symmetric', 'opt-put-call-parity'],
    6: [
      'prob-dice-eight',
      'stats-n-minus-one',
      'la-eigen-symmetric',
      'prob-wait-for-six',
      'opt-put-call-parity',
      'stats-uniform-mle',
    ],
  },
};

export function roundPicks(path: QuantPath, count: number, game = false): QuantPick[] {
  const ids = PICKS[path][count] ?? PICKS[path][4] ?? [];
  const picks: QuantPick[] = ids.map((id) => {
    const b = ROUND_BANK[id];
    if (!b) throw new Error(`no bank question ${id}`);
    return b;
  });
  // As the API's assembler: the game takes the second slot (§8.3).
  if (game) picks[1] = gamePick();
  return picks;
}

// ---------------------------------------------------------------- the market-making game

/** packages/content/games/mm-game-dice-sum.yaml, as the seed loads it (the explanation shortened). */
export const DICE_SUM_GAME: QuantGame = QuantGame.parse({
  id: 'mm-game-dice-sum',
  topic: 'betting-market-making',
  title: 'Sum of three dice',
  difficulty: 'easy',
  prompt:
    'Three fair six-sided dice have been rolled where neither of us can see them. A contract settles at their sum, $D_1 + D_2 + D_3$.\n\nMake me a two-sided market on it: a bid, an offer and a size of up to 5 contracts, in steps of 0.5. I may buy from you, sell to you, or ask for another market. As we go I will show you some of the dice, one at a time; each time your market is withdrawn and you make a new one. At the end every die is shown and the contract settles.',
  components: [1, 2, 3].map((i) => ({ label: `Die ${i}`, faces: [1, 2, 3, 4, 5, 6] })),
  payoff: 'sum',
  reveal: [0, 1],
  tick: 0.5,
  maxSize: 5,
  counterparty: 'Trade on the public fair value; reveal a die after a trade.',
  hints: [
    'What is the expected value of one die, and of three?',
    'Against someone who knows no more than you, what does each trade earn you on average?',
    'Once a die is shown, only the other two are still random. What is the new expected sum?',
  ],
  explanation:
    'Before anything is shown the fair value is $3 \\times 3.5 = 10.5$, with standard deviation $\\sqrt{3 \\times 35/12} \\approx 2.96$. A market such as 9.5 at 11.5 earns 1 per contract against an uninformed counterparty.\n\nWhen Die 1 shows $d$, the fair value becomes $d + 7$: move the mid by $d - 3.5$ at once. In the last stage the counterparty knows the answer, so its trades measure adverse selection rather than skill.',
  expect: { fair: '10.5', sd: 2.958, min: '3', max: '18' },
});

/** The game's content by id, as the API's report reads `quant_games`. */
export const ROUND_GAMES: Record<string, QuantGame> = { [DICE_SUM_GAME.id]: DICE_SUM_GAME };

/** The dice the mock always draws: Die 1 = 6, Die 2 = 2, Die 3 = 5, so the contract is worth 13. */
export const GAME_VALUES = [6, 2, 5];

/** The game's slot, drawn through the contract's `quantGamePick` (a "PRNG" that gives the dice). */
export function gamePick(): QuantPick {
  let i = 0;
  const rand = () => ((GAME_VALUES[i++] ?? 1) - 1) / 6 + 0.01;
  const topicTitle = QUIZ_TOPICS.find((t) => t.slug === DICE_SUM_GAME.topic)?.title ?? '';
  return quantGamePick(DICE_SUM_GAME, topicTitle, rand);
}

/** A round in progress whose second question, the game, has just been posed. */
export const QUANT_GAME_PAD_ID = uuid(1203);
/** A round with a game, played and ended a day ago, for the report. */
export const QUANT_GAME_ENDED_PAD_ID = uuid(1204);
export const QUANT_GAME_ENDED_STARTED_AT = iso(-86400 + 1800);

/** What the scripted interviewer says in a game. */
export const GAME_LINES = {
  tighten: "That's a bit wide for me. Can you tighten it up?",
  /**
   * The interviewer's side, as the platform states it before the model's words (`tradeLine` in
   * packages/interviewer/src/quant/game.ts): "I buy 2 at your offer of 11.5."
   */
  trade: (side: 'buy' | 'sell', quantity: number, price: string) =>
    `I ${side} ${quantity} at your ${side === 'buy' ? 'offer' : 'bid'} of ${price}.`,
  again: 'Make me a new market.',
  /** `revealLine`: "Die 1 shows 6." */
  shown: (label: string, value: number) => `${label} shows ${value}.`,
  withdrawn: 'Your market is withdrawn; make me a new one.',
  nothingLeft: 'Nothing more is shown before the end.',
} as const;

/** A round in progress (the dashboard lists it; screens open it). */
export const QUANT_PAD_ID = uuid(1201);
/** A round that finished and ended two days ago, with its report. */
export const QUANT_ENDED_PAD_ID = uuid(1202);
/** Its fixed start, as the playback's. */
export const QUANT_ENDED_STARTED_AT = iso(-86400 * 2 + 3600);

/** What the scripted interviewer says (mock-quant-round.ts), with math where a real one would. */
export const LINES = {
  greeting:
    "Hi Ada, thanks for joining. We'll go through a few quant questions; think out loud as much as you like, and use the scratchpad for working. Here's the first one.",
  stay: 'Good. What are you conditioning on, and is $P(A \\mid B)$ the quantity you want?',
  hint: 'A nudge: count the outcomes rather than the sums. How many of the $36$ give you $8$?',
  ownHint: 'Try writing the expectation as $E = \\sum_n p_n x_n$ and see which terms you know.',
  followUp: 'And how would the answer change if one of the dice were weighted towards $6$?',
  nudge: "That's about the time for this one. Where have you got to?",
  close: 'Right, $\\frac{5}{36}$ is it. Let’s move on to the next one.',
  closeNoVerdict: "Let's leave that one there and move on.",
  timeout: "We're over time on this one, so let's move on.",
  wrapUp:
    "That's the last question. Thanks, that was a good round. End the pad when you are ready and the report will score each answer.",
} as const;

/** The verdicts the scripted interviewer and the mock's assessment give. */
export const VERDICTS = {
  good: {
    score: 0.85,
    summary:
      'Counted the five outcomes $(2,6), \\dots, (6,2)$ directly and gave $\\frac{5}{36}$ without help.',
  },
  partial: {
    score: 0.45,
    summary: 'Found the right idea but did not finish the calculation in time.',
  },
  weak: {
    score: 0.2,
    summary: 'The approach was not yet set up when the round moved on.',
  },
} as const;
