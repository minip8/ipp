'use client';
/**
 * What only the host of an interview room sees: the problem's interviewer notes and reference
 * solutions, their own notes on the candidate, and the AI's second opinion on the code. None of
 * it is in the shared document or the event channel; it is fetched for the host alone.
 */
import { HOST_NOTES_MAX, LANGUAGES, type Language, type SolutionReview } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  CircleAlertIcon,
  LockIcon,
  MessageCircleQuestionIcon,
  SparklesIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeBlock } from '@/components/code-block';
import { LANG_LABEL } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { ErrorState, InlineError, useRetryCountdown } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { usePad } from '@/features/pad/session';
import { api } from '@/lib/api';
import { formatTimeOfDay } from '@/lib/format';
import { qk, useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { REVIEW_VERDICT } from './logic';

function useHostView(padId: string) {
  return useQuery({
    queryKey: qk.hostView(padId),
    queryFn: () => api.hostView(padId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

export function OnlyYou({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-2xs text-fg-subtle">
      <LockIcon className="size-3 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/** The problem's interviewer notes and reference solutions. */
export function HostGuide() {
  const { state } = usePad();
  const view = useHostView(state.pad.id);
  const [lang, setLang] = useState<Language | null>(null);
  if (view.isPending)
    return (
      <div role="status" aria-busy="true" aria-label="Loading the guide" className="space-y-2 p-4">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    );
  if (view.isError) return <ErrorState error={view.error} onRetry={() => view.refetch()} compact />;
  const guide = view.data.problem;
  if (!guide)
    return (
      <div className="space-y-2 px-4 py-4 text-sm text-fg-muted">
        <OnlyYou>Only you see this tab.</OnlyYou>
        <p>
          A blank room has no interviewer notes or reference solution. Choose a problem from the
          library to get both.
        </p>
      </div>
    );
  const offered = LANGUAGES.filter((l) => guide.referenceSolutions[l]);
  const shown =
    (lang && offered.includes(lang) ? lang : null) ??
    (offered.includes(state.pad.language) ? state.pad.language : offered[0]);
  const solution = shown ? guide.referenceSolutions[shown] : undefined;
  return (
    <div className="space-y-5 px-4 py-4">
      <OnlyYou>Only you see this tab. Your candidate cannot open it.</OnlyYou>
      <section aria-labelledby="guide-notes">
        <h3
          id="guide-notes"
          className="text-2xs font-medium tracking-wider text-fg-subtle uppercase"
        >
          Interviewer notes
        </h3>
        <Markdown className="mt-2 text-[13.5px]">{guide.interviewerNotes}</Markdown>
      </section>
      {shown && solution && (
        <section aria-labelledby="guide-solution">
          <div className="flex items-center justify-between gap-2">
            <h3
              id="guide-solution"
              className="text-2xs font-medium tracking-wider text-fg-subtle uppercase"
            >
              Reference solution
            </h3>
            {offered.length > 1 && (
              <Segmented
                aria-label="Solution language"
                size="sm"
                value={shown}
                onValueChange={(l: Language) => setLang(l)}
                options={offered.map((l) => ({ value: l, label: LANG_LABEL[l] }))}
              />
            )}
          </div>
          <CodeBlock code={solution} language={shown} className="mt-2 text-xs" />
        </section>
      )}
    </div>
  );
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'failed';

/**
 * The host's own notes on the interview: saved as they type, kept with the report (which shows
 * this same editor, so they can be finished after the candidate has left).
 */
export function PrivateNotes({ padId, className }: { padId: string; className?: string }) {
  const qc = useQueryClient();
  const view = useHostView(padId);
  const [value, setValue] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveState>('saved');
  const latest = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = view.data?.notes;
  useEffect(() => {
    if (loaded !== undefined && value === null) {
      setValue(loaded);
      latest.current = loaded;
    }
  }, [loaded, value]);

  const save = useCallback(async () => {
    const text = latest.current;
    setStatus('saving');
    try {
      await api.saveHostNotes(padId, text);
      qc.setQueryData(qk.hostView(padId), (old: Awaited<ReturnType<typeof api.hostView>>) =>
        old ? { ...old, notes: text } : old,
      );
      void qc.invalidateQueries({ queryKey: qk.report(padId) });
      // Typed more while the request was out: that edit has its own save scheduled.
      setStatus(latest.current === text ? 'saved' : 'dirty');
    } catch {
      setStatus('failed');
    }
  }, [padId, qc]);

  const onChange = (next: string) => {
    setValue(next);
    latest.current = next;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  };
  // Leaving the pad with a save still waiting: send it now.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void api.saveHostNotes(padId, latest.current).catch(() => {});
      }
    },
    [padId],
  );

  if (view.isError) return <ErrorState error={view.error} onRetry={() => view.refetch()} compact />;
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <label htmlFor="host-notes" className="sr-only">
        Your private notes
      </label>
      <textarea
        id="host-notes"
        value={value ?? ''}
        disabled={value === null}
        maxLength={HOST_NOTES_MAX}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (status === 'dirty' && timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
            void save();
          }
        }}
        placeholder={
          'Your notes on the candidate: what went well, where they needed help, what to ask next.\n\nOnly you can read these. They stay with the report after the interview.'
        }
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[13.5px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
      />
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-1.5">
        <OnlyYou>Only you see these notes</OnlyYou>
        <p className="text-2xs text-fg-subtle" role="status" data-testid="host-notes-status">
          {status === 'failed' ? (
            <button
              type="button"
              className="font-medium text-bad-text hover:underline"
              onClick={() => void save()}
            >
              Not saved. Retry
            </button>
          ) : status === 'saved' ? (
            value === null ? (
              ''
            ) : (
              'Saved'
            )
          ) : (
            'Saving…'
          )}
        </p>
      </div>
    </div>
  );
}

function ReviewCard({ review, question }: { review: SolutionReview; question: string | null }) {
  const v = REVIEW_VERDICT[review.verdict];
  return (
    <article
      className="rounded-lg border border-border bg-surface"
      data-testid="review"
      data-verdict={review.verdict}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Badge tone={v.tone}>
          {review.verdict === 'correct' ? <CheckIcon /> : <CircleAlertIcon />}
          {v.label}
        </Badge>
        <span className="ml-auto text-2xs text-fg-subtle">
          {LANG_LABEL[review.language]} at {formatTimeOfDay(review.createdAt)}
        </span>
      </header>
      <div className="space-y-3 px-3 py-3 text-[13.5px] leading-relaxed">
        {question && review.answer && (
          <div className="rounded-md bg-surface-2 px-3 py-2">
            <p className="flex items-start gap-1.5 text-xs font-medium text-fg-muted">
              <MessageCircleQuestionIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {question}
            </p>
            <p className="mt-1">{review.answer}</p>
          </div>
        )}
        <p>{review.summary}</p>
        {review.issues.length > 0 && (
          <div>
            <h4 className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">Issues</h4>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {review.issues.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {review.complexity && (
          <div>
            <h4 className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
              Complexity
            </h4>
            <p className="mt-1">{review.complexity}</p>
          </div>
        )}
        {review.followUps.length > 0 && (
          <div>
            <h4 className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
              You could ask
            </h4>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {review.followUps.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <footer className="border-t border-border px-3 py-1.5 font-mono text-2xs text-fg-subtle">
        {review.model}
      </footer>
    </article>
  );
}

/** The AI reads the code as it is now and tells the host what it thinks. On the host's own key. */
export function SecondOpinion() {
  const { state } = usePad();
  const key = useAiKey();
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [reviews, setReviews] = useState<{ review: SolutionReview; question: string | null }[]>([]);
  const ask = useMutation({
    mutationFn: (q: string) => api.reviewSolution(state.pad.id, q || undefined),
    onSuccess: (review, q) => {
      setReviews((r) => [{ review, question: q || null }, ...r].slice(0, 6));
      setQuestion('');
    },
    // A key that stopped working shows up as "needs a key" right away.
    onError: () => void qc.invalidateQueries({ queryKey: qk.aiKey }),
  });
  const wait = useRetryCountdown(ask.error);
  const keyState = key.data?.state;

  return (
    <div className="flex h-full flex-col">
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
            Add a key and the AI can read the code for you: whether it is correct, what breaks it,
            and what to ask next.
          </AiKeyPrompt>
        ) : reviews.length === 0 && !ask.isPending ? (
          <div className="flex flex-col items-center px-4 pt-8 text-center text-sm text-fg-muted">
            <SparklesIcon className="mb-2 size-5 text-fg-subtle" aria-hidden />
            <p className="font-medium text-fg">A second pair of eyes</p>
            <p className="mt-1 max-w-64 text-xs">
              Ask at any point. The AI reads the code as it is now, with the problem&apos;s notes
              and reference solution, and tells you whether it holds up.
            </p>
          </div>
        ) : null}
        {ask.isPending && (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Spinner /> Reading the code…
          </p>
        )}
        <InlineError error={ask.error} />
        {reviews.map((r) => (
          <ReviewCard key={r.review.createdAt} review={r.review} question={r.question} />
        ))}
      </div>
      <form
        className="shrink-0 space-y-2 border-t border-border p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ask.isPending && wait === 0) ask.mutate(question.trim());
        }}
      >
        <label htmlFor="review-question" className="sr-only">
          Something specific to check (optional)
        </label>
        <input
          id="review-question"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={keyState !== undefined && keyState !== 'active'}
          placeholder="Anything specific to check? (optional)"
          className="h-8 w-full rounded-md border border-border-strong bg-surface px-2.5 text-[13.5px] outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 disabled:opacity-60"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="w-full"
          disabled={ask.isPending || wait > 0 || (keyState !== undefined && keyState !== 'active')}
          data-testid="review-button"
        >
          {ask.isPending ? <Spinner /> : <SparklesIcon />}
          {wait > 0
            ? `Try again in ${wait}s`
            : question.trim()
              ? 'Ask about the code'
              : reviews.length
                ? 'Review the code again'
                : 'Review the code now'}
        </Button>
      </form>
    </div>
  );
}
