'use client';
import {
  CATEGORY_INFO,
  type Difficulty,
  LANGUAGE_LABELS,
  type Language,
  type PadFormat,
  type ProblemCategory,
  QUANT_PATH_INFO,
  type QuantPath,
  type RunVerdict,
  type TestVerdict,
} from '@ipp/contracts';
import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleMinusIcon,
  CircleXIcon,
  ClockIcon,
  FileWarningIcon,
  MemoryStickIcon,
  ScrollTextIcon,
  SigmaIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react';
import { DIFFICULTY_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RUN_VERDICT, TEST_VERDICT, type Tone } from '@/lib/verdict';

const DIFF_TONE: Record<Difficulty, string> = {
  easy: 'text-ok-text bg-ok-soft',
  medium: 'text-warn-text bg-warn-soft',
  hard: 'text-bad-text bg-bad-soft',
};

export function DifficultyBadge({
  difficulty,
  className,
}: {
  difficulty: Difficulty;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-[4px] px-1.5 text-2xs font-medium',
        DIFF_TONE[difficulty],
        className,
      )}
    >
      {DIFFICULTY_LABEL[difficulty]}
    </span>
  );
}

/** Neutral outline: the category is context, not a rating like difficulty. */
export function CategoryBadge({
  category,
  className,
}: {
  category: ProblemCategory;
  className?: string;
}) {
  return (
    <span
      title={CATEGORY_INFO[category].label}
      className={cn(
        'inline-flex h-5 items-center rounded-[4px] border border-border px-1.5 text-2xs font-medium whitespace-nowrap text-fg-muted',
        className,
      )}
    >
      {CATEGORY_INFO[category].short}
    </span>
  );
}

export const toneText: Record<Tone, string> = {
  ok: 'text-ok-text',
  bad: 'text-bad-text',
  warn: 'text-warn-text',
  neutral: 'text-fg-muted',
};
export const toneIcon: Record<Tone, string> = {
  ok: 'text-ok',
  bad: 'text-bad',
  warn: 'text-warn',
  neutral: 'text-fg-subtle',
};
export const toneSoft: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok-text',
  bad: 'bg-bad-soft text-bad-text',
  warn: 'bg-warn-soft text-warn-text',
  neutral: 'bg-surface-3 text-fg-muted',
};

const RUN_ICON: Record<RunVerdict, typeof CheckIcon> = {
  accepted: CircleCheckIcon,
  wrong_answer: CircleXIcon,
  compile_error: FileWarningIcon,
  runtime_error: ZapIcon,
  time_limit: ClockIcon,
  memory_limit: MemoryStickIcon,
  output_limit: ScrollTextIcon,
  invalid_submission: BanIcon,
  ok: CircleCheckIcon,
  internal_error: AlertTriangleIcon,
};

export const TEST_ICON: Record<TestVerdict, typeof CheckIcon> = {
  pass: CheckIcon,
  fail: XIcon,
  ran: CircleDotIcon,
  runtime_error: ZapIcon,
  time_limit: ClockIcon,
  memory_limit: MemoryStickIcon,
  output_limit: ScrollTextIcon,
  skipped: CircleMinusIcon,
};

export function RunVerdictIcon({
  verdict,
  className,
}: {
  verdict: RunVerdict;
  className?: string;
}) {
  const Icon = RUN_ICON[verdict];
  return (
    <Icon aria-hidden className={cn('size-4', toneIcon[RUN_VERDICT[verdict].tone], className)} />
  );
}

export function RunVerdictBadge({
  verdict,
  label,
  className,
}: {
  verdict: RunVerdict;
  label?: string;
  className?: string;
}) {
  const v = RUN_VERDICT[verdict];
  const Icon = RUN_ICON[verdict];
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-2xs font-medium',
        toneSoft[v.tone],
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {label ?? v.label}
    </span>
  );
}

export function TestVerdictChip({
  verdict,
  className,
}: {
  verdict: TestVerdict;
  className?: string;
}) {
  const v = TEST_VERDICT[verdict];
  const Icon = TEST_ICON[verdict];
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-2xs font-medium whitespace-nowrap',
        toneSoft[v.tone],
        className,
      )}
    >
      <Icon aria-hidden className="size-3" strokeWidth={2.5} />
      {v.label}
    </span>
  );
}

const LANG_COLOR: Record<Language, string> = {
  cpp: 'bg-[oklch(0.6_0.13_256)]',
  python: 'bg-[oklch(0.75_0.13_90)]',
  java: 'bg-[oklch(0.62_0.15_40)]',
};
export const LANG_LABEL = LANGUAGE_LABELS;
export const LANG_FILE: Record<Language, string> = {
  cpp: 'main.cpp',
  python: 'main.py',
  java: 'Main.java',
};

export function LanguageTag({ language, className }: { language: Language; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-fg-muted', className)}>
      <span aria-hidden className={cn('size-2 rounded-full', LANG_COLOR[language])} />
      {LANG_LABEL[language]}
    </span>
  );
}

/** Marks a quant round beside its title (the pad's top bar, the report); the path is its tooltip. */
export function QuantPathBadge({ path, className }: { path: QuantPath; className?: string }) {
  return (
    <span
      data-testid="quant-badge"
      title={`A live quant round on the ${QUANT_PATH_INFO[path].label.toLowerCase()} path`}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[4px] border border-border px-1.5 text-2xs font-medium whitespace-nowrap text-fg-muted',
        className,
      )}
    >
      <SigmaIcon aria-hidden className="size-3 text-accent-text" />
      Quant
    </span>
  );
}

/**
 * What a pad is in a list: its language, or "Quant · Trader" for a quant round (whose stored
 * language means nothing), with its path when the summary has one.
 */
export function PadTag({
  pad,
  className,
}: {
  pad: { format: PadFormat; language: Language; quantPath?: QuantPath | null };
  className?: string;
}) {
  if (pad.format !== 'quant') return <LanguageTag language={pad.language} className={className} />;
  return (
    <span
      data-testid="quant-badge"
      className={cn('inline-flex items-center gap-1.5 text-sm text-fg-muted', className)}
    >
      <SigmaIcon aria-hidden className="size-3.5 text-accent-text" />
      {pad.quantPath ? `Quant · ${QUANT_PATH_INFO[pad.quantPath].label}` : 'Quant'}
    </span>
  );
}
