import type * as React from 'react';

/**
 * The top of a track tab (Interviews, Practice, Roadmap): title and one line on the left, a few
 * figures on the right. The software Interviews page (features/dashboard) draws the same.
 */
export function PageHeader({
  title,
  description,
  stats,
}: {
  title: string;
  description: React.ReactNode;
  /** Shown once known; label and value. */
  stats?: { label: string; value: React.ReactNode }[] | null;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{description}</p>
      </div>
      {stats && stats.length > 0 && (
        <dl className="flex gap-6 text-right">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-fg-muted">{s.label}</dt>
              <dd className="text-lg font-semibold tabular">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** A track tab's page box: the width, gutters and room at the bottom every tab shares. */
export const TAB_PAGE =
  'mx-auto max-w-6xl px-4 pt-8 pb-[calc(2rem_+_env(safe-area-inset-bottom))] sm:px-6';
