import type { ReactNode } from 'react';
import { RememberTrack } from '@/components/remember-track';

/** Every page under /software is in the Software track, and arriving on one remembers it. */
export default function SoftwareLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <RememberTrack track="software" />
      {children}
    </>
  );
}
