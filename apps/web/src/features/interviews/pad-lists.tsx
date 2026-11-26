'use client';
/**
 * The Interviews tab's lists of pads, the same in both tracks: what is under way, and the finished
 * ones (cards on a phone, a table from `md` up). The columns follow the track: a coding pad has a
 * language and is solved or not; a quant round has its path and is scored in its report, a quant
 * room the host's verdicts.
 */
import type { PadSummary, Track } from '@ipp/contracts';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  FileTextIcon,
  HistoryIcon,
  PlayIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { DifficultyBadge, PadTag } from '@/components/domain';
import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DeletePadButton } from '@/features/delete-pad/delete-pad-dialog';
import type { DeleteTarget } from '@/features/delete-pad/logic';
import { formatDuration, formatRelative } from '@/lib/format';
import { canOpenReport, padLength, padName } from './logic';

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

function Outcome({ p }: { p: PadSummary }) {
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

export function ActivePads({ pads, onDelete }: { pads: PadSummary[]; onDelete: OnDelete }) {
  if (pads.length === 0) return null;
  return (
    <section aria-labelledby="active-heading" className="mt-8">
      <h2 id="active-heading" className="mb-3 text-sm font-semibold">
        In progress
      </h2>
      <ul className="space-y-2">
        {pads.map((p) => (
          <li
            key={p.id}
            data-testid="active-pad"
            // Phones: the actions get a row of their own, with full-size tap targets.
            className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-3"
          >
            <span className="relative flex size-2.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-40" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{padName(p)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                <RoomBadge p={p} />
                {p.difficulty && <DifficultyBadge difficulty={p.difficulty} />}
                <PadTag pad={p} />
                <span>Started {formatRelative(p.startedAt)}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:gap-2">
              <Button
                asChild
                variant="primary"
                size="sm"
                className="max-sm:h-10 max-sm:flex-1 max-sm:text-base"
              >
                <Link href={`/pads/${p.id}`}>
                  <PlayIcon /> Resume
                </Link>
              </Button>
              <DeletePadButton
                target={deleteTarget(p)}
                onClick={() => onDelete(deleteTarget(p))}
                className="max-sm:size-10 max-sm:[&_svg]:size-4"
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Phones: one entry per finished interview, the whole entry opening it. */
function HistoryCards({ pads, onDelete }: { pads: PadSummary[]; onDelete: OnDelete }) {
  return (
    <ul className="divide-y divide-border md:hidden" aria-label="Finished interviews">
      {pads.map((p) => {
        const len = padLength(p);
        return (
          <li key={p.id} className="relative flex items-center gap-2 py-3 pr-2 pl-4">
            <div className="min-w-0 flex-1">
              {/* Stretched over the entry, so all of it is a tap target; the actions sit above. */}
              <Link
                href={padHref(p)}
                className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-offset-2"
              >
                {padName(p)}
              </Link>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Outcome p={p} />
                {p.difficulty && <DifficultyBadge difficulty={p.difficulty} />}
                <RoomBadge p={p} />
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
                <PadTag pad={p} className="text-xs" />
                <span aria-hidden>·</span>
                <span>{formatRelative(p.startedAt)}</span>
                {len !== null && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular">{formatDuration(len)}</span>
                  </>
                )}
              </p>
            </div>
            <div className="relative z-10 flex shrink-0 items-center gap-1">
              {canOpenReport(p) && (
                <Button asChild variant="ghost" size="icon" className="size-10 [&_svg]:size-[18px]">
                  <Link href={`/pads/${p.id}/report`} aria-label={`Report for ${padName(p)}`}>
                    <FileTextIcon />
                  </Link>
                </Button>
              )}
              <DeletePadButton
                target={deleteTarget(p)}
                onClick={() => onDelete(deleteTarget(p))}
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
  pads,
  onDelete,
}: {
  track: Track;
  pads: PadSummary[];
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
          {pads.map((p) => {
            const len = padLength(p);
            return (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Link href={padHref(p)} className="truncate font-medium hover:underline">
                      {padName(p)}
                    </Link>
                    {p.difficulty && <DifficultyBadge difficulty={p.difficulty} />}
                    <RoomBadge p={p} />
                  </div>
                </td>
                <td className="hidden px-4 py-2.5 md:table-cell">
                  <PadTag pad={p} />
                </td>
                <td className="hidden px-4 py-2.5 text-fg-muted sm:table-cell">
                  {formatRelative(p.startedAt)}
                </td>
                <td className="hidden px-4 py-2.5 text-fg-muted tabular lg:table-cell">
                  {len ? formatDuration(len) : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <Outcome p={p} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    {canOpenReport(p) && (
                      <Button asChild variant="ghost" size="xs">
                        <Link href={`/pads/${p.id}/report`} aria-label={`Report for ${padName(p)}`}>
                          <FileTextIcon /> <span className="hidden sm:inline">Report</span>
                        </Link>
                      </Button>
                    )}
                    <DeletePadButton
                      target={deleteTarget(p)}
                      onClick={() => onDelete(deleteTarget(p))}
                    />
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
  quant: 'Rounds and quant rooms you finish show up here, each with a report.',
};

export function PadHistory({
  track,
  pads,
  onDelete,
}: {
  track: Track;
  pads: PadSummary[];
  onDelete: OnDelete;
}) {
  return (
    <Card aria-labelledby="history-heading">
      <CardHeader>
        <CardTitle id="history-heading">Finished interviews</CardTitle>
        {pads.length > 0 && (
          <span className="text-xs text-fg-subtle tabular">{pads.length} completed</span>
        )}
      </CardHeader>
      {pads.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No finished interviews yet">
          {EMPTY[track]}
        </EmptyState>
      ) : (
        // Only one of the two is displayed at a time (and so in the accessibility tree).
        <>
          <HistoryCards pads={pads} onDelete={onDelete} />
          <HistoryTable track={track} pads={pads} onDelete={onDelete} />
        </>
      )}
    </Card>
  );
}
