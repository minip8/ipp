'use client';
/**
 * The cards over the plan, one choice among them: a link's preview (when the page was opened by
 * one), the track's presets, then under "Your interviews" the user's saved plans of this track
 * (each with a menu to rename or delete it) and "Custom", the user's own draft. Choosing a card
 * shows its plan; the draft is kept whatever is chosen, and Custom shows it again.
 */
import { type InterviewPreset, type InterviewStage, presetStages } from '@ipp/contracts';
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { RadioCard, RadioRoot } from '@/components/ui/radio-cards';
import { planTotal } from '@/features/interview/logic';
import { cn } from '@/lib/utils';
import { type SavedPlan, type Selection, stageKinds } from './selection';

const CARD = 'h-full px-3 py-2.5 max-sm:px-2.5';

/** A card's radio value. */
export function selectionValue(s: Selection): string {
  if (s.kind === 'preset') return `preset:${s.id}`;
  if (s.kind === 'saved') return `saved:${s.id}`;
  return s.kind;
}

/**
 * A saved plan's menu. The dialog an item opens is opened once the menu has closed and given
 * focus back to its button, so closing the dialog returns focus there.
 */
function PlanMenu({
  plan,
  onRename,
  onDelete,
}: {
  plan: SavedPlan;
  onRename: (t: SavedPlan) => void;
  onDelete: (t: SavedPlan) => void;
}) {
  const then = useRef<(() => void) | null>(null);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-1.5 right-1.5 z-10 max-sm:top-1 max-sm:right-1 max-sm:size-8"
          aria-label={`Actions for ${plan.name}`}
        >
          <MoreHorizontalIcon />
        </Button>
      </MenuTrigger>
      <MenuContent
        align="end"
        onCloseAutoFocus={() => {
          const action = then.current;
          then.current = null;
          action?.();
        }}
      >
        <MenuItem onSelect={() => (then.current = () => onRename(plan))}>
          <PencilIcon /> Rename
        </MenuItem>
        <MenuItem tone="danger" onSelect={() => (then.current = () => onDelete(plan))}>
          <Trash2Icon /> Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Total({ stages }: { stages: readonly InterviewStage[] }) {
  return <span className="mt-1 block text-xs text-fg-subtle tabular">{planTotal(stages)}</span>;
}

export function PresetPicker({
  presets,
  saved,
  preview,
  draft,
  value,
  onChoose,
  onRename,
  onDelete,
}: {
  presets: InterviewPreset[];
  /** This track's saved plans, by name. */
  saved: readonly SavedPlan[];
  /** A link's plan, shown as its own card: what it is called and its stages. */
  preview: { label: string; stages: InterviewStage[] } | null;
  /** The draft's stages, or null with none. */
  draft: InterviewStage[] | null;
  value: Selection;
  onChoose: (s: Selection) => void;
  onRename: (t: SavedPlan) => void;
  onDelete: (t: SavedPlan) => void;
}) {
  const choose = (v: string) => {
    if (v === 'custom' || v === 'preview') return onChoose({ kind: v });
    const [kind, id] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    if (kind === 'preset') return onChoose({ kind: 'preset', id });
    const t = saved.find((x) => x.id === id);
    if (kind === 'saved' && t)
      onChoose({ kind: 'saved', id: t.id, name: t.name, stages: t.stages });
  };
  return (
    <RadioRoot
      aria-label="Presets"
      value={selectionValue(value)}
      onValueChange={choose}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      data-testid="presets"
    >
      {preview && (
        <RadioCard value="preview" className={CARD} data-testid="preset-link">
          <span className="block truncate text-sm font-medium">{preview.label}</span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted max-sm:hidden">
            From the link you followed. Change it to make it your own.
          </span>
          <Total stages={preview.stages} />
        </RadioCard>
      )}
      {presets.map((p) => (
        <RadioCard
          key={p.id}
          value={selectionValue({ kind: 'preset', id: p.id })}
          className={CARD}
          data-testid={`preset-${p.id}`}
        >
          <span className="block text-sm font-medium">{p.label}</span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted max-sm:hidden">
            {p.description}
          </span>
          {/* A preset's shape does not depend on the language: count its stages as C++. */}
          <Total stages={presetStages(p, 'cpp')} />
        </RadioCard>
      ))}
      {saved.length > 0 && (
        <p
          className="col-span-full mt-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase"
          id="saved-plans-label"
        >
          Your interviews
        </p>
      )}
      {saved.map((t) => (
        // The menu sits over the card's corner, beside its radio rather than inside it.
        <div key={t.id} className="relative" data-testid="saved-plan">
          <RadioCard
            value={selectionValue({ kind: 'saved', id: t.id, name: t.name, stages: t.stages })}
            className={cn(CARD, 'pr-9 max-sm:pr-9')}
          >
            <span className="block truncate text-sm font-medium">{t.name}</span>
            <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted max-sm:hidden">
              {stageKinds(t.stages)}
            </span>
            <Total stages={t.stages} />
          </RadioCard>
          <PlanMenu plan={t} onRename={onRename} onDelete={onDelete} />
        </div>
      ))}
      {/* Always choosable: the draft as it was left, or a new one from the plan shown. */}
      <RadioCard
        value="custom"
        className={cn(CARD, !draft && 'border-dashed')}
        data-testid="preset-custom"
      >
        <span className={cn('block text-sm font-medium', !draft && 'text-fg-muted')}>Custom</span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted max-sm:hidden">
          {draft
            ? 'Your own plan, kept while you look at the others.'
            : 'Start from the plan shown and make it your own.'}
        </span>
        {draft && <Total stages={draft} />}
      </RadioCard>
    </RadioRoot>
  );
}
