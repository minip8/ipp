'use client';
import { useSearchParams } from 'next/navigation';
import { Tabs as T } from 'radix-ui';
import type * as React from 'react';
import { useCallback } from 'react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/** The search param that holds a hub page's view; the default (first) view is never written. */
export const VIEW_PARAM = 'view';

/**
 * A hub page's view, kept in `?view=` so it can be linked and Back returns to the previous one.
 * The first view is the default and leaves the param out. Other params on the page are kept:
 * the URL is rebuilt from `window.location`, as the pages' own `replaceState` calls do.
 * `views` should be a module-level constant.
 */
export function usePageView<V extends string>(views: readonly [V, ...V[]]) {
  const params = useSearchParams();
  const raw = params.get(VIEW_PARAM);
  const view = views.find((v) => v === raw) ?? views[0];
  const setView = useCallback(
    (next: V) => {
      const q = new URLSearchParams(window.location.search);
      const current = q.get(VIEW_PARAM);
      if (next === views[0]) q.delete(VIEW_PARAM);
      else q.set(VIEW_PARAM, next);
      if ((q.get(VIEW_PARAM) ?? null) === current) return;
      const search = q.toString();
      // Next keeps useSearchParams in step with the native History API.
      window.history.pushState(
        null,
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
      );
    },
    [views],
  );
  return [view, setView] as const;
}

export type PageTab<V extends string> = {
  value: V;
  label: string;
  /** Shown beside the label once known (null or undefined while loading). */
  count?: number | null;
};

/**
 * The page-level view switch under a hub page's title (Interviews, Quizzes). Tabs fill the width
 * on phones and sit at the start of the row from `sm` up. Panels go in `children`.
 */
export function PageTabs<V extends string>({
  value,
  onValueChange,
  tabs,
  label,
  className,
  children,
}: {
  value: V;
  onValueChange: (v: V) => void;
  tabs: PageTab<V>[];
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <T.Root value={value} onValueChange={(v) => onValueChange(v as V)} className={className}>
      <TabsList aria-label={label} className="h-11 border-b border-border">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="group min-w-0 justify-center px-3 text-base max-sm:flex-1"
          >
            <span className="truncate">{t.label}</span>
            {t.count != null && (
              <>
                <span
                  aria-hidden
                  className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 px-1.5 text-2xs font-medium text-fg-muted tabular group-data-[state=active]:bg-accent-soft group-data-[state=active]:text-accent-text"
                >
                  {t.count}
                </span>
                {/* Read as "History, 4" rather than "History4". */}
                <span className="sr-only">, {t.count}</span>
              </>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </T.Root>
  );
}

/**
 * One view of a `PageTabs`. `keepMounted` keeps an inactive panel in the DOM, hidden (so out of
 * the accessibility tree), for views whose in-progress state must survive a switch.
 */
export function PageTabPanel({
  value,
  keepMounted,
  className,
  ...props
}: Omit<React.ComponentProps<typeof T.Content>, 'forceMount'> & { keepMounted?: boolean }) {
  return (
    <T.Content
      value={value}
      forceMount={keepMounted ? true : undefined}
      className={cn(
        'min-w-0 focus-visible:outline-offset-4 data-[state=inactive]:hidden',
        className,
      )}
      {...props}
    />
  );
}
