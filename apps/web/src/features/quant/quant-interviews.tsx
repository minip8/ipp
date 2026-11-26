'use client';
/**
 * The Quant track's Interviews tab: a live round with the AI interviewer on the chosen path
 * (Trader | Researcher, in `?path=` as on the Roadmap's study path). Rounds under way and finished
 * are on the software Interviews tab for now, which lists every pad.
 */
import { QUANT_PATH_INFO } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, TAB_PAGE } from '@/components/page-header';
import { usePageView } from '@/components/page-tabs';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { PATH_PARAM, PATHS } from './logic';
import { QuantPathPicker } from './path-picker';
import { RoundSetup } from './round-setup';

export function QuantInterviews() {
  const [path, setPath] = usePageView(PATHS, PATH_PARAM);
  const pads = useQuery({ queryKey: qk.pads, queryFn: api.pads });
  const rounds = pads.data?.filter((p) => p.format === 'quant' && p.status === 'ended');
  return (
    <div className={TAB_PAGE}>
      <PageHeader
        title="Interviews"
        description="A live round of quant questions with the AI interviewer, against the clock."
        stats={rounds ? [{ label: 'Rounds', value: rounds.length }] : null}
      />
      <div className="mt-6 space-y-3">
        <QuantPathPicker value={path} onValueChange={setPath} />
        <p className="text-sm text-fg-muted" data-testid="path-description">
          {QUANT_PATH_INFO[path].description}
        </p>
      </div>
      {/* One setup per path, as before: switching paths starts from that path's saved choices. */}
      <div className="mt-5">
        <RoundSetup key={path} path={path} />
      </div>
    </div>
  );
}
