'use client';
/**
 * Markdown with LaTeX math (`$inline$`, `$$display$$`), rendered by KaTeX. For quiz surfaces
 * only: KaTeX's script, stylesheet and fonts load with the pages that import this file, and never
 * with a pad, whose chat and problem statement use the plain `Markdown`. The fonts are bundled
 * from the katex package and served from our own origin (the CSP allows no other).
 */
import 'katex/dist/katex.min.css';
import { memo } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';
import { markdownComponents } from './markdown';
import { rehypeMathGuard, type Segment, segmentsToMarkdown, splitMath } from './math-guard';

const rehypePlugins: Options['rehypePlugins'] = [
  rehypeMathGuard,
  // Unknown commands render as red source text instead of failing; nothing is logged.
  [rehypeKatex, { strict: 'ignore' }],
];
const blockPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath];
// A one-line summary is escaped plain text: math is the only Markdown in it.
const inlinePlugins: Options['remarkPlugins'] = [remarkMath];
const inlineComponents: Components = {
  ...markdownComponents,
  p: ({ children }) => <>{children}</>,
};

export const MathMarkdown = memo(function MathMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn('prose-ipp', className)}>
      <ReactMarkdown
        remarkPlugins={blockPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
        skipHtml
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

/**
 * Plain text (a prompt's first line, say) shown as written, with its math typeset. Takes the text
 * or its segments (`splitMath`), when the caller has already decided what is math.
 */
export const MathText = memo(function MathText({
  children,
  className,
}: {
  children: string | Segment[];
  className?: string;
}) {
  const segments = typeof children === 'string' ? splitMath(children) : children;
  if (!segments.some((s) => s.kind === 'math'))
    return <span className={className}>{segments.map((s) => s.text).join('')}</span>;
  return (
    <span className={cn('math-text', className)}>
      <ReactMarkdown
        remarkPlugins={inlinePlugins}
        rehypePlugins={rehypePlugins}
        components={inlineComponents}
        skipHtml
      >
        {segmentsToMarkdown(segments)}
      </ReactMarkdown>
    </span>
  );
});
