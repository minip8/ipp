'use client';
import {
  CheckIcon,
  CopyIcon,
  KeyboardIcon,
  LinkIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import { LANG_LABEL, RunVerdictBadge } from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented } from '@/components/ui/segmented';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  type EditorSettings,
  savedEditorSettingKeys,
  updateEditorSettings,
  useEditorSettings,
} from './editor/settings';
import { touchEditorSettings } from './layout';
import { usePad } from './session';
import { SHORTCUTS } from './shortcuts';

function SettingRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-xs text-fg-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  compact = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The phone layout, whose defaults differ (see touchEditorSettings). */
  compact?: boolean;
}) {
  const stored = useEditorSettings();
  const s = useMemo(
    () => (compact ? touchEditorSettings(stored, savedEditorSettingKeys()) : stored),
    [compact, stored],
  );
  const { theme, setTheme } = useTheme();
  const set = (patch: Partial<EditorSettings>) => updateEditorSettings(patch);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editor settings</DialogTitle>
          <DialogDescription>Saved in this browser for every pad.</DialogDescription>
        </DialogHeader>
        <DialogBody className="divide-y divide-border pb-4">
          <SettingRow label="Theme">
            <Segmented
              aria-label="Theme"
              size="sm"
              value={(theme as 'light' | 'dark' | 'system') ?? 'system'}
              onValueChange={setTheme}
              options={[
                { value: 'light', label: <SunIcon className="size-3.5" aria-label="Light" /> },
                { value: 'dark', label: <MoonIcon className="size-3.5" aria-label="Dark" /> },
                {
                  value: 'system',
                  label: <MonitorIcon className="size-3.5" aria-label="System" />,
                },
              ]}
            />
          </SettingRow>
          <SettingRow label="Font size">
            <div className="flex items-center gap-1">
              <Button
                size="icon-xs"
                variant="secondary"
                aria-label="Smaller font"
                disabled={s.fontSize <= 10}
                onClick={() => set({ fontSize: s.fontSize - 1 })}
              >
                −
              </Button>
              <output className="w-10 text-center text-sm tabular" aria-live="polite">
                {s.fontSize}px
              </output>
              <Button
                size="icon-xs"
                variant="secondary"
                aria-label="Larger font"
                disabled={s.fontSize >= 24}
                onClick={() => set({ fontSize: s.fontSize + 1 })}
              >
                +
              </Button>
            </div>
          </SettingRow>
          <SettingRow label="Tab size">
            <Segmented
              aria-label="Tab size"
              size="sm"
              value={String(s.tabSize)}
              onValueChange={(v) => set({ tabSize: Number(v) as 2 | 4 | 8 })}
              options={[
                { value: '2', label: '2' },
                { value: '4', label: '4' },
                { value: '8', label: '8' },
              ]}
            />
          </SettingRow>
          <SettingRow
            label="Key bindings"
            hint={s.keymap === 'vim' ? 'Mode shows in the bar under the editor.' : undefined}
          >
            <Segmented
              aria-label="Key bindings"
              size="sm"
              value={s.keymap}
              onValueChange={(keymap) => set({ keymap })}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'vim', label: 'Vim' },
                { value: 'emacs', label: 'Emacs' },
              ]}
            />
          </SettingRow>
          <SettingRow
            label="Autocomplete"
            hint="Word and keyword suggestions as you type."
            htmlFor="set-ac"
          >
            <Switch
              id="set-ac"
              checked={s.autocomplete}
              onCheckedChange={(autocomplete) => set({ autocomplete })}
            />
          </SettingRow>
          <SettingRow label="Word wrap" htmlFor="set-wrap">
            <Switch
              id="set-wrap"
              checked={s.wordWrap}
              onCheckedChange={(wordWrap) => set({ wordWrap })}
            />
          </SettingRow>
          <SettingRow label="Relative line numbers" htmlFor="set-rel">
            <Switch
              id="set-rel"
              checked={s.lineNumbers === 'relative'}
              onCheckedChange={(on) => set({ lineNumbers: on ? 'relative' : 'on' })}
            />
          </SettingRow>
          <SettingRow label="Minimap" htmlFor="set-mini">
            <Switch
              id="set-mini"
              checked={s.minimap}
              onCheckedChange={(minimap) => set({ minimap })}
            />
          </SettingRow>
          <SettingRow label="Font ligatures" htmlFor="set-lig">
            <Switch
              id="set-lig"
              checked={s.ligatures}
              onCheckedChange={(ligatures) => set({ ligatures })}
            />
          </SettingRow>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const groups = ['Code', 'Interviewer', 'Layout', 'General'] as const;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyboardIcon className="size-4 text-fg-muted" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            These work in the editor too, unless marked otherwise.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-x-8 gap-y-5 pb-5 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g}>
              <h3 className="mb-1.5 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                {g}
              </h3>
              <ul className="space-y-0.5">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-1 text-sm">
                    <span className="text-fg">
                      {s.label}
                      {!s.inEditor && <span className="text-fg-subtle"> (outside the editor)</span>}
                    </span>
                    <Kbd keys={s.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="sm:col-span-2">
            <h3 className="mb-1.5 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
              In the editor
            </h3>
            <ul className="grid gap-x-8 gap-y-0.5 sm:grid-cols-2">
              {[
                ['Command palette', 'F1'],
                ['Toggle comment', 'Mod+/'],
                ['Find', 'Mod+F'],
                ['Multi-cursor at next match', 'Mod+D'],
                ['Undo', 'Mod+Z'],
                ['Redo', 'Mod+Shift+Z'],
              ].map(([l, k]) => (
                <li key={l} className="flex items-center justify-between gap-3 py-1 text-sm">
                  <span>{l}</span>
                  <Kbd keys={k as string} />
                </li>
              ))}
            </ul>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function shareText(isRoom: boolean) {
  return isRoom
    ? 'Anyone with this link can join as a candidate: they type their name, no account needed. They can edit the code, run it and chat. Your notes, the solution and the report stay with you.'
    : 'Anyone signed in with this link can join, edit the code and chat. Share it with a friend playing interviewer, or a mentor.';
}

/** The invite link and its copy button (in the share popover, or the share dialog on a phone). */
function ShareLink() {
  const { state } = usePad();
  const [copied, setCopied] = useState(false);
  const token = state.pad.shareToken;
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (token) setUrl(`${window.location.origin}/join/${token}`);
  }, [token]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      (document.getElementById('share-url') as HTMLInputElement | null)?.select();
    }
  };
  return (
    <div className="mt-3 flex gap-2">
      <label htmlFor="share-url" className="sr-only">
        Share link
      </label>
      <input
        id="share-url"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-2 font-mono text-xs text-fg-muted outline-none focus-visible:border-accent max-lg:h-10 max-lg:text-base"
      />
      <Button
        size="sm"
        variant={copied ? 'secondary' : 'primary'}
        onClick={copy}
        className="w-24 max-lg:h-10"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function SharePopover({ children }: { children: React.ReactNode }) {
  const { state, isRoom } = usePad();
  if (!state.pad.shareToken) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)]">
        <p className="flex items-center gap-2 text-sm font-medium">
          <LinkIcon className="size-4 text-fg-muted" />{' '}
          {isRoom ? 'Invite your candidate' : 'Invite a collaborator'}
        </p>
        <p className="mt-1 text-xs text-fg-muted">{shareText(isRoom)}</p>
        <ShareLink />
      </PopoverContent>
    </Popover>
  );
}

/** The same as SharePopover, opened from the top bar's menu on a phone. */
export function ShareDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { state, isRoom } = usePad();
  if (!state.pad.shareToken) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isRoom ? 'Invite your candidate' : 'Invite a collaborator'}</DialogTitle>
          <DialogDescription>{shareText(isRoom)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-5">
          <ShareLink />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function ResetDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
}) {
  const { state } = usePad();
  const lang = LANG_LABEL[state.pad.language];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" role="alertdialog">
        <DialogHeader>
          <DialogTitle>Reset {lang} to the starter code?</DialogTitle>
          <DialogDescription>
            Your {lang} code is replaced for everyone in this pad. Code in other languages is kept.
            You can undo with <Kbd keys="Mod+Z" />.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Reset code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EndDialog({
  open,
  onOpenChange,
  onEnded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onEnded: () => void;
}) {
  const { state, endPad, isRoom } = usePad();
  const [busy, setBusy] = useState(false);
  const elapsed = (Date.now() - Date.parse(state.pad.startedAt)) / 1000;
  const submissions = state.runs.filter((r) => r.mode === 'submit' && r.status === 'finished');
  const lastSubmit = submissions.at(-1);
  const accepted = submissions.some((r) => r.verdict === 'accepted');
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>End the interview?</DialogTitle>
          <DialogDescription>
            {isRoom
              ? 'The room becomes read-only for everyone. The report, with the playback and your notes, is for you alone.'
              : 'The pad becomes read-only for everyone and your report is generated.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border text-center">
            {[
              ['Time', formatDuration(elapsed)],
              ['Runs', String(state.runs.length)],
              ['Submissions', String(submissions.length)],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-3 py-2.5">
                <dt className="text-2xs text-fg-muted">{k}</dt>
                <dd className="mt-0.5 text-md font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 text-sm">
            {lastSubmit?.verdict ? (
              <p className="flex items-center gap-2">
                Last submission <RunVerdictBadge verdict={lastSubmit.verdict} />
              </p>
            ) : isRoom ? (
              <p className="text-fg-muted">Nothing has been submitted on this problem.</p>
            ) : (
              <p className="text-fg-muted">
                You have not submitted yet. Submitting runs the hidden tests, and the result is part
                of your report.
              </p>
            )}
            {!accepted && submissions.length > 0 && (
              <p className="mt-1 text-fg-muted">No submission has passed every test yet.</p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Keep going
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            className={cn(busy && 'cursor-wait')}
            onClick={async () => {
              setBusy(true);
              const ok = await endPad();
              setBusy(false);
              if (ok) {
                onOpenChange(false);
                onEnded();
              }
            }}
          >
            {busy && <Spinner />}
            End and see report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
