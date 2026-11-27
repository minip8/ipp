'use client';
/**
 * The Interviews tab, the same page in both tracks (the skeleton Practice and Roadmap share):
 * the title and the track's figures, what is under way, then "New interview" (the builder, or
 * hosting) and "History" (what was finished). Every list and figure is the track's own: its
 * staged interviews (`interview.track`) and the pads started on their own (`padsInTrack`).
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
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { INTERVIEW_VIEWS } from '@/lib/track';
import { cn } from '@/lib/utils';
import { interviewFigures, rowsInTrack } from './logic';
import { NewInterview } from './new-interview';
import { ActiveRows, History } from './pad-lists';

const BLURB: Record<Track, string> = {
  software:
    'A mock interview in stages with the AI interviewer, built your way, or interview someone yourself.',
  quant:
    'A mock interview in stages with the AI interviewer: questions, games and code, or interview someone yourself.',
};

export function InterviewsPage({ track }: { track: Track }) {
  const [view, setView] = usePageView(INTERVIEW_VIEWS);
  const pads = useQuery({ queryKey: qk.pads, queryFn: api.pads });
  const interviews = useQuery({ queryKey: qk.interviews, queryFn: api.interviews });
  const loaded = Boolean(pads.data && interviews.data);
  const { active, ended } = useMemo(
    () => rowsInTrack(interviews.data ?? [], pads.data ?? [], track),
    [interviews.data, pads.data, track],
  );
  const [toDelete, setToDelete] = useState<DeleteTarget | null>(null);
  const failed = pads.isError ? pads : interviews.isError ? interviews : null;

  // What is under way, then a switch between starting something new and what you did before.
  return (
    <div
      className={cn(
        'mx-auto max-w-6xl px-4 pt-8 sm:px-6 lg:pb-8',
        // Room for the setup bar fixed to the bottom of phones (the start view).
        view === 'start'
          ? 'pb-[calc(6rem_+_env(safe-area-inset-bottom))]'
          : 'pb-[calc(2rem_+_env(safe-area-inset-bottom))]',
      )}
    >
      <PageHeader
        title="Interviews"
        description={BLURB[track]}
        stats={loaded ? interviewFigures(track, { ended }, pads.data ?? []) : null}
      />

      {loaded && <ActiveRows rows={active} onDelete={setToDelete} />}

      <PageTabs
        className="mt-6"
        label="Interviews"
        value={view}
        onValueChange={setView}
        tabs={[
          { value: 'start', label: 'New interview' },
          { value: 'history', label: 'History', count: loaded ? ended.length : null },
        ]}
      >
        {/* Kept mounted while hidden: what was chosen in the setup survives a look at History. */}
        <PageTabPanel value="start" keepMounted className="mt-5">
          <NewInterview track={track} />
        </PageTabPanel>
        <PageTabPanel value="history" className="mt-5">
          {failed ? (
            <Card>
              <ErrorState error={failed.error} onRetry={() => failed.refetch()} compact />
            </Card>
          ) : !loaded ? (
            <div role="status" aria-busy="true" aria-label="Loading interviews">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <History track={track} rows={ended} onDelete={setToDelete} />
          )}
        </PageTabPanel>
      </PageTabs>
      <DeletePadDialog target={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}
