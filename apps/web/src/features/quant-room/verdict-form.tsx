'use client';
/**
 * The host's verdict on a question of a quant room: a score in one tap and an optional note.
 * Used to close a question on the desk, to change a verdict in the Asked list, and to give a
 * missing one in the report. HOST-ONLY.
 */
import { Segmented } from '@/components/ui/segmented';
import { pct, SCORE_LABEL, SCORE_STEPS, type VerdictDraft } from './logic';

const NONE = 'none';

export function VerdictForm({
  value,
  onChange,
  idPrefix,
  compact,
  allowNone = true,
}: {
  value: VerdictDraft;
  onChange: (d: VerdictDraft) => void;
  idPrefix: string;
  /** Percentages instead of words, where the row is narrow. */
  compact?: boolean;
  /** Offer "No score" (closing a question without a verdict). */
  allowNone?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Segmented
        aria-label="Score"
        size="sm"
        className="flex w-full max-lg:[&>*]:h-9 [&>*]:px-1"
        value={value.score === null ? NONE : String(value.score)}
        onValueChange={(v) => onChange({ ...value, score: v === NONE ? null : Number(v) })}
        options={[
          ...(allowNone ? [{ value: NONE, label: 'No score', hint: 'Without a verdict' }] : []),
          ...SCORE_STEPS.map((s) => ({
            value: String(s),
            label: compact ? pct(s) : SCORE_LABEL[s],
            hint: `${SCORE_LABEL[s]}: ${pct(s)}`,
          })),
        ]}
      />
      {value.score !== null && (
        <>
          <label htmlFor={`${idPrefix}-note`} className="sr-only">
            Your note on the answer (optional)
          </label>
          <textarea
            id={`${idPrefix}-note`}
            rows={2}
            maxLength={4000}
            value={value.summary}
            onChange={(e) => onChange({ ...value, summary: e.target.value })}
            placeholder="What was right, what was missing (optional; for you and the report)"
            className="block w-full resize-none rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] leading-snug outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 max-lg:text-base"
          />
        </>
      )}
    </div>
  );
}
