import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  FlaskConicalIcon,
  ListChecksIcon,
  MicIcon,
  PlayIcon,
  UsersIcon,
  XCircleIcon,
} from 'lucide-react';
import { LandingActions, LandingNav } from '@/components/landing-nav';
import { Logo } from '@/components/logo';

const FEATURES = [
  {
    icon: BrainCircuitIcon,
    title: 'An interviewer that pays attention',
    body: 'It reads your code as you type, asks about complexity and edge cases, nudges when you stall and gives hints on a ladder. It never hands you the answer.',
  },
  {
    icon: PlayIcon,
    title: 'Run, test, submit',
    body: 'Run the file with your own main(), check the sample tests, try custom inputs, then submit against hidden tests. Diffs show input, expected and actual side by side.',
  },
  {
    icon: UsersIcon,
    title: 'A real shared pad',
    body: 'C++, Python and Java with Vim or Emacs keys, live cursors for anyone you invite, a whiteboard for sketching, and notes that stay with the session.',
  },
  {
    icon: MicIcon,
    title: 'Talk it through',
    body: 'Turn on voice and think out loud. Push to talk or go hands-free; the interviewer answers in short spoken turns, and you can interrupt.',
  },
  {
    icon: FlaskConicalIcon,
    title: 'A report after every session',
    body: 'Scores across problem solving, coding, communication, testing and complexity analysis, with evidence. Replay the whole session with a scrubber.',
  },
  {
    icon: ListChecksIcon,
    title: 'Quizzes for the fundamentals',
    body: 'C++ and Python semantics, what programs actually print, operating systems, networking, concurrency, architecture. Practice or exam mode.',
  },
];

type Tok = readonly [string, string];
function toLines(tokens: readonly Tok[]): Tok[][] {
  const lines: Tok[][] = [[]];
  for (const [k, t] of tokens) {
    t.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]?.push([k, part]);
    });
  }
  return lines;
}

function PadPreview() {
  const code = [
    ['kw', 'class '],
    ['ty', 'Solution'],
    ['p', ' {\n'],
    ['kw', 'public'],
    ['p', ':\n    '],
    ['ty', 'vector'],
    ['p', '<'],
    ['kw', 'int'],
    ['p', '> '],
    ['fn', 'twoSum'],
    ['p', '('],
    ['ty', 'vector'],
    ['p', '<'],
    ['kw', 'int'],
    ['p', '>& nums, '],
    ['kw', 'int'],
    ['p', ' target) {\n        '],
    ['ty', 'unordered_map'],
    ['p', '<'],
    ['kw', 'int'],
    ['p', ', '],
    ['kw', 'int'],
    ['p', '> seen;\n        '],
    ['kw', 'for '],
    ['p', '('],
    ['kw', 'int '],
    ['p', 'i = '],
    ['num', '0'],
    ['p', '; i < nums.'],
    ['fn', 'size'],
    ['p', '(); i++) {\n            '],
    ['kw', 'auto '],
    ['p', 'it = seen.'],
    ['fn', 'find'],
    ['p', '(target - nums[i]);\n            '],
    ['kw', 'if '],
    ['p', '(it != seen.'],
    ['fn', 'end'],
    ['p', '()) '],
    ['kw', 'return '],
    ['p', '{it->second, i};\n            seen[nums[i]] = i;\n        }\n        '],
    ['kw', 'return '],
    ['p', '{};\n    }\n};'],
  ] as const;
  const color: Record<string, string> = {
    kw: 'text-[oklch(0.55_0.17_300)] dark:text-[oklch(0.75_0.13_300)]',
    ty: 'text-[oklch(0.52_0.12_200)] dark:text-[oklch(0.78_0.1_200)]',
    fn: 'text-[oklch(0.5_0.14_256)] dark:text-[oklch(0.78_0.12_256)]',
    num: 'text-[oklch(0.55_0.13_60)] dark:text-[oklch(0.8_0.12_70)]',
    p: 'text-fg',
  };
  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-overlay"
      aria-hidden
    >
      <div className="flex h-9 items-center gap-2 border-b border-border bg-surface-2 px-3 text-xs text-fg-muted">
        <span className="font-medium text-fg">Two Sum</span>
        <span className="rounded-[4px] bg-ok-soft px-1.5 py-px text-2xs font-medium text-ok-text">
          Easy
        </span>
        <span className="ml-auto font-mono tabular">31:42</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px]">
        <div className="min-w-0 border-border md:border-r">
          <div className="flex h-8 items-center gap-3 border-b border-border px-3 text-xs">
            <span className="font-medium text-fg">solution.cpp</span>
            <span className="text-fg-subtle">C++</span>
          </div>
          <pre className="overflow-x-auto py-3 font-mono text-[12.5px] leading-[1.7]">
            <code className="block min-w-max">
              {toLines(code).map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static content
                <span key={i} className="flex">
                  <span className="w-10 shrink-0 pr-4 text-right text-fg-subtle select-none">
                    {i + 1}
                  </span>
                  <span className="whitespace-pre">
                    {line.map(([k, t], j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: static content
                      <span key={j} className={color[k]}>
                        {t}
                      </span>
                    ))}
                    {line.length === 0 && ' '}
                  </span>
                </span>
              ))}
            </code>
          </pre>
          <div className="border-t border-border px-3 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="size-4 text-ok" />
              <span className="font-medium text-ok-text">Accepted</span>
              <span className="text-fg-muted">58 / 58 tests · 4 ms</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 bg-surface-2/50 p-3 text-[12.5px]">
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="mb-0.5 text-2xs font-medium text-fg-subtle">Interviewer</p>
            Before you code it: what are you aiming for on time and space?
          </div>
          <div className="ml-6 rounded-lg bg-accent-soft px-3 py-2 text-fg">
            One pass with a hash map. O(n) time, O(n) space.
          </div>
          <div className="rounded-lg border border-proactive/40 bg-proactive-soft/60 px-3 py-2">
            <p className="mb-0.5 flex items-center gap-1 text-2xs font-medium text-proactive">
              Spoke up · probe
            </p>
            What happens if the same value appears twice, like [3, 3] with target 6?
          </div>
          <div className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-fg-subtle">
            <XCircleIcon className="size-3.5 text-bad" /> Sample 2 failed earlier: expected [0,1]
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
        <Logo />
        <LandingNav />
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-medium tracking-wide text-accent-text">
              C++ · Python · Java
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Practice the coding interview, not just the problem.
            </h1>
            <p className="mt-4 max-w-xl text-md text-fg-muted">
              A real interview pad with an AI interviewer that watches your approach, asks the
              follow-ups and speaks up when you go quiet. Then a scorecard and a replay of how it
              went.
            </p>
            <LandingActions />
          </div>
          <div className="mt-14">
            <PadPreview />
          </div>
        </section>

        <section className="border-t border-border bg-surface-2/40">
          <div className="mx-auto grid max-w-6xl gap-x-10 gap-y-9 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <f.icon className="size-5 text-accent-text" aria-hidden />
                <h2 className="mt-3 text-base font-semibold">{f.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-fg-subtle sm:px-6">
          <span>interview++</span>
          <span>Code runs in an isolated sandbox with no network access.</span>
        </div>
      </footer>
    </div>
  );
}
