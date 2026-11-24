'use client';
import { BotIcon, ClipboardCheckIcon, ListChecksIcon } from 'lucide-react';
import { ErrorState } from '@/components/states';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAiKey } from '@/lib/queries';
import { KeyFacts } from './ai-key-dialog';
import { AiKeyForm, ConsoleLink } from './ai-key-form';

const USES = [
  { icon: BotIcon, text: 'The AI interviewer in your pads (collaborators you invite use it too)' },
  { icon: ClipboardCheckIcon, text: 'The written assessment at the end of an interview' },
  { icon: ListChecksIcon, text: 'Grading short answers in quizzes' },
];

export function AiKeySettings() {
  const status = useAiKey();
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">AI key</h1>
      <p className="mt-1 text-sm text-fg-muted">
        interview++ runs its AI features on your own Anthropic API key and never pays for model
        usage itself. Everything else (the editor, running code, quizzes) works without one.
      </p>

      <Card className="mt-6" aria-labelledby="key-heading">
        <CardHeader>
          <CardTitle id="key-heading">Your key</CardTitle>
          {status.data && (
            <span className="text-xs text-fg-muted">
              Model: <span className="font-mono">{status.data.model}</span>
            </span>
          )}
        </CardHeader>
        <div className="space-y-5 p-4 sm:p-5">
          {status.isPending ? (
            <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : status.isError ? (
            <ErrorState error={status.error} onRetry={() => status.refetch()} compact />
          ) : (
            <AiKeyForm status={status.data} />
          )}
          <p className="text-sm text-fg-muted">
            Don’t have one? Create a key in the <ConsoleLink />: Settings → API keys. It starts with{' '}
            <span className="font-mono text-fg">sk-ant-</span>.
          </p>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section aria-labelledby="uses-heading">
          <h2 id="uses-heading" className="text-sm font-semibold">
            What it is used for
          </h2>
          <ul className="mt-2.5 space-y-2">
            {USES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-fg-muted">
                <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="custody-heading">
          <h2 id="custody-heading" className="text-sm font-semibold">
            How your key is handled
          </h2>
          <p className="mt-2.5 text-sm text-fg-muted">
            The interviewer runs on our server (it watches the editor and speaks up on its own), so
            the key has to be kept there while you use it.
          </p>
          <KeyFacts ttlHours={status.data?.ttlHours} className="mt-2.5 space-y-2" />
        </section>
      </div>
    </div>
  );
}
