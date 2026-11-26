'use client';
/**
 * The AI's second opinion on a question of a quant room, for the host on the host's own key
 * (`POST …/host/round/review`): whether the candidate has it, what they covered and missed, what
 * to ask next and the score it would give. Neither stored nor broadcast; the AI never writes in
 * the chat. As the coding room's second opinion: no key, the daily budget and a failed call each
 * say so.
 */
import type { QuantSecondOpinion } from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  CircleAlertIcon,
  MessageCircleQuestionIcon,
  MinusIcon,
  PlusIcon,
  SparklesIcon,
} from 'lucide-react';
import { useState } from 'react';
import { MathMarkdown } from '@/components/math-markdown';
import { InlineError, useRetryCountdown } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { OnlyYou } from '@/features/room/host-tools';
import { api } from '@/lib/api';
import { formatTimeOfDay } from '@/lib/format';
import { qk, useAiKey } from '@/lib/queries';
import { useHostRoom } from './host-room';
import { defaultOpinionIndex, nearestStep, OPINION_VERDICT, pct } from './logic';
import { InlineMd, SectionTitle } from './material';

function List({
  title,
  items,
  icon: Icon,
}: {
  title: string;
  items: string[];
  icon: typeof PlusIcon;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <ul className="mt-1 space-y-1">
        {items.map((x) => (
          <li key={x} className="flex items-start gap-1.5">
            <Icon className="mt-1 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <InlineMd className="min-w-0">{x}</InlineMd>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpinionCard({ o, question }: { o: QuantSecondOpinion; question: string | null }) {
  const room = useHostRoom();
  const v = OPINION_VERDICT[o.verdict];
  const isOpen = room.round?.open === o.index && !room.ended;
  const step = o.suggestedScore === null ? null : nearestStep(o.suggestedScore);
  return (
    <article
      className="rounded-lg border border-border bg-surface"
      data-testid="quant-opinion"
      data-verdict={o.verdict}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Badge tone={v.tone}>
          {o.verdict === 'correct' ? <CheckIcon /> : <CircleAlertIcon />}
          {v.label}
        </Badge>
        <span className="text-xs font-medium">Question {o.index + 1}</span>
        <span className="ml-auto text-2xs text-fg-subtle">{formatTimeOfDay(o.createdAt)}</span>
      </header>
      <div className="space-y-3 px-3 py-3 text-[13.5px] leading-relaxed">
        {question && o.answer && (
          <div className="rounded-md bg-surface-2 px-3 py-2">
            <p className="flex items-start gap-1.5 text-xs font-medium text-fg-muted">
              <MessageCircleQuestionIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {question}
            </p>
            <MathMarkdown className="mt-1">{o.answer}</MathMarkdown>
          </div>
        )}
        <MathMarkdown>{o.summary}</MathMarkdown>
        <List title="Covered" items={o.covered} icon={PlusIcon} />
        <List title="Missing" items={o.missing} icon={MinusIcon} />
        <List title="You could ask" items={o.followUps} icon={MessageCircleQuestionIcon} />
        {o.suggestedScore !== null && (
          <div className="flex flex-wrap items-center gap-2" data-testid="opinion-score">
            <span className="text-xs text-fg-muted">
              Would score it{' '}
              <span className="font-semibold text-fg tabular">{pct(o.suggestedScore)}</span>
            </span>
            {isOpen && step !== null && (
              <Button
                size="xs"
                variant="ghost"
                className="max-lg:h-9"
                onClick={() => room.setDraft({ ...room.draft, score: step })}
                data-testid="use-opinion-score"
              >
                Use {pct(step)} in my verdict
              </Button>
            )}
          </div>
        )}
      </div>
      <footer className="border-t border-border px-3 py-1.5 font-mono text-2xs text-fg-subtle">
        {o.model}
      </footer>
    </article>
  );
}

export function QuantSecondOpinionPanel() {
  const room = useHostRoom();
  const key = useAiKey();
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const [opinions, setOpinions] = useState<{ o: QuantSecondOpinion; question: string | null }[]>(
    [],
  );
  const asked = room.round?.questions ?? [];
  const fallback = defaultOpinionIndex(room.round);
  const index = chosen !== null && asked.some((q) => q.index === chosen) ? chosen : fallback;
  const ask = useMutation({
    mutationFn: (q: string) =>
      api.quantSecondOpinion(room.padId, {
        ...(index !== null ? { index } : {}),
        ...(q ? { question: q } : {}),
      }),
    onSuccess: (o, q) => {
      setOpinions((r) => [{ o, question: q || null }, ...r].slice(0, 6));
      setQuestion('');
    },
    onError: () => void qc.invalidateQueries({ queryKey: qk.aiKey }),
  });
  const wait = useRetryCountdown(ask.error);
  const keyState = key.data?.state;
  const noKey = keyState !== undefined && keyState !== 'active';

  return (
    <div className="flex h-full flex-col" data-testid="quant-second-opinion">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <OnlyYou>Only you see this. The AI never writes in the chat.</OnlyYou>
        {keyState && keyState !== 'active' ? (
          <AiKeyPrompt
            state={keyState}
            size="sm"
            testId="review-key-prompt"
            title={
              keyState === 'rejected'
                ? 'Your API key was rejected'
                : 'The second opinion runs on your own API key'
            }
          >
            Add a key and the AI can read the conversation and the scratchpad for you: whether the
            answer holds up, what is missing, and what to ask next.
          </AiKeyPrompt>
        ) : opinions.length === 0 && !ask.isPending ? (
          <div className="flex flex-col items-center px-4 pt-8 text-center text-sm text-fg-muted">
            <SparklesIcon className="mb-2 size-5 text-fg-subtle" aria-hidden />
            <p className="font-medium text-fg">A second pair of eyes</p>
            <p className="mt-1 max-w-64 text-xs">
              {asked.length
                ? 'The AI reads the question’s solution and hints, the chat since it was asked and the scratchpad, and tells you how the answer stands.'
                : 'Ask a question first: the AI then reads the chat and the scratchpad against its solution.'}
            </p>
          </div>
        ) : null}
        {ask.isPending && (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Spinner /> Reading the answer…
          </p>
        )}
        <InlineError error={ask.error} />
        {opinions.map((r) => (
          <OpinionCard key={r.o.createdAt + r.o.index} o={r.o} question={r.question} />
        ))}
      </div>
      <form
        className="shrink-0 space-y-2 border-t border-border p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ask.isPending && wait === 0 && index !== null) ask.mutate(question.trim());
        }}
      >
        {asked.length > 1 && (
          <Select value={String(index ?? '')} onValueChange={(v) => setChosen(Number(v))}>
            <SelectTrigger className="h-8 w-full text-xs max-lg:h-10" aria-label="Which question">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...asked].reverse().map((q) => (
                <SelectItem key={q.index} value={String(q.index)}>
                  Question {q.index + 1}
                  {q.index === room.round?.open ? ' (open)' : ''} · {q.topicTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <label htmlFor="quant-review-question" className="sr-only">
          Something specific to check (optional)
        </label>
        <input
          id="quant-review-question"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={noKey}
          placeholder="Anything specific to check? (optional)"
          className="h-8 w-full rounded-md border border-border-strong bg-surface px-2.5 text-[13.5px] outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 disabled:opacity-60 max-lg:h-10 max-lg:text-base"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="w-full max-lg:h-10"
          disabled={ask.isPending || wait > 0 || noKey || index === null}
          data-testid="review-button"
        >
          {ask.isPending ? <Spinner /> : <SparklesIcon />}
          {wait > 0
            ? `Try again in ${wait}s`
            : index === null
              ? 'No question asked yet'
              : question.trim()
                ? `Ask about question ${index + 1}`
                : `Second opinion on question ${index + 1}`}
        </Button>
      </form>
    </div>
  );
}
