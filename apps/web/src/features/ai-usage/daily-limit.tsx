'use client';
/**
 * "Daily limit" on the AI key settings page: today's usage, the caps that apply (the user's own
 * or the server defaults), and a form to set them by estimated cost, tokens or messages.
 */
import type { AiUsageStatus } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, InfoIcon, RotateCcwIcon, SaveIcon } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, useRetryCountdown } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, formatRetry } from '@/lib/api';
import { qk, useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  activeCaps,
  costFallbackActive,
  defaultsLine,
  type FormErrors,
  formatCount,
  formatMicros,
  formOf,
  type LimitsForm,
  lowCapWarning,
  priceLine,
  readLimitsForm,
  untrackedNote,
} from './logic';

/** Today's usage and limits. Keyed on the key too: another provider prices differently. */
function useAiUsage() {
  const key = useAiKey();
  const keyed = [...qk.aiUsage, key.data?.state ?? null, key.data?.provider ?? null] as const;
  const query = useQuery({ queryKey: keyed, queryFn: api.aiUsage, enabled: !key.isPending });
  return { query, key: keyed };
}

const ESTIMATE_NOTE =
  'Cost is an estimate from list prices; your provider’s bill is what you actually pay.';

/** Decorative: the figures beside it say the same in words. */
function UsageBar({ share }: { share: number }) {
  const pct = Math.round(share * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div
        className={cn(
          'h-full rounded-full',
          share >= 1 ? 'bg-bad' : share >= 0.8 ? 'bg-warn' : 'bg-accent',
        )}
        style={{ width: `${Math.max(pct, share > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

function resetsIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!(ms > 0)) return 'soon';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.ceil((ms % 3_600_000) / 60_000);
  if (h === 0) return `in ${m} min`;
  return `in ${h} h ${m === 60 ? 0 : m} min`;
}

function Today({ status }: { status: AiUsageStatus }) {
  const caps = activeCaps(status);
  const u = status.usage;
  const costShown = caps.some((c) => c.kind === 'cost');
  return (
    <div className="space-y-3" data-testid="ai-usage-today">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">Today</h3>
        <span className="text-xs text-fg-muted">
          Starts again at midnight UTC, {resetsIn(status.resetsAt)}
        </span>
      </div>
      <ul className="space-y-2.5" aria-label="Limits that apply today">
        {caps.map((c) => (
          <li key={`${c.kind}-${c.label}`} className="space-y-1" data-testid={`ai-cap-${c.kind}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="text-fg">{c.label}</span>
              <span className="tabular-nums text-fg-muted">{c.text}</span>
            </div>
            <UsageBar share={c.share} />
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-fg-muted">
        <dt>Messages</dt>
        <dd className="text-right tabular-nums sm:text-left">{formatCount(u.messages)}</dd>
        <dt>Tokens</dt>
        <dd className="text-right tabular-nums sm:text-left">
          {formatCount(u.totalTokens)}{' '}
          <span className="text-fg-subtle">
            ({formatCount(u.inputTokens)} in, {formatCount(u.outputTokens)} out)
          </span>
        </dd>
        {u.costMicros > 0 && !costShown && (
          <>
            <dt>Estimated cost</dt>
            <dd className="text-right tabular-nums sm:text-left">{formatMicros(u.costMicros)}</dd>
          </>
        )}
      </dl>
      {(u.costMicros > 0 || costShown) && <p className="text-xs text-fg-muted">{ESTIMATE_NOTE}</p>}
      {u.unpricedTokens > 0 && (
        <p className="text-xs text-fg-muted" data-testid="ai-usage-unpriced">
          {formatCount(u.unpricedTokens)} tokens today were on a model with no known price, so the
          estimate leaves them out.
        </p>
      )}
      {costFallbackActive(status) && (
        <p className="text-xs text-fg-muted">
          Because some of today’s usage could not be priced, the default limit of{' '}
          {formatCount(status.defaults.messages)} messages applies as well.
        </p>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  prefix,
  disabled,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: React.ReactNode;
  placeholder: string;
  prefix?: string;
  disabled?: boolean;
  inputMode: 'decimal' | 'numeric' | 'text';
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {prefix && (
          <span
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-fg-subtle"
            aria-hidden
          >
            {prefix}
          </span>
        )}
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          onChange={(e) => onChange(e.target.value)}
          className={cn('tabular-nums', prefix && 'pl-6')}
        />
      </div>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-xs text-bad-text"
        >
          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
      <FieldHint id={`${id}-hint`}>{hint}</FieldHint>
    </div>
  );
}

function LimitsEditor({
  status,
  queryKey,
}: {
  status: AiUsageStatus;
  queryKey: readonly unknown[];
}) {
  const id = useId();
  const qc = useQueryClient();
  const [form, setForm] = useState<LimitsForm>(() => formOf(status.limits));
  const [errors, setErrors] = useState<FormErrors>({});
  // A save or reset elsewhere (or the first load) refills the form from what is stored.
  const stored = JSON.stringify(status.limits);
  useEffect(() => {
    setForm(formOf(JSON.parse(stored)));
    setErrors({});
  }, [stored]);

  const settle = (s: AiUsageStatus) => qc.setQueryData(queryKey, s);
  const save = useMutation({ mutationFn: api.saveAiLimits, onSuccess: settle });
  const reset = useMutation({ mutationFn: api.resetAiLimits, onSuccess: settle });
  const busy = save.isPending || reset.isPending;
  const wait = useRetryCountdown(save.error ?? reset.error);
  const serverError = save.error ?? reset.error;

  const read = readLimitsForm(form);
  const warning = read.ok ? lowCapWarning(read.limits) : null;
  const tracking = status.costTracking;
  const untracked = untrackedNote(tracking, status.defaults);

  const set = (k: keyof LimitsForm) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k] || errors.form) setErrors({});
    if (save.error) save.reset();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!read.ok) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    save.mutate(read.limits, {
      onSuccess: () => toast.success('Daily limit saved'),
    });
  };

  const costHint = untracked ? (
    <span className="text-warn-text" data-testid="ai-cost-untracked">
      {untracked}
    </span>
  ) : tracking?.price ? (
    <>
      {tracking.model}: {priceLine(tracking.price)}
      {tracking.source === 'reported' ? '; OpenRouter reports what each call cost' : ''}.
    </>
  ) : tracking?.source === 'reported' ? (
    'OpenRouter reports what each call cost.'
  ) : (
    'Estimated from list prices once you save a key.'
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-labelledby={`${id}-heading`}>
      <div>
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          Set your own
        </h3>
        <p className="mt-1 text-sm text-fg-muted">
          Set any of these; the first one reached stops the AI for the rest of the day. Leave a
          field empty for no limit of that kind.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id={`${id}-cost`}
          label="Cost in US dollars"
          prefix="$"
          placeholder="5.00"
          inputMode="decimal"
          value={form.cost}
          onChange={set('cost')}
          error={errors.cost}
          disabled={busy}
          hint={costHint}
        />
        <Field
          id={`${id}-tokens`}
          label="Tokens"
          placeholder="2M"
          inputMode="text"
          value={form.tokens}
          onChange={set('tokens')}
          error={errors.tokens}
          disabled={busy}
          hint="Input and output together, like 2,000,000 or 2M."
        />
        <Field
          id={`${id}-messages`}
          label="Messages"
          placeholder="300"
          inputMode="numeric"
          value={form.messages}
          onChange={set('messages')}
          error={errors.messages}
          disabled={busy}
          hint="Interviewer messages and graded answers."
        />
      </div>
      {errors.form && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-bad-text">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {errors.form}
        </p>
      )}
      {warning && !errors.form && (
        <p
          role="status"
          className="flex items-start gap-1.5 text-sm text-warn-text"
          data-testid="ai-limit-low"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {warning}
        </p>
      )}
      {serverError ? (
        <p role="alert" className="text-sm text-bad-text">
          {errorMessage(serverError)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy || wait > 0}>
          {save.isPending ? <Spinner /> : <SaveIcon />}
          {wait > 0 ? `Try again in ${formatRetry(wait)}` : 'Save limits'}
        </Button>
        {status.limits && (
          <Button
            variant="ghost"
            disabled={busy || wait > 0}
            onClick={() =>
              reset.mutate(undefined, {
                onSuccess: () => toast.success('Back to the default limits'),
              })
            }
          >
            {reset.isPending ? <Spinner /> : <RotateCcwIcon />}
            Use the defaults
          </Button>
        )}
      </div>
    </form>
  );
}

export function DailyLimitSection() {
  const { query, key } = useAiUsage();
  const status = query.data;
  return (
    <Card className="mt-6" aria-labelledby="daily-limit-heading" data-testid="ai-daily-limit">
      <CardHeader>
        <CardTitle id="daily-limit-heading">Daily limit</CardTitle>
        {status && (
          <Badge tone={status.limits ? 'accent' : 'neutral'}>
            {status.limits ? 'Your limits' : 'Defaults'}
          </Badge>
        )}
      </CardHeader>
      <div className="space-y-5 p-4 sm:p-5">
        {query.isPending ? (
          <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} compact />
        ) : !status ? null : (
          <>
            <p className="text-sm text-fg-muted">
              A brake on what the AI spends from your key each day. When a limit is reached the
              interviewer says so and stops until the next day.
              {!status.limits &&
                ` You have not set your own, so the defaults apply: ${defaultsLine(status.defaults)}.`}
            </p>
            <Today status={status} />
            <LimitsEditor status={status} queryKey={key} />
          </>
        )}
      </div>
    </Card>
  );
}
