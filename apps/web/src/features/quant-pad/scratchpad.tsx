'use client';
/**
 * A quant pad's working space: the shared notes as a generous monospace scratchpad, and the
 * whiteboard beside it. Both are in the pad's document, so collaborators see them live, the
 * interviewer reads the scratchpad, and the report's playback replays it.
 */
import { NotebookPenIcon, PenToolIcon } from 'lucide-react';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotesEditor } from '@/features/pad/notes';
import { Whiteboard } from '@/features/pad/whiteboard';
import { cn } from '@/lib/utils';

export function Scratchpad({ className }: { className?: string }) {
  const [tab, setTab] = useState<'scratch' | 'board'>('scratch');
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as 'scratch' | 'board')}
      className={cn('flex h-full flex-col bg-surface', className)}
    >
      <TabsList
        aria-label="Working space"
        className="h-9 shrink-0 border-b border-border px-2 max-lg:h-10"
      >
        <TabsTrigger value="scratch">
          <NotebookPenIcon /> Scratchpad
        </TabsTrigger>
        <TabsTrigger value="board">
          <PenToolIcon /> Whiteboard
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="scratch"
        className="min-h-0 flex-1 bg-editor focus-visible:outline-none"
        forceMount
        hidden={tab !== 'scratch'}
      >
        <NotesEditor
          id="quant-scratchpad"
          label="Scratchpad"
          placeholder={
            'Work it out here: set-ups, sums, a quick table.\n\nThe interviewer reads this as you go, everyone in the pad sees it, and it is kept in the report.'
          }
          className="px-5 py-4 text-[14px] leading-6 max-lg:px-4"
        />
      </TabsContent>
      <TabsContent value="board" className="relative min-h-0 flex-1 focus-visible:outline-none">
        <div className="absolute inset-0">
          <Whiteboard active />
        </div>
      </TabsContent>
    </Tabs>
  );
}
