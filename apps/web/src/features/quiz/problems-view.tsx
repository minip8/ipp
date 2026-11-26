'use client';
/**
 * Software's Practice tab, Problems view (`?view=problems`): the problem library on the left (the
 * same component as the interview setup's, `features/new/problem-library.tsx`) and, on the right,
 * a card for the chosen problem (`?problem=`) with the start of its statement, its difficulty,
 * the user's standing on it and one action: set up an interview on it, on the Interviews tab with
 * the problem chosen. The same list-left, card-right skeleton as the Quizzes view.
 */
import type { ProblemStatus } from '@ipp/contracts';
import { ArrowRightIcon, MousePointerClickIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { CategoryBadge, DifficultyBadge } from '@/components/domain';
import { PROBLEM_STATUS_LABEL, ProblemStatusIcon } from '@/components/status-icon';
import { Button } from '@/components/ui/button';
import {
  ProblemLibrary,
  ProblemPreview,
  RestrictionBadge,
  useProblemLibrary,
} from '@/features/new/problem-library';
import { useOnScreen } from '@/lib/layout-hooks';
import { interviewsHref } from '@/lib/track';
import { cn } from '@/lib/utils';

const PROBLEM_PARAM = 'problem';

function StatusLine({ status }: { status: ProblemStatus }) {
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-sm',
        status === 'solved'
          ? 'text-ok-text'
          : status === 'attempted'
            ? 'text-warn-text'
            : 'text-fg-muted',
      )}
      data-testid="problem-card-status"
    >
      <ProblemStatusIcon status={status} />
      {PROBLEM_STATUS_LABEL[status]}
    </p>
  );
}

export function ProblemsView() {
  const params = useSearchParams();
  const lib = useProblemLibrary();
  const [selected, setSelected] = useState<string | null>(params.get(PROBLEM_PARAM));
  const select = (slug: string) => {
    setSelected(slug);
    // Kept in the URL (replaced: choosing is not a step to go back through), so a reload or a
    // link keeps the problem.
    const q = new URLSearchParams(window.location.search);
    q.set(PROBLEM_PARAM, slug);
    window.history.replaceState(null, '', `?${q.toString()}`);
  };
  const current = lib.library.find((p) => p.slug === selected);
  const status = current ? lib.statusFor(current.slug) : null;
  // Phones: the card is under a long list, so a bar keeps it in reach until it is on screen.
  const card = useRef<HTMLElement>(null);
  const cardOnScreen = useOnScreen(card);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ProblemLibrary lib={lib} selected={selected} onSelect={select} />
      <section
        ref={card}
        id="problem-card"
        aria-labelledby="problem-card-heading"
        className="min-w-0 scroll-mt-20 rounded-lg border border-border bg-surface lg:sticky lg:top-20"
        data-testid="problem-card"
      >
        {current ? (
          <>
            <div className="space-y-2 border-b border-border p-4">
              <h2
                id="problem-card-heading"
                className="font-medium text-base"
                data-testid="selected-problem"
              >
                {current.title}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <DifficultyBadge difficulty={current.difficulty} />
                <CategoryBadge category={current.category} />
                <RestrictionBadge p={current} />
              </div>
              {status && <StatusLine status={status} />}
            </div>
            <div className="p-4">
              <ProblemPreview
                slug={current.slug}
                unavailable="The statement could not be loaded."
              />
            </div>
            <div className="space-y-2 border-t border-border p-4">
              <Button asChild variant="primary" size="lg" className="w-full">
                <Link href={interviewsHref('software', { problem: current.slug })}>
                  Set up an interview <ArrowRightIcon />
                </Link>
              </Button>
              <p className="text-center text-xs text-fg-muted">
                On the Interviews tab, with this problem chosen: practise with the AI, or interview
                someone on it.
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-3 p-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-subtle">
              <MousePointerClickIcon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 text-sm">
              <h2 id="problem-card-heading" className="font-medium">
                No problem selected
              </h2>
              <p className="mt-0.5 text-fg-muted">
                Choose one from the library to read the start of it and set up an interview on it.
              </p>
            </div>
          </div>
        )}
      </section>

      {current && !cardOnScreen && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{current.title}</p>
            <Button
              size="lg"
              variant="primary"
              onClick={() =>
                document.getElementById('problem-card')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              View problem
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
