/**
 * A game's hidden components as tiles: a die drawn with its pips, anything else as its number,
 * and a component not yet shown as a dashed "?" tile. Shared by the pad's game panel and the
 * report's game review.
 */
import { cn } from '@/lib/utils';
import { dieFace, num } from './logic';

/** Which of the 3 × 3 cells hold a pip, for each face. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Pips({ face, small }: { face: number; small?: boolean }) {
  const on = new Set(PIPS[face] ?? []);
  return (
    <span
      aria-hidden
      className={cn('grid size-full grid-cols-3 grid-rows-3', small ? 'p-[3px]' : 'p-[7px]')}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of cells
          key={i}
          className={cn(
            'm-auto rounded-full',
            small ? 'size-[3px]' : 'size-[6px]',
            on.has(i) ? 'bg-fg' : 'bg-transparent',
          )}
        />
      ))}
    </span>
  );
}

export function ComponentTile({
  label,
  value,
  fresh = false,
  size = 'md',
}: {
  label: string;
  value: number | null;
  /** Just shown: drawn so the eye catches it. */
  fresh?: boolean;
  size?: 'sm' | 'md';
}) {
  const face = dieFace(label, value);
  const small = size === 'sm';
  return (
    <li
      className={cn('flex flex-col items-center', small ? 'gap-0.5' : 'gap-1')}
      data-testid="game-component"
      data-shown={value !== null || undefined}
      data-fresh={fresh || undefined}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-lg border font-mono font-semibold tabular transition-[box-shadow,background-color] duration-500',
          small ? 'h-7 min-w-7 rounded-md text-xs' : 'h-11 min-w-11 text-lg',
          value === null
            ? 'border-dashed border-border-strong bg-surface text-fg-subtle'
            : 'border-border-strong bg-surface text-fg shadow-[0_1px_0_var(--border-strong)]',
          face === null && value !== null && (small ? 'px-1.5' : 'px-2.5'),
          fresh &&
            'animate-pop-in bg-accent-soft ring-2 ring-accent ring-offset-2 ring-offset-surface',
        )}
      >
        {value === null ? (
          <span aria-hidden>?</span>
        ) : face !== null ? (
          <Pips face={face} small={small} />
        ) : (
          <span aria-hidden>{num(value)}</span>
        )}
      </span>
      <span
        className={cn(
          'max-w-20 truncate text-center',
          small ? 'text-[10px] text-fg-subtle' : 'text-2xs text-fg-muted',
          fresh && 'font-medium text-accent-text',
        )}
        aria-hidden
      >
        {label}
        {face !== null && !small && <span className="text-fg-subtle"> · {face}</span>}
      </span>
      <span className="sr-only">
        {label}: {value === null ? 'not shown yet' : num(value)}
        {fresh ? ' (just shown)' : ''}
      </span>
    </li>
  );
}

export function ComponentTiles({
  components,
  fresh,
  size = 'md',
  className,
  label = 'The hidden values',
}: {
  components: readonly { label: string; value: number | null }[];
  fresh?: ReadonlySet<number>;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn('flex flex-wrap items-start', size === 'sm' ? 'gap-1.5' : 'gap-3', className)}
    >
      {components.map((c, i) => (
        <ComponentTile
          // biome-ignore lint/suspicious/noArrayIndexKey: components are fixed for a game
          key={i}
          label={c.label}
          value={c.value}
          fresh={fresh?.has(i)}
          size={size}
        />
      ))}
    </ul>
  );
}
