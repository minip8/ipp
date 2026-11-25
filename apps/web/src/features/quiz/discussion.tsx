'use client';
/**
 * Discussion mode: each open question is talked through with the AI interviewer. The question is
 * the interviewer's first message; after each reply it either asks a follow-up or closes the
 * question with a grade, the reference answer and the explanation.
 */
import {
  type AnswerFeedback,
  DISCUSSION_MAX_TURNS,
  DISCUSSION_TURN_MAX_CHARS,
  type DiscussionTurn,
  type PublicQuizQuestion,
  type QuizAttempt,
} from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon, ArrowRightIcon, FlagIcon, SendIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { InlineError, useRetryCountdown } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';
import { qk, useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { outcomeOf, resumeIndex } from './logic';
import { ProgressSegments, type SegState } from './progress';
import { FeedbackPanel, QuestionHeader } from './question';

function Bubble({
  who,
  children,
}: {
  who: 'interviewer' | 'candidate';
  children: React.ReactNode;
}) {
  return (
    <li className={cn('flex', who === 'candidate' && 'justify-end')}>
      <div
        className={cn(
          'max-w-[88%] rounded-lg px-3.5 py-2.5',
          who === 'candidate' ? 'bg-accent-soft' : 'border border-border bg-surface',
        )}
      >
        <p className="mb-0.5 text-2xs font-medium text-fg-subtle">
          {who === 'candidate' ? 'You' : 'Interviewer'}
        </p>
        {children}
      </div>
    </li>
  );
}

export function DiscussionFlow({
  attempt,
  topicLine,
}: {
  attempt: QuizAttempt;
  topicLine: string;
}) {
  const qc = useQueryClient();
  const aiKey = useAiKey();
  const qs = attempt.questions;
  const [turns, setTurns] = useState<Record<string, DiscussionTurn[]>>(attempt.discussion);
  const [feedback, setFeedback] = useState<Record<string, AnswerFeedback>>(() =>
    Object.fromEntries(attempt.feedback.map((f) => [f.questionId, f])),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(() =>
    resumeIndex(qs, attempt.responses, attempt.feedback, attempt.mode),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const q = qs[index] as PublicQuizQuestion;
  const said = turns[q.id] ?? [];
  const fb = feedback[q.id];
  const draft = drafts[q.id] ?? '';
  const replies = said.filter((t) => t.role === 'candidate').length;
  const last = index === qs.length - 1;
  const open = qs.filter((qq) => !feedback[qq.id]).length;

  const go = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(qs.length - 1, i))),
    [qs.length],
  );
  const stateOf = (qq: PublicQuizQuestion): SegState =>
    outcomeOf(feedback[qq.id]) ?? (turns[qq.id]?.length ? 'answered' : 'empty');

  const reply = useMutation({
    mutationFn: (vars: { questionId: string; text: string }) =>
      api.discussionReply(attempt.id, vars),
    onSuccess: (res, { questionId }) => {
      const nextTurns = { ...turns, [questionId]: res.turns };
      const nextFeedback = res.feedback ? { ...feedback, [questionId]: res.feedback } : feedback;
      setTurns(nextTurns);
      setFeedback(nextFeedback);
      setDrafts((d) => ({ ...d, [questionId]: '' }));
      qc.setQueryData<QuizAttempt>(qk.attempt(attempt.id), (old) =>
        old
          ? {
              ...old,
              discussion: nextTurns,
              feedback: Object.values(nextFeedback),
              responses: res.feedback
                ? {
                    ...old.responses,
                    [questionId]: {
                      type: 'short',
                      text: res.turns
                        .filter((t) => t.role === 'candidate')
                        .map((t) => t.text)
                        .join('\n\n'),
                    },
                  }
                : old.responses,
            }
          : old,
      );
      if (res.feedback) void qc.invalidateQueries({ queryKey: qk.quizTopics });
    },
    // The reply may have failed because the key was rejected; let the prompt reflect that.
    onError: () => void qc.invalidateQueries({ queryKey: qk.aiKey }),
  });
  const wait = useRetryCountdown(reply.error);
  const sending = reply.isPending && reply.variables?.questionId === q.id ? reply.variables : null;

  const finish = useMutation({
    mutationFn: () => api.finishAttempt(attempt.id),
    onSuccess: (a) => {
      qc.setQueryData(qk.attempt(a.id), a);
      qc.invalidateQueries({ queryKey: qk.attempts });
      qc.invalidateQueries({ queryKey: qk.quizTopics });
      window.scrollTo({ top: 0 });
    },
  });

  const text = draft.trim();
  const canSend = !fb && text.length > 0 && !reply.isPending && wait === 0;
  const send = () => {
    if (canSend) reply.mutate({ questionId: q.id, text });
  };
  const next = () => {
    if (!last) return go(index + 1);
    const unfinished = qs.findIndex((qq) => !feedback[qq.id]);
    if (unfinished === -1) finish.mutate();
    else setConfirmOpen(true);
  };

  // Keep the newest message in view, and the cursor in the box while the question is open.
  const shown = said.length + (sending ? 1 : 0) + (fb ? 1 : 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the thread grows or changes
  useEffect(() => {
    if (shown > 0) endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [shown, q.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the question changes
  useEffect(() => {
    if (!fb) inputRef.current?.focus({ preventScroll: true });
  }, [q.id, said.length]);

  const keyState = aiKey.data?.state;
  const needsKey = keyState === 'missing' || keyState === 'rejected';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/quiz"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeftIcon className="size-3.5" /> Quizzes
        </Link>
        <span className="text-xs text-fg-subtle">Progress is saved</span>
        <Button
          variant={open === 0 ? 'primary' : 'ghost'}
          size="sm"
          className="ml-auto"
          onClick={() => setConfirmOpen(true)}
        >
          <FlagIcon /> Finish
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone="accent">Discussion</Badge>
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
      </div>

      <article className="mt-6" aria-labelledby={`q-${q.id}`}>
        <QuestionHeader q={q} />
        <h1 className="sr-only">
          Question {index + 1} of {qs.length}
        </h1>
        <ol className="mt-3 space-y-3" aria-label="Conversation">
          <Bubble who="interviewer">
            <div id={`q-${q.id}`}>
              <Markdown className="text-md text-fg">{q.prompt}</Markdown>
            </div>
          </Bubble>
          {said.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: turns are only ever appended
            <Bubble key={i} who={t.role}>
              <p className="text-base whitespace-pre-wrap">{t.text}</p>
            </Bubble>
          ))}
          {sending && (
            <>
              <Bubble who="candidate">
                <p className="text-base whitespace-pre-wrap">{sending.text}</p>
              </Bubble>
              <li className="flex items-center gap-2 text-xs text-fg-subtle" role="status">
                <Spinner /> Interviewer is thinking
              </li>
            </>
          )}
        </ol>

        {fb ? (
          <div className="mt-5">
            <FeedbackPanel q={q} feedback={fb} />
          </div>
        ) : needsKey ? (
          <AiKeyPrompt
            className="mt-5"
            testId="discussion-key-prompt"
            state={keyState}
            title={
              keyState === 'rejected'
                ? 'Your API key was rejected, so the interviewer cannot reply'
                : 'The interviewer runs on your own AI API key'
            }
          >
            What you have said so far is kept.
          </AiKeyPrompt>
        ) : (
          <div className="mt-5">
            <label htmlFor="discussion-reply" className="sr-only">
              Your reply
            </label>
            <Textarea
              id="discussion-reply"
              ref={inputRef}
              rows={4}
              value={draft}
              maxLength={DISCUSSION_TURN_MAX_CHARS}
              disabled={reply.isPending}
              onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                replies === 0 ? 'Answer as you would out loud' : 'Reply to the follow-up'
              }
            />
            <p className="mt-1.5 text-xs text-fg-muted">
              {replies + 1 >= DISCUSSION_MAX_TURNS
                ? 'This is your last reply on this question.'
                : `Reply ${replies + 1} of up to ${DISCUSSION_MAX_TURNS}. The interviewer may follow up.`}
            </p>
          </div>
        )}
        <div ref={endRef} />

        <InlineError error={reply.error ?? finish.error} className="mt-4" />

        <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
          {!fb && !last && (
            <Button variant="ghost" size="sm" onClick={() => go(index + 1)}>
              Skip
            </Button>
          )}
          {fb ? (
            <Button
              variant="primary"
              className="ml-auto"
              onClick={next}
              disabled={finish.isPending}
              data-testid="quiz-primary"
            >
              {finish.isPending && <Spinner />}
              {last ? 'See results' : 'Next question'} <ArrowRightIcon />
            </Button>
          ) : (
            <>
              <span className="ml-auto hidden items-center gap-1.5 text-xs text-fg-subtle md:inline-flex">
                <Kbd keys="Mod+Enter" /> to send
              </span>
              <Button
                variant="primary"
                className="ml-auto md:ml-2"
                onClick={send}
                disabled={!canSend || needsKey}
                data-testid="quiz-primary"
              >
                {reply.isPending ? <Spinner /> : <SendIcon />}
                {wait > 0 ? `Try again in ${wait}s` : 'Send'}
              </Button>
            </>
          )}
        </div>
      </article>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finish this discussion?</DialogTitle>
            <DialogDescription>
              {open > 0
                ? `${plural(open, 'question')} ${open === 1 ? 'is' : 'are'} not finished and will count as unanswered.`
                : 'You will see your score and a review of every question.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Keep going
            </Button>
            <Button
              variant="primary"
              disabled={finish.isPending}
              onClick={() => finish.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
            >
              {finish.isPending && <Spinner />}
              Finish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
