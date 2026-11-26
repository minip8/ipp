'use client';
/** The way into the mental math drill from the Quant page (both paths). */
import { DRILL_LEVEL_LABEL, type DrillConfig } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import { TimerIcon, TrophyIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { bestFor, DURATION_LABEL } from './logic';
import { loadDrillSetup } from './storage';

export const DRILL_HREF = '/quant/drill';

export function DrillCard() {
  const history = useQuery({ queryKey: qk.drillRuns, queryFn: api.drillRuns });
  // The best for the setup last used in this browser (read after mount: storage is per browser).
  const [setup, setSetup] = useState<DrillConfig | null>(null);
  useEffect(() => setSetup(loadDrillSetup()), []);
  const best =
    setup && history.data ? bestFor(history.data.bests, setup.durationSec, setup.level) : null;
  return (
    <Card aria-labelledby="quant-drill-heading" className="space-y-3 p-4" data-testid="drill-card">
      <div className="space-y-1">
        <h2 id="quant-drill-heading" className="text-sm font-semibold">
          Mental math drill
        </h2>
        <p className="text-sm text-fg-muted">
          Timed arithmetic answered from the keyboard, the speed test trading interviews often start
          with.
        </p>
      </div>
      {best && setup && (
        <p className="flex items-center gap-1.5 text-sm" data-testid="drill-card-best">
          <TrophyIcon className="size-4 shrink-0 text-warn" aria-hidden />
          <span>
            Your best at {DURATION_LABEL[setup.durationSec]} · {DRILL_LEVEL_LABEL[setup.level]}:{' '}
            <span className="font-semibold tabular">{best.score}</span>
          </span>
        </p>
      )}
      <Button asChild variant="secondary" className="w-full max-sm:h-10">
        <Link href={DRILL_HREF}>
          <TimerIcon />
          Start a drill
        </Link>
      </Button>
    </Card>
  );
}
