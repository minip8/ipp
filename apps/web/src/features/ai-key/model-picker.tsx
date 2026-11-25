'use client';
/**
 * Choosing the interviewer's model from the models the user's own key can use (listed live by its
 * provider). Optional everywhere: without a key, while loading, or when the list cannot be
 * fetched, it simply means "the provider default", and nothing is blocked.
 */
import type { AiModelChoice } from '@ipp/contracts';
import { CpuIcon } from 'lucide-react';
import { useId } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAiKey, useAiModels } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { choiceFor, DEFAULT_MODEL_VALUE, pickerOptions, pickerValue, providerLabel } from './logic';

export function ModelPicker({
  value,
  onChange,
  disabled,
  label = 'Model',
  className,
  labelClassName,
}: {
  /** The stored choice; null/undefined = provider default. */
  value: AiModelChoice | null | undefined;
  onChange: (choice: AiModelChoice | null) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  labelClassName?: string;
}) {
  const id = useId();
  const key = useAiKey();
  const active = key.data?.state === 'active';
  const provider = active ? (key.data?.provider ?? 'anthropic') : null;
  const models = useAiModels(active);
  const defaultModel = key.data?.model || 'provider default';
  const { value: selected, stale } = pickerValue(value, provider);
  const options = pickerOptions(
    active ? models.data : undefined,
    defaultModel,
    selected === DEFAULT_MODEL_VALUE ? null : selected,
  );

  let hint: React.ReactNode;
  if (key.isPending) hint = 'Checking your API key…';
  else if (!active)
    hint =
      key.data?.state === 'rejected'
        ? 'Save a working API key to choose a model.'
        : 'Add an API key to choose a model. Until then the provider default is used.';
  else if (models.isPending)
    hint = (
      <span className="inline-flex items-center gap-1.5">
        <Spinner className="size-3" /> Loading the models your {providerLabel(provider)} key can
        use…
      </span>
    );
  else if (models.isError || models.data?.source === 'fallback')
    hint = `Could not get the model list from ${providerLabel(provider)}; the default is used unless you pick another.`;
  else if (stale)
    hint = `Your earlier choice (${stale.id}) was for ${providerLabel(stale.provider)}; with your ${providerLabel(provider)} key the default is used.`;
  else hint = `Models your ${providerLabel(provider)} key can use. Billed to your account.`;

  return (
    <div className={cn('space-y-1.5', className)} data-testid="model-picker">
      <label
        id={`${id}-label`}
        htmlFor={`${id}-trigger`}
        className={cn('block text-xs text-fg-muted', labelClassName)}
      >
        {label}
      </label>
      <Select
        value={selected}
        onValueChange={(v) => provider && onChange(choiceFor(v, provider))}
        disabled={disabled || !active}
      >
        <SelectTrigger
          id={`${id}-trigger`}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          className="h-8"
        >
          <span className="flex min-w-0 items-center gap-2">
            <CpuIcon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span className="min-w-0 truncate">
              <SelectValue placeholder="Provider default" />
            </span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="font-mono text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-xs text-fg-muted">
        {hint}
      </p>
    </div>
  );
}
