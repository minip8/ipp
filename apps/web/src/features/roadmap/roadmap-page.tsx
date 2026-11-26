'use client';
/**
 * The Roadmap tab, the same page in both tracks: the study path (the default view: the track's
 * topics in order, see study-path.tsx) and the topic maps (`?view=maps`: each topic's areas as a
 * graph, see features/quiz/roadmap.tsx), both scoped to the track.
 */
import type { Track } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { PageHeader, TAB_PAGE } from '@/components/page-header';
import { PageTabPanel, PageTabs, usePageView } from '@/components/page-tabs';
import { ErrorState } from '@/components/states';
import { Card } from '@/components/ui/card';
import { QuizRoadmap } from '@/features/quiz/roadmap';
import { nodeState } from '@/features/quiz/roadmap-logic';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { ROADMAP_VIEWS, topicsOf } from '@/lib/track';
import { PathSkeleton, StudyPathView } from './study-path';

const BLURB: Record<Track, string> = {
  software:
    'The software topics in the order to study them, and a map of the areas inside each one.',
  quant:
    'The quant topics in the order to study them for a trading or research interview, and a map of the areas inside each one.',
};

export function RoadmapPage({ track }: { track: Track }) {
  const [view, setView] = usePageView(ROADMAP_VIEWS);
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  const mine = useMemo(() => topicsOf(topics.data ?? [], track), [topics.data, track]);
  const done = mine.filter((t) => nodeState(t) === 'complete').length;
  return (
    <div className={TAB_PAGE}>
      <PageHeader
        title="Roadmap"
        description={BLURB[track]}
        stats={
          topics.data && mine.length > 0
            ? [
                {
                  label: 'Topics done',
                  value: (
                    <>
                      {done}
                      <span className="font-normal text-fg-subtle">/{mine.length}</span>
                    </>
                  ),
                },
              ]
            : null
        }
      />
      <PageTabs
        className="mt-6"
        label="Roadmap"
        value={view}
        onValueChange={setView}
        tabs={[
          { value: 'path', label: 'Study path' },
          { value: 'maps', label: 'Topic maps' },
        ]}
      >
        <PageTabPanel value="path" className="mt-5">
          {topics.isPending ? (
            <PathSkeleton />
          ) : topics.isError ? (
            <Card>
              <ErrorState error={topics.error} onRetry={() => topics.refetch()} />
            </Card>
          ) : (
            <StudyPathView track={track} topics={topics.data} />
          )}
        </PageTabPanel>
        <PageTabPanel value="maps" className="mt-5">
          <QuizRoadmap track={track} />
        </PageTabPanel>
      </PageTabs>
    </div>
  );
}
