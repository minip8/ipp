'use client';
/**
 * The Interviews tab's "New interview", the same in both tracks: "Practise with the AI" is the
 * interview builder (a staged mock interview with the AI interviewer), "Interview someone"
 * (`?mode=host`) the track's room setup: a coding room on a problem from the library, or a quant
 * room on questions of the bank. The switch sits at the top of each setup panel, so switching
 * modes leaves it where it was.
 */
import type { Track } from '@ipp/contracts';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { InterviewBuilder } from '@/features/interview-builder/interview-builder';
import { HostSetup } from '@/features/new/host-setup';
import { KindSwitch, useInterviewMode } from './kind-switch';

/**
 * Setting up a quant room: its own chunk (it typesets math, so KaTeX loads with it and never with
 * the builder).
 */
const QuantRoomSetup = dynamic(
  () => import('@/features/quant-room/setup').then((m) => m.QuantRoomSetup),
  { ssr: false, loading: () => <Skeleton className="h-[560px] w-full" /> },
);

export function NewInterview({ track }: { track: Track }) {
  const [mode, setMode] = useInterviewMode();
  const header = <KindSwitch value={mode} onValueChange={setMode} />;
  if (mode === 'host')
    return track === 'software' ? (
      <HostSetup header={header} />
    ) : (
      <section aria-labelledby="new-interview-heading">
        <h2 id="new-interview-heading" className="sr-only">
          Host a quant interview
        </h2>
        <QuantRoomSetup header={header} track="quant" />
      </section>
    );
  return (
    <section aria-labelledby="new-interview-heading">
      <h2 id="new-interview-heading" className="sr-only">
        New interview
      </h2>
      <InterviewBuilder track={track} header={header} />
    </section>
  );
}
