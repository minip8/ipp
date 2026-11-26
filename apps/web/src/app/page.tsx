// KaTeX's stylesheet for the quant preview's formulas, which are typeset on the server: the page
// carries no KaTeX script, and the fonts load only for the glyphs the formulas use.
import 'katex/dist/katex.min.css';
import {
  BrainCircuitIcon,
  FlaskConicalIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  PlayIcon,
  SigmaIcon,
} from 'lucide-react';
import { LandingActions, LandingHeader } from '@/components/landing-nav';
import { PadPreview, QuantPreview } from '@/features/landing/previews';

const FEATURES = [
  {
    icon: BrainCircuitIcon,
    title: 'An interviewer that pays attention',
    body: 'In a coding pad it reads your code as you type, asks about complexity and edge cases, and nudges you when you stall. You get hints, never the answer.',
  },
  {
    icon: PlayIcon,
    title: 'A shared editor with real tests',
    body: 'C++, Python and Java, with Vim or Emacs keys if you like. Run the sample tests and your own inputs, then submit against the hidden ones. Anyone you invite types alongside you.',
  },
  {
    icon: FlaskConicalIcon,
    title: 'A report after every interview',
    body: 'Scores for problem solving, coding, communication, testing and complexity, each with the reasons behind it. You can replay the whole session too.',
  },
  {
    icon: SigmaIcon,
    title: 'Quant question banks',
    body: 'Probability, brainteasers, betting and market making, options, statistics, and linear algebra and calculus, in order for trader and researcher interviews. Numeric answers are marked as you submit them.',
  },
  {
    icon: MessagesSquareIcon,
    title: 'Talk it through',
    body: 'Open questions are a conversation: explain your reasoning, and the interviewer follows up before it grades you. In a pad, turn on voice and think out loud; you can interrupt it.',
  },
  {
    icon: ListChecksIcon,
    title: 'Fundamentals for developers',
    body: 'C++ and Python semantics, what a program actually prints, operating systems, networking, concurrency and architecture.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <LandingHeader />

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-medium tracking-wide text-accent-text">
              Coding · Quant · Systems
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Practice the interview, not just the question.
            </h1>
            <p className="mt-4 max-w-2xl text-md text-fg-muted">
              Solve coding problems in C++, Python or Java while an AI interviewer watches, asks
              follow-ups and speaks up when you go quiet. Work through probability, markets and
              statistics with your answers checked, and talk the open questions through with the
              same interviewer.
            </p>
            <LandingActions />
          </div>
          <div className="mt-14 grid gap-6 xl:grid-cols-2">
            <figure className="flex min-w-0 flex-col gap-2.5">
              <figcaption className="font-mono text-xs font-medium tracking-wide text-fg-muted">
                Coding interview
              </figcaption>
              <PadPreview />
            </figure>
            <figure className="flex min-w-0 flex-col gap-2.5">
              <figcaption className="font-mono text-xs font-medium tracking-wide text-fg-muted">
                Quant questions
              </figcaption>
              <QuantPreview />
            </figure>
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
    </div>
  );
}
