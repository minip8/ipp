/**
 * Contract-valid fixtures for browser tests. Every object is parsed with its @ipp/contracts
 * schema on creation, so a contract change that breaks these fails loudly here.
 */
import {
  AiKeyStatus,
  AiModelList,
  type AiProvider,
  AnswerFeedback,
  type HostView,
  type Language,
  Message,
  Pad,
  PadDetail,
  type PadMember,
  PadSummary,
  Playback,
  ProblemContent,
  ProblemDetail,
  ProblemSummary,
  problemScaffolds,
  QuizAttempt,
  QuizAttemptSummary,
  type QuizResponse,
  QuizTopicStats,
  Report,
  Run,
  SolutionReview,
  YDOC,
} from '@ipp/contracts';
import boxJson from '@ipp/contracts/fixtures/problem-box-cpp.json' with { type: 'json' };
import lruJson from '@ipp/contracts/fixtures/problem-lru-cache.json' with { type: 'json' };
import twoSumJson from '@ipp/contracts/fixtures/problem-two-sum.json' with { type: 'json' };
import * as Y from 'yjs';

export const USER = { id: 'user_ada', name: 'Ada Lovelace', email: 'ada@example.com', image: null };
export const OTHER_USER = {
  id: 'user_grace',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  image: null,
};

const T0 = Date.parse('2026-11-20T15:00:00.000Z');
export const iso = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();
let uuidCounter = 0;
/** Deterministic UUIDs (valid v4 layout) so screenshots are stable. */
export function uuid(seed?: number): string {
  const n = seed ?? ++uuidCounter;
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

// ---------- problems ----------

const twoSumContent = ProblemContent.parse({
  ...twoSumJson,
  statement: `Given an array of integers \`nums\` and an integer \`target\`, return the indices of the two numbers that add up to \`target\`.

Exactly one answer exists, and you may not use the same element twice. Return the indices in any order.

### Example 1

\`\`\`
Input:  nums = [2, 7, 11, 15], target = 9
Output: [0, 1]
\`\`\`

Because \`nums[0] + nums[1] == 9\`.

### Example 2

\`\`\`
Input:  nums = [3, 2, 4], target = 6
Output: [1, 2]
\`\`\`

### Constraints

- \`2 <= nums.length <= 10^4\`
- \`-10^9 <= nums[i], target <= 10^9\`
- Exactly one valid answer exists.

**Follow-up:** can you do better than O(n²)?`,
});
const lruContent = ProblemContent.parse(lruJson);

function toDetail(c: ProblemContent): ProblemDetail {
  return ProblemDetail.parse({
    slug: c.slug,
    title: c.title,
    difficulty: c.difficulty,
    category: c.category,
    tags: c.tags,
    statement: c.statement,
    signature: c.signature,
    limits: c.limits,
    sampleTests: c.tests.filter((t) => !t.hidden),
    hiddenTestCount: c.tests.filter((t) => t.hidden).length + 55,
    languages: c.languages,
    scaffolds: problemScaffolds(c),
  });
}

export const TWO_SUM = toDetail(twoSumContent);
export const LRU = toDetail(lruContent);
/** A C++-only problem with its own starter code (the contracts' box-cpp fixture, renamed). */
export const UNIQUE_PTR = toDetail(
  ProblemContent.parse({
    ...boxJson,
    slug: 'unique-pointer',
    title: 'Unique Pointer',
    difficulty: 'medium',
    category: 'data-structure',
  }),
);

export const PROBLEMS = ProblemSummary.array().parse([
  {
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'easy',
    category: 'dsa',
    tags: ['array', 'hash-table'],
  },
  {
    slug: 'valid-parentheses',
    title: 'Valid Parentheses',
    difficulty: 'easy',
    category: 'dsa',
    tags: ['stack', 'string'],
  },
  {
    slug: 'min-stack',
    title: 'Min Stack',
    difficulty: 'easy',
    category: 'data-structure',
    tags: ['design', 'stack'],
  },
  {
    slug: 'lru-cache',
    title: 'LRU Cache',
    difficulty: 'medium',
    category: 'data-structure',
    tags: ['design', 'hash-table', 'linked-list'],
  },
  {
    slug: 'merge-intervals',
    title: 'Merge Intervals',
    difficulty: 'medium',
    category: 'dsa',
    tags: ['array', 'intervals', 'sorting'],
  },
  {
    slug: 'number-of-islands',
    title: 'Number of Islands',
    difficulty: 'medium',
    category: 'dsa',
    tags: ['graph', 'bfs', 'dfs', 'matrix'],
  },
  {
    slug: 'top-k-frequent-elements',
    title: 'Top K Frequent Elements',
    difficulty: 'medium',
    category: 'dsa',
    tags: ['heap', 'hash-table'],
  },
  {
    slug: 'longest-substring-without-repeating',
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'medium',
    category: 'dsa',
    tags: ['sliding-window', 'string'],
  },
  {
    slug: 'course-schedule',
    title: 'Course Schedule',
    difficulty: 'medium',
    category: 'dsa',
    tags: ['graph', 'topological-sort'],
  },
  {
    slug: 'kv-store-transactions',
    title: 'Key-Value Store with Transactions',
    difficulty: 'medium',
    category: 'implementation',
    tags: ['design', 'hash-table', 'stack'],
  },
  {
    slug: 'trapping-rain-water',
    title: 'Trapping Rain Water',
    difficulty: 'hard',
    category: 'dsa',
    tags: ['array', 'two-pointers'],
  },
  {
    slug: 'word-ladder',
    title: 'Word Ladder',
    difficulty: 'hard',
    category: 'dsa',
    tags: ['graph', 'bfs'],
  },
  {
    slug: 'text-justification',
    title: 'Text Justification',
    difficulty: 'hard',
    category: 'implementation',
    tags: ['array', 'string', 'simulation'],
  },
  {
    slug: 'median-of-two-sorted-arrays',
    title: 'Median of Two Sorted Arrays',
    difficulty: 'hard',
    category: 'dsa',
    tags: ['binary-search'],
  },
  {
    slug: UNIQUE_PTR.slug,
    title: UNIQUE_PTR.title,
    difficulty: UNIQUE_PTR.difficulty,
    category: UNIQUE_PTR.category,
    tags: UNIQUE_PTR.tags,
    languages: UNIQUE_PTR.languages,
  },
]);

export const PROBLEM_DETAILS: Record<string, ProblemDetail> = {
  'two-sum': TWO_SUM,
  'lru-cache': LRU,
  'unique-pointer': UNIQUE_PTR,
};

// ---------- pads ----------

export const ACTIVE_PAD_ID = uuid(1001);
export const ENDED_PAD_ID = uuid(1002);
export const COLLAB_PAD_ID = uuid(1005);

export function makePad(over: Partial<Pad> = {}): Pad {
  return Pad.parse({
    id: ACTIVE_PAD_ID,
    ownerId: USER.id,
    title: 'Two Sum',
    problemSlug: 'two-sum',
    language: 'cpp',
    status: 'active',
    durationMin: 45,
    interviewer: { enabled: true, style: 'neutral', proactivity: 'normal', voice: false },
    shareToken: 'sh_7Hq2kLx9',
    startedAt: new Date(Date.now() - 13 * 60_000).toISOString(),
    endedAt: null,
    ...over,
  });
}

export function makeMessage(over: Partial<Message> & Pick<Message, 'role' | 'text'>): Message {
  return Message.parse({
    id: uuid(),
    padId: ACTIVE_PAD_ID,
    kind: 'chat',
    intent: null,
    via: 'text',
    userId: over.role === 'candidate' ? USER.id : null,
    createdAt: new Date().toISOString(),
    ...over,
  });
}

export function initialMessages(padId = ACTIVE_PAD_ID): Message[] {
  const now = Date.now();
  return [
    makeMessage({
      padId,
      role: 'interviewer',
      kind: 'proactive',
      intent: 'greeting',
      text: "Hi Ada, thanks for joining. Today we'll work on **Two Sum**: given an array and a target, return the indices of the two numbers that add up to the target.\n\nTake a minute to read it, and feel free to ask clarifying questions before you start.",
      createdAt: new Date(now - 12 * 60_000).toISOString(),
    }),
    makeMessage({
      padId,
      role: 'candidate',
      text: 'Can the array contain duplicates, and is it sorted?',
      createdAt: new Date(now - 11 * 60_000).toISOString(),
    }),
    makeMessage({
      padId,
      role: 'interviewer',
      intent: 'answer',
      text: "Duplicates are possible and the array isn't sorted. You can assume exactly one valid pair exists.",
      createdAt: new Date(now - 11 * 60_000 + 8000).toISOString(),
    }),
  ];
}

export function makePadDetail(
  over: {
    pad?: Partial<Pad>;
    messages?: Message[];
    runs?: Run[];
    interviewerKey?: 'active' | 'missing' | 'rejected';
    role?: 'owner' | 'collaborator';
    members?: PadMember[];
  } = {},
) {
  const pad = makePad(over.pad);
  return PadDetail.parse({
    pad,
    role: over.role ?? 'owner',
    problem: pad.problemSlug ? (PROBLEM_DETAILS[pad.problemSlug] ?? TWO_SUM) : null,
    members: over.members ?? [],
    messages: over.messages ?? initialMessages(pad.id),
    runs: over.runs ?? [],
    interviewerAvailable: (over.interviewerKey ?? 'active') === 'active',
    interviewerKey: over.interviewerKey ?? 'active',
    interviewerModel:
      (over.interviewerKey ?? 'active') === 'active'
        ? {
            provider: 'anthropic',
            id: 'claude-opus-5-5',
            chosen: false,
            defaultModel: 'claude-opus-5-5',
          }
        : null,
  });
}

// ---------------------------------------------------------------- interview rooms

export const ROOM_PAD_ID = uuid(1101);
export const ROOM_TOKEN = 'room_Kx81QzT4';
/** Someone who joins a room by its link with just a name. */
export const GUEST = { id: 'guest_casey', name: 'Casey Jones', email: 'temp-1@guest.invalid' };
export const HOST_MEMBER: PadMember = {
  userId: USER.id,
  name: USER.name,
  role: 'owner',
  guest: false,
};
export const GUEST_MEMBER: PadMember = {
  userId: GUEST.id,
  name: GUEST.name,
  role: 'collaborator',
  guest: true,
};

/**
 * A room. `as: 'host'` is the signed-in user's own room; `as: 'candidate'` is one Grace Hopper
 * hosts, seen by whoever joined it.
 */
export function makeRoomDetail(
  over: {
    as?: 'host' | 'candidate';
    pad?: Partial<Pad>;
    members?: PadMember[];
    messages?: Message[];
    runs?: Run[];
  } = {},
) {
  const host = (over.as ?? 'host') === 'host';
  const owner: PadMember = host
    ? HOST_MEMBER
    : { userId: OTHER_USER.id, name: OTHER_USER.name, role: 'owner', guest: false };
  return makePadDetail({
    pad: {
      id: ROOM_PAD_ID,
      kind: 'room',
      ownerId: owner.userId,
      interviewer: { enabled: false, style: 'neutral', proactivity: 'normal', voice: false },
      shareToken: host ? ROOM_TOKEN : null,
      ...over.pad,
    },
    role: host ? 'owner' : 'collaborator',
    members: over.members ?? [owner],
    messages: over.messages ?? [],
    runs: over.runs,
    // A candidate learns nothing about the host's key.
    ...(host ? {} : { interviewerKey: 'missing' as const }),
  });
}

/** A short exchange between the host (Ada) and the candidate (Casey). */
export function roomMessages(hostId = USER.id, candidateId = GUEST.id): Message[] {
  return [
    makeMessage({
      padId: ROOM_PAD_ID,
      role: 'interviewer',
      userId: hostId,
      text: 'Welcome! Take a minute to read the problem, then talk me through your approach.',
      createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    }),
    makeMessage({
      padId: ROOM_PAD_ID,
      role: 'candidate',
      userId: candidateId,
      text: 'A hash map from value to index, so each lookup for the complement is O(1).',
      createdAt: new Date(Date.now() - 7 * 60_000).toISOString(),
    }),
  ];
}

export const HOST_VIEWS: Record<string, HostView['problem']> = {
  'two-sum': {
    slug: 'two-sum',
    interviewerNotes: twoSumContent.interviewerNotes,
    referenceSolutions: twoSumContent.referenceSolutions,
  },
  'lru-cache': {
    slug: 'lru-cache',
    interviewerNotes: lruContent.interviewerNotes,
    referenceSolutions: lruContent.referenceSolutions,
  },
};

export function makeReview(question?: string): SolutionReview {
  return SolutionReview.parse({
    verdict: 'incorrect',
    summary:
      'The approach is right, but the map is filled before the lookup, so an element can be paired with itself.',
    issues: ['Line 6: for nums = [3, 2, 4] and target = 6 it returns [0, 0]; expected [1, 2].'],
    complexity: 'O(n) time and O(n) space, which is what the problem asks for.',
    followUps: [
      'What does your code return when the same value appears twice?',
      'Could you do it without extra space if the input were sorted?',
    ],
    answer: question ? 'Yes: the loop visits every index once, so the bound is right.' : null,
    language: 'cpp',
    model: 'claude-opus-5-5',
    createdAt: new Date().toISOString(),
  });
}

export const PAD_SUMMARIES = PadSummary.array().parse([
  {
    id: ACTIVE_PAD_ID,
    title: 'Two Sum',
    problemSlug: 'two-sum',
    language: 'cpp',
    status: 'active',
    startedAt: new Date(Date.now() - 13 * 60_000).toISOString(),
    endedAt: null,
    problemTitle: 'Two Sum',
    difficulty: 'easy',
    accepted: false,
    role: 'owner',
  },
  {
    id: ENDED_PAD_ID,
    title: 'LRU Cache',
    problemSlug: 'lru-cache',
    language: 'python',
    status: 'ended',
    startedAt: iso(-86400 * 2),
    endedAt: iso(-86400 * 2 + 2520),
    problemTitle: 'LRU Cache',
    difficulty: 'medium',
    accepted: true,
    role: 'owner',
  },
  {
    id: uuid(1003),
    title: 'Trapping Rain Water',
    problemSlug: 'trapping-rain-water',
    language: 'java',
    status: 'ended',
    startedAt: iso(-86400 * 5),
    endedAt: iso(-86400 * 5 + 2700),
    problemTitle: 'Trapping Rain Water',
    difficulty: 'hard',
    accepted: false,
    role: 'owner',
  },
  {
    id: uuid(1004),
    title: 'Merge Intervals',
    problemSlug: 'merge-intervals',
    language: 'cpp',
    status: 'ended',
    startedAt: iso(-86400 * 9),
    endedAt: iso(-86400 * 9 + 1980),
    problemTitle: 'Merge Intervals',
    difficulty: 'medium',
    accepted: true,
    role: 'owner',
  },
  {
    // Joined through someone else's invite link: the user can only remove it from their history.
    id: COLLAB_PAD_ID,
    title: 'Number of Islands',
    problemSlug: 'number-of-islands',
    language: 'python',
    status: 'ended',
    startedAt: iso(-86400 * 12),
    endedAt: iso(-86400 * 12 + 2400),
    problemTitle: 'Number of Islands',
    difficulty: 'medium',
    accepted: false,
    role: 'collaborator',
  },
]);

// ---------- runs ----------

const runBase = (over: Partial<Run>): Run =>
  Run.parse({
    id: uuid(),
    padId: ACTIVE_PAD_ID,
    userId: USER.id,
    mode: 'samples',
    language: 'cpp',
    status: 'finished',
    verdict: null,
    compile: { ok: true, output: '', timeMs: 812 },
    file: null,
    tests: [],
    passed: 0,
    total: 0,
    message: null,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...over,
  });

export const RUNS = {
  queued: (mode: Run['mode'] = 'samples', id = uuid()) =>
    runBase({ id, mode, status: 'queued', verdict: null, compile: null, finishedAt: null }),
  samplesAccepted: (id = uuid()) =>
    runBase({
      id,
      verdict: 'accepted',
      passed: 2,
      total: 2,
      tests: [
        {
          hidden: false,
          id: 's1',
          verdict: 'pass',
          timeMs: 0.21,
          actual: [[0, 1]],
          stdout: '',
          stderr: '',
          message: null,
        },
        {
          hidden: false,
          id: 's2',
          verdict: 'pass',
          timeMs: 0.18,
          actual: [[1, 2]],
          stdout: '',
          stderr: '',
          message: null,
        },
      ],
    }),
  wrongAnswer: (id = uuid()) =>
    runBase({
      id,
      verdict: 'wrong_answer',
      passed: 1,
      total: 2,
      tests: [
        {
          hidden: false,
          id: 's1',
          verdict: 'pass',
          timeMs: 0.2,
          actual: [[0, 1]],
          stdout: '',
          stderr: '',
          message: null,
        },
        {
          hidden: false,
          id: 's2',
          verdict: 'fail',
          timeMs: 0.3,
          actual: [[0, 0]],
          stdout: 'checking i=0 j=0\nfound pair\n',
          stderr: '',
          message: 'call 1 (twoSum): expected [1,2], got [0,0]',
        },
      ],
    }),
  compileError: (id = uuid()) =>
    runBase({
      id,
      verdict: 'compile_error',
      compile: {
        ok: false,
        timeMs: 640,
        output:
          "solution.cpp:7:31: error: 'unordered_mapp' was not declared in this scope; did you mean 'unordered_map'?\n    7 |         unordered_mapp<int, int> seen;\n      |         ^~~~~~~~~~~~~~\n      |         unordered_map\nsolution.cpp:7:46: error: expected primary-expression before 'int'\n    7 |         unordered_mapp<int, int> seen;\n      |                                  ^~~",
      },
    }),
  runtimeError: (id = uuid()) =>
    runBase({
      id,
      verdict: 'runtime_error',
      passed: 0,
      total: 2,
      tests: [
        {
          hidden: false,
          id: 's1',
          verdict: 'runtime_error',
          timeMs: 2.1,
          actual: null,
          stdout: '',
          stderr: 'AddressSanitizer: heap-buffer-overflow on address 0x602000000018',
          message: 'terminated by SIGSEGV (segmentation fault)',
        },
        {
          hidden: false,
          id: 's2',
          verdict: 'skipped',
          timeMs: 0,
          actual: null,
          stdout: '',
          stderr: '',
          message: null,
        },
      ],
    }),
  timeLimit: (id = uuid()) =>
    runBase({
      id,
      verdict: 'time_limit',
      passed: 1,
      total: 2,
      tests: [
        {
          hidden: false,
          id: 's1',
          verdict: 'pass',
          timeMs: 0.4,
          actual: [[0, 1]],
          stdout: '',
          stderr: '',
          message: null,
        },
        {
          hidden: false,
          id: 's2',
          verdict: 'time_limit',
          timeMs: 1000,
          actual: null,
          stdout: '',
          stderr: '',
          message: 'exceeded 1000 ms',
        },
      ],
    }),
  fileOk: (id = uuid()) =>
    runBase({
      id,
      mode: 'file',
      verdict: 'ok',
      file: {
        exitCode: 0,
        signal: null,
        stdout: 'twoSum([2,7,11,15], 9) = [0, 1]\ntwoSum([3,2,4], 6) = [1, 2]\n',
        stderr: '',
        truncated: false,
        timeMs: 3.4,
      },
    }),
  fileCrash: (id = uuid()) =>
    runBase({
      id,
      mode: 'file',
      verdict: 'runtime_error',
      file: {
        exitCode: null,
        signal: 'SIGABRT',
        stdout: 'starting\n',
        stderr:
          "terminate called after throwing an instance of 'std::out_of_range'\n  what():  vector::_M_range_check: __n (which is 4) >= this->size() (which is 4)",
        truncated: false,
        timeMs: 5.1,
      },
    }),
  customRan: (id = uuid()) =>
    runBase({
      id,
      mode: 'custom',
      verdict: 'ok',
      passed: 0,
      total: 1,
      tests: [
        {
          hidden: false,
          id: 'c1',
          verdict: 'ran',
          timeMs: 0.3,
          actual: [[0, 2]],
          stdout: '',
          stderr: '',
          message: null,
        },
      ],
    }),
  submitPartial: (id = uuid()) =>
    runBase({
      id,
      mode: 'submit',
      verdict: 'wrong_answer',
      passed: 55,
      total: 58,
      tests: [
        {
          hidden: false,
          id: 's1',
          verdict: 'pass',
          timeMs: 0.2,
          actual: [[0, 1]],
          stdout: '',
          stderr: '',
          message: null,
        },
        {
          hidden: false,
          id: 's2',
          verdict: 'pass',
          timeMs: 0.2,
          actual: [[1, 2]],
          stdout: '',
          stderr: '',
          message: null,
        },
        ...Array.from({ length: 56 }, (_, i) => ({
          hidden: true as const,
          id: `h${i + 1}`,
          verdict:
            i === 17
              ? ('fail' as const)
              : i === 40
                ? ('time_limit' as const)
                : i === 41
                  ? ('runtime_error' as const)
                  : ('pass' as const),
          timeMs: i === 40 ? 1000 : 0.3 + (i % 7) * 0.4,
        })),
      ],
    }),
  submitAccepted: (id = uuid()) =>
    runBase({
      id,
      mode: 'submit',
      verdict: 'accepted',
      passed: 58,
      total: 58,
      tests: [
        {
          hidden: false,
          id: 's1',
          verdict: 'pass',
          timeMs: 0.2,
          actual: [[0, 1]],
          stdout: '',
          stderr: '',
          message: null,
        },
        {
          hidden: false,
          id: 's2',
          verdict: 'pass',
          timeMs: 0.2,
          actual: [[1, 2]],
          stdout: '',
          stderr: '',
          message: null,
        },
        ...Array.from({ length: 56 }, (_, i) => ({
          hidden: true as const,
          id: `h${i + 1}`,
          verdict: 'pass' as const,
          timeMs: 0.3 + (i % 5) * 0.5,
        })),
      ],
    }),
  invalid: (id = uuid()) =>
    runBase({
      id,
      verdict: 'invalid_submission',
      compile: null,
      message: 'class `Solution` has no method `twoSum` taking 2 arguments',
    }),
};

// ---------- report & playback ----------

export const REPORT_READY = Report.parse({
  padId: ENDED_PAD_ID,
  status: 'ready',
  generatedAt: iso(-86400 * 2 + 2600),
  stats: {
    durationSec: 2520,
    runs: 7,
    submissions: 2,
    accepted: true,
    candidateMessages: 14,
    interviewerMessages: 17,
  },
  assessment: {
    recommendation: 'hire',
    summary:
      'Ada clarified the eviction semantics before writing code and landed on the hash map plus doubly linked list design quickly. The first submission missed refreshing recency on `put` for an existing key; she found it from the failing test rather than from a hint. Complexity analysis was precise. Testing was reactive: she relied on the provided samples until prompted.',
    scores: [
      {
        dimension: 'problem_solving',
        score: 3,
        evidence:
          'Identified the O(1) design without hints and explained why an ordered dict suffices in Python.',
      },
      {
        dimension: 'coding',
        score: 3,
        evidence:
          'Clean, idiomatic Python. One bug in `put` for existing keys, fixed in under two minutes.',
      },
      {
        dimension: 'communication',
        score: 4,
        evidence: 'Narrated trade-offs throughout and checked assumptions about capacity 0.',
      },
      {
        dimension: 'testing',
        score: 2,
        evidence: 'Did not write custom tests until asked about eviction after a `get`.',
      },
      {
        dimension: 'complexity_analysis',
        score: 4,
        evidence:
          'Gave O(1) average for both operations and O(capacity) space, with the hashing caveat.',
      },
    ],
    strengths: [
      'Asked about edge cases (capacity 0, repeated puts) before coding',
      'Precise complexity analysis',
      'Calm debugging from a failing test',
    ],
    improvements: [
      'Write a custom test for the tricky path before submitting',
      'State the invariant of the linked list out loud before coding it',
    ],
  },
  assessmentUnavailable: null,
});

export const REPORT_PENDING = Report.parse({
  ...REPORT_READY,
  status: 'pending',
  generatedAt: null,
  assessment: null,
});

/** A room's report before the host asks for the AI assessment. */
export const REPORT_ROOM = Report.parse({
  ...REPORT_READY,
  padId: ROOM_PAD_ID,
  assessment: null,
  assessmentUnavailable: 'not_requested',
  hostNotes: 'Strong start. Needed a nudge on duplicates.',
});

function b64(u: Uint8Array) {
  return Buffer.from(u).toString('base64');
}

/** A realistic editing history: the candidate builds an LRU cache in Python over ~40 minutes. */
export function makePlayback(): Playback {
  const doc = new Y.Doc();
  const updates: { seq: number; at: string; update: string }[] = [];
  let seq = 0;
  const start = Date.parse(REPORT_READY.generatedAt ?? iso(0)) - 2600 * 1000;
  const at = (sec: number) => new Date(start + sec * 1000).toISOString();
  doc.on('update', (u: Uint8Array) => {
    updates.push({ seq: ++seq, at: at(currentSec), update: b64(u) });
  });
  let currentSec = 0;
  const scaffolds = LRU.scaffolds;
  doc.transact(() => {
    for (const lang of ['cpp', 'python', 'java'] as Language[])
      doc.getText(YDOC.code(lang)).insert(0, scaffolds[lang]);
  });
  const text = doc.getText(YDOC.code('python'));
  const finalCode = `from collections import OrderedDict


class LRUCache:
    def __init__(self, capacity: int) -> None:
        self.cap = capacity
        self.d: OrderedDict[int, int] = OrderedDict()

    def get(self, key: int) -> int:
        if key not in self.d:
            return -1
        self.d.move_to_end(key)
        return self.d[key]

    def put(self, key: int, value: int) -> None:
        self.d[key] = value
        self.d.move_to_end(key)
        if len(self.d) > self.cap:
            self.d.popitem(last=False)


if __name__ == "__main__":
    c = LRUCache(2)
    c.put(1, 1)
    c.put(2, 2)
    print(c.get(1))
`;
  // Replace the scaffold progressively: 40 chunks over the session.
  currentSec = 240;
  doc.transact(() => {
    text.delete(0, text.length);
  });
  const chunks = 40;
  const size = Math.ceil(finalCode.length / chunks);
  for (let i = 0; i < chunks; i++) {
    currentSec = 260 + i * 55;
    doc.transact(() => text.insert(text.length, finalCode.slice(i * size, (i + 1) * size)));
  }
  doc
    .getText(YDOC.notes)
    .insert(0, 'hash map + DLL\nevict LRU on overflow\nedge: capacity 0? repeated put?');
  const events = [
    { type: 'run', mode: 'file', verdict: 'ok', passed: 0, total: 0, sec: 1300 },
    { type: 'run', mode: 'samples', verdict: 'wrong_answer', passed: 0, total: 1, sec: 1500 },
    { type: 'run', mode: 'samples', verdict: 'accepted', passed: 1, total: 1, sec: 1720 },
    { type: 'run', mode: 'submit', verdict: 'wrong_answer', passed: 41, total: 44, sec: 1850 },
    { type: 'run', mode: 'submit', verdict: 'accepted', passed: 44, total: 44, sec: 2210 },
  ].map((e, i) => ({
    id: uuid(5000 + i),
    padId: ENDED_PAD_ID,
    at: at(e.sec),
    event: {
      type: 'run' as const,
      runId: uuid(6000 + i),
      mode: e.mode,
      verdict: e.verdict,
      passed: e.passed,
      total: e.total,
    },
  }));
  const messages = [
    {
      role: 'interviewer',
      kind: 'proactive',
      intent: 'greeting',
      text: "Hi Ada! Today's problem is an LRU cache. Read it through and ask anything you like.",
      sec: 10,
    },
    { role: 'candidate', text: 'What should happen with capacity 0?', sec: 95 },
    {
      role: 'interviewer',
      intent: 'answer',
      text: 'Good question. Assume capacity is at least 1.',
      sec: 110,
    },
    {
      role: 'interviewer',
      kind: 'proactive',
      intent: 'probe',
      text: 'What time complexity are you targeting for get and put?',
      sec: 600,
    },
    {
      role: 'candidate',
      text: 'O(1) average for both, using a hash map plus an ordered structure.',
      sec: 640,
    },
    {
      role: 'interviewer',
      kind: 'proactive',
      intent: 'nudge',
      text: 'Your submission failed a hidden test. What happens when you put a key that already exists?',
      sec: 1900,
    },
    {
      role: 'interviewer',
      kind: 'proactive',
      intent: 'wrap_up',
      text: "Nice work. We're nearly out of time; walk me through the final complexity.",
      sec: 2400,
    },
  ].map((m, i) =>
    Message.parse({
      id: uuid(7000 + i),
      padId: ENDED_PAD_ID,
      role: m.role,
      kind: m.kind ?? 'chat',
      intent: m.intent ?? null,
      text: m.text,
      via: 'text',
      userId: m.role === 'candidate' ? USER.id : null,
      createdAt: at(m.sec),
    }),
  );
  return Playback.parse({ updates, events, messages });
}

// ---------- quizzes ----------

export const QUIZ_TOPICS = QuizTopicStats.array().parse([
  {
    slug: 'cpp',
    title: 'C++',
    description:
      'Language rules, the standard library, object lifetime, templates, and what programs actually print.',
    questionCount: 84,
    answered: 31,
    accuracy: 0.71,
  },
  {
    slug: 'python',
    title: 'Python',
    description: 'Language semantics, the data model, the standard library, and common gotchas.',
    questionCount: 62,
    answered: 12,
    accuracy: 0.83,
  },
  {
    slug: 'computer-architecture',
    title: 'Computer architecture',
    description: 'CPUs, caches, memory hierarchy, pipelines, data representation, and performance.',
    questionCount: 40,
    answered: 0,
    accuracy: null,
  },
  {
    slug: 'operating-systems',
    title: 'Operating systems',
    description: 'Processes, threads, scheduling, virtual memory, file systems, and system calls.',
    questionCount: 55,
    answered: 20,
    accuracy: 0.55,
  },
  {
    slug: 'networking',
    title: 'Networking',
    description: 'TCP/IP, UDP, DNS, HTTP, TLS, sockets, and how packets get from A to B.',
    questionCount: 48,
    answered: 6,
    accuracy: 0.5,
  },
  {
    slug: 'concurrency',
    title: 'Concurrency',
    description: 'Threads, locks, atomics, memory models, lock-free structures, and classic bugs.',
    questionCount: 37,
    answered: 0,
    accuracy: null,
  },
]);

export const QUIZ_ATTEMPT_ID = uuid(9001);

export const QUIZ_QUESTIONS = [
  {
    id: 'os-virtual-memory-002',
    topic: 'operating-systems',
    subtopic: 'Virtual memory',
    difficulty: 'medium',
    type: 'single',
    prompt:
      'A process touches a page that is mapped but not currently resident. What happens **first**?',
    choices: [
      { id: 'a', text: 'The CPU raises a page fault and the kernel loads the page' },
      { id: 'b', text: 'The TLB is flushed and the access is retried' },
      { id: 'c', text: 'The process receives SIGSEGV' },
      { id: 'd', text: 'The MMU allocates a new frame on its own' },
    ],
    code: null,
  },
  {
    id: 'concurrency-primitives-004',
    topic: 'concurrency',
    subtopic: 'Synchronisation',
    difficulty: 'medium',
    type: 'multiple',
    prompt: 'Which of these can cause a **deadlock** on their own? Select all that apply.',
    choices: [
      { id: 'a', text: 'Two threads acquiring the same two mutexes in opposite orders' },
      { id: 'b', text: 'A thread locking a non-recursive mutex it already holds' },
      { id: 'c', text: 'Reading a shared `std::atomic<int>` from many threads' },
      { id: 'd', text: 'Waiting on a condition variable without a predicate' },
    ],
    code: null,
  },
  {
    id: 'cpp-lifetime-011',
    topic: 'cpp',
    subtopic: 'Object lifetime',
    difficulty: 'hard',
    type: 'output',
    prompt: 'What does this program print?',
    choices: null,
    code: {
      language: 'cpp',
      standard: 'C++20',
      source: `#include <iostream>

struct A {
    A() { std::cout << "a"; }
    A(const A&) { std::cout << "c"; }
    ~A() { std::cout << "d"; }
};

A make() { return A{}; }

int main() {
    A x = make();
    std::cout << "|";
}`,
    },
  },
  {
    id: 'networking-tcp-007',
    topic: 'networking',
    subtopic: 'TCP',
    difficulty: 'medium',
    type: 'short',
    prompt:
      'Why does TCP need a **TIME_WAIT** state after an active close? Answer in two or three sentences.',
    choices: null,
    code: null,
  },
] as const;

export function makeAttempt(over: Partial<QuizAttempt> = {}): QuizAttempt {
  return QuizAttempt.parse({
    id: QUIZ_ATTEMPT_ID,
    mode: 'practice',
    topics: ['operating-systems', 'concurrency', 'cpp', 'networking'],
    status: 'active',
    questions: QUIZ_QUESTIONS,
    responses: {},
    feedback: [],
    score: null,
    startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    finishedAt: null,
    ...over,
  });
}

export const QUIZ_FEEDBACK: Record<string, (r: QuizResponse) => AnswerFeedback> = {
  'os-virtual-memory-002': (r) =>
    AnswerFeedback.parse({
      questionId: 'os-virtual-memory-002',
      score: r.type === 'single' && r.choice === 'a' ? 1 : 0,
      correct: r.type === 'single' && r.choice === 'a',
      correctAnswer: 'a',
      explanation:
        'The MMU finds the page-table entry marked not-present and raises a **page fault**. The kernel handler reads the page in (from swap or the backing file), updates the page table, and the faulting instruction is restarted. SIGSEGV is only sent when the address is not mapped at all or the access violates its permissions.',
      feedback: null,
      gradedBy: 'auto',
      needsSelfGrade: false,
    }),
  'concurrency-primitives-004': (r) => {
    const chosen = r.type === 'multiple' ? [...r.choices].sort().join(',') : '';
    const correct = chosen === 'a,b';
    return AnswerFeedback.parse({
      questionId: 'concurrency-primitives-004',
      score: correct ? 1 : 0.5,
      correct,
      correctAnswer: ['a', 'b'],
      explanation:
        'Lock-order inversion (a) is the classic deadlock. Re-locking a non-recursive mutex (b) is undefined behaviour for `std::mutex` and deadlocks in practice. Atomic reads (c) never block. A condition-variable wait without a predicate (d) risks lost wake-ups and spurious wake-ups, which is a bug but not a deadlock by itself.',
      feedback: null,
      gradedBy: 'auto',
      needsSelfGrade: false,
    });
  },
  'cpp-lifetime-011': (r) => {
    const ok =
      r.type === 'output' &&
      r.answer.kind === 'output' &&
      r.answer.output.replace(/\s+/g, '') === 'a|d';
    return AnswerFeedback.parse({
      questionId: 'cpp-lifetime-011',
      score: ok ? 1 : 0,
      correct: ok,
      correctAnswer: { kind: 'output', output: 'a|d' },
      explanation:
        'Since C++17, returning a prvalue of the same type is **guaranteed copy elision**: `A{}` initialises `x` directly. So the copy constructor never runs; `x` is constructed once (`a`), then `|` is printed, then `x` is destroyed at the end of `main` (`d`).',
      feedback: null,
      gradedBy: 'auto',
      needsSelfGrade: false,
    });
  },
  'networking-tcp-007': (r) =>
    AnswerFeedback.parse({
      questionId: 'networking-tcp-007',
      score: r.type === 'short' && r.text.length > 40 ? 0.67 : 0.2,
      correct: r.type === 'short' && r.text.length > 40,
      correctAnswer:
        'TIME_WAIT lasts 2×MSL so that (1) the final ACK can be retransmitted if it is lost and the peer resends its FIN, and (2) delayed segments from the old connection expire before a new connection with the same 4-tuple can reuse it.',
      explanation:
        'The side that closes first holds the 4-tuple for twice the maximum segment lifetime. Without it, a lost final ACK would leave the peer stuck in LAST_ACK, and stray segments from the old connection could be accepted by a new one.',
      feedback:
        'Covered: retransmitting the final ACK. Missed: letting old duplicate segments expire before the 4-tuple is reused.',
      gradedBy: 'ai',
      needsSelfGrade: false,
    }),
};

export const QUIZ_HISTORY = QuizAttemptSummary.array().parse([
  {
    id: uuid(9002),
    mode: 'exam',
    topics: ['cpp'],
    status: 'finished',
    score: 0.8,
    startedAt: iso(-86400),
    finishedAt: iso(-86400 + 900),
    questionCount: 10,
  },
  {
    id: uuid(9003),
    mode: 'practice',
    topics: ['operating-systems', 'concurrency'],
    status: 'finished',
    score: 0.55,
    startedAt: iso(-86400 * 3),
    finishedAt: iso(-86400 * 3 + 700),
    questionCount: 8,
  },
  {
    id: uuid(9004),
    mode: 'practice',
    topics: ['python'],
    status: 'active',
    score: null,
    startedAt: iso(-86400 * 4),
    finishedAt: null,
    questionCount: 10,
  },
]);

/** A saved key as the API reports it (only the last four characters). */
export function aiKeyStatus(
  state: 'active' | 'missing' | 'rejected',
  over: {
    last4?: string;
    problem?: 'invalid' | 'permission' | 'billing' | 'spend_limit';
    provider?: AiProvider;
  } = {},
) {
  const provider = state === 'missing' ? null : (over.provider ?? 'anthropic');
  return AiKeyStatus.parse({
    state,
    provider,
    last4: state === 'missing' ? null : (over.last4 ?? 'Wx9Q'),
    expiresAt: state === 'active' ? new Date(Date.now() + 24 * 3600_000).toISOString() : null,
    problem: state === 'rejected' ? (over.problem ?? 'invalid') : null,
    model: DEFAULT_MODELS[provider ?? 'anthropic'],
    ttlHours: 24,
  });
}

/** Provider defaults as the API reports them (fixtures only; the API owns the real values). */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-6.2-astra',
  gemini: 'gemini-4-hydrogen',
  openrouter: 'openai/gpt-6.2-sol',
};

/** `GET /api/ai-key/models` for a key of `provider`. */
export function aiModelList(provider: AiProvider = 'anthropic') {
  const defaultModel = DEFAULT_MODELS[provider];
  const models =
    provider === 'anthropic'
      ? [
          { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
          { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
          { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
          { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
        ]
      : [
          { id: defaultModel, label: defaultModel },
          { id: `${provider}-other-model`, label: `${provider}-other-model` },
        ];
  return AiModelList.parse({
    provider,
    defaultModel,
    models: models.map((m) => ({ ...m, default: m.id === defaultModel })),
    source: 'live',
  });
}
