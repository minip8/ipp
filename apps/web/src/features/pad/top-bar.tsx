'use client';
import { ClockIcon, KeyboardIcon, Settings2Icon, UserPlusIcon, WifiOffIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DifficultyBadge } from '@/components/domain';
import { LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Avatar } from '@/components/user-menu';
import { formatClock, formatTimeOfDay } from '@/lib/format';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { SharePopover } from './dialogs';
import type { PresenceUser } from './editor/binding';
import { usePad } from './session';
import { presenceUser } from './yjs-guards';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Timer() {
  const { state } = usePad();
  const now = useNow();
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(storage.get('ipp:timer-hidden', false)), []);
  const { pad } = state;
  const end = Date.parse(pad.startedAt) + pad.durationMin * 60_000;
  const ended = pad.status === 'ended';
  const left = Math.round((end - (ended && pad.endedAt ? Date.parse(pad.endedAt) : now)) / 1000);
  const over = left < 0;
  const warn = !over && left <= 5 * 60;
  const label = ended ? 'Ended' : over ? `+${formatClock(-left)}` : formatClock(left);
  const toggle = () => {
    setHidden((h) => {
      storage.set('ipp:timer-hidden', !h);
      return !h;
    });
  };
  return (
    <Tooltip
      label={`${pad.durationMin} min interview, started ${formatTimeOfDay(pad.startedAt)}. Click to ${hidden ? 'show' : 'hide'} the timer.`}
    >
      <button
        type="button"
        onClick={toggle}
        data-testid="timer"
        aria-label={hidden ? 'Show timer' : `Time ${over ? 'over' : 'left'}: ${label}`}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-sm tabular transition-colors hover:bg-surface-3',
          over
            ? 'bg-bad-soft text-bad-text'
            : warn
              ? 'bg-warn-soft text-warn-text'
              : 'text-fg-muted',
        )}
      >
        <ClockIcon className="size-3.5" aria-hidden />
        {!hidden && <span>{label}</span>}
        {!hidden && over && !ended && <span className="font-sans text-2xs font-medium">over</span>}
      </button>
    </Tooltip>
  );
}

function Connection() {
  const { socketStatus, collabStatus, socketRetryInMs, reconnect } = usePad();
  const editorDown = collabStatus === 'disconnected';
  const denied = socketStatus === 'offline' || collabStatus === 'denied';
  if (socketStatus === 'open' && collabStatus === 'connected') {
    return (
      <Tooltip label="Connected. Code and chat are live.">
        <span
          className="flex size-7 items-center justify-center"
          role="status"
          aria-label="Connected"
        >
          <span className="size-2 rounded-full bg-ok" />
        </span>
      </Tooltip>
    );
  }
  if (socketStatus === 'connecting' && collabStatus === 'connecting') {
    return (
      <span className="flex h-7 items-center gap-1.5 px-2 text-xs text-fg-subtle" role="status">
        <span className="size-2 animate-pulse rounded-full bg-fg-subtle" /> Connecting
      </span>
    );
  }
  const what = denied
    ? 'You no longer have access to this pad.'
    : editorDown && socketStatus === 'open'
      ? 'The editor is reconnecting. Keep typing; your changes sync when it is back.'
      : socketStatus !== 'open' && !editorDown
        ? 'Chat and run results are reconnecting.'
        : 'Reconnecting. Keep typing; your changes sync when the connection is back.';
  return (
    <Tooltip
      label={`${what}${socketRetryInMs ? ` Next try in ${Math.ceil(socketRetryInMs / 1000)} s.` : ''}`}
    >
      <button
        type="button"
        onClick={reconnect}
        aria-live="polite"
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
          denied ? 'bg-bad-soft text-bad-text' : 'bg-warn-soft text-warn-text',
        )}
      >
        <WifiOffIcon className="size-3.5" aria-hidden />
        {denied ? 'Disconnected' : 'Reconnecting…'}
        {!denied && (
          <span className="font-normal underline-offset-2 hover:underline">Retry now</span>
        )}
      </button>
    </Tooltip>
  );
}

function Presence() {
  const { collab, me } = usePad();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  useEffect(() => {
    const aw = collab?.awareness;
    if (!aw) return;
    const update = () => {
      const seen = new Map<string, PresenceUser>();
      aw.getStates().forEach((s, id) => {
        const u = presenceUser(s.user);
        if (!u || id === aw.clientID || u.userId === me.id) return;
        seen.set(u.userId ?? String(id), u);
      });
      setUsers([...seen.values()]);
    };
    update();
    aw.on('change', update);
    return () => aw.off('change', update);
  }, [collab, me.id]);
  if (users.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of avatars, not a form fieldset
    <div
      className="flex items-center -space-x-1.5"
      role="group"
      aria-label={`${users.length} other ${users.length === 1 ? 'person' : 'people'} in this pad`}
    >
      {users.slice(0, 4).map((u) => (
        <Tooltip key={u.userId ?? u.name} label={`${u.name} is here`}>
          <span
            className="rounded-full ring-2 ring-surface"
            style={{ boxShadow: `0 0 0 2px ${u.color}` }}
          >
            <Avatar name={u.name} className="size-6 text-[10px]" />
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

export function TopBar({
  onSettings,
  onShortcuts,
  onEnd,
}: {
  onSettings: () => void;
  onShortcuts: () => void;
  onEnd: () => void;
}) {
  const { state, readOnly } = usePad();
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <Tooltip label="Back to dashboard">
        <Link
          href="/dashboard"
          className="rounded-md p-1 hover:bg-surface-3"
          aria-label="interview++ dashboard"
        >
          <LogoMark />
        </Link>
      </Tooltip>
      <span className="h-4 w-px bg-border" aria-hidden />
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-sm font-semibold">{state.problem.title}</h1>
        <DifficultyBadge difficulty={state.problem.difficulty} />
        {state.role === 'collaborator' && (
          <span className="text-xs text-fg-subtle">· collaborating</span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Connection />
        <Presence />
        <Timer />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {!readOnly && (
          <SharePopover>
            <Button size="sm" variant="ghost">
              <UserPlusIcon /> Invite
            </Button>
          </SharePopover>
        )}
        <Tooltip label="Keyboard shortcuts" shortcut="Mod+/">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onShortcuts}
            aria-label="Keyboard shortcuts"
          >
            <KeyboardIcon />
          </Button>
        </Tooltip>
        <Tooltip label="Editor settings" shortcut="Mod+.">
          <Button size="icon-sm" variant="ghost" onClick={onSettings} aria-label="Editor settings">
            <Settings2Icon />
          </Button>
        </Tooltip>
        {readOnly ? (
          <Button asChild size="sm" variant="primary" className="ml-1">
            <Link href={`/pads/${state.pad.id}/report`}>View report</Link>
          </Button>
        ) : (
          state.role === 'owner' && (
            <Button size="sm" variant="secondary" className="ml-1" onClick={onEnd}>
              End interview
            </Button>
          )
        )}
      </div>
    </header>
  );
}
