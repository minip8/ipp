'use client';
/**
 * The Quant track's "New interview", in the Software setup's skeleton: what to work on on the
 * left, the setup panel on the right with "Practise with the AI | Interview someone" at its top
 * (`?mode=host`), so switching modes leaves the switch where it was. Practising is a live round
 * with the AI interviewer on a path (`?path=`); interviewing someone sets up a quant room on
 * questions of the bank, its browser starting on Quant.
 */
import dynamic from 'next/dynamic';
import { usePageView } from '@/components/page-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { PATH_PARAM, PATHS } from '@/features/quant/logic';
import { RoundSetup } from '@/features/quant/round-setup';
import { KindSwitch, useInterviewMode } from './kind-switch';

/**
 * Setting up a quant room: its own chunk (it typesets math, so KaTeX loads with it and never with
 * the round's setup).
 */
const QuantRoomSetup = dynamic(
  () => import('@/features/quant-room/setup').then((m) => m.QuantRoomSetup),
  { ssr: false, loading: () => <Skeleton className="h-[560px] w-full" /> },
);

export function QuantNewInterview() {
  const [mode, setMode] = useInterviewMode();
  const [path, setPath] = usePageView(PATHS, PATH_PARAM);
  const header = <KindSwitch value={mode} onValueChange={setMode} />;
  return (
    <section aria-labelledby="new-interview-heading">
      <h2 id="new-interview-heading" className="sr-only">
        {mode === 'host' ? 'Host a quant interview' : 'New interview'}
      </h2>
      {mode === 'host' ? (
        <QuantRoomSetup header={header} track="quant" />
      ) : (
        <RoundSetup path={path} onPathChange={setPath} header={header} />
      )}
    </section>
  );
}
