'use client';
import { CAPS, type CustomTest, type ProblemDetail, type ProblemSignature } from '@ipp/contracts';
import {
  CopyPlusIcon,
  FlaskConicalIcon,
  HistoryIcon,
  PlayIcon,
  PlusIcon,
  SquareTerminalIcon,
  TextCursorInputIcon,
  Trash2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RunVerdictIcon } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { fieldClass } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/components/ui/menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatTimeOfDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MODE_LABEL, runHeadline } from '@/lib/verdict';
import { usePad } from '../session';
import {
  compileDraft,
  type DraftTest,
  draftFromSample,
  emptyDraft,
  loadDrafts,
  saveDrafts,
} from './custom-tests';
import { NoRunsYet, RunProgressView, RunResult } from './run-result';

export type ConsoleTab = 'result' | 'custom' | 'stdin';

export function useConsoleState(padId: string) {
  const [tab, setTab] = useState<ConsoleTab>('result');
  const [stdin, setStdin] = useState('');
  const [drafts, setDraftsState] = useState<DraftTest[]>([]);
  useEffect(() => setDraftsState(loadDrafts(padId)), [padId]);
  const setDrafts = useCallback(
    (next: DraftTest[]) => {
      setDraftsState(next);
      saveDrafts(padId, next);
    },
    [padId],
  );
  return { tab, setTab, stdin, setStdin, drafts, setDrafts };
}
export type ConsoleState = ReturnType<typeof useConsoleState>;

export function compileAll(sig: ProblemSignature, drafts: DraftTest[]) {
  const results = drafts.map((d) => compileDraft(sig, d));
  const ok = results.every((r) => r.test);
  return {
    ok,
    tests: results.map((r) => r.test).filter((t): t is CustomTest => t !== null),
    results,
  };
}

function ArgField({
  id,
  label,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label
        htmlFor={id}
        className="w-20 shrink-0 truncate font-mono text-xs text-fg-muted"
        title={label}
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder="JSON, e.g. [1, 2, 3]"
        className={cn(fieldClass, 'h-7 min-w-0 flex-1 px-2 font-mono text-xs')}
      />
    </div>
  );
}

function CustomTestsTab({
  cs,
  onRun,
  problem,
}: {
  cs: ConsoleState;
  onRun: () => void;
  problem: ProblemDetail;
}) {
  const { readOnly, running } = usePad();
  const sig = problem.signature;
  const { drafts, setDrafts } = cs;
  const compiled = useMemo(() => compileAll(sig, drafts), [sig, drafts]);
  const update = (i: number, d: DraftTest) => setDrafts(drafts.map((x, j) => (j === i ? d : x)));
  const full = drafts.length >= CAPS.customTests;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-fg-muted">
          Your own inputs, run against your class. There is no expected output; you judge the
          result.
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={full || readOnly}
          onClick={() => setDrafts([...drafts, emptyDraft(sig)])}
        >
          <PlusIcon /> Add test
        </Button>
        {problem.sampleTests.length > 0 && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={full || readOnly}>
                <CopyPlusIcon /> From sample
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuLabel>Start from</MenuLabel>
              {problem.sampleTests.map((t, i) => (
                <MenuItem key={t.id} onSelect={() => setDrafts([...drafts, draftFromSample(t)])}>
                  Sample {i + 1}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={!compiled.ok || drafts.length === 0 || readOnly || Boolean(running)}
          onClick={onRun}
        >
          <FlaskConicalIcon /> Run custom tests
        </Button>
      </div>

      {drafts.length === 0 && (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-fg-muted">
          No custom tests yet. Add one, or copy a sample and change it to probe an edge case.
        </div>
      )}

      <ol className="space-y-3">
        {drafts.map((d, i) => {
          const errs = compiled.results[i]?.errors ?? [];
          const bad = (path: string) => errs.some((e) => e.path === path);
          return (
            <li key={d.id} className="rounded-md border border-border">
              <div className="flex h-8 items-center justify-between border-b border-border bg-surface-2 px-3">
                <span className="text-xs font-medium">Custom {i + 1}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove custom test ${i + 1}`}
                  disabled={readOnly}
                  onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <div className="space-y-2 p-3">
                {sig.kind === 'design' &&
                  sig.ctorParams.map((p, pi) => (
                    <ArgField
                      key={p.name}
                      id={`${d.id}-ctor-${pi}`}
                      label={p.name}
                      value={d.ctorArgs[pi] ?? ''}
                      invalid={bad(`ctor.${pi}`)}
                      disabled={readOnly}
                      onChange={(v) =>
                        update(i, { ...d, ctorArgs: d.ctorArgs.map((a, k) => (k === pi ? v : a)) })
                      }
                    />
                  ))}
                {d.calls.map((c, ci) => {
                  const m = sig.methods.find((x) => x.name === c.method);
                  return (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: calls are positional within a test
                      key={`${d.id}-${ci}`}
                      className={cn(sig.kind === 'design' && 'rounded-md border border-border p-2')}
                    >
                      {sig.kind === 'design' && (
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-2xs text-fg-subtle tabular">{ci + 1}.</span>
                          <select
                            aria-label={`Method for call ${ci + 1}`}
                            value={c.method}
                            disabled={readOnly}
                            onChange={(e) => {
                              const nm = sig.methods.find((x) => x.name === e.target.value);
                              update(i, {
                                ...d,
                                calls: d.calls.map((x, k) =>
                                  k === ci
                                    ? {
                                        method: e.target.value,
                                        args: (nm?.params ?? []).map(() => ''),
                                      }
                                    : x,
                                ),
                              });
                            }}
                            className={cn(fieldClass, 'h-7 w-auto px-2 font-mono text-xs')}
                          >
                            {sig.methods.map((mm) => (
                              <option key={mm.name} value={mm.name}>
                                {mm.name}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="ml-auto"
                            aria-label={`Remove call ${ci + 1}`}
                            disabled={d.calls.length <= 1 || readOnly}
                            onClick={() =>
                              update(i, { ...d, calls: d.calls.filter((_, k) => k !== ci) })
                            }
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(m?.params ?? []).map((p, ai) => (
                          <ArgField
                            key={p.name}
                            id={`${d.id}-${ci}-${ai}`}
                            label={p.name}
                            value={c.args[ai] ?? ''}
                            invalid={bad(`call.${ci}.${ai}`)}
                            disabled={readOnly}
                            onChange={(v) =>
                              update(i, {
                                ...d,
                                calls: d.calls.map((x, k) =>
                                  k === ci
                                    ? { ...x, args: x.args.map((a, q) => (q === ai ? v : a)) }
                                    : x,
                                ),
                              })
                            }
                          />
                        ))}
                        {m && m.params.length === 0 && (
                          <span className="text-xs text-fg-subtle">No arguments</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {sig.kind === 'design' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={readOnly}
                    onClick={() => {
                      const m0 = sig.methods[0];
                      if (m0)
                        update(i, {
                          ...d,
                          calls: [...d.calls, { method: m0.name, args: m0.params.map(() => '') }],
                        });
                    }}
                  >
                    <PlusIcon /> Add call
                  </Button>
                )}
                {errs.length > 0 && <p className="text-xs text-bad-text">{errs[0]?.message}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {full && (
        <p className="text-xs text-fg-muted">You can have up to {CAPS.customTests} custom tests.</p>
      )}
    </div>
  );
}

function RunHistory({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { state } = usePad();
  const runs = [...state.runs].reverse();
  if (runs.length < 2) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="xs" variant="ghost" aria-label="Earlier runs">
          <HistoryIcon /> {runs.length} runs
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        <MenuLabel>Runs in this interview</MenuLabel>
        {runs.map((r, i) => {
          const h = runHeadline(r);
          const selected = value ? value === r.id : i === 0;
          return (
            <MenuItem
              key={r.id}
              onSelect={() => onChange(i === 0 ? null : r.id)}
              className={cn(selected && 'bg-surface-3')}
            >
              {r.verdict ? <RunVerdictIcon verdict={r.verdict} /> : <PlayIcon />}
              <span className="min-w-0 flex-1 truncate">
                {MODE_LABEL[r.mode]} · {h.label}
              </span>
              <span className="text-xs text-fg-subtle tabular">{formatTimeOfDay(r.createdAt)}</span>
            </MenuItem>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

export function ConsolePanel({
  cs,
  onRunCustom,
  onJump,
}: {
  cs: ConsoleState;
  onRunCustom: () => void;
  onJump: (line: number, col: number | null) => void;
}) {
  const { state, running, selectedRunId, selectRun, runInputs, readOnly } = usePad();
  const latest = state.runs.at(-1);
  const shown = (selectedRunId && state.runs.find((r) => r.id === selectedRunId)) || latest;
  const isLive = shown && shown.status !== 'finished';
  // A blank room has no class to test: only the result and the program's input remain.
  const problem = state.problem;
  const tab = !problem && cs.tab === 'custom' ? 'result' : cs.tab;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => cs.setTab(v as ConsoleTab)}
      className="flex h-full flex-col bg-surface"
    >
      <div className="flex h-9 shrink-0 items-stretch border-b border-border pr-2 pl-2">
        <TabsList aria-label="Console">
          <TabsTrigger value="result">
            <SquareTerminalIcon /> Result
            {running && (
              <span className="size-1.5 animate-pulse rounded-full bg-accent">
                <span className="sr-only">(running)</span>
              </span>
            )}
          </TabsTrigger>
          {problem && (
            <TabsTrigger value="custom">
              <FlaskConicalIcon /> Custom tests
              {cs.drafts.length > 0 && (
                <span className="rounded-full bg-surface-3 px-1.5 text-2xs text-fg-muted tabular">
                  {cs.drafts.length}
                </span>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="stdin">
            <TextCursorInputIcon /> Input
            {cs.stdin && (
              <span className="size-1.5 rounded-full bg-fg-subtle">
                <span className="sr-only">(has input)</span>
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center">
          {tab === 'result' && <RunHistory value={selectedRunId} onChange={selectRun} />}
        </div>
      </div>
      <TabsContent
        value="result"
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
      >
        {!shown ? (
          <NoRunsYet blank={!problem} />
        ) : (
          <div className="p-4">
            {isLive ? (
              <RunProgressView key={shown.id} run={shown} />
            ) : (
              <RunResult run={shown} onJump={onJump} customInputs={runInputs.get(shown.id)} />
            )}
          </div>
        )}
      </TabsContent>
      {problem && (
        <TabsContent
          value="custom"
          className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
        >
          <CustomTestsTab cs={cs} onRun={onRunCustom} problem={problem} />
        </TabsContent>
      )}
      <TabsContent
        value="stdin"
        className="flex min-h-0 flex-1 flex-col focus-visible:outline-none"
      >
        <label htmlFor="stdin" className="px-4 pt-3 text-sm text-fg-muted">
          Standard input for <strong className="font-medium text-fg">Run</strong>. Tests ignore it.
        </label>
        <textarea
          id="stdin"
          value={cs.stdin}
          readOnly={readOnly}
          onChange={(e) => cs.setStdin(e.target.value.slice(0, CAPS.stdinBytes))}
          spellCheck={false}
          placeholder={'5\n1 2 3 4 5'}
          className={cn(
            fieldClass,
            'm-4 mt-2 min-h-0 w-auto flex-1 resize-none py-2 font-mono text-xs',
          )}
        />
      </TabsContent>
    </Tabs>
  );
}
