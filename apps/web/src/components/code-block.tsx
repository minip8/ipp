'use client';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Highlighter = {
  codeToHtml: (
    code: string,
    opts: { lang: string; themes: { light: string; dark: string }; defaultColor: 'light' },
  ) => string;
};
let highlighterPromise: Promise<Highlighter> | null = null;

const LANG_ALIASES: Record<string, string> = {
  'c++': 'cpp',
  cc: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  py: 'python',
  python3: 'python',
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
};
const SUPPORTED = new Set([
  'cpp',
  'python',
  'java',
  'json',
  'bash',
  'javascript',
  'typescript',
  'c',
]);

/** Shiki loaded on first use, with just the grammars this product needs and JS regex engine. */
function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [
        import('shiki/themes/github-light-default.mjs'),
        import('shiki/themes/github-dark-default.mjs'),
      ],
      langs: [
        import('shiki/langs/cpp.mjs'),
        import('shiki/langs/c.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/java.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/bash.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/typescript.mjs'),
      ],
      engine: createJavaScriptRegexEngine(),
    }) as unknown as Promise<Highlighter>;
  })();
  return highlighterPromise;
}

export function normalizeLang(lang?: string): string | null {
  if (!lang) return null;
  const l = LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
  return SUPPORTED.has(l) ? l : null;
}

export function CodeBlock({
  code,
  language,
  className,
  lineNumbers,
}: {
  code: string;
  language?: string | null;
  className?: string;
  lineNumbers?: boolean;
}) {
  const lang = normalizeLang(language ?? undefined);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!lang) return;
    getHighlighter()
      .then((h) => {
        if (!cancelled)
          setHtml(
            h.codeToHtml(code, {
              lang,
              themes: { light: 'github-light-default', dark: 'github-dark-default' },
              defaultColor: 'light',
            }),
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const base = cn(
    'code-block max-w-full overflow-x-auto overscroll-x-contain rounded-md border border-border bg-surface-2 py-3 font-mono text-sm leading-[1.6]',
    lineNumbers ? 'pr-4' : 'px-3.5',
    className,
  );
  if (html) {
    // Shiki output is generated from plain text by the highlighter: it escapes all content.
    return (
      <div
        className={cn(base, lineNumbers && 'with-line-numbers')}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped highlighter output, not user HTML
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className={cn(base, lineNumbers && 'with-line-numbers')}>
      <code>
        {lineNumbers
          ? code.split('\n').map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines of static text
              <span key={i} className="line">
                {l}
                {'\n'}
              </span>
            ))
          : code}
      </code>
    </pre>
  );
}
