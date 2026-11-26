'use client';
/**
 * The bank, opened beside the host's desk mid-interview: the host's bank search (each question
 * with its solution and material), marking what is queued or already asked. On a wide screen it
 * covers the chat and the scratchpad, not the desk, which stays usable (a hint can be recorded
 * while browsing); on a phone it takes the screen. HOST-ONLY.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckIcon, ListPlusIcon, SendIcon, XIcon } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { BankBrowser } from './bank-browser';
import { OnlyYouBadge } from './host-desk';
import { useHostRoom } from './host-room';
import {
  addToQueue,
  type BankQuery,
  fromHostPage,
  hostBankParams,
  NO_BANK_FILTERS,
  openQuestion,
  queueIds,
} from './logic';

export function HostBankSheet({ compact }: { compact: boolean }) {
  const room = useHostRoom();
  const [query, setQuery] = useState<BankQuery>(NO_BANK_FILTERS);
  const params = hostBankParams(query);
  const page = useQuery({
    queryKey: qk.hostBank(room.padId, params),
    queryFn: () => api.hostBank(room.padId, params),
    enabled: room.bankOpen,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const onQuery = useCallback((q: BankQuery) => setQuery(q), []);
  const ids = room.round ? queueIds(room.round) : [];
  const open = openQuestion(room.round);
  const view = page.data ? fromHostPage(page.data) : undefined;
  // The page may be a moment behind the host's own steps: what the desk knows wins.
  const queued = new Set(ids);
  const asked = new Set(room.round?.questions.map((q) => q.questionId) ?? []);

  return (
    <D.Root open={room.bankOpen} onOpenChange={room.setBankOpen} modal={compact}>
      <D.Portal>
        {compact && (
          <D.Overlay className="fixed inset-0 z-50 bg-[oklch(0.15_0.01_260/0.45)] data-[state=open]:animate-fade-in" />
        )}
        <D.Content
          aria-describedby={undefined}
          // Wide screens: the desk stays usable beside the sheet, so clicks there do not close it.
          onInteractOutside={(e) => {
            if (!compact) e.preventDefault();
          }}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border-border bg-surface shadow-overlay outline-none data-[state=open]:animate-fade-in',
            compact
              ? 'inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
              : 'top-11 right-0 bottom-0 w-[min(860px,calc(100vw-420px))] border-l',
          )}
          data-testid="bank-sheet"
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
            <D.Title className="text-sm font-semibold">Question bank</D.Title>
            <OnlyYouBadge />
            <span className="ml-auto text-xs text-fg-muted max-sm:hidden">
              {open
                ? `Asking now closes question ${open.index + 1} first`
                : 'Queue questions, or ask one now'}
            </span>
            <D.Close asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Close the bank"
                className="max-lg:size-10"
              >
                <XIcon />
              </Button>
            </D.Close>
          </div>
          <BankBrowser
            className="min-h-0 flex-1"
            trackFilter={false}
            query={query}
            onQuery={onQuery}
            view={view}
            loading={page.isFetching}
            error={page.error}
            onRetry={() => void page.refetch()}
            actions={(item) => {
              const id = item.question.id;
              if (asked.has(id) || item.status === 'posed')
                return (
                  <span className="px-2 text-xs text-fg-subtle" data-testid="bank-asked">
                    Asked
                  </span>
                );
              const isQueued = queued.has(id);
              const busy = room.busy !== null;
              return (
                <>
                  {isQueued ? (
                    <span className="inline-flex items-center gap-1 px-2 text-xs text-accent-text">
                      <CheckIcon className="size-3.5" aria-hidden /> Queued
                    </span>
                  ) : (
                    <Button
                      size="xs"
                      className="max-lg:h-9"
                      disabled={busy}
                      onClick={() => void room.setQueue(addToQueue(ids, id))}
                      aria-label={`Queue ${id}`}
                      data-testid="bank-queue"
                    >
                      <ListPlusIcon /> Queue
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="primary"
                    className="max-lg:h-9"
                    disabled={busy}
                    onClick={() => room.requestPose(id)}
                    aria-label={`Ask ${id} now`}
                    data-testid="bank-ask"
                  >
                    <SendIcon /> Ask now
                  </Button>
                </>
              );
            }}
          />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
