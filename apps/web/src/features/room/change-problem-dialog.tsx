'use client';
/** The host picks the room's next problem from the library, or a blank editor. */
import type { ProblemSummary } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import { FileIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CategoryBadge, DifficultyBadge } from '@/components/domain';
import { ErrorState } from '@/components/states';
import { PROBLEM_STATUS_LABEL, ProblemStatusIcon } from '@/components/status-icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { progressMap, statusOf } from '@/features/new/logic';
import { usePad } from '@/features/pad/session';
import { api } from '@/lib/api';
import { qk, useProblemProgress } from '@/lib/queries';
import { cn } from '@/lib/utils';

const BLANK = '';

export function ChangeProblemDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { state, changeProblem } = usePad();
  const current = state.pad.problemSlug ?? BLANK;
  const problems = useQuery({
    queryKey: qk.problems({}),
    queryFn: () => api.problems(),
    enabled: open,
  });
  // The host's own solved and attempted problems, marked as in the library.
  const progressQuery = useProblemProgress(open);
  const progress = useMemo(() => progressMap(progressQuery.data), [progressQuery.data]);
  const known = progressQuery.data !== undefined;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (problems.data ?? []).filter((p: ProblemSummary) => p.title.toLowerCase().includes(q));
  }, [problems.data, query]);
  const choice = picked ?? current;
  const close = (o: boolean) => {
    if (busy) return;
    if (!o) {
      setPicked(null);
      setQuery('');
    }
    onOpenChange(o);
  };
  const confirm = async () => {
    setBusy(true);
    const ok = await changeProblem(choice === BLANK ? null : choice);
    setBusy(false);
    if (ok) {
      setPicked(null);
      setQuery('');
      onOpenChange(false);
    }
  };
  const row = (selected: boolean) =>
    cn(
      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px]',
      selected && 'bg-accent-soft/40 shadow-[inset_2px_0_0_var(--accent)] hover:bg-accent-soft/50',
    );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change the problem</DialogTitle>
          <DialogDescription>
            Everyone in the room moves to the problem you choose. The code written so far is kept
            and comes back if you return to this problem.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 pb-4">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
              aria-hidden
            />
            <label htmlFor="change-problem-search" className="sr-only">
              Search problems
            </label>
            <input
              id="change-problem-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search problems"
              className="h-8 w-full rounded-md border border-border-strong bg-surface pr-2.5 pl-8 text-sm outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 max-lg:h-10 max-lg:text-base"
            />
          </div>
          <div
            role="radiogroup"
            aria-label="Problem"
            className="h-72 divide-y divide-border overflow-y-auto rounded-md border border-border max-lg:h-[min(18rem,45dvh)]"
          >
            {/* biome-ignore lint/a11y/useSemanticElements: rows carry badges, not just a label */}
            <button
              type="button"
              role="radio"
              aria-checked={choice === BLANK}
              onClick={() => setPicked(BLANK)}
              className={row(choice === BLANK)}
            >
              <FileIcon className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Blank editor</span>
                <span className="block text-xs text-fg-muted">
                  No statement or tests: give the task yourself, and run the code as a program.
                </span>
              </span>
            </button>
            {problems.isPending ? (
              <div className="space-y-2 p-3" role="status" aria-busy="true" aria-label="Loading">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-3/5" />
              </div>
            ) : problems.isError ? (
              <ErrorState error={problems.error} onRetry={() => problems.refetch()} compact />
            ) : list.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-fg-muted">No problem matches.</p>
            ) : (
              list.map((p) => (
                // biome-ignore lint/a11y/useSemanticElements: rows carry badges, not just a label
                <button
                  key={p.slug}
                  type="button"
                  role="radio"
                  aria-checked={choice === p.slug}
                  onClick={() => setPicked(p.slug)}
                  className={row(choice === p.slug)}
                >
                  {known && (
                    <ProblemStatusIcon status={statusOf(progress, p.slug)} className="shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {p.title}
                    {known && (
                      <span className="sr-only">
                        . {PROBLEM_STATUS_LABEL[statusOf(progress, p.slug)]}.
                      </span>
                    )}
                  </span>
                  {p.slug === current && <span className="text-xs text-fg-subtle">current</span>}
                  <DifficultyBadge difficulty={p.difficulty} />
                  <CategoryBadge category={p.category} className="max-sm:hidden" />
                </button>
              ))
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void confirm()}
            disabled={busy || choice === current}
          >
            {busy && <Spinner />}
            Change problem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
