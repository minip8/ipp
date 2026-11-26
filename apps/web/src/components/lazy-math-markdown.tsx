'use client';
/**
 * `MathMarkdown`, loaded only when first rendered: for pages that show math for some records and
 * not others (the report typesets a quant pad's transcript, never a coding pad's), so KaTeX loads
 * only where it is used. Until it arrives the text shows as plain Markdown.
 */
import { lazy, Suspense } from 'react';
import { Markdown } from './markdown';

const MathMarkdown = lazy(() =>
  import('./math-markdown').then((m) => ({ default: m.MathMarkdown })),
);

export function LazyMathMarkdown(props: { children: string; className?: string }) {
  return (
    <Suspense fallback={<Markdown {...props} />}>
      <MathMarkdown {...props} />
    </Suspense>
  );
}
