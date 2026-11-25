'use client';
import type { AnswerFeedback, PublicQuizQuestion, QuizAttempt, QuizResponse } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { ErrorState, InlineError, useRetryCountdown } from '@/components/states';
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
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { rejectedTitle } from '@/features/ai-key/logic';
import { ApiRequestError, api } from '@/lib/api';
import { humanize, plural } from '@/lib/format';
import { qk, useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { DiscussionFlow } from './discussion';
import {
  type Draft,
  draftForKey,
  draftFromResponse,
  outcomeOf,
  resumeIndex,
  toResponse,
} from './logic';
import { ProgressSegments, type SegState } from './progress';
import {
  ACTION_BAR,
  AnswerInput,
  FeedbackPanel,
  PHONE_FIT,
  QuestionCode,
  QuestionHeader,
  revealOnNarrow,
} from './question';
import { QuizResults } from './results';

export function useTopicTitles() {
  const topics = useQuery({
    queryKey: qk.quizTopics,
    queryFn: api.quizTopics,
    staleTime: 5 * 60_000,
  });
  return useCallback(
    (slug: string) => topics.data?.find((t) => t.slug === slug)?.title ?? humanize(slug),
    [topics.data],
  );
}

function AttemptSkeleton() {
  return (
    <div
      role="status"
      className="mx-auto max-w-3xl px-4 py-6 sm:px-6"
      aria-busy="true"
      aria-label="Loading quiz"
    >
      <Skeleton className="h-4 w-24" />
      <div className="mt-5 flex gap-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
          <Skeleton key={i} className="size-7" />
        ))}
      </div>
      <Skeleton className="mt-8 h-3 w-48" />
      <Skeleton className="mt-3 h-6 w-full" />
      <Skeleton className="mt-2 h-6 w-2/3" />
      <div className="mt-6 space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}

export function QuizAttemptView({ id }: { id: string }) {
  const attempt = useQuery({ queryKey: qk.attempt(id), queryFn: () => api.attempt(id) });
  if (attempt.isPending) return <AttemptSkeleton />;
  if (attempt.isError) {
    const notFound = attempt.error instanceof ApiRequestError && attempt.error.isNotFound;
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <ErrorState
          error={attempt.error}
          title={notFound ? 'This quiz does not exist' : undefined}
          onRetry={notFound ? undefined : () => attempt.refetch()}
        />
        <div className="text-center">
          <Button asChild variant="ghost" size="sm">
            <Link href="/quiz">
              <ArrowLeftIcon /> Back to quizzes
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  if (attempt.data.status === 'finished') return <QuizResults attempt={attempt.data} />;
  if (attempt.data.mode === 'discussion')
    return <DiscussionRoute key={attempt.data.id} attempt={attempt.data} />;
  return <QuizFlow key={attempt.data.id} attempt={attempt.data} />;
}

export function isTyping(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox')
  );
}

function DiscussionRoute({ attempt }: { attempt: QuizAttempt }) {
  const titleOf = useTopicTitles();
  return <DiscussionFlow attempt={attempt} topicLine={attempt.topics.map(titleOf).join(', ')} />;
}

function QuizFlow({ attempt }: { attempt: QuizAttempt }) {
  const qc = useQueryClient();
  const aiKey = useAiKey();
  const titleOf = useTopicTitles();
  const exam = attempt.mode === 'exam';
  const qs = attempt.questions;
  const [responses, setResponses] = useState<Record<string, QuizResponse>>(attempt.responses);
  const [feedback, setFeedback] = useState<Record<string, AnswerFeedback>>(() =>
    Object.fromEntries(attempt.feedback.map((f) => [f.questionId, f])),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(qs.map((q) => [q.id, draftFromResponse(q, attempt.responses[q.id])])),
  );
  const [index, setIndex] = useState(() =>
    resumeIndex(qs, attempt.responses, attempt.feedback, attempt.mode),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [grading, setGrading] = useState<number | null>(null);
  const mainRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  const q = qs[index] as PublicQuizQuestion;
  const draft = drafts[q.id] as Draft;
  const fb = feedback[q.id];
  const settled = !exam && Boolean(fb && !fb.needsSelfGrade);
  const locked = !exam && Boolean(fb);
  const response = toResponse(draft);
  const savedSame =
    exam && response !== null && JSON.stringify(responses[q.id]) === JSON.stringify(response);

  const stateOf = useCallback(
    (qq: PublicQuizQuestion): SegState => {
      if (exam) return responses[qq.id] ? 'answered' : 'empty';
      return outcomeOf(feedback[qq.id]) ?? (responses[qq.id] ? 'answered' : 'empty');
    },
    [exam, responses, feedback],
  );
  const counts = useMemo(() => {
    const c = { correct: 0, partial: 0, incorrect: 0, answered: 0 };
    for (const qq of qs) {
      const s = stateOf(qq);
      if (s === 'correct' || s === 'partial' || s === 'incorrect') c[s]++;
      if (s !== 'empty') c.answered++;
    }
    return c;
  }, [qs, stateOf]);
  const unanswered = qs.length - counts.answered;
  const allSettled = exam
    ? unanswered === 0
    : qs.every((qq) => feedback[qq.id] && !feedback[qq.id]?.needsSelfGrade);

  const go = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(qs.length - 1, i));
      setIndex(next);
      setGrading(null);
      requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: false }));
    },
    [qs.length],
  );

  const syncCache = (patch: Partial<QuizAttempt>) =>
    qc.setQueryData<QuizAttempt>(qk.attempt(attempt.id), (old) =>
      old ? { ...old, ...patch } : old,
    );

  const submit = useMutation({
    mutationFn: (vars: { question: PublicQuizQuestion; response: QuizResponse }) =>
      api.submitAnswer(attempt.id, { questionId: vars.question.id, response: vars.response }),
    onSuccess: (res, { question, response: r }) => {
      // Grading may have found the key rejected; let the prompt reflect that.
      if (question.type === 'short') void qc.invalidateQueries({ queryKey: qk.aiKey });
      const nextResponses = { ...responses, [question.id]: r };
      setResponses(nextResponses);
      if ('recorded' in res) {
        syncCache({ responses: nextResponses });
        // Exam: move on to the next unanswered question, if any.
        const after = qs.findIndex((qq, i) => i > index && !nextResponses[qq.id]);
        const before = qs.findIndex((qq) => !nextResponses[qq.id]);
        const target = after !== -1 ? after : before;
        if (target !== -1) go(target);
      } else {
        const nextFeedback = { ...feedback, [question.id]: res };
        setFeedback(nextFeedback);
        syncCache({ responses: nextResponses, feedback: Object.values(nextFeedback) });
      }
      setGrading(null);
    },
    onError: () => setGrading(null),
  });
  const submitWait = useRetryCountdown(submit.error);

  const finish = useMutation({
    mutationFn: () => api.finishAttempt(attempt.id),
    onSuccess: (a) => {
      qc.setQueryData(qk.attempt(a.id), a);
      qc.invalidateQueries({ queryKey: qk.attempts });
      qc.invalidateQueries({ queryKey: qk.quizTopics });
      window.scrollTo({ top: 0 });
    },
  });

  const setDraft = (d: Draft) => setDrafts((all) => ({ ...all, [q.id]: d }));

  // On a phone the feedback lands below the choices, often off screen: bring it up.
  const fbKey = fb ? String(fb.needsSelfGrade) : '';
  const seenFb = useRef({ id: q.id, key: fbKey });
  useEffect(() => {
    const was = seenFb.current;
    seenFb.current = { id: q.id, key: fbKey };
    if (was.id === q.id && fbKey && was.key !== fbKey) revealOnNarrow(feedbackRef.current);
  }, [q.id, fbKey]);

  const primary = useCallback(() => {
    if (submit.isPending || finish.isPending || submitWait > 0) return;
    if (settled) {
      if (index < qs.length - 1) go(index + 1);
      else if (allSettled) finish.mutate();
      else go(qs.findIndex((qq) => !feedback[qq.id] || feedback[qq.id]?.needsSelfGrade));
      return;
    }
    if (locked) return; // waiting for a self-grade
    if (response) submit.mutate({ question: q, response });
    else if (exam && index === qs.length - 1) setConfirmOpen(true);
  }, [
    submit,
    finish,
    submitWait,
    settled,
    index,
    qs,
    allSettled,
    go,
    feedback,
    locked,
    response,
    q,
    exam,
  ]);

  // Keyboard: 1-9 / A-Z choose, Enter submits or continues, arrows and J/K move between questions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmOpen || e.defaultPrevented || e.altKey) return;
      const typing = isTyping(e.target);
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        primary();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement | null;
      if (e.key === 'Enter') {
        if (target?.tagName === 'BUTTON' || target?.tagName === 'A') return;
        e.preventDefault();
        primary();
        return;
      }
      if (
        target?.getAttribute('role') === 'radio' &&
        target.closest('[data-radix-collection-item]') &&
        e.key.startsWith('Arrow')
      )
        return;
      if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault();
        go(e.key === 'ArrowRight' || e.key === 'j' ? index + 1 : index - 1);
        return;
      }
      if (locked) return;
      const next = draftForKey(q, draft, e.key);
      if (next) {
        e.preventDefault();
        setDraft(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const last = index === qs.length - 1;
  let primaryLabel: string;
  if (settled) primaryLabel = last ? (allSettled ? 'See results' : 'Next unanswered') : 'Continue';
  else if (locked) primaryLabel = 'Grade to continue';
  else if (exam)
    primaryLabel = savedSame
      ? last
        ? 'Saved'
        : 'Saved · next'
      : last
        ? 'Save answer'
        : 'Save and next';
  else primaryLabel = 'Submit answer';
  const primaryDisabled =
    submit.isPending ||
    finish.isPending ||
    submitWait > 0 ||
    (!settled && (locked || !response || (exam && savedSame && last)));

  const topicLine = attempt.topics.map(titleOf).join(', ');

  return (
    <div className={cn('mx-auto max-w-3xl px-4 py-6 sm:px-6 max-sm:pt-3', PHONE_FIT)}>
      <div className="flex items-center gap-3">
        <Link
          href="/quiz"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg max-sm:min-h-10"
        >
          <ArrowLeftIcon className="size-3.5" /> Quizzes
        </Link>
        <span className="text-xs text-fg-subtle">Progress is saved</span>
        <Button
          variant={exam && unanswered === 0 ? 'primary' : 'ghost'}
          size="sm"
          className="ml-auto max-sm:h-10"
          onClick={() => setConfirmOpen(true)}
        >
          <FlagIcon /> Finish quiz
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 max-sm:mt-2 max-sm:px-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={exam ? 'warn' : 'accent'}>{exam ? 'Exam' : 'Practice'}</Badge>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={topicLine}>
            {topicLine}
          </span>
          <span className="text-sm text-fg-muted tabular" data-testid="quiz-counter">
            Question {index + 1} of {qs.length}
          </span>
        </div>
        <div className="mt-3">
          <ProgressSegments questions={qs} index={index} stateOf={stateOf} onJump={go} />
        </div>
        <p className="mt-2.5 text-xs text-fg-muted tabular">
          {exam
            ? `${counts.answered} answered · ${plural(unanswered, 'question')} left. Feedback comes when you finish.`
            : `${counts.correct} correct · ${counts.partial ? `${counts.partial} partly correct · ` : ''}${counts.incorrect} incorrect · ${unanswered} to go`}
        </p>
      </div>

      <article className="mt-6 max-sm:mt-5" aria-labelledby={`q-${q.id}`}>
        <QuestionHeader q={q} />
        <h1 ref={mainRef} tabIndex={-1} className="sr-only">
          Question {index + 1} of {qs.length}
        </h1>
        <div id={`q-${q.id}`} className="mt-2">
          <Markdown className="text-md text-fg">{q.prompt}</Markdown>
        </div>
        {q.code && (
          <div className="mt-4">
            <QuestionCode q={q} />
          </div>
        )}
        <div className="mt-5">
          <AnswerInput q={q} draft={draft} setDraft={setDraft} feedback={fb} locked={locked} />
        </div>
        {q.type === 'short' && !locked && aiKey.data && aiKey.data.state !== 'active' && (
          <AiKeyPrompt
            className="mt-3"
            size="sm"
            testId="quiz-key-prompt"
            quiet
            state={aiKey.data.state}
            title={
              aiKey.data.state === 'rejected'
                ? `${rejectedTitle(aiKey.data.provider)}, so you will grade this answer yourself`
                : 'AI grading runs on your own AI API key'
            }
          >
            Without one you compare your answer with the reference and grade it yourself. Your
            answer stays as you typed it.
          </AiKeyPrompt>
        )}

        {fb && !exam && (
          <div ref={feedbackRef} className="mt-5 max-lg:scroll-mb-24">
            <FeedbackPanel
              q={q}
              feedback={fb}
              grading={grading}
              onSelfGrade={(g) => {
                const r = toResponse(draft);
                if (r?.type !== 'short') return;
                setGrading(g);
                submit.mutate({ question: q, response: { ...r, selfGrade: g } });
              }}
            />
          </div>
        )}

        <InlineError error={submit.error ?? finish.error} className="mt-4" />

        <div className={cn('mt-6 flex items-center gap-2 border-t border-border pt-4', ACTION_BAR)}>
          <Button
            variant="ghost"
            size="sm"
            className="max-sm:h-10 max-sm:px-3"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Previous question"
          >
            <ChevronLeftIcon /> <span className="hidden sm:inline">Previous</span>
          </Button>
          {!settled && !locked && !exam && !last && (
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:h-10 max-sm:px-3"
              onClick={() => go(index + 1)}
            >
              Skip
            </Button>
          )}
          {exam && !last && (
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:h-10 max-sm:px-3"
              onClick={() => go(index + 1)}
              aria-label="Next question"
            >
              <span className="hidden sm:inline">Next</span> <ChevronRightIcon />
            </Button>
          )}
          <span
            className={cn(
              'ml-auto hidden items-center gap-1.5 text-xs text-fg-subtle',
              !(locked && !settled) && 'md:inline-flex',
              // Key hints are noise on a touch screen.
              'pointer-coarse:hidden!',
            )}
          >
            {q.type === 'short' || (draft.type === 'output' && draft.kind === 'output') ? (
              <>
                <Kbd keys="Mod+Enter" /> to {settled ? 'continue' : 'submit'}
              </>
            ) : (
              <>
                {!locked && (q.type === 'single' || q.type === 'multiple') && (
                  <>
                    <Kbd keys="A" />–
                    <Kbd keys={String.fromCharCode(64 + (q.choices?.length ?? 4))} /> choose ·
                  </>
                )}
                <Kbd keys="Enter" /> {settled ? 'continue' : exam ? 'save' : 'submit'}
              </>
            )}
          </span>
          <Button
            variant="primary"
            className="ml-auto md:ml-2 max-sm:h-10 max-sm:flex-1"
            onClick={primary}
            disabled={primaryDisabled}
            data-testid="quiz-primary"
          >
            {(submit.isPending && grading === null) || finish.isPending ? (
              <Spinner />
            ) : savedSame ? (
              <CheckIcon />
            ) : null}
            {submitWait > 0 ? `Try again in ${submitWait}s` : primaryLabel}
            {!submit.isPending && !finish.isPending && !savedSame && submitWait === 0 && (
              <ArrowRightIcon />
            )}
          </Button>
        </div>
        {exam && last && unanswered === 0 && (
          <p className="mt-3 text-right text-sm text-fg-muted max-sm:text-center">
            All questions answered.{' '}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="font-medium text-accent-text hover:underline"
            >
              Finish and see results
            </button>
          </p>
        )}
      </article>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finish this quiz?</DialogTitle>
            <DialogDescription>
              {unanswered > 0
                ? `You have ${plural(unanswered, 'unanswered question')}. Unanswered questions count as incorrect.`
                : exam
                  ? 'You have answered every question. You will see your score and the explanations next.'
                  : 'You will see your score and a review of every answer.'}
            </DialogDescription>
          </DialogHeader>
          {finish.error ? (
            <DialogBody>
              <InlineError error={finish.error} />
            </DialogBody>
          ) : null}
          <DialogFooter className="max-sm:[&_button]:h-10">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Keep going
            </Button>
            <Button
              variant="primary"
              disabled={finish.isPending}
              onClick={() => finish.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
            >
              {finish.isPending && <Spinner />}
              Finish quiz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
