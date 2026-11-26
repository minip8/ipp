'use client';
/**
 * "Practise with the AI | Interview someone": the first choice of the Interviews tab's setup in
 * both tracks, at the top of its setup panel. Hosting is kept in `?mode=host` (replaced, not
 * pushed: it is a setting of the page, not a place to go back to).
 */
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Segmented } from '@/components/ui/segmented';

export type InterviewMode = 'practice' | 'host';

const MODE_PARAM = 'mode';

/** Whether the setup is for hosting, from `?mode=host`, and the way to change it. */
export function useInterviewMode() {
  const params = useSearchParams();
  const [mode, setModeState] = useState<InterviewMode>(
    params.get(MODE_PARAM) === 'host' ? 'host' : 'practice',
  );
  const setMode = (next: InterviewMode) => {
    setModeState(next);
    const q = new URLSearchParams(window.location.search);
    if (next === 'host') q.set(MODE_PARAM, 'host');
    else q.delete(MODE_PARAM);
    const search = q.toString();
    window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
  };
  return [mode, setMode] as const;
}

export function KindSwitch({
  value,
  onValueChange,
}: {
  value: InterviewMode;
  onValueChange: (m: InterviewMode) => void;
}) {
  return (
    <Segmented
      aria-label="Kind of interview"
      // Phones: a size a finger can hit, and less padding so both fit at 360px.
      className="flex w-full max-sm:[&>*]:h-9 max-sm:[&>*]:px-1.5"
      value={value}
      onValueChange={onValueChange}
      options={[
        { value: 'practice', label: 'Practise with the AI' },
        { value: 'host', label: 'Interview someone' },
      ]}
    />
  );
}
