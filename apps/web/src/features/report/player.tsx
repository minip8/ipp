'use client';
import {
  LANGUAGES,
  type Language,
  type Message,
  type PadDetail,
  type Playback,
  YDOC,
} from '@ipp/contracts';
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CodeBlock } from '@/components/code-block';
import { LANG_LABEL, toneIcon } from '@/components/domain';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';
import { formatClock, formatTimeOfDay, humanize } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RUN_VERDICT } from '@/lib/verdict';
import {
  activityHistogram,
  countAtTime,
  decodeUpdates,
  languageAt,
  PlaybackEngine,
  type Span,
  stepTime,
  timelineSpan,
} from './playback-engine';
import {
  buildTranscript,
  runEventLabel,
  speaker,
  type TranscriptItem,
  TranscriptRow,
} from './transcript';

type View = Language | 'notes';
const SPEEDS = ['1', '4', '16', '64'] as const;
type Speed = (typeof SPEEDS)[number];
const BUCKETS = 120;

const pct = (t: number, span: Span) =>
  `${(((t - span.start) / (span.end - span.start)) * 100).toFixed(3)}%`;

function Marker({
  item,
  span,
  onSeek,
  whoSaid,
}: {
  item: TranscriptItem;
  span: Span;
  onSeek: (t: number) => void;
  /** In an interview room: the people in it by name. */
  whoSaid?: (m: Message) => string;
}) {
  const time = formatClock((item.t - span.start) / 1000);
  if (item.kind === 'event') {
    if (item.event.type !== 'run') return null;
    const { verdict, mode, label, counts } = runEventLabel(item.event);
    const tone = verdict ? RUN_VERDICT[verdict].tone : 'neutral';
    const ok = tone === 'ok';
    const text = `${mode}: ${label}${counts ? `, ${counts}` : ''} at ${time}`;
    return (
      <Tooltip label={text} side="top">
        <button
          type="button"
          aria-label={text}
          onClick={() => onSeek(item.t)}
          style={{ left: pct(item.t, span) }}
          className={cn(
            // Touch: a larger invisible hit area, kept mostly out of the scrub track below.
            'absolute top-0 flex size-4 -translate-x-1/2 items-center justify-center rounded-[4px] border bg-surface pointer-coarse:before:absolute pointer-coarse:before:-inset-x-2 pointer-coarse:before:-top-2 pointer-coarse:before:-bottom-1 shadow-[0_1px_2px_oklch(0_0_0/0.1)] transition-transform hover:z-10 hover:scale-125 focus-visible:z-10',
            tone === 'ok'
              ? 'border-ok/60'
              : tone === 'bad'
                ? 'border-bad/60'
                : tone === 'warn'
                  ? 'border-warn/70'
                  : 'border-border-strong',
          )}
        >
          <span aria-hidden className={cn('text-[10px] leading-none font-bold', toneIcon[tone])}>
            {ok ? '✓' : tone === 'neutral' ? '•' : tone === 'warn' ? '!' : '✕'}
          </span>
        </button>
      </Tooltip>
    );
  }
  const m = item.message;
  const proactive = m.role === 'interviewer' && m.kind === 'proactive';
  const who =
    m.role === 'interviewer'
      ? proactive
        ? `Interviewer spoke up${m.intent ? ` (${humanize(m.intent).toLowerCase()})` : ''}`
        : (whoSaid?.(m) ?? 'Interviewer')
      : (whoSaid?.(m) ?? 'You');
  const preview = m.text.length > 90 ? `${m.text.slice(0, 88)}…` : m.text;
  return (
    <Tooltip
      label={
        <span className="block max-w-64 font-normal">
          <span className="font-medium">
            {who} · {time}
          </span>
          <br />
          {preview}
        </span>
      }
      side="bottom"
    >
      <button
        type="button"
        aria-label={`${who} at ${time}: ${preview}`}
        onClick={() => onSeek(item.t)}
        style={{ left: pct(item.t, span) }}
        className={cn(
          'absolute bottom-0 size-2.5 -translate-x-1/2 rounded-full border-2 pointer-coarse:before:absolute pointer-coarse:before:-inset-x-2.5 pointer-coarse:before:-top-0.5 pointer-coarse:before:-bottom-2.5 transition-transform hover:z-10 hover:scale-150 focus-visible:z-10',
          m.role === 'candidate'
            ? 'border-accent bg-accent'
            : proactive
              ? 'border-proactive bg-surface'
              : 'border-fg-subtle bg-surface',
        )}
      />
    </Tooltip>
  );
}

function Timeline({
  span,
  t,
  onSeek,
  histogram,
  items,
  onKeyDown,
  whoSaid,
}: {
  span: Span;
  t: number;
  onSeek: (t: number) => void;
  histogram: number[];
  items: TranscriptItem[];
  onKeyDown: (e: KeyboardEvent) => void;
  whoSaid?: (m: Message) => string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const max = Math.max(1, ...histogram);
  const timeAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return t;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return span.start + f * (span.end - span.start);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onSeek(timeAt(e.clientX));
  };
  const stop = () => {
    dragging.current = false;
  };
  const elapsed = (t - span.start) / 1000;
  const total = (span.end - span.start) / 1000;
  return (
    <div className="relative px-2 pt-1 pb-1">
      {/* run markers lane */}
      <div className="relative h-5">
        {items
          .filter((i) => i.kind === 'event')
          .map((i) => (
            <Marker key={i.key} item={i} span={span} onSeek={onSeek} whoSaid={whoSaid} />
          ))}
      </div>
      {/* track */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(elapsed)}
        aria-valuetext={`${formatClock(elapsed)} of ${formatClock(total)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={onKeyDown}
        className="group relative mt-1 h-9 cursor-pointer touch-none rounded-md outline-offset-2 pointer-coarse:h-11"
      >
        <div
          className="absolute inset-0 flex items-end gap-px overflow-hidden rounded-md border border-border bg-surface-2 px-px"
          aria-hidden
        >
          {histogram.map((v, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed buckets
              key={i}
              className={cn(
                'flex-1 rounded-t-[1px]',
                span.start + ((i + 0.5) / BUCKETS) * (span.end - span.start) <= t
                  ? 'bg-accent/45'
                  : 'bg-fg-subtle/25',
              )}
              style={{ height: v ? `${12 + (v / max) * 76}%` : '0%' }}
            />
          ))}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-accent/8"
          style={{ width: pct(t, span) }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-accent"
          style={{ left: pct(t, span) }}
        >
          <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-surface bg-accent shadow-sm transition-transform group-active:scale-125 pointer-coarse:-top-1.5 pointer-coarse:size-4" />
        </div>
      </div>
      {/* message markers lane */}
      <div className="relative mt-1.5 h-3">
        {items
          .filter((i) => i.kind === 'message')
          .map((i) => (
            <Marker key={i.key} item={i} span={span} onSeek={onSeek} whoSaid={whoSaid} />
          ))}
      </div>
    </div>
  );
}

/** `room`: the transcript is between the candidate and the host, who is the reader. */
function Legend({ room }: { room: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-fg-subtle">
      <span className="flex items-center gap-1.5">
        <span className="flex size-3 items-center justify-center rounded-[3px] border border-ok/60 bg-surface text-[8px] font-bold text-ok">
          ✓
        </span>{' '}
        Run
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full border-2 border-accent bg-accent" />{' '}
        {room ? 'Candidate' : 'You'}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full border-2 border-fg-subtle bg-surface" />{' '}
        {room ? 'You' : 'Interviewer'}
      </span>
      {!room && (
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full border-2 border-proactive bg-surface" /> Spoke up
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-1 rounded-t-[1px] bg-fg-subtle/40" /> Editing
      </span>
    </div>
  );
}

export function Player({
  detail,
  playback,
  selfId,
}: {
  detail: PadDetail;
  playback: Playback;
  selfId?: string;
}) {
  const updates = useMemo(() => decodeUpdates(playback.updates), [playback.updates]);
  // An interview room: the transcript is between people, shown by name.
  const names = useMemo(
    () =>
      detail.pad.kind === 'room'
        ? new Map(detail.members.map((m) => [m.userId, m.name]))
        : undefined,
    [detail.pad.kind, detail.members],
  );
  const engine = useMemo(() => new PlaybackEngine(updates), [updates]);
  useEffect(() => () => engine.destroy(), [engine]);
  const span = useMemo(
    () =>
      timelineSpan(
        detail.pad.startedAt,
        detail.pad.endedAt,
        updates,
        playback.events,
        playback.messages,
      ),
    [detail.pad.startedAt, detail.pad.endedAt, updates, playback.events, playback.messages],
  );
  const items = useMemo(
    () => buildTranscript(playback.messages, playback.events),
    [playback.messages, playback.events],
  );
  const histogram = useMemo(() => activityHistogram(updates, span, BUCKETS), [updates, span]);

  const [t, setT] = useState(span.end);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('16');
  const [follow, setFollow] = useState(true);
  const [manualView, setManualView] = useState<View>(detail.pad.language);
  const autoLanguage = languageAt(playback.events, t, detail.pad.language);
  const view: View = follow ? autoLanguage : manualView;

  const count = countAtTime(updates, t);
  const code = useMemo(() => {
    engine.seek(count);
    return view === 'notes' ? engine.text(YDOC.notes) : engine.code(view);
  }, [engine, count, view]);

  const seek = useCallback(
    (next: number) => setT(Math.min(span.end, Math.max(span.start, next))),
    [span],
  );

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setT((prev) => {
        const next = prev + dt * Number(speed);
        if (next >= span.end) {
          setPlaying(false);
          return span.end;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, span.end]);

  const togglePlay = () => {
    if (!playing && t >= span.end) setT(span.start);
    setPlaying((p) => !p);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, [role="radio"]') && e.key === ' ') return;
    const big = 30_000;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setPlaying(false);
        seek(e.shiftKey ? t - big : stepTime(updates, t, -1, span));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setPlaying(false);
        seek(e.shiftKey ? t + big : stepTime(updates, t, 1, span));
        break;
      case 'Home':
        e.preventDefault();
        seek(span.start);
        break;
      case 'End':
        e.preventDefault();
        seek(span.end);
        break;
    }
  };

  // Keep the latest transcript item in view while playing.
  const currentIndex = items.findLastIndex((i) => i.t <= t);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  useEffect(() => {
    if (!playing || currentIndex < 0) return;
    rowRefs.current.get(currentIndex)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [playing, currentIndex]);

  const elapsed = (t - span.start) / 1000;
  const total = (span.end - span.start) / 1000;

  return (
    <section
      aria-labelledby="playback-heading"
      onKeyDown={onKeyDown}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 id="playback-heading" className="text-sm font-semibold">
          Playback
        </h2>
        <Legend room={detail.pad.kind === 'room'} />
      </div>

      {/* Desktop: code | transcript, controls underneath. Phone: code, controls, transcript. */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* code */}
        <div className="min-w-0 border-border lg:col-start-1 lg:row-start-1 lg:border-r">
          <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2 sm:px-4">
            <div role="tablist" aria-label="Buffer" className="flex items-center gap-1">
              {[...LANGUAGES, 'notes' as const].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => {
                    setFollow(false);
                    setManualView(v);
                  }}
                  className={cn(
                    'touch-hit h-7 rounded-md px-2.5 text-sm font-medium transition-colors',
                    view === v ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {v === 'notes' ? 'Notes' : LANG_LABEL[v]}
                </button>
              ))}
            </div>
            <label
              className="ml-auto flex items-center gap-2 text-xs text-fg-muted"
              htmlFor="follow-language"
            >
              Follow active language
              <Switch
                id="follow-language"
                checked={follow}
                onCheckedChange={(c) => {
                  setFollow(c);
                  if (!c) setManualView(view);
                }}
              />
            </label>
          </div>
          <div
            className="h-[360px] overflow-auto bg-editor sm:h-[460px]"
            data-testid="playback-code"
          >
            {code.trim() ? (
              <CodeBlock
                code={code}
                language={view === 'notes' ? null : view}
                lineNumbers={view !== 'notes'}
                className={cn(
                  'min-h-full rounded-none border-0 bg-transparent',
                  view === 'notes' && 'whitespace-pre-wrap',
                )}
              />
            ) : (
              <p className="px-4 py-6 text-sm text-fg-subtle">
                {updates.length === 0
                  ? 'No editor history was recorded for this interview.'
                  : view === 'notes'
                    ? 'No notes at this point.'
                    : 'This buffer is empty at this point.'}
              </p>
            )}
          </div>
        </div>

        {/* transcript */}
        <div className="order-3 flex min-h-0 flex-col border-t border-border lg:order-none lg:col-start-2 lg:row-start-1 lg:border-t-0">
          <div className="flex h-11 items-center justify-between border-b border-border px-4">
            <h3 className="text-sm font-semibold" id="transcript-heading">
              Transcript
            </h3>
            <span className="text-2xs text-fg-subtle tabular">
              {playback.messages.length} messages
            </span>
          </div>
          {items.length === 0 ? (
            <EmptyState title="Nothing was said">
              There are no messages or runs in this interview.
            </EmptyState>
          ) : (
            <ol
              aria-labelledby="transcript-heading"
              className="h-[360px] space-y-2.5 overflow-y-auto py-3 pr-3 pl-6 sm:h-[460px]"
            >
              {items.map((item, i) => (
                <TranscriptRow
                  key={item.key}
                  ref={(el) => {
                    if (el) rowRefs.current.set(i, el);
                    else rowRefs.current.delete(i);
                  }}
                  item={item}
                  start={span.start}
                  past={item.t <= t}
                  current={i === currentIndex}
                  onSeek={(time) => {
                    setPlaying(false);
                    seek(time);
                  }}
                  selfId={selfId}
                  names={names}
                />
              ))}
            </ol>
          )}
        </div>

        {/* controls */}
        <div className="order-2 border-t border-border bg-surface-2/40 px-3 pt-2 pb-3 lg:order-none lg:col-span-2 lg:row-start-2">
          <Timeline
            span={span}
            t={t}
            onSeek={(x) => seek(x)}
            histogram={histogram}
            items={items}
            onKeyDown={onKeyDown}
            whoSaid={names ? (m) => speaker(m, selfId, names) : undefined}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
            <Tooltip label={playing ? 'Pause' : 'Play'} shortcut="Space" side="top">
              <Button
                variant="primary"
                size="icon-sm"
                onClick={togglePlay}
                aria-label={playing ? 'Pause playback' : 'Play'}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </Button>
            </Tooltip>
            <Tooltip label="Previous change" shortcut="←" side="top">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous change"
                onClick={() => {
                  setPlaying(false);
                  seek(stepTime(updates, t, -1, span));
                }}
              >
                <ChevronLeftIcon />
              </Button>
            </Tooltip>
            <Tooltip label="Next change" shortcut="→" side="top">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next change"
                onClick={() => {
                  setPlaying(false);
                  seek(stepTime(updates, t, 1, span));
                }}
              >
                <ChevronRightIcon />
              </Button>
            </Tooltip>
            <span
              className="ml-1 font-mono text-sm tabular"
              aria-live="off"
              data-testid="playback-time"
            >
              {formatClock(elapsed)}
              <span className="text-fg-subtle"> / {formatClock(total)}</span>
            </span>
            <span className="hidden text-xs text-fg-subtle tabular sm:inline">
              · {formatTimeOfDay(new Date(t).toISOString())} · change {count} of {updates.length}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-fg-muted" id="speed-label">
                Speed
              </span>
              <Segmented
                aria-label="Playback speed"
                size="sm"
                value={speed}
                onValueChange={setSpeed}
                options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
