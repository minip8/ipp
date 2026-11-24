/** What the pad's clock shows: a countdown to the planned end, or the time elapsed when there is none. */
import type { Pad } from '@ipp/contracts';
import { formatClock } from '@/lib/format';

export interface TimerView {
  label: string;
  /** Counting up: the pad has no time limit. */
  elapsed: boolean;
  /** Past the planned end. */
  over: boolean;
  /** Five minutes or less to go. */
  warn: boolean;
}

export function timerView(
  pad: Pick<Pad, 'startedAt' | 'endedAt' | 'durationMin' | 'status'>,
  now: number,
): TimerView {
  const start = Date.parse(pad.startedAt);
  const at = pad.status === 'ended' && pad.endedAt ? Date.parse(pad.endedAt) : now;
  if (pad.durationMin === null) {
    const sec = Math.max(0, Math.round((at - start) / 1000));
    return { label: formatClock(sec), elapsed: true, over: false, warn: false };
  }
  const left = Math.round((start + pad.durationMin * 60_000 - at) / 1000);
  const over = left < 0;
  return {
    label: over ? `+${formatClock(-left)}` : formatClock(left),
    elapsed: false,
    over,
    warn: !over && left <= 5 * 60,
  };
}
