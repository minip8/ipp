'use client';
/**
 * A pad that is a stage of a staged interview (`PadDetail.interview`, the owner's alone): where
 * it sits ("Stage 2 of 3", the interview's title on its popover), and moving on. Before the last
 * stage the pad's End ends the stage; once it has ended (or a quant round finished by itself)
 * the way on is "Next: <the next stage>", which ends this stage if need be and opens the next
 * one's pad, or "End interview here". The last stage's End ends the interview and opens its page.
 *
 * A pad of a one-stage interview, and every pad started on its own, has none of this.
 */
import type { PadInterview } from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightIcon, FlagIcon, LayersIcon, RotateCwIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { stageSummary } from '@/features/interview/logic';
import { useStageNames } from '@/features/interview/use-names';
import { startError } from '@/features/interview-builder/logic';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { usePad } from './session';

/** The pad's stage, when it is one of an interview of more than one stage. */
export function useStage(): {
  interview: PadInterview;
  /** This is the interview's last stage. */
  last: boolean;
  /** A stage follows, and the interview is still going. */
  hasNext: boolean;
  /** "Probability, Brainteasers · 3 questions · 20 min" */
  nextSummary: string | null;
} | null {
  const { interview } = usePad();
  const names = useStageNames();
  if (!interview || interview.total <= 1) return null;
  const last = interview.index === interview.total - 1;
  const hasNext = interview.active && !last && interview.next !== null;
  return {
    interview,
    last,
    hasNext,
    nextSummary: interview.next ? stageSummary(interview.next, names) : null,
  };
}

/** Caches to refresh once the interview has moved: its own, the lists, this pad. */
function useRefresh() {
  const qc = useQueryClient();
  const { state } = usePad();
  return (interviewId: string) => {
    void qc.invalidateQueries({ queryKey: qk.interview(interviewId) });
    void qc.invalidateQueries({ queryKey: qk.interviews });
    void qc.invalidateQueries({ queryKey: qk.pads });
    void qc.invalidateQueries({ queryKey: qk.pad(state.pad.id) });
  };
}

/** Move on to the next stage: this one ends if it has not, and the next one's pad opens. */
export function useAdvance(interview: PadInterview) {
  const router = useRouter();
  const qc = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => api.advanceInterview(interview.id, { from: interview.index }),
    onSuccess: ({ interview: next, padId }) => {
      qc.setQueryData(qk.interview(next.id), next);
      refresh(next.id);
      router.push(padId ? `/pads/${padId}` : `/interviews/${next.id}`);
    },
  });
}

/** End the interview here: this stage ends if it has not, and the ones not started are skipped. */
export function useEndInterview(interview: PadInterview) {
  const router = useRouter();
  const qc = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => api.endInterview(interview.id),
    onSuccess: (ended) => {
      qc.setQueryData(qk.interview(ended.id), ended);
      refresh(ended.id);
      router.push(`/interviews/${ended.id}`);
    },
  });
}

/** "Stage 2 of 3" in the top bar; its popover names the interview and links to its page. */
export function StageChip({ compact }: { compact?: boolean }) {
  const stage = useStage();
  if (!stage) return null;
  const { interview } = stage;
  const position = `Stage ${interview.index + 1} of ${interview.total}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="stage-chip"
          aria-label={`${position} of ${interview.title}`}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-accent-soft px-1.5 text-2xs font-medium whitespace-nowrap text-accent-text hover:bg-accent-soft/70',
            compact ? 'h-6' : 'h-5',
          )}
        >
          <LayersIcon className="size-3" aria-hidden />
          {compact ? `${interview.index + 1}/${interview.total}` : position}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <p className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">{position}</p>
        <p className="mt-1 font-medium">{interview.title}</p>
        <p className="mt-1 text-xs text-fg-muted">
          {stage.last
            ? 'This is the last stage.'
            : stage.nextSummary
              ? `Next: ${stage.nextSummary}`
              : null}
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link href={`/interviews/${interview.id}`}>
            Open the interview <ArrowRightIcon />
          </Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Next: <the next stage>", the way on from a stage. Pending, it is disabled; a refusal (the
 * next stage's topics short of questions, say) is shown under it, and it tries again.
 */
export function NextStageButton({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  const stage = useStage();
  if (!stage?.hasNext) return null;
  return <NextStage stage={stage} size={size} className={className} />;
}

function NextStage({
  stage,
  size,
  className,
}: {
  stage: NonNullable<ReturnType<typeof useStage>>;
  size: 'sm' | 'md';
  className?: string;
}) {
  const advance = useAdvance(stage.interview);
  return (
    <div className={cn('min-w-0', className)}>
      <Button
        variant="primary"
        size={size}
        className="max-w-full max-lg:h-10"
        disabled={advance.isPending}
        onClick={() => advance.mutate()}
        data-testid="next-stage"
      >
        {advance.isPending ? <Spinner /> : advance.isError ? <RotateCwIcon /> : <ArrowRightIcon />}
        <span className="truncate">
          {advance.isError ? 'Try again: ' : 'Next: '}
          {stage.nextSummary}
        </span>
      </Button>
      {advance.isError && (
        <p role="alert" className="mt-1.5 text-sm text-bad-text" data-testid="next-stage-error">
          {startError(advance.error)}
        </p>
      )}
    </div>
  );
}

/** "End interview here", confirmed: the stages not started yet are skipped. */
export function EndInterviewHere({ className }: { className?: string }) {
  const stage = useStage();
  const [open, setOpen] = useState(false);
  if (!stage?.interview.active || stage.last) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn('max-lg:h-10', className)}
        onClick={() => setOpen(true)}
      >
        <FlagIcon /> End interview here
      </Button>
      <EndInterviewDialog open={open} onOpenChange={setOpen} interview={stage.interview} />
    </>
  );
}

function EndInterviewDialog({
  open,
  onOpenChange,
  interview,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  interview: PadInterview;
}) {
  const end = useEndInterview(interview);
  const left = interview.total - interview.index - 1;
  return (
    <Dialog open={open} onOpenChange={(o) => !end.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>End the interview here?</DialogTitle>
          <DialogDescription>
            {`The ${plural(left, 'stage')} after this one ${left === 1 ? 'is' : 'are'} skipped. The interview’s page has the report of every stage you took and the overall result.`}
          </DialogDescription>
        </DialogHeader>
        {end.isError && (
          <DialogBody>
            <p role="alert" className="text-sm text-bad-text">
              {startError(end.error)}
            </p>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={end.isPending} onClick={() => onOpenChange(false)}>
            Keep going
          </Button>
          <Button variant="primary" disabled={end.isPending} onClick={() => end.mutate()}>
            {end.isPending && <Spinner />}
            End interview
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
