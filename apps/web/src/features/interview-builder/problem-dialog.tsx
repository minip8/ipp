'use client';
/**
 * Choosing a coding stage's problem: the problem library (the same component as the Practice
 * tab's and the room setup's) in a dialog. Picking a row chooses it and closes the dialog.
 */
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProblemLibrary, useProblemLibrary } from '@/features/new/problem-library';

function Library({
  selected,
  onChoose,
}: {
  selected: string | null;
  onChoose: (slug: string) => void;
}) {
  const lib = useProblemLibrary();
  return <ProblemLibrary lib={lib} selected={selected} onSelect={onChoose} className="border-0" />;
}

export function ProblemDialog({
  open,
  onOpenChange,
  selected,
  onChoose,
  stageNumber,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selected: string | null;
  onChoose: (slug: string) => void;
  stageNumber: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="problem-dialog">
        <DialogHeader>
          <DialogTitle>Choose a problem for stage {stageNumber}</DialogTitle>
          <DialogDescription>
            Pick one from the library. Its statement opens with the stage, when the stage starts.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="px-0 pb-0 sm:px-0">
          {/* Mounted only while open: the library reads its filters fresh each time. */}
          {open && (
            <Library
              selected={selected}
              onChoose={(slug) => {
                onChoose(slug);
                onOpenChange(false);
              }}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
