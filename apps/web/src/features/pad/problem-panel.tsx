'use client';
import { CAPS, YDOC } from '@ipp/contracts';
import {
  ClockIcon,
  CpuIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  NotebookPenIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { CategoryBadge, DifficultyBadge } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMs, humanize, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { usePad } from './session';
import { describeTest, tyName } from './tests-format';

function Signature() {
  const { problem } = usePad().state;
  const sig = problem.signature;
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs leading-relaxed">
      <p className="text-fg-subtle">
        {sig.kind === 'design' ? 'Implement the class' : 'Implement'}
      </p>
      <p className="mt-0.5 text-fg">
        <span className="text-accent-text">class</span> {sig.className}
        {sig.kind === 'design' && (
          <span className="text-fg-muted">
            ({sig.ctorParams.map((p) => `${p.name}: ${tyName(p.type)}`).join(', ')})
          </span>
        )}
      </p>
      {sig.methods.map((m) => (
        <p key={m.name} className="pl-4 text-fg">
          {m.name}
          <span className="text-fg-muted">
            ({m.params.map((p) => `${p.name}: ${tyName(p.type)}`).join(', ')})
          </span>
          <span className="text-fg-subtle"> → </span>
          <span className="text-fg-muted">{tyName(m.returns)}</span>
          {m.compare !== 'exact' && (
            <span className="ml-2 font-sans text-2xs text-fg-subtle">(any order)</span>
          )}
        </p>
      ))}
    </div>
  );
}

function SampleTests() {
  const { problem } = usePad().state;
  if (problem.sampleTests.length === 0) return null;
  return (
    <section aria-labelledby="samples-heading" className="space-y-2">
      <h3
        id="samples-heading"
        className="text-2xs font-medium tracking-wider text-fg-subtle uppercase"
      >
        Sample tests
      </h3>
      {problem.sampleTests.map((t, i) => {
        const v = describeTest(problem.signature, t, t.expected, null);
        return (
          <div
            key={t.id}
            className="overflow-hidden rounded-md border border-border font-mono text-xs"
          >
            <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5 font-sans text-xs text-fg-muted">
              <span>Sample {i + 1}</span>
            </div>
            <div className="space-y-1 px-3 py-2 leading-relaxed">
              {v.kind === 'function' ? (
                <>
                  {v.params.map((p) => (
                    <p key={p.name} className="break-all">
                      <span className="text-fg-subtle">{p.name} = </span>
                      {p.value}
                    </p>
                  ))}
                  <p className="break-all">
                    <span className="text-fg-subtle">returns </span>
                    {v.call?.expected}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-fg-muted">{v.ctor}</p>
                  {v.calls.map((c, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: calls are positional
                    <p key={j} className="break-all">
                      {c.label}
                      {c.expected !== null && (
                        <span className="text-fg-subtle"> → {c.expected}</span>
                      )}
                    </p>
                  ))}
                </>
              )}
              {t.explanation && <p className="pt-1 font-sans text-fg-muted">{t.explanation}</p>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ProblemTab() {
  const { problem } = usePad().state;
  // Topics can give the approach away; they stay hidden until asked for.
  const [showTopics, setShowTopics] = useState(false);
  return (
    <div className="space-y-5 px-4 py-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{problem.title}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <DifficultyBadge difficulty={problem.difficulty} />
          <CategoryBadge category={problem.category} />
          {showTopics
            ? problem.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex h-5 items-center rounded-[4px] border border-border px-1.5 text-2xs text-fg-muted"
                >
                  {humanize(t)}
                </span>
              ))
            : problem.tags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowTopics(true)}
                  title="Topics can give away the intended approach"
                  className="inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-2xs text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg"
                >
                  <EyeIcon className="size-3" aria-hidden /> Show topics
                </button>
              )}
        </div>
      </div>
      <Markdown className="text-[13.5px]">{problem.statement}</Markdown>
      <Signature />
      <SampleTests />
      <dl className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-fg-muted">
        <div className="flex items-center gap-1.5">
          <ClockIcon className="size-3.5" aria-hidden />
          <dt className="sr-only">Time limit</dt>
          <dd>{formatMs(problem.limits.timeMs)} per test (C++)</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <CpuIcon className="size-3.5" aria-hidden />
          <dt className="sr-only">Memory limit</dt>
          <dd>{problem.limits.memoryMb} MB</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <EyeOffIcon className="size-3.5" aria-hidden />
          <dt className="sr-only">Hidden tests</dt>
          <dd>{plural(problem.hiddenTestCount, 'hidden test')} on submit</dd>
        </div>
      </dl>
    </div>
  );
}

/** Applies the minimal edit between two strings to a Y.Text. */
export function applyTextDiff(ytext: Y.Text, prev: string, next: string) {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  ytext.doc?.transact(() => {
    if (endPrev > start) ytext.delete(start, endPrev - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  }, 'notes');
}

function NotesTab() {
  const { collab, synced, readOnly } = usePad();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const ytext = collab?.doc.getText(YDOC.notes);

  useEffect(() => {
    if (!ytext) return;
    setValue(ytext.toString());
    const obs = (e: Y.YTextEvent) => {
      if (e.transaction.origin === 'notes' && e.transaction.local) return;
      const el = ref.current;
      const next = ytext.toString();
      if (el && document.activeElement === el) {
        // Keep the caret where it was relative to the text around it.
        const { selectionStart, selectionEnd } = el;
        let shift = 0;
        let idx = 0;
        for (const op of e.delta) {
          if (op.retain) idx += op.retain;
          else if (op.insert && typeof op.insert === 'string') {
            if (idx < selectionStart) shift += op.insert.length;
            idx += op.insert.length;
          } else if (op.delete) {
            if (idx < selectionStart) shift -= Math.min(op.delete, selectionStart - idx);
          }
        }
        setValue(next);
        requestAnimationFrame(() =>
          el.setSelectionRange(selectionStart + shift, selectionEnd + shift),
        );
      } else {
        setValue(next);
      }
    };
    ytext.observe(obs);
    return () => ytext.unobserve(obs);
  }, [ytext]);

  return (
    <div className="flex h-full flex-col">
      <label htmlFor="pad-notes" className="sr-only">
        Scratch notes
      </label>
      <textarea
        id="pad-notes"
        ref={ref}
        value={value}
        readOnly={readOnly || !synced}
        maxLength={CAPS.notesChars}
        placeholder={
          'Scratch space for your approach, edge cases and complexity.\n\nNotes are shared with everyone in this pad and kept in the report.'
        }
        onChange={(e) => {
          if (!ytext) return;
          const next = e.target.value;
          applyTextDiff(ytext, value, next);
          setValue(next);
        }}
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-fg outline-none placeholder:font-sans placeholder:text-fg-subtle"
      />
      <p className="shrink-0 border-t border-border px-4 py-1.5 text-right text-2xs text-fg-subtle tabular">
        {value.length.toLocaleString()} / {CAPS.notesChars.toLocaleString()}
      </p>
    </div>
  );
}

export function ProblemPanel({ className }: { className?: string }) {
  const [tab, setTab] = useState('problem');
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className={cn('flex h-full flex-col bg-surface', className)}
    >
      <TabsList aria-label="Problem panel" className="h-9 shrink-0 border-b border-border px-2">
        <TabsTrigger value="problem">
          <FileTextIcon /> Problem
        </TabsTrigger>
        <TabsTrigger value="notes">
          <NotebookPenIcon /> Notes
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="problem"
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
      >
        <ProblemTab />
      </TabsContent>
      <TabsContent
        value="notes"
        className="min-h-0 flex-1 focus-visible:outline-none"
        forceMount
        hidden={tab !== 'notes'}
      >
        <NotesTab />
      </TabsContent>
    </Tabs>
  );
}
