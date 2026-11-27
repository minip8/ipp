/**
 * The landing page's two static pictures of the product: a coding pad with the interviewer, and a
 * quant question with its checked numeric answer (a practice quiz) beside an open question being
 * talked through in an interview. Server components with no state: the math is typeset on the
 * server (`tex`). Both are drawn after the real screens (the pad, the quiz attempt in
 * features/quiz, and the interviewer's chat in a questions stage), so keep them true to what those
 * do.
 *
 * Wide screens (xl) put the two side by side, each stacked inside; in between, each takes the full
 * width with its two halves side by side; phones stack everything.
 */
import { ArrowRightIcon, CheckCircle2Icon, CheckIcon, XCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { tex } from './tex';

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

const FRAME =
  'flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-overlay';
const BAR =
  'flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-3 text-xs text-fg-muted';
/** The two halves: side by side from md while the preview has the row to itself. */
const HALVES = 'grid flex-1 grid-cols-1 md:grid-cols-[1fr_300px] xl:grid-cols-1';
const SIDE =
  'flex flex-col gap-2.5 bg-surface-2/50 p-3 text-[12.5px] border-border max-md:border-t md:border-l xl:border-l-0 xl:border-t';

function Bubble({
  who,
  tone = 'interviewer',
  children,
}: {
  who?: ReactNode;
  tone?: 'interviewer' | 'you' | 'proactive';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 leading-relaxed',
        tone === 'interviewer' && 'border border-border bg-surface',
        tone === 'you' && 'ml-6 bg-accent-soft text-fg',
        tone === 'proactive' && 'border border-proactive/40 bg-proactive-soft/60',
      )}
    >
      {who && (
        <p
          className={cn(
            'mb-0.5 text-2xs font-medium',
            tone === 'proactive' ? 'text-proactive' : 'text-fg-subtle',
          )}
        >
          {who}
        </p>
      )}
      {children}
    </div>
  );
}

export function PadPreview() {
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
    <div className={FRAME} aria-hidden data-testid="pad-preview">
      <div className={BAR}>
        <span className="font-medium text-fg">Two Sum</span>
        <span className="rounded-[4px] bg-ok-soft px-1.5 py-px text-2xs font-medium text-ok-text">
          Easy
        </span>
        <span className="ml-auto font-mono tabular">31:42</span>
      </div>
      <div className={HALVES}>
        <div className="flex min-w-0 flex-col">
          <div className="flex h-8 items-center gap-3 border-b border-border px-3 text-xs">
            <span className="font-medium text-fg">solution.cpp</span>
            <span className="text-fg-subtle">C++</span>
          </div>
          <pre className="flex-1 overflow-x-auto py-3 font-mono text-[12.5px] leading-[1.7]">
            <code className="block min-w-max">
              {toLines(code).map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static content
                <span key={i} className="flex">
                  <span className="w-10 shrink-0 pr-4 text-right text-fg-subtle select-none">
                    {i + 1}
                  </span>
                  <span className="whitespace-pre pr-3">
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
        <div className={SIDE}>
          <Bubble who="Interviewer">
            Before you code it: what are you aiming for on time and space?
          </Bubble>
          <Bubble tone="you">One pass with a hash map. O(n) time, O(n) space.</Bubble>
          <Bubble tone="proactive" who="Spoke up · probe">
            What happens if the same value appears twice, like [3, 3] with target 6?
          </Bubble>
          <div className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-fg-subtle">
            <XCircleIcon className="size-3.5 shrink-0 text-bad" /> Sample 2 failed earlier: expected
            [0,1]
          </div>
        </div>
      </div>
    </div>
  );
}

/** Typeset math from the server, inline or as a display block. */
function M({ children, display }: { children: string; display?: boolean }) {
  const Tag = display ? 'div' : 'span';
  return (
    <Tag
      className={display ? 'landing-math-display' : undefined}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output for constant formulas, rendered on the server
      dangerouslySetInnerHTML={{ __html: tex(children, display) }}
    />
  );
}

export function QuantPreview() {
  return (
    <div className={FRAME} aria-hidden data-testid="quant-preview">
      <div className={BAR}>
        <span className="rounded-[4px] bg-accent-soft px-1.5 py-px text-2xs font-medium text-accent-text">
          Practice
        </span>
        <span className="font-medium text-fg">Probability</span>
        <span className="ml-auto tabular">Question 3 of 10</span>
      </div>
      <div className={HALVES}>
        <div className="flex min-w-0 flex-col p-4 text-[13.5px] leading-relaxed">
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
            <span className="font-medium text-fg">Numeric answer</span>
            <span aria-hidden>·</span>
            <span>Distributions</span>
            <span className="ml-1 rounded-[4px] bg-warn-soft px-1.5 py-px text-2xs font-medium text-warn-text">
              Medium
            </span>
          </p>
          <div className="landing-math mt-3 text-fg">
            <p>
              <M>X</M> and <M>Y</M> are independent and uniform on <M>{'[0, 1]'}</M>. Find
            </p>
            <M display>{String.raw`P\left(X + Y > \tfrac{3}{2}\right).`}</M>
          </div>
          <p className="mt-3 text-xs font-medium text-fg">Your answer</p>
          <div className="mt-1.5 flex h-9 w-40 items-center rounded-md border-2 border-ok/70 bg-surface px-3 text-sm text-fg tabular">
            1/8
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs">
            <CheckIcon className="size-3.5 text-ok" strokeWidth={2.5} />
            <span className="font-medium text-ok-text">Correct</span>
            <span className="text-fg-muted">· graded automatically</span>
          </p>
          <div className="mt-auto flex justify-end pt-5">
            <span className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-fg">
              Continue <ArrowRightIcon className="size-3.5" />
            </span>
          </div>
        </div>
        <div className={cn(SIDE, 'landing-math')}>
          <p className="flex items-center gap-1.5 px-1 text-2xs font-medium text-fg-subtle">
            <span className="rounded-[4px] bg-accent-soft px-1.5 py-px text-accent-text">
              Interview
            </span>
            Open question
          </p>
          <Bubble who="Interviewer">
            A stick is broken at two uniformly random points. How would you find the chance that the
            three pieces make a triangle?
          </Bubble>
          <Bubble tone="you" who="You">
            Every piece has to be shorter than half the stick. I&apos;d integrate over where the two
            cuts land.
          </Bubble>
          <Bubble who="Interviewer">
            Before you integrate: with the cuts at <M>{'{x < y}'}</M>, what does &ldquo;every piece
            under <M>{String.raw`\tfrac{1}{2}`}</M>&rdquo; say about <M>x</M> and <M>y</M>?
          </Bubble>
        </div>
      </div>
    </div>
  );
}
