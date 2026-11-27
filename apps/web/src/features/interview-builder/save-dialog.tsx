'use client';
/**
 * Saving the plan shown under a name (`POST /api/interview-templates`), or, for a draft started
 * from a saved plan, updating that one instead (`PUT` with the stages); and renaming a saved
 * plan. The dialogs stay open on a refusal and say why in plain words: a name taken on this
 * track (change it and try again), the most saved plans one may keep, a rate limit counting down.
 */
import {
  INTERVIEW_TEMPLATE_NAME_MAX,
  type InterviewStage,
  type InterviewTemplate,
  type Track,
} from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, SaveIcon } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { InlineError, useRetryCountdown } from '@/components/states';
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
import { Input, Label } from '@/components/ui/input';
import { RadioCard, RadioRoot } from '@/components/ui/radio-cards';
import { Spinner } from '@/components/ui/spinner';
import { planTotal } from '@/features/interview/logic';
import { ApiRequestError, api, formatRetry } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useReturnFocus } from './return-focus';
import { type SavedPlan, templateProblem } from './selection';

/** A refusal's words under the form; a rate limit counts down. */
function Problem({ error, name }: { error: unknown; name: string }) {
  const wait = useRetryCountdown(error);
  const p = templateProblem(error, name);
  if (!p || p.kind === 'name') return null;
  if (p.kind === 'other') return <InlineError error={error} className="mt-3" />;
  const text =
    p.kind === 'rate'
      ? wait > 0
        ? `You have saved a lot in a short time. You can try again in ${formatRetry(wait)}.`
        : 'You can try again now.'
      : p.text;
  return (
    <p
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad-text"
      data-testid="save-problem"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

function NameField({
  value,
  onChange,
  error,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The name's own problem (taken), shown under it. */
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Name</Label>
      <Input
        id={id}
        ref={inputRef}
        value={value}
        maxLength={INTERVIEW_TEMPLATE_NAME_MAX}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-bad-text" data-testid="name-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Focus the name, selected, when a dialog opens (instead of its first control). */
const focusName = (ref: React.RefObject<HTMLInputElement | null>) => (e: Event) => {
  e.preventDefault();
  ref.current?.focus();
  ref.current?.select();
};

type Mode = 'update' | 'new';

export function SaveDialog({
  open,
  onOpenChange,
  track,
  stages,
  suggested,
  update,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: Track;
  stages: InterviewStage[];
  /** The name offered for a new saved plan. */
  suggested: string;
  /** The saved plan the draft came from, which may be updated instead. */
  update: SavedPlan | null;
  onSaved: (t: InterviewTemplate, how: Mode) => void;
}) {
  const [mode, setMode] = useState<Mode>(update ? 'update' : 'new');
  const [name, setName] = useState(suggested);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (how: Mode) =>
      how === 'update' && update
        ? api.updateInterviewTemplate(update.id, { stages })
        : api.saveInterviewTemplate({ name: name.trim(), track, stages }),
    onSuccess: (t, how) => onSaved(t, how),
    // Deleted meanwhile (another tab): the list loses it, and saving as new is what is left.
    onError: (e) => {
      if (e instanceof ApiRequestError && e.isNotFound)
        void qc.invalidateQueries({ queryKey: qk.interviewTemplates });
    },
  });
  const { reset } = save;
  // Each opening starts afresh: the suggested name, and updating when that is offered.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMode(update ? 'update' : 'new');
      setName(suggested);
      reset();
    }
    wasOpen.current = open;
  }, [open, update, suggested, reset]);

  const returnFocus = useReturnFocus(open);
  const wait = useRetryCountdown(save.error);
  const problem = templateProblem(save.error, name);
  const asNew = mode === 'new' || !update;
  const busy = save.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || wait > 0 || (asNew && !name.trim())) return;
    save.mutate(asNew ? 'new' : 'update');
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className="max-w-md"
        data-testid="save-dialog"
        onOpenAutoFocus={update ? undefined : focusName(input)}
        onCloseAutoFocus={returnFocus}
      >
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Save this interview</DialogTitle>
            <DialogDescription>
              {planTotal(stages)}. A saved interview is listed under Your interviews on this track,
              ready to start again.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {update && (
              <RadioRoot
                aria-label="How to save it"
                value={mode}
                onValueChange={(v) => {
                  setMode(v as Mode);
                  reset();
                }}
                className="space-y-2"
              >
                <RadioCard value="update">
                  <span className="block text-sm font-medium">Update “{update.name}”</span>
                  <span className="block text-xs text-fg-muted">
                    Its stages become this plan’s.
                  </span>
                </RadioCard>
                <RadioCard value="new">
                  <span className="block text-sm font-medium">Save as new</span>
                  <span className="block text-xs text-fg-muted">
                    “{update.name}” stays as it is.
                  </span>
                </RadioCard>
              </RadioRoot>
            )}
            {asNew && (
              <NameField
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (problem?.kind === 'name') reset();
                }}
                error={problem?.kind === 'name' ? problem.text : null}
                inputRef={input}
              />
            )}
            <Problem error={save.error} name={name} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || wait > 0 || (asNew && !name.trim())}
            >
              {busy ? <Spinner /> : <SaveIcon />}
              {asNew ? 'Save' : 'Update'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog({
  plan,
  onClose,
  onRenamed,
}: {
  /** The saved plan being renamed; null: closed. */
  plan: SavedPlan | null;
  onClose: () => void;
  onRenamed: (t: InterviewTemplate) => void;
}) {
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.updateInterviewTemplate(id, { name }),
    onSuccess: (t) => onRenamed(t),
  });
  const { reset } = rename;
  useEffect(() => {
    if (!plan) return;
    setName(plan.name);
    reset();
  }, [plan, reset]);

  const returnFocus = useReturnFocus(plan !== null);
  const wait = useRetryCountdown(rename.error);
  const problem = templateProblem(rename.error, name);
  const busy = rename.isPending;
  const unchanged = name.trim() === plan?.name;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!plan || busy || wait > 0 || !name.trim()) return;
    if (unchanged) return onClose();
    rename.mutate({ id: plan.id, name: name.trim() });
  };
  return (
    <Dialog open={plan !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      {plan && (
        <DialogContent
          className="max-w-md"
          data-testid="rename-dialog"
          onOpenAutoFocus={focusName(input)}
          onCloseAutoFocus={returnFocus}
        >
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>Rename “{plan.name}”</DialogTitle>
              <DialogDescription>
                Interviews already started from it keep the name they had.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <NameField
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (problem?.kind === 'name') reset();
                }}
                error={problem?.kind === 'name' ? problem.text : null}
                inputRef={input}
              />
              <Problem error={rename.error} name={name} />
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy || wait > 0 || !name.trim()}>
                {busy && <Spinner />}
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
