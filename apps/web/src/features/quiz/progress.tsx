'use client';
import type { PublicQuizQuestion } from '@ipp/contracts';
import { cn } from '@/lib/utils';
import { OUTCOME_LABEL, type Outcome } from './logic';
import { OUTCOME_ICON } from './question';

export type SegState = Outcome | 'answered' | 'empty';

export function ProgressSegments({
  questions,
  index,
  stateOf,
  onJump,
}: {
  questions: PublicQuizQuestion[];
  index: number;
  stateOf: (q: PublicQuizQuestion) => SegState;
  onJump: (i: number) => void;
}) {
  const label: Record<SegState, string> = {
    ...OUTCOME_LABEL,
    answered: 'Answered',
    empty: 'Not answered',
  };
  return (
    <nav aria-label="Questions" className="flex flex-wrap gap-1.5">
      {questions.map((q, i) => {
        const s = stateOf(q);
        const Icon = s === 'answered' || s === 'empty' ? null : OUTCOME_ICON[s];
        const current = i === index;
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onJump(i)}
            aria-current={current ? 'step' : undefined}
            aria-label={`Question ${i + 1}: ${label[s]}`}
            title={`Question ${i + 1}: ${label[s]}`}
            className={cn(
              'touch-hit flex size-7 items-center justify-center rounded-md border text-xs font-medium tabular transition-colors max-sm:size-9 max-sm:text-sm',
              s === 'empty' &&
                'border-border-strong border-dashed text-fg-subtle hover:border-fg-subtle hover:text-fg',
              s === 'answered' && 'border-border-strong bg-surface-3 text-fg',
              s === 'correct' && 'border-ok/40 bg-ok-soft text-ok-text',
              s === 'incorrect' && 'border-bad/40 bg-bad-soft text-bad-text',
              s === 'partial' && 'border-warn/50 bg-warn-soft text-warn-text',
              s === 'pending' && 'border-accent/40 bg-accent-soft text-accent-text',
              current && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
            )}
          >
            {Icon ? <Icon className="size-3.5" strokeWidth={2.25} aria-hidden /> : i + 1}
          </button>
        );
      })}
    </nav>
  );
}
