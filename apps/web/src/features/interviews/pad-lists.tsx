'use client';
/**
 * The Interviews tab's lists, the same in both tracks: what is under way, and the finished ones
 * (cards on a phone, a table from `md` up). A row is a pad started on its own, a staged
 * interview (its stages' kinds, the overall recommendation, opening the interview's page) or a
 * one-stage interview, shown as its pad (opening the pad's report). The columns follow the
 * track: a coding pad has a language and is solved or not; a quant round is scored in its
 * report, a quant room has the host's verdicts.
 */
import {
  type Interview,
  overallRecommendation,
  type PadSummary,
  STAGE_KIND_INFO,
  type Track,
} from '@ipp/contracts';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  FileTextIcon,
  HistoryIcon,
  LayersIcon,
  PlayIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DifficultyBadge, LanguageTag, PadTag } from '@/components/domain';
import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { DeletePadButton } from '@/features/delete-pad/delete-pad-dialog';
import { type DeleteTarget, interviewTarget } from '@/features/delete-pad/logic';
import {
  interviewHref,
  reportsPending,
  stagePosition,
  timeSpentSec,
} from '@/features/interview/logic';
import { STAGE_ICON } from '@/features/interview/stage-icon';
import { RecommendationBadge } from '@/features/report/scorecard';
import { formatDuration, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { canOpenReport, padLength, padName, type Row, rowKey } from './logic';

export type OnDelete = (t: DeleteTarget) => void;

export const deleteTarget = (p: PadSummary): DeleteTarget => ({
  id: p.id,
  problemTitle: padName(p),
  status: p.status,
  role: p.role,
});

const padHref = (p: PadSummary) => (canOpenReport(p) ? `/pads/${p.id}/report` : `/pads/${p.id}`);

/** What each track's history calls its columns. */
const COLUMNS: Record<Track, { name: string; kind: string }> = {
  software: { name: 'Problem', kind: 'Language' },
  quant: { name: 'Interview', kind: 'Kind' },
};

function RoomBadge({ p }: { p: PadSummary }) {
  if (p.kind !== 'room') return null;
  return (
    <Badge tone="outline">
      <UsersIcon /> {p.role === 'owner' ? 'Hosting' : 'Candidate'}
    </Badge>
  );
}

function PadOutcome({ p }: { p: PadSummary }) {
  // A quant room: the host's verdicts are in the report; its candidate has no outcome to show.
  if (p.format === 'quant' && p.kind === 'room')
    return p.role === 'owner' ? (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted">
        <FileTextIcon className="size-4 text-fg-subtle" aria-hidden /> Your verdicts in the report
      </span>
    ) : (
      <span className="text-fg-subtle">—</span>
    );
  // A quant round is not solved or not: its report scores each question.
  if (p.format === 'quant')
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted">
        <FileTextIcon className="size-4 text-fg-subtle" aria-hidden /> Scored in the report
      </span>
    );
  return p.accepted ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ok-text">
      <CircleCheckIcon className="size-4 text-ok" aria-hidden /> Solved
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted">
      <CircleDashedIcon className="size-4 text-fg-subtle" aria-hidden /> Not solved
    </span>
  );
}

/** A staged interview's outcome: the stages' recommendations averaged, or why there is none. */
function InterviewOutcome({ interview }: { interview: Interview }) {
  const overall = overallRecommendation(interview.stages);
  if (overall) return <RecommendationBadge value={overall} prefix="Overall" />;
  if (reportsPending(interview))
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted">
        <Spinner className="size-3.5" /> Reports being written
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted">
      <FileTextIcon className="size-4 text-fg-subtle" aria-hidden /> Stage reports inside
    </span>
  );
}

/** The kinds of a staged interview's stages, in order, as icons, and how many. */
function StageKinds({ interview, className }: { interview: Interview; className?: string }) {
  const kinds = interview.stages.map((s) => STAGE_KIND_INFO[s.stage.kind].label);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-sm text-fg-muted', className)}
      data-testid="stage-kinds"
    >
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {interview.stages.map((s) => {
          const Icon = STAGE_ICON[s.stage.kind];
          return <Icon key={s.index} className="size-3.5 text-accent-text" />;
        })}
      </span>
      <span>{interview.stages.length} stages</span>
      <span className="sr-only">: {kinds.join(', ')}</span>
    </span>
  );
}

/** A one-stage interview's tag: the language of its coding stage, else what kind of stage it is. */
function SingleTag({
  row,
  className,
}: {
  row: Extract<Row, { kind: 'single' }>;
  className?: string;
}) {
  const stage = row.interview.stages[0]?.stage;
  if (!stage || stage.kind === 'coding')
    return <LanguageTag language={row.pad.language} className={className} />;
  const Icon = STAGE_ICON[stage.kind];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-fg-muted', className)}>
      <Icon aria-hidden className="size-3.5 text-accent-text" />
      {STAGE_KIND_INFO[stage.kind].label}
    </span>
  );
}

/** Everything a list shows of a row, whatever it is. */
type RowView = {
  key: string;
  name: string;
  /** Where the row's name goes. */
  href: string;
  /** The report (or results) link, when there is one. */
  report: { href: string; label: string } | null;
  target: DeleteTarget;
  tag: (className?: string) => ReactNode;
  outcome: ReactNode;
  badges: ReactNode;
  startedAt: string;
  lengthSec: number | null;
};

function rowView(row: Row): RowView {
  if (row.kind === 'interview') {
    const i = row.interview;
    return {
      key: rowKey(row),
      name: i.title,
      href: `/interviews/${i.id}`,
      report: { href: `/interviews/${i.id}`, label: `Results of ${i.title}` },
      target: interviewTarget(i),
      tag: (className) => <StageKinds interview={i} className={className} />,
      outcome: <InterviewOutcome interview={i} />,
      badges: null,
      startedAt: i.startedAt,
      lengthSec: i.endedAt ? timeSpentSec(i) : null,
    };
  }
  const p = row.pad;
  return {
    key: rowKey(row),
    name: padName(p),
    href: padHref(p),
    report: canOpenReport(p)
      ? { href: `/pads/${p.id}/report`, label: `Report for ${padName(p)}` }
      : null,
    target: row.kind === 'single' ? interviewTarget(row.interview) : deleteTarget(p),
    tag: (className) =>
      row.kind === 'single' ? (
        <SingleTag row={row} className={className} />
      ) : (
        <PadTag pad={p} className={className} />
      ),
    outcome: <PadOutcome p={p} />,
    badges: (
      <>
        {p.difficulty && <DifficultyBadge difficulty={p.difficulty} />}
        <RoomBadge p={p} />
      </>
    ),
    startedAt: p.startedAt,
    lengthSec: padLength(p),
  };
}

/** An interview under way: the stage it is on, or that it is between stages. */
function ActiveInterviewLine({ interview }: { interview: Interview }) {
  return (
    <>
      <Badge tone="accent">
        <LayersIcon /> {stagePosition(interview)}
      </Badge>
      <span>Started {formatRelative(interview.startedAt)}</span>
    </>
  );
}

export function ActiveRows({ rows, onDelete }: { rows: Row[]; onDelete: OnDelete }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="active-heading" className="mt-8">
      <h2 id="active-heading" className="mb-3 text-sm font-semibold">
        In progress
      </h2>
      <ul className="space-y-2">
        {rows.map((row) => {
          const staged = row.kind === 'interview';
          const v = rowView(row);
          const href = staged
            ? interviewHref(row.interview)
            : `/pads/${(row as Exclude<Row, { kind: 'interview' }>).pad.id}`;
          return (
            <li
              key={v.key}
              data-testid={staged ? 'active-interview' : 'active-pad'}
              // Phones: the actions get a row of their own, with full-size tap targets.
              className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-3"
            >
              <span className="relative flex size-2.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-40" />
                <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{v.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                  {staged ? (
                    <ActiveInterviewLine interview={row.interview} />
                  ) : (
                    <>
                      {v.badges}
                      {v.tag()}
                      <span>Started {formatRelative(v.startedAt)}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:gap-2">
                <Button
                  asChild
                  variant="primary"
                  size="sm"
                  className="max-sm:h-10 max-sm:flex-1 max-sm:text-base"
                >
                  <Link href={href}>
                    <PlayIcon /> {staged ? 'Continue' : 'Resume'}
                  </Link>
                </Button>
                <DeletePadButton
                  target={v.target}
                  onClick={() => onDelete(v.target)}
                  className="max-sm:size-10 max-sm:[&_svg]:size-4"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Phones: one entry per finished interview, the whole entry opening it. */
function HistoryCards({ rows, onDelete }: { rows: Row[]; onDelete: OnDelete }) {
  return (
    <ul className="divide-y divide-border md:hidden" aria-label="Finished interviews">
      {rows.map((row) => {
        const v = rowView(row);
        return (
          <li key={v.key} className="relative flex items-center gap-2 py-3 pr-2 pl-4">
            <div className="min-w-0 flex-1">
              {/* Stretched over the entry, so all of it is a tap target; the actions sit above. */}
              <Link
                href={v.href}
                className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-offset-2"
              >
                {v.name}
              </Link>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {v.outcome}
                {v.badges}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
                {v.tag('text-xs')}
                <span aria-hidden>·</span>
                <span>{formatRelative(v.startedAt)}</span>
                {v.lengthSec !== null && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular">{formatDuration(v.lengthSec)}</span>
                  </>
                )}
              </p>
            </div>
            <div className="relative z-10 flex shrink-0 items-center gap-1">
              {v.report && (
                <Button asChild variant="ghost" size="icon" className="size-10 [&_svg]:size-[18px]">
                  <Link href={v.report.href} aria-label={v.report.label}>
                    <FileTextIcon />
                  </Link>
                </Button>
              )}
              <DeletePadButton
                target={v.target}
                onClick={() => onDelete(v.target)}
                className="size-10 [&_svg]:size-[18px]"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** From `md` up: a table, with fewer columns on smaller screens. */
function HistoryTable({
  track,
  rows,
  onDelete,
}: {
  track: Track;
  rows: Row[];
  onDelete: OnDelete;
}) {
  const columns = COLUMNS[track];
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-fg-subtle">
            <th className="px-4 py-2 font-medium">{columns.name}</th>
            <th className="hidden px-4 py-2 font-medium md:table-cell">{columns.kind}</th>
            <th className="hidden px-4 py-2 font-medium sm:table-cell">When</th>
            <th className="hidden px-4 py-2 font-medium lg:table-cell">Length</th>
            <th className="px-4 py-2 font-medium">Outcome</th>
            <th className="px-4 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const v = rowView(row);
            return (
              <tr
                key={v.key}
                className="border-b border-border last:border-0 hover:bg-surface-2"
                data-testid={row.kind === 'interview' ? 'history-interview' : undefined}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Link href={v.href} className="truncate font-medium hover:underline">
                      {v.name}
                    </Link>
                    {v.badges}
                  </div>
                </td>
                <td className="hidden px-4 py-2.5 md:table-cell">{v.tag()}</td>
                <td className="hidden px-4 py-2.5 text-fg-muted sm:table-cell">
                  {formatRelative(v.startedAt)}
                </td>
                <td className="hidden px-4 py-2.5 text-fg-muted tabular lg:table-cell">
                  {v.lengthSec ? formatDuration(v.lengthSec) : '—'}
                </td>
                <td className="px-4 py-2.5">{v.outcome}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    {v.report && (
                      <Button asChild variant="ghost" size="xs">
                        <Link href={v.report.href} aria-label={v.report.label}>
                          <FileTextIcon />{' '}
                          <span className="hidden sm:inline">
                            {row.kind === 'interview' ? 'Results' : 'Report'}
                          </span>
                        </Link>
                      </Button>
                    )}
                    <DeletePadButton target={v.target} onClick={() => onDelete(v.target)} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY: Record<Track, string> = {
  software: 'Interviews you finish show up here, each with a report.',
  quant: 'Interviews and quant rooms you finish show up here, each with a report.',
};

export function History({
  track,
  rows,
  onDelete,
}: {
  track: Track;
  rows: Row[];
  onDelete: OnDelete;
}) {
  return (
    <Card aria-labelledby="history-heading">
      <CardHeader>
        <CardTitle id="history-heading">Finished interviews</CardTitle>
        {rows.length > 0 && (
          <span className="text-xs text-fg-subtle tabular">{rows.length} completed</span>
        )}
      </CardHeader>
      {rows.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No finished interviews yet">
          {EMPTY[track]}
        </EmptyState>
      ) : (
        // Only one of the two is displayed at a time (and so in the accessibility tree).
        <>
          <HistoryCards rows={rows} onDelete={onDelete} />
          <HistoryTable track={track} rows={rows} onDelete={onDelete} />
        </>
      )}
    </Card>
  );
}
