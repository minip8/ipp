'use client';
import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { CodeBlock } from './code-block';

/**
 * Markdown without raw HTML (react-markdown ignores HTML unless rehype-raw is added, and we never
 * add it). Used for problem statements, quiz prompts/explanations and interviewer messages.
 */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...rest }) => {
    const match = /language-(\w+)/.exec(className ?? '');
    const text = String(children ?? '');
    const isBlock = Boolean(match) || text.includes('\n');
    if (!isBlock) return <code {...rest}>{children}</code>;
    return <CodeBlock code={text.replace(/\n$/, '')} language={match?.[1]} />;
  },
  // Wide tables scroll inside the text column rather than widening the page.
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
  img: () => null,
};

export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn('prose-ipp', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
});
