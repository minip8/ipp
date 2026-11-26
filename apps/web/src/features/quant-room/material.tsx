'use client';
/**
 * A bank question's material as a quant room's host reads it: the answer, the key points, the
 * explanation, the hint ladder and the follow-ups. HOST-ONLY: rendered only in the host's desk,
 * bank browser and queue, never in anything shared (the chat, the scratchpad, the whiteboard).
 * Nothing here can send its text anywhere: the host says hints and follow-ups in their own words.
 */
import type { HostQuestionMaterial, QuantQuestionType } from '@ipp/contracts';
import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DifficultyBadge } from '@/components/domain';
import { MathMarkdown } from '@/components/math-markdown';
import { cn } from '@/lib/utils';
import { TYPE_LABEL } from './logic';

/**
 * Markdown with math for a line of material (a hint, a key point, a prompt's summary): written
 * as the bank writes it (`\$`, `**bold**`, code), its paragraphs kept inline so it can be clamped.
 */
export function InlineMd({ children, className }: { children: string; className?: string }) {
  return (
    <MathMarkdown className={cn('[&>p]:inline [&_p]:m-0', className)}>{children}</MathMarkdown>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h4 className={cn('text-2xs font-medium tracking-wider text-fg-subtle uppercase', className)}>
      {children}
    </h4>
  );
}

/** "Probability · Dice and counting · Easy · Numeric": what a question is, at a glance. */
export function QuestionMeta({
  topicTitle,
  subtopic,
  difficulty,
  type,
  className,
  children,
}: {
  topicTitle: string;
  subtopic?: string;
  difficulty: HostQuestionMaterial['difficulty'];
  type: QuantQuestionType;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted',
        className,
      )}
    >
      <span className="font-medium text-fg-muted">{topicTitle}</span>
      {subtopic && (
        <>
          <span aria-hidden className="text-fg-subtle">
            ·
          </span>
          <span className="truncate">{subtopic}</span>
        </>
      )}
      <DifficultyBadge difficulty={difficulty} />
      <span className="rounded-[4px] border border-border px-1.5 text-2xs leading-[18px] text-fg-muted">
        {TYPE_LABEL[type]}
      </span>
      {children}
    </span>
  );
}

/** The answer, set apart: the one thing a host looks for first. */
export function AnswerBox({ m, className }: { m: HostQuestionMaterial; className?: string }) {
  return (
    <div
      className={cn('rounded-md border border-ok/35 bg-ok-soft/40 px-3 py-2.5', className)}
      data-testid="host-answer"
    >
      <SectionTitle className="text-ok-text">Answer</SectionTitle>
      <MathMarkdown className="mt-1 text-[14px] leading-relaxed">{m.solution}</MathMarkdown>
      {m.tolerance && (
        <p className="mt-1 text-2xs text-fg-muted">
          Within{' '}
          {[
            m.tolerance.abs !== undefined ? `±${m.tolerance.abs}` : null,
            m.tolerance.rel !== undefined ? `${m.tolerance.rel * 100}%` : null,
          ]
            .filter(Boolean)
            .join(' or ')}{' '}
          counts.
        </p>
      )}
    </div>
  );
}

export function KeyPoints({ points }: { points: string[] }) {
  if (points.length === 0) return null;
  return (
    <section>
      <SectionTitle>Key points</SectionTitle>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13.5px] leading-relaxed marker:text-fg-subtle">
        {points.map((k) => (
          <li key={k}>
            <InlineMd>{k}</InlineMd>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The explanation, folded: long, and read only when the answer is in doubt. */
export function Explanation({ text, open }: { text: string; open?: boolean }) {
  if (!text.trim()) return null;
  return (
    <details className="group" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-2xs font-medium tracking-wider text-fg-subtle uppercase select-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          className="size-3.5 transition-transform group-open:rotate-90"
          aria-hidden
        />
        Explanation
      </summary>
      <MathMarkdown className="mt-1 text-[13.5px] leading-relaxed text-fg-muted">
        {text}
      </MathMarkdown>
    </details>
  );
}

/** Everything about a question that is not yet posed (the queue, the bank): read only. */
export function MaterialPreview({ m, prompt }: { m: HostQuestionMaterial; prompt?: string }) {
  return (
    <div className="space-y-3" data-testid="material-preview">
      {prompt && (
        <section>
          <SectionTitle>What the candidate sees</SectionTitle>
          <MathMarkdown className="mt-1 text-[13.5px] leading-relaxed">{prompt}</MathMarkdown>
        </section>
      )}
      <AnswerBox m={m} />
      <KeyPoints points={m.keyPoints} />
      {m.hints.length > 0 && (
        <section>
          <SectionTitle>Hints</SectionTitle>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13.5px] leading-relaxed marker:text-fg-subtle">
            {m.hints.map((h) => (
              <li key={h}>
                <InlineMd>{h}</InlineMd>
              </li>
            ))}
          </ol>
        </section>
      )}
      {m.followUps.length > 0 && (
        <section>
          <SectionTitle>Follow-ups</SectionTitle>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13.5px] leading-relaxed marker:text-fg-subtle">
            {m.followUps.map((f) => (
              <li key={f}>
                <InlineMd>{f}</InlineMd>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Explanation text={m.explanation} />
    </div>
  );
}
