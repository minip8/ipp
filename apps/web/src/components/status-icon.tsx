/**
 * The marks every list of things the user works through shares: a question in the bank, a quiz
 * result, a library problem. Right is a green tick, part-way an amber dot, wrong a red cross,
 * waiting a blue question mark, and not started a dashed circle.
 */
import type { ProblemStatus, QuizQuestionStatus } from '@ipp/contracts';
import {
  type CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CircleXIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** Every status but "not started". */
type Outcome = Exclude<QuizQuestionStatus, 'unanswered'>;

export const OUTCOME_ICON: Record<Outcome, typeof CheckIcon> = {
  correct: CircleCheckIcon,
  partial: CircleDotIcon,
  incorrect: CircleXIcon,
  pending: CircleHelpIcon,
};
export const OUTCOME_TEXT: Record<Outcome, string> = {
  correct: 'text-ok-text',
  partial: 'text-warn-text',
  incorrect: 'text-bad-text',
  pending: 'text-accent-text',
};

export function StatusIcon({
  status,
  className,
}: {
  status: QuizQuestionStatus;
  className?: string;
}) {
  if (status === 'unanswered')
    return <CircleDashedIcon aria-hidden className={cn('size-4 text-fg-subtle', className)} />;
  const Icon = OUTCOME_ICON[status];
  return <Icon aria-hidden className={cn('size-4', OUTCOME_TEXT[status], className)} />;
}

/** A problem in the question bank's terms: solved is right, attempted is part-way. */
const AS_QUESTION: Record<ProblemStatus, QuizQuestionStatus> = {
  new: 'unanswered',
  attempted: 'partial',
  solved: 'correct',
};

export const PROBLEM_STATUS_LABEL: Record<ProblemStatus, string> = {
  new: 'Not attempted',
  attempted: 'Attempted, not solved',
  solved: 'Solved',
};

export function ProblemStatusIcon({
  status,
  className,
}: {
  status: ProblemStatus;
  className?: string;
}) {
  return (
    <span data-testid="problem-status" data-status={status} className="contents">
      <StatusIcon status={AS_QUESTION[status]} className={className} />
    </span>
  );
}
