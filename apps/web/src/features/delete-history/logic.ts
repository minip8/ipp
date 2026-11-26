/**
 * Wording and cache rules for deleting from the user's own history: one quiz attempt (any mode,
 * running or finished), the whole quiz history, one mental math drill run, or every run. The
 * wording says what the deletion does to the numbers, which all read what is left: quiz stats,
 * the roadmap, question status and "Prefer questions I missed" use the latest countable answer
 * per question, and drill bests the highest full-mix run.
 */
import {
  DRILL_LEVEL_LABEL,
  type DrillBest,
  type DrillHistory,
  type DrillRun,
  isFullMix,
  type QuizAttemptSummary,
  type QuizMode,
} from '@ipp/contracts';
import { DURATION_LABEL, setupLabel } from '@/features/drill/logic';
import { ApiRequestError } from '@/lib/api';
import { plural } from '@/lib/format';

export type DeleteCopy = {
  /** Button label and accessible name prefix. */
  action: string;
  title: string;
  description: string;
  /** Heading over `lost`. */
  lostHeading: string;
  /** What goes and what changes, one line each. */
  lost: string[];
  confirm: string;
  pending: string;
  done: string;
  /** First words of the error shown when it fails. */
  failed: string;
};

/** What the confirmation needs to know about an attempt (from its summary or its page). */
export type AttemptTarget = {
  id: string;
  mode: QuizMode;
  status: 'active' | 'finished';
  /** The topics' titles, joined. */
  topics: string;
  /** Questions with a recorded answer. */
  answered: number;
};

const NOUN: Record<QuizMode, string> = {
  practice: 'practice quiz',
  exam: 'exam',
  discussion: 'discussion',
};

export const attemptTarget = (
  a: Pick<QuizAttemptSummary, 'id' | 'mode' | 'status' | 'answeredCount'>,
  topics: string,
): AttemptTarget => ({
  id: a.id,
  mode: a.mode,
  status: a.status,
  topics,
  answered: a.answeredCount,
});

const NUMBERS =
  'Your stats, roadmap progress and question statuses go back to your latest answer to each of its questions given elsewhere (or to not answered), and “Prefer questions I missed” sees them that way.';

export function attemptDeleteCopy(t: AttemptTarget): DeleteCopy {
  const noun = NOUN[t.mode];
  const running = t.status === 'active';
  // A running exam's answers do not count anywhere until it is finished.
  const counted = t.answered > 0 && !(t.mode === 'exam' && running);
  const answers =
    t.answered === 0
      ? 'No answers yet.'
      : t.mode === 'discussion'
        ? `${plural(t.answered, 'graded answer')}, and the conversation on every question.`
        : `${plural(t.answered, 'answer')} and ${t.answered === 1 ? 'its' : 'their'} feedback.`;
  return {
    action: `Delete ${noun}`,
    title: `Delete this ${noun} on ${t.topics}?`,
    description: `This permanently deletes the ${noun} and everything you answered in it. It cannot be undone.`,
    lostHeading: 'What is lost',
    lost: [
      ...(running ? [`The ${noun} in progress: you will not be able to resume it.`] : []),
      answers,
      counted
        ? NUMBERS
        : running && t.mode === 'exam' && t.answered > 0
          ? 'Your stats do not change: answers in an exam count once it is finished.'
          : 'Your stats do not change: nothing in it counts towards them.',
    ],
    confirm: `Delete ${noun}`,
    pending: 'Deleting…',
    done: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted`,
    failed: `The ${noun} was not deleted.`,
  };
}

/**
 * `attempts` counts the whole history; `elsewhere`, those of them the page does not list (a track's
 * Practice lists only its own), which go too.
 */
export function clearQuizHistoryCopy(attempts: number, elsewhere = 0): DeleteCopy {
  return {
    action: 'Clear quiz history',
    title: 'Clear your whole quiz history?',
    description:
      'This permanently deletes every quiz, exam and discussion you have taken, and every answer you gave in the question bank. It cannot be undone.',
    lostHeading: 'What is lost',
    lost: [
      `${plural(attempts, 'quiz', 'quizzes')} in your history, with their answers.${elsewhere > 0 ? ` That includes ${elsewhere} on the other track's topics, not listed here.` : ''}`,
      'Your answers in the question bank.',
      'Your stats, roadmap progress and question statuses start again from nothing, and “Prefer questions I missed” sees every question as new.',
      'Questions judged in your live quant rounds still count: they belong to those interviews, and go with them.',
    ],
    confirm: 'Clear quiz history',
    pending: 'Clearing…',
    done: 'Quiz history cleared',
    failed: 'Your quiz history was not cleared.',
  };
}

/** The run is the one a best points at (bests name the earliest run with the top score). */
export function holdsBest(run: DrillRun, bests: readonly DrillBest[]): boolean {
  if (!isFullMix(run.config)) return false;
  return bests.some(
    (b) =>
      b.durationSec === run.config.durationSec &&
      b.level === run.config.level &&
      b.score === run.score &&
      Date.parse(b.finishedAt) === Date.parse(run.finishedAt),
  );
}

export function drillRunDeleteCopy(run: DrillRun, bests: readonly DrillBest[]): DeleteCopy {
  const where = `${DURATION_LABEL[run.config.durationSec]} · ${DRILL_LEVEL_LABEL[run.config.level]}`;
  return {
    action: 'Delete run',
    title: `Delete this ${setupLabel(run.config)} run?`,
    description: `It scored ${run.score}. Deleting it cannot be undone.`,
    lostHeading: 'What changes',
    lost: [
      'The run and its results per category leave your history.',
      holdsBest(run, bests)
        ? `It is your best at ${where}: the best goes to your next highest full-mix run there, or to none.`
        : isFullMix(run.config)
          ? 'Your bests stay as they are.'
          : 'Your bests stay as they are: a run on chosen categories never sets one.',
    ],
    confirm: 'Delete run',
    pending: 'Deleting…',
    done: 'Run deleted',
    failed: 'The run was not deleted.',
  };
}

export function clearDrillHistoryCopy(totalRuns: number): DeleteCopy {
  return {
    action: 'Clear drill history',
    title: 'Clear your drill history?',
    description:
      'This permanently deletes every mental math run you have recorded. It cannot be undone.',
    lostHeading: 'What is lost',
    lost: [
      `All ${plural(totalRuns, 'run')}.`,
      'Every best: your next run sets the first one again.',
    ],
    confirm: 'Clear drill history',
    pending: 'Clearing…',
    done: 'Drill history cleared',
    failed: 'Your drill history was not cleared.',
  };
}

/** A 404 on delete means it is already gone (a double click, another tab): that is success. */
export const alreadyGone = (err: unknown) => err instanceof ApiRequestError && err.isNotFound;

export const withoutAttempt = (list: QuizAttemptSummary[] | undefined, id: string) =>
  list?.filter((a) => a.id !== id);

/** The history without one run, for a 404 (it was already gone): bests are left to a refetch. */
export const withoutRun = (h: DrillHistory | undefined, id: string): DrillHistory | undefined =>
  h && {
    ...h,
    runs: h.runs.filter((r) => r.id !== id),
    totalRuns: Math.max(0, h.totalRuns - (h.runs.some((r) => r.id === id) ? 1 : 0)),
  };
