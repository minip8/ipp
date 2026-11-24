import Link from 'next/link';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)} aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="5.5" fill="var(--accent)" />
      <path
        d="M7.5 7.5 4.75 12l2.75 4.5"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 12h6M15 9v6"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 rounded-md font-semibold tracking-tight text-fg',
        className,
      )}
    >
      <LogoMark />
      <span className="text-base">
        interview<span className="text-accent-text">++</span>
      </span>
    </Link>
  );
}
