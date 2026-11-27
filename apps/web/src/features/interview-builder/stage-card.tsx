'use client';
/**
 * One stage of the plan: its place, kind and summary, with buttons to edit it in place, move it
 * and remove it; expanded, the editor of its kind (a coding stage's problem, language and length;
 * a questions stage's topics and length; a game's length).
 */
import {
  CATEGORY_INFO,
  CODING_STAGE_DURATIONS,
  GAME_STAGE_DURATIONS,
  type InterviewStage,
  LANGUAGES,
  type Language,
  PROBLEM_CATEGORIES,
  type ProblemCategory,
  QUESTIONS_STAGE_DURATIONS,
  STAGE_KIND_INFO,
  stageQuestionCount,
  type Track,
} from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  ShuffleIcon,
  Trash2Icon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { DifficultyBadge, LANG_LABEL } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { type Names, stageSummary } from '@/features/interview/logic';
import { STAGE_ICON } from '@/features/interview/stage-icon';
import { effectiveLanguage, languageNote } from '@/features/new/logic';
import { RestrictionBadge } from '@/features/new/problem-library';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { questionsShape, toggleTopic } from './logic';
import { ProblemDialog } from './problem-dialog';
import { TopicPicker } from './topic-picker';

/** Phones: segmented controls at a size a finger can hit. */
const TOUCH = 'max-sm:[&>*]:h-9';
const ANY = 'any';

type Coding = Extract<InterviewStage, { kind: 'coding' }>;
type Questions = Extract<InterviewStage, { kind: 'questions' }>;
type Game = Extract<InterviewStage, { kind: 'game' }>;

function Field({
  label,
  id,
  children,
  note,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label id={id}>{label}</Label>
      {children}
      {note && <p className="text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

function CodingEditor({
  stage,
  number,
  onChange,
  onLanguage,
}: {
  stage: Coding;
  number: number;
  onChange: (s: Coding) => void;
  /** The user chose a language: new stages and presets take it too. */
  onLanguage: (l: Language) => void;
}) {
  const ids = { problem: useId(), lang: useId(), len: useId(), diff: useId(), cat: useId() };
  const problems = useQuery({ queryKey: qk.problems({}), queryFn: () => api.problems() });
  const [choosing, setChoosing] = useState(false);
  const problem = stage.problemSlug
    ? problems.data?.find((p) => p.slug === stage.problemSlug)
    : undefined;
  const offered = problem?.languages ?? LANGUAGES;
  const choose = (slug: string) => {
    const p = problems.data?.find((x) => x.slug === slug);
    onChange({
      kind: 'coding',
      problemSlug: slug,
      language: effectiveLanguage(stage.language, p),
      durationMin: stage.durationMin,
    });
  };
  return (
    <div className="space-y-4">
      <Field label="Problem" id={ids.problem}>
        <Segmented
          aria-label={`Stage ${number} problem`}
          className={cn('flex w-full sm:w-auto sm:max-w-sm', TOUCH)}
          value={stage.problemSlug ? 'chosen' : 'random'}
          onValueChange={(v) => {
            if (v === 'random')
              onChange({
                kind: 'coding',
                difficulty: problem?.difficulty ?? 'medium',
                language: stage.language,
                durationMin: stage.durationMin,
              });
            else setChoosing(true);
          }}
          options={[
            { value: 'random', label: 'Random' },
            { value: 'chosen', label: 'Choose a problem' },
          ]}
        />
        {stage.problemSlug ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
            <span className="font-medium" data-testid="stage-problem">
              {problem?.title ?? stage.problemSlug}
            </span>
            {problem && <DifficultyBadge difficulty={problem.difficulty} />}
            {problem && <RestrictionBadge p={problem} />}
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto max-sm:h-9"
              onClick={() => setChoosing(true)}
            >
              <RefreshCwIcon /> Change
            </Button>
          </div>
        ) : (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p id={ids.diff} className="text-xs text-fg-muted">
                Difficulty
              </p>
              <Segmented
                aria-label={`Stage ${number} difficulty`}
                size="sm"
                className={cn('flex w-full', 'max-sm:[&>*]:h-8')}
                value={stage.difficulty ?? ANY}
                onValueChange={(v) => onChange({ ...stage, difficulty: v === ANY ? undefined : v })}
                options={[
                  { value: ANY, label: 'Any' },
                  { value: 'easy', label: 'Easy' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'hard', label: 'Hard' },
                ]}
              />
            </div>
            <div className="space-y-1">
              <p id={ids.cat} className="text-xs text-fg-muted">
                Kind of problem
              </p>
              <Select
                value={stage.category ?? ANY}
                onValueChange={(v) =>
                  onChange({
                    ...stage,
                    category: v === ANY ? undefined : (v as ProblemCategory),
                  })
                }
              >
                <SelectTrigger
                  className="h-7 w-full max-sm:h-9"
                  aria-label={`Stage ${number} kind of problem`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any kind</SelectItem>
                  {PROBLEM_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_INFO[c].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-fg-muted sm:col-span-2">
              <ShuffleIcon className="size-3.5 shrink-0" aria-hidden /> Picked when the stage
              starts, so you see it for the first time then.
            </p>
          </div>
        )}
      </Field>
      <Field
        label="Language"
        id={ids.lang}
        note={
          languageNote(stage.language, problem) ??
          (stage.problemSlug
            ? 'You can switch languages during the stage.'
            : 'A random pick is always a problem you can solve in it.')
        }
      >
        <Segmented
          aria-label={`Stage ${number} language`}
          className={cn('flex w-full sm:w-auto', TOUCH)}
          value={effectiveLanguage(stage.language, problem)}
          onValueChange={(l: Language) => {
            onChange({ ...stage, language: l });
            onLanguage(l);
          }}
          options={offered.map((l) => ({ value: l, label: LANG_LABEL[l] }))}
        />
      </Field>
      <Field label="Length" id={ids.len}>
        <Segmented
          aria-label={`Stage ${number} length`}
          className={cn('flex w-full sm:w-auto', TOUCH)}
          value={String(stage.durationMin)}
          onValueChange={(v) => onChange({ ...stage, durationMin: Number(v) })}
          options={CODING_STAGE_DURATIONS.map((d) => ({ value: String(d), label: `${d} min` }))}
        />
      </Field>
      <ProblemDialog
        open={choosing}
        onOpenChange={setChoosing}
        selected={stage.problemSlug ?? null}
        onChoose={choose}
        stageNumber={number}
      />
    </div>
  );
}

function QuestionsEditor({
  stage,
  number,
  track,
  onChange,
}: {
  stage: Questions;
  number: number;
  track: Track;
  onChange: (s: Questions) => void;
}) {
  const ids = { topics: useId(), len: useId() };
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label id={ids.topics}>Topics</Label>
        <TopicPicker
          track={track}
          value={stage.topics}
          labelledBy={ids.topics}
          onToggle={(slug) => onChange({ ...stage, topics: toggleTopic(stage.topics, slug) })}
        />
      </div>
      <Field label="Length" id={ids.len} note={`${questionsShape(stage.durationMin)}.`}>
        <Segmented
          aria-label={`Stage ${number} length`}
          className={cn('flex w-full sm:w-auto', TOUCH)}
          value={String(stage.durationMin)}
          onValueChange={(v) => onChange({ ...stage, durationMin: Number(v) })}
          options={QUESTIONS_STAGE_DURATIONS.map((d) => {
            const n = stageQuestionCount({ ...stage, durationMin: d }) ?? 0;
            return { value: String(d), label: `${d} min`, hint: plural(n, 'question') };
          })}
        />
      </Field>
    </div>
  );
}

function GameEditor({
  stage,
  number,
  onChange,
}: {
  stage: Game;
  number: number;
  onChange: (s: Game) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">{STAGE_KIND_INFO.game.description}</p>
      <Field
        label="Length"
        id={id}
        note="The game is drawn when the stage starts; the report shows the edge of every trade."
      >
        <Segmented
          aria-label={`Stage ${number} length`}
          className={cn('flex w-full sm:w-auto', TOUCH)}
          value={String(stage.durationMin)}
          onValueChange={(v) => onChange({ ...stage, durationMin: Number(v) })}
          options={GAME_STAGE_DURATIONS.map((d) => ({ value: String(d), label: `${d} min` }))}
        />
      </Field>
    </div>
  );
}

export function StageCard({
  stage,
  index,
  count,
  track,
  names,
  expanded,
  onExpandedChange,
  onChange,
  onLanguage,
  onMove,
  onRemove,
  canRemove,
}: {
  stage: InterviewStage;
  index: number;
  count: number;
  track: Track;
  names: Names;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onChange: (s: InterviewStage) => void;
  onLanguage: (l: Language) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const number = index + 1;
  const Icon = STAGE_ICON[stage.kind];
  const editorId = useId();
  const summary = stageSummary(stage, names);
  const kind = STAGE_KIND_INFO[stage.kind].label;
  return (
    <li
      className={cn(
        'rounded-lg border bg-surface transition-colors',
        expanded ? 'border-border-strong' : 'border-border',
      )}
      data-testid="plan-stage"
      aria-label={`Stage ${number}: ${kind}`}
    >
      <div className="flex items-center gap-3 py-2.5 pr-2 pl-3 max-sm:gap-2.5 max-sm:pl-2.5">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-fg-muted tabular"
          aria-hidden
        >
          {number}
        </span>
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-accent-text max-sm:hidden"
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        {/* The whole text opens the editor too, so the card's main target is large. */}
        <button
          type="button"
          className="min-w-0 flex-1 text-left focus-visible:outline-offset-2"
          aria-expanded={expanded}
          aria-controls={editorId}
          onClick={() => onExpandedChange(!expanded)}
        >
          <span className="block text-sm font-medium">{kind}</span>
          <span className="block truncate text-xs text-fg-muted" data-testid="stage-summary">
            {summary}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip label="Move up">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              aria-label={`Move stage ${number} up`}
              className="max-sm:size-9"
            >
              <ArrowUpIcon />
            </Button>
          </Tooltip>
          <Tooltip label="Move down">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={index === count - 1}
              onClick={() => onMove(1)}
              aria-label={`Move stage ${number} down`}
              className="max-sm:size-9"
            >
              <ArrowDownIcon />
            </Button>
          </Tooltip>
          <Tooltip label={canRemove ? 'Remove' : 'An interview needs at least one stage'}>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={!canRemove}
              onClick={onRemove}
              aria-label={`Remove stage ${number}`}
              className="hover:bg-bad-soft hover:text-bad-text max-sm:size-9"
            >
              <Trash2Icon />
            </Button>
          </Tooltip>
          <Tooltip label={expanded ? 'Done editing' : 'Edit'}>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onExpandedChange(!expanded)}
              aria-expanded={expanded}
              aria-controls={editorId}
              aria-label={`Edit stage ${number}`}
              className="max-sm:size-9"
            >
              <ChevronDownIcon className={cn('transition-transform', expanded && 'rotate-180')} />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div
        id={editorId}
        hidden={!expanded}
        className="border-t border-border px-4 pt-3.5 pb-4 max-sm:px-3"
        data-testid="stage-editor"
      >
        {expanded &&
          (stage.kind === 'coding' ? (
            <CodingEditor
              stage={stage}
              number={number}
              onChange={onChange}
              onLanguage={onLanguage}
            />
          ) : stage.kind === 'questions' ? (
            <QuestionsEditor stage={stage} number={number} track={track} onChange={onChange} />
          ) : (
            <GameEditor stage={stage} number={number} onChange={onChange} />
          ))}
      </div>
    </li>
  );
}
