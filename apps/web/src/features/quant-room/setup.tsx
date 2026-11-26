'use client';
/**
 * Setting up a quant room (ARCHITECTURE §8.4): the host interviews someone on questions of the
 * bank. They may line questions up now (browsing and searching the bank, any topic of either
 * track), reorder and remove them, or start with an empty room and pick as they go, or never, and
 * just talk over the scratchpad and whiteboard. No AI key is needed.
 *
 * Self-contained so it can move to another page in one piece: it fetches what it needs itself
 * (the quiz topics and each topic's public bank, prompts only: a room's bank search with the
 * solutions needs the room) and creates the room with `POST /api/pads`. Its parent may put
 * something at the top of the setup panel (`header`: the Interviews tab's kind-of-interview
 * switch), start the bank on a site track (`track`: the Quant tab starts it on Quant) and decide
 * what happens once the room exists (`onCreated`; by default it is opened).
 */
import { type Pad, QUANT_QUEUE_MAX, type QuizBank, type Track } from '@ipp/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  InboxIcon,
  ListPlusIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useId, useMemo, useState } from 'react';
import { InlineError } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';
import { qk } from '@/lib/queries';
import { BankBrowser } from './bank-browser';
import {
  type BankItem,
  type BankQuery,
  moveInQueue,
  NO_BANK_FILTERS,
  promptLine,
  type QueuedPick,
  searchPublicBank,
} from './logic';
import { InlineMd, QuestionMeta } from './material';

const DURATIONS = [30, 45, 60, 90] as const;
const NO_LIMIT = 'none';

/** Every topic's public bank (prompts only), fetched in parallel. */
function usePublicBank() {
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  const slugs = useMemo(
    () => topics.data?.filter((t) => t.questionCount > 0).map((t) => t.slug) ?? [],
    [topics.data],
  );
  const banks = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: qk.quizBank(slug),
      queryFn: () => api.quizBank(slug),
      staleTime: 5 * 60_000,
    })),
  });
  const loaded = banks.flatMap((b) => (b.data ? [b.data] : []));
  const key = loaded.map((b) => `${b.topic.slug}:${b.items.length}`).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the loaded banks
  const data = useMemo<QuizBank[]>(() => loaded, [key]);
  const failed = topics.error ?? banks.find((b) => b.error)?.error ?? null;
  return {
    banks: data,
    pending: topics.isPending || banks.some((b) => b.isPending),
    ready: topics.isSuccess && loaded.length > 0,
    error: failed,
    retry: () => {
      void topics.refetch();
      for (const b of banks) if (b.isError) void b.refetch();
    },
  };
}

function QueueList({
  picks,
  onMove,
  onRemove,
}: {
  picks: QueuedPick[];
  onMove: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ol className="mt-2 space-y-1.5" aria-label="Questions lined up" data-testid="setup-queue">
      {picks.map((p, i) => (
        <li
          key={p.id}
          className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2"
          data-testid="setup-queue-item"
          data-question={p.id}
        >
          <span className="mt-0.5 w-4 shrink-0 text-right text-xs font-semibold text-fg-subtle tabular">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">
            <QuestionMeta topicTitle={p.topicTitle} difficulty={p.difficulty} type={p.type} />
            <InlineMd className="mt-0.5 block text-[13px] leading-snug line-clamp-2">
              {promptLine(p.prompt, 120)}
            </InlineMd>
          </span>
          <span className="flex shrink-0 items-center">
            <Button
              size="icon-xs"
              variant="ghost"
              className="max-sm:size-9"
              aria-label={`Move question ${i + 1} up`}
              disabled={i === 0}
              onClick={() => onMove(p.id, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              className="max-sm:size-9"
              aria-label={`Move question ${i + 1} down`}
              disabled={i === picks.length - 1}
              onClick={() => onMove(p.id, 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              className="max-sm:size-9"
              aria-label={`Remove question ${i + 1}`}
              onClick={() => onRemove(p.id)}
            >
              <XIcon />
            </Button>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function QuantRoomSetup({
  header,
  track,
  onCreated,
}: {
  /** Shown at the top of the setup panel (the Interviews tab puts its kind-of-interview switch here). */
  header?: ReactNode;
  /** The site track the bank's filter starts on; every question stays a click away. */
  track?: Track;
  /** After the room is created; by default the browser goes to it. */
  onCreated?: (pad: Pad) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const ids = { dur: useId() };
  const bank = usePublicBank();
  const [query, setQuery] = useState<BankQuery>(() =>
    track ? { ...NO_BANK_FILTERS, track } : NO_BANK_FILTERS,
  );
  const [picks, setPicks] = useState<QueuedPick[]>([]);
  const [durationMin, setDurationMin] = useState<number | null>(45);
  const queued = useMemo(() => picks.map((p) => p.id), [picks]);
  const view = useMemo(
    () => (bank.ready ? searchPublicBank(bank.banks, query, queued) : undefined),
    [bank.ready, bank.banks, query, queued],
  );
  const onQuery = useCallback((q: BankQuery) => setQuery(q), []);

  const add = (item: BankItem) =>
    setPicks((ps) =>
      ps.some((p) => p.id === item.question.id) || ps.length >= QUANT_QUEUE_MAX
        ? ps
        : [...ps, item.question],
    );
  const remove = (id: string) => setPicks((ps) => ps.filter((p) => p.id !== id));
  const move = (id: string, delta: number) =>
    setPicks((ps) => {
      const order = moveInQueue(
        ps.map((p) => p.id),
        id,
        delta,
      );
      return order.flatMap((x) => ps.filter((p) => p.id === x));
    });

  const create = useMutation({
    mutationFn: () =>
      api.createPad({
        kind: 'room',
        format: 'quant',
        durationMin,
        ...(queued.length ? { queue: queued } : {}),
      }),
    onSuccess: (pad) => {
      void qc.invalidateQueries({ queryKey: qk.pads });
      if (onCreated) onCreated(pad);
      else router.push(`/pads/${pad.id}`);
    },
  });
  const full = picks.length >= QUANT_QUEUE_MAX;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section
        aria-labelledby="quant-bank-heading"
        className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface max-lg:order-2 lg:h-[calc(100dvh-13rem)] lg:min-h-[520px]"
      >
        <div className="shrink-0 border-b border-border px-4 pt-3 pb-2.5">
          <h2 id="quant-bank-heading" className="text-sm font-semibold">
            Question bank
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Line up questions for the interview, from any topic of either track. Optional: you can
            pick more, or all of them, in the room, where each one shows its answer and hints.
          </p>
        </div>
        <BankBrowser
          className="min-h-0 flex-1"
          query={query}
          onQuery={onQuery}
          view={view}
          loading={bank.pending}
          error={bank.ready ? null : bank.error}
          onRetry={bank.retry}
          noMaterial={
            <p className="mt-2 text-xs text-fg-subtle">
              Its answer, hints and follow-ups are on your desk in the room.
            </p>
          }
          actions={(item) => {
            const isQueued = queued.includes(item.question.id);
            return isQueued ? (
              <Button
                size="xs"
                variant="ghost"
                className="max-sm:h-9"
                onClick={() => remove(item.question.id)}
                aria-label={`Remove ${item.question.id} from the queue`}
              >
                <CheckIcon /> Queued
              </Button>
            ) : (
              <Button
                size="xs"
                className="max-sm:h-9"
                disabled={full}
                onClick={() => add(item)}
                aria-label={`Queue ${item.question.id}`}
                data-testid="queue-question"
              >
                <ListPlusIcon /> Queue
              </Button>
            );
          }}
        />
      </section>

      <section
        aria-labelledby="quant-setup-heading"
        className="min-w-0 rounded-lg border border-border bg-surface max-lg:order-1 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
        data-testid="quant-room-setup"
      >
        {header && <div className="border-b border-border p-4">{header}</div>}
        <div className="border-b border-border p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2
              id="quant-setup-heading"
              className="text-2xs font-medium tracking-wider text-fg-subtle uppercase"
            >
              Questions lined up
            </h2>
            {picks.length > 0 && (
              <button
                type="button"
                className="text-xs text-fg-muted hover:text-fg hover:underline"
                onClick={() => setPicks([])}
              >
                Remove all
              </button>
            )}
          </div>
          {picks.length === 0 ? (
            <div className="mt-2 flex items-start gap-3" data-testid="setup-queue-empty">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-subtle">
                <InboxIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-medium">Nothing lined up</p>
                <p className="mt-0.5 text-fg-muted">
                  That is fine: start with an empty room, then pick questions during the interview,
                  or none and just talk. To line some up now, queue them from the bank.
                </p>
              </div>
            </div>
          ) : (
            <>
              <QueueList picks={picks} onMove={move} onRemove={remove} />
              <p className="mt-2 text-xs text-fg-muted">
                Asked in this order unless you choose otherwise. You can change the queue in the
                room.
              </p>
            </>
          )}
        </div>
        <div className="space-y-5 p-4">
          <div className="space-y-1.5">
            <Label id={ids.dur}>Clock</Label>
            <Segmented
              aria-label="Duration"
              className="flex w-full max-sm:[&>*]:h-9 max-sm:[&>*]:px-1"
              value={durationMin === null ? NO_LIMIT : String(durationMin)}
              onValueChange={(v) => setDurationMin(v === NO_LIMIT ? null : Number(v))}
              options={[
                ...DURATIONS.map((d) => ({ value: String(d), label: `${d} min` })),
                { value: NO_LIMIT, label: 'No limit' },
              ]}
            />
            <p className="text-xs text-fg-muted">
              Only the clock in the top bar: questions have no time limits, and nothing ends on its
              own.
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <UsersIcon className="size-4 text-accent-text" aria-hidden /> You are the interviewer
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-fg-muted">
              <li>A shared scratchpad, whiteboard and chat with whoever you invite.</li>
              <li>
                You post each question when you are ready. Only you see its answer, hints,
                follow-ups and your verdicts.
              </li>
              <li>
                The AI stays out of the conversation. With your API key it can give you a second
                opinion on an answer, and an assessment afterwards.
              </li>
            </ul>
          </div>
        </div>
        <div className="sticky bottom-0 space-y-2 rounded-b-lg border-t border-border bg-surface p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] lg:pb-4">
          <InlineError error={create.error} />
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            data-testid="create-quant-room"
          >
            {create.isPending ? <Spinner /> : <UsersIcon />}
            {picks.length ? 'Create room' : 'Create an empty room'}
          </Button>
          <p className="text-center text-xs text-fg-muted" data-testid="create-quant-room-note">
            {picks.length
              ? `${plural(picks.length, 'question')} lined up. Nobody sees them until you ask.`
              : 'No questions lined up: pick them in the room, or none at all.'}
          </p>
        </div>
      </section>
    </div>
  );
}
