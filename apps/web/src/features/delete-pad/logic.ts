/**
 * Wording and cache rules for deleting an interview (owner) or leaving one (collaborator). A pad
 * started on its own is deleted by itself; a staged interview (`interview` set, `id` the
 * interview's) is deleted as a whole, every stage's pad with it.
 */
import type { Interview, PadRole, PadSummary } from '@ipp/contracts';
import { ApiRequestError } from '@/lib/api';
import { plural } from '@/lib/format';

export type DeleteTarget = {
  id: string;
  problemTitle: string;
  status: 'active' | 'ended';
  role: PadRole;
  /** A staged interview: how many of its stages have a pad (started). */
  interview?: { stages: number; started: number };
};

/** A staged interview as something to delete. */
export const interviewTarget = (i: Interview): DeleteTarget => ({
  id: i.id,
  problemTitle: i.title,
  status: i.status,
  role: 'owner',
  interview: { stages: i.stages.length, started: i.stages.filter((s) => s.pad).length },
});

export type DeleteCopy = {
  /** Button / menu label and accessible name prefix. */
  action: string;
  title: string;
  description: string;
  /** What goes away, one line each. */
  lost: string[];
  confirm: string;
  pending: string;
  done: string;
};

export function deleteCopy(t: DeleteTarget): DeleteCopy {
  const active = t.status === 'active';
  if (t.role !== 'owner') {
    return {
      action: 'Remove from history',
      title: `Remove “${t.problemTitle}” from your history?`,
      description:
        'It is removed from your interviews only. The owner keeps it; you would need their invite link to see it again.',
      lost: [
        ...(active ? ['You leave the session in progress; it goes on for the others.'] : []),
        'Your access to the report, the code playback and the transcript.',
      ],
      confirm: 'Remove from history',
      pending: 'Removing…',
      done: 'Removed from your history',
    };
  }
  if (t.interview && t.interview.stages > 1) {
    const started = t.interview.started;
    return {
      action: 'Delete interview',
      title: `Delete “${t.problemTitle}”?`,
      description: `This permanently deletes the interview and the ${plural(started, 'stage')} you started in it. It cannot be undone.`,
      lost: [
        ...(active ? ['The stage in progress ends.'] : []),
        'Every stage’s report and the interviewer’s assessments.',
        'The overall result.',
        'The playbacks, runs and transcripts of every stage.',
      ],
      confirm: 'Delete interview',
      pending: 'Deleting…',
      done: 'Interview deleted',
    };
  }
  return {
    action: 'Delete interview',
    title: `Delete “${t.problemTitle}”?`,
    description: 'This permanently deletes the interview for everyone in it. It cannot be undone.',
    lost: [
      ...(active ? ['The session in progress ends, and anyone in the pad is disconnected.'] : []),
      'The report and the interviewer’s assessment.',
      'The code playback and every run and submission.',
      'The transcript of your conversation with the interviewer.',
    ],
    confirm: 'Delete interview',
    pending: 'Deleting…',
    done: 'Interview deleted',
  };
}

/** A 404 on delete means it is already gone (a double click, another tab): that is success. */
export const alreadyGone = (err: unknown) => err instanceof ApiRequestError && err.isNotFound;

export const withoutPad = (pads: PadSummary[] | undefined, id: string) =>
  pads?.filter((p) => p.id !== id);

export const withoutInterview = (interviews: Interview[] | undefined, id: string) =>
  interviews?.filter((i) => i.id !== id);
