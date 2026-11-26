'use client';
/**
 * The Interviews tab, the same page in both tracks (the skeleton Practice and Roadmap share):
 * the title and the track's figures, its pads under way, then "New interview" (the track's setup)
 * and "History" (its finished pads). Every list and figure is the track's own (`padsInTrack`).
 */
import type { Track } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageTabPanel, PageTabs, usePageView } from '@/components/page-tabs';
import { ErrorState } from '@/components/states';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DeletePadDialog } from '@/features/delete-pad/delete-pad-dialog';
import type { DeleteTarget } from '@/features/delete-pad/logic';
import { NewInterview } from '@/features/new/new-interview';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { INTERVIEW_VIEWS } from '@/lib/track';
import { cn } from '@/lib/utils';
import { interviewFigures, padsInTrack } from './logic';
import { ActivePads, PadHistory } from './pad-lists';
import { QuantNewInterview } from './quant-new-interview';

const BLURB: Record<Track, string> = {
  software: 'Solve a problem with the AI interviewer, or interview someone yourself.',
  quant: 'A live round of quant questions with the AI interviewer, or interview someone yourself.',
};

export function InterviewsPage({ track }: { track: Track }) {
  const [view, setView] = usePageView(INTERVIEW_VIEWS);
  const pads = useQuery({ queryKey: qk.pads, queryFn: api.pads });
  const { active, ended } = useMemo(() => padsInTrack(pads.data ?? [], track), [pads.data, track]);
  const [toDelete, setToDelete] = useState<DeleteTarget | null>(null);

  // What is under way, then a switch between starting something new and what you did before.
  return (
    <div
      className={cn(
        'mx-auto max-w-6xl px-4 pt-8 sm:px-6 lg:pb-8',
        // Room for the setup bar fixed to the bottom of phones (Software's start view only).
        view === 'start' && track === 'software'
          ? 'pb-[calc(6rem_+_env(safe-area-inset-bottom))]'
          : 'pb-[calc(2rem_+_env(safe-area-inset-bottom))]',
      )}
    >
      <PageHeader
        title="Interviews"
        description={BLURB[track]}
        stats={pads.data ? interviewFigures(track, { ended }) : null}
      />

      {pads.data && <ActivePads pads={active} onDelete={setToDelete} />}

      <PageTabs
        className="mt-6"
        label="Interviews"
        value={view}
        onValueChange={setView}
        tabs={[
          { value: 'start', label: 'New interview' },
          { value: 'history', label: 'History', count: pads.data ? ended.length : null },
        ]}
      >
        {/* Kept mounted while hidden: what was chosen in the setup survives a look at History. */}
        <PageTabPanel value="start" keepMounted className="mt-5">
          {track === 'software' ? <NewInterview /> : <QuantNewInterview />}
        </PageTabPanel>
        <PageTabPanel value="history" className="mt-5">
          {pads.isPending ? (
            <div role="status" aria-busy="true" aria-label="Loading interviews">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : pads.isError ? (
            <Card>
              <ErrorState error={pads.error} onRetry={() => pads.refetch()} compact />
            </Card>
          ) : (
            <PadHistory track={track} pads={ended} onDelete={setToDelete} />
          )}
        </PageTabPanel>
      </PageTabs>
      <DeletePadDialog target={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}
