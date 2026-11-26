'use client';
import {
  ClockIcon,
  FileBarChartIcon,
  FlagIcon,
  KeyboardIcon,
  MoreVerticalIcon,
  Settings2Icon,
  UserPlusIcon,
  WifiOffIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DifficultyBadge, QuantPathBadge } from '@/components/domain';
import { LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { Avatar } from '@/components/user-menu';
import { hostOf } from '@/features/room/logic';
import { formatTimeOfDay } from '@/lib/format';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { SharePopover } from './dialogs';
import type { PresenceUser } from './editor/binding';
import { usePad } from './session';
import { timerView } from './timer';
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
  const ended = pad.status === 'ended';
  const clock = timerView(pad, now);
  const { over, warn } = clock;
  const label = ended ? 'Ended' : clock.label;
  const toggle = () => {
    setHidden((h) => {
      storage.set('ipp:timer-hidden', !h);
      return !h;
    });
  };
  return (
    <Tooltip
      label={`${pad.durationMin === null ? 'No time limit' : `${pad.durationMin} min interview`}, started ${formatTimeOfDay(pad.startedAt)}. Click to ${hidden ? 'show' : 'hide'} the timer.`}
    >
      <button
        type="button"
        onClick={toggle}
        data-testid="timer"
        aria-label={
          hidden
            ? 'Show timer'
            : `Time ${clock.elapsed ? 'elapsed' : over ? 'over' : 'left'}: ${label}`
        }
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-sm tabular transition-colors hover:bg-surface-3 max-lg:h-9',
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
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium max-lg:h-9',
          denied ? 'bg-bad-soft text-bad-text' : 'bg-warn-soft text-warn-text',
        )}
      >
        <WifiOffIcon className="size-3.5" aria-hidden />
        {denied ? 'Disconnected' : 'Reconnecting…'}
        {!denied && (
          <span className="font-normal underline-offset-2 hover:underline max-lg:sr-only">
            Retry now
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function Presence({ max = 4, more = false }: { max?: number; more?: boolean }) {
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
      {users.slice(0, max).map((u) => (
        <Tooltip key={u.userId ?? u.name} label={`${u.name} is here`}>
          <span
            className="rounded-full ring-2 ring-surface"
            style={{ boxShadow: `0 0 0 2px ${u.color}` }}
          >
            <Avatar name={u.name} className="size-6 text-[10px]" />
          </span>
        </Tooltip>
      ))}
      {more && users.length > max && (
        <span className="z-10 flex size-6 items-center justify-center rounded-full bg-surface-3 text-[10px] font-medium text-fg-muted ring-2 ring-surface">
          +{users.length - max}
        </span>
      )}
    </div>
  );
}

type TopBarProps = {
  /** Editor settings and the keyboard shortcuts; a quant pad has no editor and leaves them out. */
  onSettings?: () => void;
  onShortcuts?: () => void;
  onEnd: () => void;
  /** Phone layout only: the invite link opens in a dialog from the menu. */
  onShare?: () => void;
  /** The phone layout: what does not fit in 360 px goes into a menu. */
  compact?: boolean;
};

function Home({ className }: { className?: string }) {
  const { me } = usePad();
  return me.guest ? (
    // A guest has no dashboard to go back to.
    <span className={cn('p-1', className)}>
      <LogoMark />
    </span>
  ) : (
    <Tooltip label="Back to dashboard">
      <Link
        href="/dashboard"
        className={cn('rounded-md p-1 hover:bg-surface-3', className)}
        aria-label="interview++ dashboard"
      >
        <LogoMark />
      </Link>
    </Tooltip>
  );
}

/**
 * The top bar on a phone: the title, the connection, the clock and a menu with the rest. Run and
 * Submit are under the editor, where the thumb is.
 */
function CompactTopBar({ onSettings, onShortcuts, onEnd, onShare }: TopBarProps) {
  const { state, readOnly, isRoom, isHost } = usePad();
  const canShare = !readOnly && Boolean(state.pad.shareToken) && Boolean(onShare);
  const canEnd = !readOnly && state.role === 'owner';
  const canReport = readOnly && (!isRoom || isHost);
  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-surface pr-1 pl-2">
      <Home className="flex size-9 shrink-0 items-center justify-center" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
        {state.problem?.title ?? state.pad.title}
      </h1>
      <div className="flex shrink-0 items-center gap-0.5">
        <Connection />
        <Presence max={2} more />
        <Timer />
        <Menu>
          <MenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-10" aria-label="More actions">
              <MoreVerticalIcon />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" className="w-56 [&_[role=menuitem]]:h-10">
            {canShare && (
              <MenuItem onSelect={onShare}>
                <UserPlusIcon /> {isRoom ? 'Invite your candidate' : 'Invite'}
              </MenuItem>
            )}
            {onSettings && (
              <MenuItem onSelect={onSettings}>
                <Settings2Icon /> Editor settings
              </MenuItem>
            )}
            {onShortcuts && (
              <MenuItem onSelect={onShortcuts}>
                <KeyboardIcon /> Keyboard shortcuts
              </MenuItem>
            )}
            {(canEnd || canReport) && (canShare || onSettings || onShortcuts) && <MenuSeparator />}
            {canEnd && (
              <MenuItem onSelect={onEnd}>
                <FlagIcon /> End interview
              </MenuItem>
            )}
            {canReport && (
              <MenuItem asChild>
                <Link href={`/pads/${state.pad.id}/report`}>
                  <FileBarChartIcon /> View report
                </Link>
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}

export function TopBar(props: TopBarProps) {
  const { onSettings, onShortcuts, onEnd, compact } = props;
  const { state, readOnly, isRoom, isHost } = usePad();
  const host = hostOf(state.members);
  if (compact) return <CompactTopBar {...props} />;
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <Home />
      <span className="h-4 w-px bg-border" aria-hidden />
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-sm font-semibold">
          {state.problem?.title ?? state.pad.title}
        </h1>
        {state.problem && <DifficultyBadge difficulty={state.problem.difficulty} />}
        {state.round?.path && <QuantPathBadge path={state.round.path} />}
        {isRoom ? (
          <span className="truncate text-xs text-fg-subtle" data-testid="room-role">
            {isHost ? '· you are hosting' : host ? `· interview with ${host.name}` : '· interview'}
          </span>
        ) : (
          state.role === 'collaborator' && (
            <span className="text-xs text-fg-subtle">· collaborating</span>
          )
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
        {onShortcuts && (
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
        )}
        {onSettings && (
          <Tooltip label="Editor settings" shortcut="Mod+.">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onSettings}
              aria-label="Editor settings"
            >
              <Settings2Icon />
            </Button>
          </Tooltip>
        )}
        {readOnly
          ? (!isRoom || isHost) && (
              <Button asChild size="sm" variant="primary" className="ml-1">
                <Link href={`/pads/${state.pad.id}/report`}>View report</Link>
              </Button>
            )
          : state.role === 'owner' && (
              <Button size="sm" variant="secondary" className="ml-1" onClick={onEnd}>
                End interview
              </Button>
            )}
      </div>
    </header>
  );
}
