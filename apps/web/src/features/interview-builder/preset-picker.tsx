'use client';
/**
 * The row of presets over the plan: each a card with its label, what it is and its length, and
 * one more, "Custom", which is chosen by itself once the plan stops being any preset. Choosing a
 * preset replaces the plan with it.
 */
import { type InterviewPreset, presetStages } from '@ipp/contracts';
import { RadioCard, RadioRoot } from '@/components/ui/radio-cards';
import { planTotal } from '@/features/interview/logic';
import { cn } from '@/lib/utils';
import { CUSTOM } from './logic';

const CARD = 'h-full px-3 py-2.5 max-sm:px-2.5';

export function PresetPicker({
  presets,
  value,
  customTotal,
  onChoose,
}: {
  presets: InterviewPreset[];
  /** A preset's id, or `custom`. */
  value: string;
  /** The plan's total while it is custom. */
  customTotal: string;
  onChoose: (preset: InterviewPreset) => void;
}) {
  const custom = value === CUSTOM;
  return (
    <RadioRoot
      aria-label="Presets"
      value={value}
      onValueChange={(id) => {
        const p = presets.find((x) => x.id === id);
        if (p) onChoose(p);
      }}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      data-testid="presets"
    >
      {presets.map((p) => {
        // A preset's shape does not depend on the language: count its stages as C++.
        const stages = presetStages(p, 'cpp');
        return (
          <RadioCard key={p.id} value={p.id} className={CARD} data-testid={`preset-${p.id}`}>
            <span className="block text-sm font-medium">{p.label}</span>
            <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted max-sm:hidden">
              {p.description}
            </span>
            <span className="mt-1 block text-xs text-fg-subtle tabular">{planTotal(stages)}</span>
          </RadioCard>
        );
      })}
      {/* Chosen by editing the plan; picking a preset again leaves it. */}
      <RadioCard
        value={CUSTOM}
        disabled={!custom}
        className={cn(CARD, !custom && 'border-dashed disabled:opacity-100')}
        data-testid="preset-custom"
      >
        <span className={cn('block text-sm font-medium', !custom && 'text-fg-muted')}>Custom</span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted max-sm:hidden">
          {custom
            ? 'Your own plan, changed from a preset.'
            : 'Change any stage below to make your own.'}
        </span>
        {custom && <span className="mt-1 block text-xs text-fg-subtle tabular">{customTotal}</span>}
      </RadioCard>
    </RadioRoot>
  );
}
