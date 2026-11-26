import type { ReactNode } from 'react';
import { RememberTrack } from '@/components/remember-track';

/** Every page under /quant is in the Quant track, and arriving on one remembers it. */
export default function QuantLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <RememberTrack track="quant" />
      {children}
    </>
  );
}
