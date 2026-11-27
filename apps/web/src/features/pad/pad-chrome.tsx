'use client';
/** Pieces of the pad's frame shared by the coding and the quant workspace. */
import { LockIcon } from 'lucide-react';
import Link from 'next/link';
import { Separator } from 'react-resizable-panels';
import { cn } from '@/lib/utils';
import { usePad } from './session';
import { EndInterviewHere, NextStageButton, useStage } from './stage';

export function ResizeHandle({ vertical }: { vertical?: boolean }) {
  return (
    <Separator
      className={cn(
        'group relative shrink-0 bg-border outline-none transition-colors data-[separator=active]:bg-accent data-[separator=focus]:bg-accent data-[separator=hover]:bg-accent/60',
        vertical ? 'h-px' : 'w-px',
      )}
    >
      <span
        className={cn('absolute', vertical ? '-inset-y-1 inset-x-0' : '-inset-x-1 inset-y-0')}
        aria-hidden
      />
    </Separator>
  );
}

/**
 * Once the pad has ended: it is read-only, and the report is a click away. A stage of an
 * interview says so, with the way on to the next stage (or to the interview's results).
 */
export function EndedBanner() {
  const pad = usePad();
  const stage = useStage();
  if (!pad.readOnly) return null;
  const report = (
    <Link
      href={`/pads/${pad.state.pad.id}/report`}
      className="font-medium text-accent-text hover:underline"
    >
      See the report
    </Link>
  );
  if (stage)
    return (
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-accent-soft/50 px-4 py-2 text-sm max-lg:px-3"
        role="status"
        data-testid="stage-ended"
      >
        <LockIcon className="size-4 text-accent-text" aria-hidden />
        <span>
          {stage.hasNext
            ? `Stage ${stage.interview.index + 1} of ${stage.interview.total} is over. The pad is read-only.`
            : 'This interview has ended. The pad is read-only.'}
        </span>
        {report}
        {!stage.hasNext && (
          <Link
            href={`/interviews/${stage.interview.id}`}
            className="font-medium text-accent-text hover:underline"
          >
            See the interview’s results
          </Link>
        )}
        {stage.hasNext && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:ml-auto">
            <NextStageButton />
            <EndInterviewHere />
          </div>
        )}
      </div>
    );
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-border bg-accent-soft/50 px-4 py-1.5 text-sm max-lg:flex-wrap max-lg:gap-x-2 max-lg:gap-y-0.5 max-lg:px-3"
      role="status"
    >
      <LockIcon className="size-4 text-accent-text" aria-hidden />
      <span>This interview has ended. The pad is read-only.</span>
      {/* A room's report belongs to its host. */}
      {(!pad.isRoom || pad.isHost) && report}
    </div>
  );
}
