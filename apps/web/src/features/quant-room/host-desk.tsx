'use client';
/**
 * The host's desk in a quant room: what they need to run the interview, beside the candidate's
 * own view (the chat and the shared scratchpad). On top, always, the open question with its
 * answer, the next hint to give, the follow-up and the verdict (or, between questions, what is
 * up next); below, the queue and the questions already asked. The bank opens beside it.
 *
 * HOST-ONLY. Nothing here writes to the chat or the shared document: recording a hint or a
 * follow-up is bookkeeping for the report, and the host says the hint in their own words.
 */
import type { HostQueueItem, HostRoundQuestion } from '@ipp/contracts';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ClockIcon,
  LibraryIcon,
  LightbulbIcon,
  LockIcon,
  MessageCircleQuestionIcon,
  PlayIcon,
  SendIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { MathMarkdown } from '@/components/math-markdown';
import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResizeHandle } from '@/features/pad/pad-chrome';
import { useNow } from '@/features/pad/top-bar';
import { formatClock, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { HostBankSheet } from './bank-sheet';
import { useHostRoom } from './host-room';
import {
  canRecordHint,
  hintLadder,
  hintsSummary,
  moveInQueue,
  nextInQueue,
  openQuestion,
  openSeconds,
  ownGiven,
  pct,
  promptLine,
  queueIds,
  removeFromQueue,
  type VerdictDraft,
  verdictEditable,
} from './logic';
import {
  AnswerBox,
  Explanation,
  InlineMd,
  KeyPoints,
  MaterialPreview,
  QuestionMeta,
  SectionTitle,
} from './material';
import { VerdictForm } from './verdict-form';

const storage = typeof window === 'undefined' ? undefined : window.localStorage;

export function OnlyYouBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-2xs text-fg-subtle', className)}
      title="Only you see this. Nothing here is in the chat or on the scratchpad."
    >
      <LockIcon className="size-3" aria-hidden /> Only you
    </span>
  );
}

function OpenTimer({ q }: { q: HostRoundQuestion }) {
  const now = useNow();
  const sec = openSeconds(q, now);
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-xs text-fg-muted tabular"
      role="timer"
      aria-label={`Open for ${formatClock(sec)}`}
      data-testid="open-timer"
    >
      <ClockIcon className="size-3.5" aria-hidden />
      {formatClock(sec)}
    </span>
  );
}

function HintLadder({ q }: { q: HostRoundQuestion }) {
  const room = useHostRoom();
  const ladder = q.material?.hints ?? [];
  const rungs = hintLadder(q, ladder);
  const own = ownGiven(q);
  const can = canRecordHint(q) && !room.ended;
  return (
    <section aria-labelledby="desk-hints" data-testid="hint-ladder">
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle>
          <span id="desk-hints">Hints</span>
        </SectionTitle>
        <span className="text-2xs text-fg-subtle tabular" data-testid="hints-recorded">
          {plural(q.hintRungs.length, 'hint')} given
        </span>
      </div>
      {rungs.length > 0 ? (
        <ol className="mt-1.5 space-y-1">
          {rungs.map((r) => (
            <li
              key={r.rung}
              data-testid="hint-rung"
              data-state={r.state}
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px] leading-snug',
                r.state === 'next' && 'border border-accent/40 bg-accent-soft/40',
                r.state === 'later' && 'text-fg-subtle',
                r.state === 'given' && 'text-fg-muted',
              )}
            >
              <span
                className={cn(
                  'mt-px flex size-4.5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular',
                  r.state === 'given'
                    ? 'bg-ok-soft text-ok-text'
                    : r.state === 'next'
                      ? 'bg-accent text-accent-fg'
                      : 'bg-surface-3 text-fg-subtle',
                )}
                aria-hidden
              >
                {r.state === 'given' ? <CheckIcon className="size-3" /> : r.rung}
              </span>
              <InlineMd className="min-w-0 flex-1">{r.text}</InlineMd>
              {r.state === 'next' && (
                <Button
                  size="xs"
                  variant="primary"
                  className="-my-0.5 shrink-0 max-lg:h-9"
                  disabled={!can || room.busy !== null}
                  onClick={() => void room.hint(q.index, r.rung)}
                  data-testid="record-hint"
                  aria-label={`I gave hint ${r.rung}`}
                >
                  {room.busy === 'hint' ? <Spinner /> : <LightbulbIcon />} Gave it
                </Button>
              )}
              {r.state === 'given' && <span className="sr-only">(given)</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-xs text-fg-muted">This question has no written hints.</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          size="xs"
          variant="ghost"
          className="-ml-2 max-lg:h-9"
          disabled={!can || room.busy !== null}
          onClick={() => void room.hint(q.index, 0)}
          data-testid="record-own-hint"
        >
          <LightbulbIcon /> I gave a hint of my own
        </Button>
        {own > 0 && (
          <span className="text-2xs text-fg-subtle" data-testid="own-hints">
            {plural(own, 'hint')} of your own
          </span>
        )}
      </div>
    </section>
  );
}

function FollowUps({ q }: { q: HostRoundQuestion }) {
  const room = useHostRoom();
  const list = q.material?.followUps ?? [];
  return (
    <section aria-labelledby="desk-follow-ups" data-testid="follow-ups">
      <SectionTitle>
        <span id="desk-follow-ups">Follow-up</span>
      </SectionTitle>
      {list.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-snug marker:text-fg-subtle">
          {list.map((f) => (
            <li key={f}>
              <InlineMd>{f}</InlineMd>
            </li>
          ))}
        </ul>
      )}
      {q.followUpAsked ? (
        <p
          className="mt-1.5 flex items-center gap-1.5 text-xs text-ok-text"
          data-testid="follow-up-asked"
        >
          <CircleCheckIcon className="size-3.5" aria-hidden /> Follow-up asked
        </p>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          className="mt-1 -ml-2 max-lg:h-9"
          disabled={room.ended || room.busy !== null}
          onClick={() => void room.followUp(q.index)}
          data-testid="record-follow-up"
        >
          <MessageCircleQuestionIcon /> I asked {list.length ? 'a follow-up' : 'one of my own'}
        </Button>
      )}
    </section>
  );
}

/** The open question: everything the host needs right now, and closing it. */
function OpenQuestion({ q, compact }: { q: HostRoundQuestion; compact: boolean }) {
  const room = useHostRoom();
  const m = q.material;
  const scored = room.draft.score !== null;
  return (
    <div className="flex h-full flex-col" data-testid="open-question" data-index={q.index}>
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold">Question {q.index + 1}</h3>
          <Badge tone="accent">Open</Badge>
          <OpenTimer q={q} />
        </div>
        <QuestionMeta
          topicTitle={q.topicTitle}
          subtopic={m?.subtopic}
          difficulty={q.difficulty}
          type={q.type}
        />
        <details className="group rounded-md border border-border bg-surface-2/50">
          <summary className="flex cursor-pointer list-none items-start gap-1.5 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              className="mt-0.5 size-3.5 shrink-0 text-fg-subtle transition-transform group-open:rotate-90"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                What they see
              </span>
              <InlineMd className="mt-0.5 block text-[13px] leading-snug text-fg-muted line-clamp-2 group-open:hidden">
                {promptLine(q.prompt)}
              </InlineMd>
            </span>
          </summary>
          <MathMarkdown className="px-3 pb-3 text-[13.5px] leading-relaxed">
            {q.prompt}
          </MathMarkdown>
        </details>
        {m ? (
          <>
            <AnswerBox m={m} />
            <HintLadder q={q} />
            <FollowUps q={q} />
            <KeyPoints points={m.keyPoints} />
            <Explanation text={m.explanation} />
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            This question has left the bank since; its answer and hints are no longer available.
          </p>
        )}
      </div>
      <div
        className="shrink-0 space-y-2 border-t border-border bg-surface px-4 py-2.5"
        data-testid="close-question-form"
      >
        <VerdictForm
          value={room.draft}
          onChange={room.setDraft}
          idPrefix="close"
          compact={compact}
        />
        <Button
          variant={scored ? 'primary' : 'secondary'}
          size="sm"
          className="w-full max-lg:h-10"
          disabled={room.ended || room.busy !== null}
          onClick={() => void room.close(q.index)}
          data-testid="close-question"
        >
          {room.busy === 'close' ? <Spinner /> : <CheckIcon />}
          {scored ? `Close with ${pct(room.draft.score ?? 0)}` : 'Close without a verdict'}
        </Button>
      </div>
    </div>
  );
}

/** Between questions: what comes next, one click away. */
function Idle() {
  const room = useHostRoom();
  const round = room.round;
  const next = round ? nextInQueue(round) : null;
  const asked = round?.questions.length ?? 0;
  if (room.ended)
    return (
      <div className="px-4 py-5" data-testid="desk-ended">
        <p className="font-medium">The interview has ended</p>
        <p className="mt-1 text-sm text-fg-muted">
          {asked
            ? 'A question without a verdict can still be given one, below or in the report.'
            : 'No question was asked.'}
        </p>
      </div>
    );
  return (
    <div className="space-y-3 px-4 py-4" data-testid="desk-idle">
      <div>
        <p className="font-medium">{asked ? 'No question is open' : 'No question asked yet'}</p>
        <p className="mt-0.5 text-sm text-fg-muted">
          {asked
            ? 'Ask the next one when you are ready.'
            : 'Your candidate sees a question only when you ask it. You can also just talk: the scratchpad and the whiteboard are shared.'}
        </p>
      </div>
      {next?.material ? (
        <div
          className="rounded-md border border-accent/40 bg-accent-soft/30 px-3 py-2.5"
          data-testid="up-next"
        >
          <SectionTitle>Up next</SectionTitle>
          <QuestionMeta
            className="mt-1"
            topicTitle={next.material.topicTitle}
            subtopic={next.material.subtopic}
            difficulty={next.material.difficulty}
            type={next.material.type}
          />
          <InlineMd className="mt-1 block text-[13.5px] leading-snug line-clamp-3">
            {promptLine(next.material.prompt, 220)}
          </InlineMd>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              className="max-lg:h-10"
              disabled={room.busy !== null}
              onClick={() => room.requestPose(next.questionId)}
              data-testid="ask-next"
            >
              {room.busy === 'pose' ? <Spinner /> : <SendIcon />} Ask it now
            </Button>
            <Button size="sm" className="max-lg:h-10" onClick={() => room.setBankOpen(true)}>
              <LibraryIcon /> Something else
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="primary"
          className="max-lg:h-10"
          onClick={() => room.setBankOpen(true)}
          data-testid="open-bank-idle"
        >
          <LibraryIcon /> Pick a question from the bank
        </Button>
      )}
    </div>
  );
}

function QueueRow({ item, i, ids }: { item: HostQueueItem; i: number; ids: string[] }) {
  const room = useHostRoom();
  const m = item.material;
  const disabled = room.ended || room.busy !== null;
  return (
    <li className="px-3 py-2" data-testid="queue-item" data-question={item.questionId}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 w-4 shrink-0 text-right text-xs font-semibold text-fg-subtle tabular">
          {i + 1}
        </span>
        <details className="group min-w-0 flex-1">
          <summary className="cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
            {m ? (
              <>
                <QuestionMeta topicTitle={m.topicTitle} difficulty={m.difficulty} type={m.type} />
                <InlineMd className="mt-0.5 block text-[13px] leading-snug line-clamp-2">
                  {promptLine(m.prompt, 140)}
                </InlineMd>
              </>
            ) : (
              <span className="text-sm text-fg-muted">
                {item.questionId}: no longer in the bank, so it cannot be asked.
              </span>
            )}
          </summary>
          {m && (
            <div className="mt-2 rounded-md border border-border bg-surface-2/50 px-3 py-3">
              <MaterialPreview m={m} />
            </div>
          )}
        </details>
        <span className="flex shrink-0 items-center">
          {m && (
            <Button
              size="xs"
              variant="ghost"
              className="max-lg:h-9"
              disabled={disabled}
              onClick={() => room.requestPose(item.questionId)}
              aria-label={`Ask queued question ${i + 1} now`}
              data-testid="ask-queued"
            >
              <PlayIcon /> Ask
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            className="max-lg:size-9"
            aria-label={`Move queued question ${i + 1} up`}
            disabled={disabled || i === 0}
            onClick={() => void room.setQueue(moveInQueue(ids, item.questionId, -1))}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="max-lg:size-9"
            aria-label={`Move queued question ${i + 1} down`}
            disabled={disabled || i === ids.length - 1}
            onClick={() => void room.setQueue(moveInQueue(ids, item.questionId, 1))}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="max-lg:size-9"
            aria-label={`Remove queued question ${i + 1}`}
            disabled={disabled}
            onClick={() => void room.setQueue(removeFromQueue(ids, item.questionId))}
          >
            <XIcon />
          </Button>
        </span>
      </div>
    </li>
  );
}

function Queue() {
  const room = useHostRoom();
  const round = room.round;
  if (!round) return null;
  const ids = queueIds(round);
  return (
    <div className="flex h-full flex-col">
      {round.queue.length === 0 ? (
        <div className="px-4 py-4 text-sm text-fg-muted" data-testid="queue-empty">
          <p>Nothing lined up.</p>
          {!room.ended && (
            <Button size="sm" className="mt-2 max-lg:h-10" onClick={() => room.setBankOpen(true)}>
              <LibraryIcon /> Add from the bank
            </Button>
          )}
        </div>
      ) : (
        <ol className="divide-y divide-border" aria-label="Queue" data-testid="queue">
          {round.queue.map((item, i) => (
            <QueueRow key={item.questionId} item={item} i={i} ids={ids} />
          ))}
        </ol>
      )}
    </div>
  );
}

function AskedRow({ q }: { q: HostRoundQuestion }) {
  const room = useHostRoom();
  const [draft, setDraft] = useState<VerdictDraft>({
    score: q.verdict?.score ?? null,
    summary: q.verdict?.summary ?? '',
  });
  const open = q.closedAt === null;
  const editable = verdictEditable(q, room.ended);
  const changed =
    draft.score !== (q.verdict?.score ?? null) || draft.summary !== (q.verdict?.summary ?? '');
  return (
    <li className="px-3 py-2" data-testid="asked-item" data-index={q.index}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 select-none [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            className="mt-0.5 size-3.5 shrink-0 text-fg-subtle transition-transform group-open:rotate-90"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium">Question {q.index + 1}</span>
              <span className="truncate text-xs text-fg-muted">{q.topicTitle}</span>
              <span className="ml-auto flex items-center gap-2 text-xs text-fg-muted tabular">
                {!open && q.timeSec !== null && <span>{formatClock(q.timeSec)}</span>}
                {q.hintRungs.length > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <LightbulbIcon className="size-3" aria-hidden /> {q.hintRungs.length}
                  </span>
                )}
                {open ? (
                  <Badge tone="accent">Open</Badge>
                ) : q.verdict ? (
                  <Badge tone="neutral" data-testid="asked-score">
                    {pct(q.verdict.score)}
                  </Badge>
                ) : (
                  <Badge tone="outline" data-testid="asked-score">
                    No verdict
                  </Badge>
                )}
              </span>
            </span>
            <InlineMd className="mt-0.5 block text-[13px] leading-snug text-fg-muted line-clamp-1">
              {promptLine(q.prompt, 120)}
            </InlineMd>
          </span>
        </summary>
        <div className="mt-2 ml-5 space-y-3 rounded-md border border-border bg-surface-2/50 px-3 py-3">
          <p className="text-xs text-fg-muted">
            {hintsSummary(q.hintRungs)}
            {q.followUpAsked ? ' · follow-up asked' : ''}
            {q.closedBy === 'ended' ? ' · open when the interview ended' : ''}
          </p>
          {q.material && <AnswerBox m={q.material} />}
          {q.verdict?.summary && !editable && (
            <p className="text-[13px] leading-snug">{q.verdict.summary}</p>
          )}
          {editable && (
            <div className="space-y-2" data-testid="verdict-editor">
              <SectionTitle>{q.verdict ? 'Your verdict' : 'Give a verdict'}</SectionTitle>
              <VerdictForm
                value={draft}
                onChange={setDraft}
                idPrefix={`verdict-${q.index}`}
                compact
                allowNone={false}
              />
              <Button
                size="xs"
                variant="primary"
                className="max-lg:h-9"
                disabled={draft.score === null || !changed || room.busy !== null}
                onClick={() => void room.verdict(q.index, draft)}
                data-testid="save-verdict"
              >
                {room.busy === 'verdict' ? <Spinner /> : <CheckIcon />} Save verdict
              </Button>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

function Asked() {
  const room = useHostRoom();
  const asked = room.round?.questions ?? [];
  if (asked.length === 0)
    return <p className="px-4 py-4 text-sm text-fg-muted">No question asked yet.</p>;
  return (
    <ol className="divide-y divide-border" aria-label="Asked" data-testid="asked">
      {[...asked].reverse().map((q) => (
        <AskedRow key={`${q.index}-${q.verdict?.score ?? 'none'}-${q.closedAt ?? ''}`} q={q} />
      ))}
    </ol>
  );
}

function Lists() {
  const room = useHostRoom();
  const [tab, setTab] = useState<'queue' | 'asked'>('queue');
  const round = room.round;
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as 'queue' | 'asked')}
      className="flex h-full flex-col"
    >
      <div className="flex h-9 shrink-0 items-center border-b border-border pr-2 max-lg:h-10">
        <TabsList aria-label="Questions" className="h-full flex-1 px-2">
          <TabsTrigger value="queue">
            Queue{' '}
            <span className="text-2xs text-fg-subtle tabular">{round?.queue.length ?? 0}</span>
          </TabsTrigger>
          <TabsTrigger value="asked">
            Asked{' '}
            <span className="text-2xs text-fg-subtle tabular">{round?.questions.length ?? 0}</span>
          </TabsTrigger>
        </TabsList>
        {!room.ended && (
          <Button
            size="xs"
            variant="ghost"
            className="max-lg:h-9"
            onClick={() => room.setBankOpen(true)}
            data-testid="open-bank"
          >
            <LibraryIcon /> Bank
          </Button>
        )}
      </div>
      <TabsContent
        value="queue"
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
      >
        <Queue />
      </TabsContent>
      <TabsContent
        value="asked"
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
      >
        <Asked />
      </TabsContent>
    </Tabs>
  );
}

function ConfirmPose() {
  const room = useHostRoom();
  const open = openQuestion(room.round);
  const scored = room.draft.score !== null;
  return (
    <Dialog open={room.confirmPose !== null} onOpenChange={(o) => !o && room.cancelPose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Question {open ? open.index + 1 : ''} is still open</DialogTitle>
          <DialogDescription>
            {scored
              ? `Asking the next question closes it first, with the verdict you chose (${pct(room.draft.score ?? 0)}).`
              : 'Asking the next question closes it first, without a verdict. You can give one afterwards in the Asked list.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody />
        <DialogFooter>
          <Button variant="ghost" onClick={room.cancelPose}>
            Keep it open
          </Button>
          <Button
            variant="primary"
            disabled={room.busy !== null}
            onClick={() => room.confirmPose && void room.pose(room.confirmPose)}
            data-testid="confirm-pose"
          >
            {room.busy ? <Spinner /> : <SendIcon />} Close it and ask
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HostDesk({ compact }: { compact: boolean }) {
  const room = useHostRoom();
  const layout = useDefaultLayout({ id: 'ipp-quant-desk', storage, panelIds: ['now', 'lists'] });
  const open = openQuestion(room.round);
  const now = room.loading ? (
    <div className="space-y-2 p-4" role="status" aria-busy="true" aria-label="Loading your desk">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  ) : room.error ? (
    <ErrorState error={room.error} onRetry={room.refetch} compact />
  ) : open ? (
    <OpenQuestion key={open.index} q={open} compact={compact} />
  ) : (
    <Idle />
  );
  return (
    <section
      aria-label="Your desk"
      className="flex h-full flex-col bg-surface"
      data-testid="host-desk"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 max-lg:h-10">
        <h2 className="text-sm font-medium">Your desk</h2>
        <OnlyYouBadge />
      </header>
      {compact ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn(open && 'h-[min(78dvh,640px)] border-b border-border')}>{now}</div>
          <div className="min-h-64">
            <Lists />
          </div>
        </div>
      ) : (
        <Group
          orientation="vertical"
          id="ipp-quant-desk"
          className="min-h-0 flex-1"
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          <Panel id="now" defaultSize="64%" minSize="200px">
            <div className="h-full overflow-y-auto">{now}</div>
          </Panel>
          <ResizeHandle vertical />
          <Panel id="lists" defaultSize="36%" minSize="120px">
            <Lists />
          </Panel>
        </Group>
      )}
      <ConfirmPose />
      <HostBankSheet compact={compact} />
    </section>
  );
}
