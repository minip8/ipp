'use client';
import { YDOC } from '@ipp/contracts';
import {
  ArrowUpRightIcon,
  CircleIcon,
  EraserIcon,
  HandIcon,
  MinusIcon,
  MousePointer2Icon,
  PencilIcon,
  Redo2Icon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePad } from './session';
import { parseShape, readShapes, type Shape, type ShapeColor } from './yjs-guards';

/**
 * Collaborative whiteboard stored in the pad's Y.Map "drawing" (one entry per shape, plain JSON),
 * so every participant sees strokes live and the report keeps them.
 */
type Color = ShapeColor;

export type { Shape };

type Tool = 'select' | 'hand' | 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser';

const COLORS: Record<Color, string> = {
  ink: 'var(--fg)',
  blue: 'var(--accent)',
  red: 'var(--bad)',
  green: 'var(--ok)',
  amber: 'var(--warn)',
};
const TOOLS: { id: Tool; label: string; key: string; icon: typeof PencilIcon }[] = [
  { id: 'select', label: 'Select and move', key: 'V', icon: MousePointer2Icon },
  { id: 'hand', label: 'Pan', key: 'H', icon: HandIcon },
  { id: 'pen', label: 'Pen', key: 'P', icon: PencilIcon },
  { id: 'line', label: 'Line', key: 'L', icon: MinusIcon },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: ArrowUpRightIcon },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: SquareIcon },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: CircleIcon },
  { id: 'text', label: 'Text', key: 'T', icon: TypeIcon },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: EraserIcon },
];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function penPath(pts: number[]): string {
  if (pts.length < 4) return pts.length === 2 ? `M${pts[0]} ${pts[1]}l0.01 0` : '';
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = ((pts[i] ?? 0) + (pts[i + 2] ?? 0)) / 2;
    const my = ((pts[i + 1] ?? 0) + (pts[i + 3] ?? 0)) / 2;
    d += ` Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  d += ` L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
  return d;
}

function bbox(s: Shape) {
  if (s.type === 'pen') {
    const xs = s.points.filter((_, i) => i % 2 === 0);
    const ys = s.points.filter((_, i) => i % 2 === 1);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  if (s.type === 'text')
    return { x1: s.x, y1: s.y - 18, x2: s.x + Math.max(20, s.text.length * 9), y2: s.y + 6 };
  return {
    x1: Math.min(s.x1, s.x2),
    y1: Math.min(s.y1, s.y2),
    x2: Math.max(s.x1, s.x2),
    y2: Math.max(s.y1, s.y2),
  };
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTest(s: Shape, x: number, y: number, tol: number): boolean {
  switch (s.type) {
    case 'pen':
      for (let i = 0; i + 3 < s.points.length; i += 2)
        if (
          distToSegment(
            x,
            y,
            s.points[i] ?? 0,
            s.points[i + 1] ?? 0,
            s.points[i + 2] ?? 0,
            s.points[i + 3] ?? 0,
          ) <=
          tol + s.width / 2
        )
          return true;
      return (
        s.points.length === 2 && Math.hypot(x - (s.points[0] ?? 0), y - (s.points[1] ?? 0)) <= tol
      );
    case 'line':
    case 'arrow':
      return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= tol + s.width / 2;
    case 'rect': {
      const b = bbox(s);
      const inside = x >= b.x1 - tol && x <= b.x2 + tol && y >= b.y1 - tol && y <= b.y2 + tol;
      const innerFar = x > b.x1 + tol && x < b.x2 - tol && y > b.y1 + tol && y < b.y2 - tol;
      return inside && !innerFar;
    }
    case 'ellipse': {
      const b = bbox(s);
      const rx = (b.x2 - b.x1) / 2 || 1;
      const ry = (b.y2 - b.y1) / 2 || 1;
      const cx = b.x1 + rx;
      const cy = b.y1 + ry;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= tol + s.width;
    }
    case 'text': {
      const b = bbox(s);
      return x >= b.x1 - tol && x <= b.x2 + tol && y >= b.y1 - tol && y <= b.y2 + tol;
    }
  }
}

function translate(s: Shape, dx: number, dy: number): Shape {
  if (s.type === 'pen')
    return { ...s, points: s.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
  if (s.type === 'text') return { ...s, x: s.x + dx, y: s.y + dy };
  return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
}

function ShapeView({ s, selected }: { s: Shape; selected: boolean }) {
  const stroke = COLORS[s.color] ?? COLORS.ink;
  const common = {
    stroke,
    strokeWidth: s.width,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  let el: React.ReactNode;
  switch (s.type) {
    case 'pen':
      el = <path d={penPath(s.points)} {...common} />;
      break;
    case 'line':
      el = <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} />;
      break;
    case 'arrow': {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const h = 8 + s.width * 2;
      el = (
        <g>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} />
          <path
            d={`M${s.x2 - h * Math.cos(a - 0.45)} ${s.y2 - h * Math.sin(a - 0.45)} L${s.x2} ${s.y2} L${s.x2 - h * Math.cos(a + 0.45)} ${s.y2 - h * Math.sin(a + 0.45)}`}
            {...common}
          />
        </g>
      );
      break;
    }
    case 'rect': {
      const b = bbox(s);
      el = <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} rx={4} {...common} />;
      break;
    }
    case 'ellipse': {
      const b = bbox(s);
      el = (
        <ellipse
          cx={(b.x1 + b.x2) / 2}
          cy={(b.y1 + b.y2) / 2}
          rx={(b.x2 - b.x1) / 2}
          ry={(b.y2 - b.y1) / 2}
          {...common}
        />
      );
      break;
    }
    case 'text':
      el = (
        <text
          x={s.x}
          y={s.y}
          fill={stroke}
          fontSize={16 + (s.width - 2) * 2}
          fontFamily="var(--font-sans)"
          style={{ whiteSpace: 'pre' }}
        >
          {s.text}
        </text>
      );
      break;
  }
  if (!selected) return <>{el}</>;
  const b = bbox(s);
  return (
    <g>
      {el}
      <rect
        x={b.x1 - 6}
        y={b.y1 - 6}
        width={b.x2 - b.x1 + 12}
        height={b.y2 - b.y1 + 12}
        rx={4}
        fill="none"
        stroke="var(--accent)"
        strokeDasharray="4 3"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

export function Whiteboard({ active }: { active: boolean }) {
  const { collab, readOnly } = usePad();
  const map = useMemo(() => collab?.doc.getMap<unknown>(YDOC.drawing) ?? null, [collab]);
  const [undo, setUndo] = useState<Y.UndoManager | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<Color>('ink');
  const [width, setWidth] = useState(2);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number; sx: number; sy: number } | null>(
    null,
  );
  const [textValue, setTextValue] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    kind: 'draw' | 'move' | 'pan' | 'erase';
    sx: number;
    sy: number;
    last: { x: number; y: number };
    vx: number;
    vy: number;
  } | null>(null);
  const spaceDown = useRef(false);

  useEffect(() => {
    if (!map) return;
    const update = () => setShapes(readShapes(map.entries()));
    update();
    map.observe(update);
    return () => map.unobserve(update);
  }, [map]);
  // Created in an effect (not useMemo) so React's dev double-mount cannot leave it destroyed.
  useEffect(() => {
    if (!map) return;
    const u = new Y.UndoManager(map, { trackedOrigins: new Set(['wb']), captureTimeout: 300 });
    setUndo(u);
    return () => {
      u.destroy();
      setUndo(null);
    };
  }, [map]);

  const write = useCallback((fn: () => void) => map?.doc?.transact(fn, 'wb'), [map]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = svg.current?.getBoundingClientRect();
    return {
      x: (e.clientX - (r?.left ?? 0) - view.x) / view.k,
      y: (e.clientY - (r?.top ?? 0) - view.y) / view.k,
    };
  };

  const effectiveTool: Tool = readOnly && tool !== 'hand' ? 'hand' : tool;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    svg.current?.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    const base = { sx: e.clientX, sy: e.clientY, last: p, vx: view.x, vy: view.y };
    if (e.button === 1 || spaceDown.current || effectiveTool === 'hand') {
      drag.current = { kind: 'pan', ...base };
      return;
    }
    if (effectiveTool === 'text') {
      const r = svg.current?.getBoundingClientRect();
      setTextAt({ x: p.x, y: p.y, sx: e.clientX - (r?.left ?? 0), sy: e.clientY - (r?.top ?? 0) });
      setTextValue('');
      return;
    }
    if (effectiveTool === 'select') {
      const hit = [...shapes].reverse().find((s) => hitTest(s, p.x, p.y, 6 / view.k));
      setSelected(hit?.id ?? null);
      if (hit) drag.current = { kind: 'move', ...base };
      return;
    }
    if (effectiveTool === 'eraser') {
      drag.current = { kind: 'erase', ...base };
      eraseAt(p);
      return;
    }
    const z = Date.now();
    const s: Shape =
      effectiveTool === 'pen'
        ? { id: uid(), z, color, width, type: 'pen', points: [p.x, p.y] }
        : { id: uid(), z, color, width, type: effectiveTool, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    setDraft(s);
    drag.current = { kind: 'draw', ...base };
  };

  const eraseAt = (p: { x: number; y: number }) => {
    const hits = shapes.filter((s) => hitTest(s, p.x, p.y, 8 / view.k));
    if (hits.length)
      write(() => {
        for (const h of hits) map?.delete(h.id);
      });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toWorld(e);
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }));
      return;
    }
    if (d.kind === 'erase') return eraseAt(p);
    if (d.kind === 'move' && selected) {
      const s = parseShape(selected, map?.get(selected));
      if (s) write(() => map?.set(selected, translate(s, p.x - d.last.x, p.y - d.last.y)));
      d.last = p;
      return;
    }
    if (d.kind === 'draw')
      setDraft((cur) => {
        if (!cur) return cur;
        if (cur.type === 'pen') return { ...cur, points: [...cur.points, p.x, p.y] };
        if (cur.type === 'text') return cur;
        const s = { ...cur, x2: p.x, y2: p.y };
        if (e.shiftKey && (cur.type === 'rect' || cur.type === 'ellipse')) {
          const size = Math.max(Math.abs(p.x - cur.x1), Math.abs(p.y - cur.y1));
          s.x2 = cur.x1 + Math.sign(p.x - cur.x1 || 1) * size;
          s.y2 = cur.y1 + Math.sign(p.y - cur.y1 || 1) * size;
        }
        return s;
      });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'draw' && draft) {
      const tiny =
        draft.type !== 'pen' &&
        draft.type !== 'text' &&
        Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 3;
      if (!tiny) write(() => map?.set(draft.id, draft));
      setDraft(null);
    }
  };

  const commitText = () => {
    if (textAt && textValue.trim()) {
      const s: Shape = {
        id: uid(),
        z: Date.now(),
        color,
        width,
        type: 'text',
        x: textAt.x,
        y: textAt.y + 6,
        text: textValue.slice(0, 500),
      };
      write(() => map?.set(s.id, s));
    }
    setTextAt(null);
  };

  const zoom = (factor: number, cx?: number, cy?: number) =>
    setView((v) => {
      const k = Math.min(4, Math.max(0.25, v.k * factor));
      const r = svg.current?.getBoundingClientRect();
      const px = cx ?? (r?.width ?? 0) / 2;
      const py = cy ?? (r?.height ?? 0) / 2;
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const r = svg.current?.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0));
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  // Tool keys while the board has focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (textAt) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) undo?.redo();
      else undo?.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      undo?.redo();
      return;
    }
    if (e.key === ' ') spaceDown.current = true;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !readOnly) {
      write(() => map?.delete(selected));
      setSelected(null);
      return;
    }
    if (mod || e.altKey) return;
    const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
    if (t) setTool(t.id);
    if (e.key === 'Escape') setSelected(null);
  };

  const cursor =
    effectiveTool === 'hand'
      ? 'grab'
      : effectiveTool === 'select'
        ? 'default'
        : effectiveTool === 'text'
          ? 'text'
          : 'crosshair';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard tool shortcuts for the board container
    <div
      className={cn('relative h-full overflow-hidden bg-editor', !active && 'hidden')}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        if (e.key === ' ') spaceDown.current = false;
      }}
    >
      <svg
        ref={svg}
        role="img"
        aria-label={`Whiteboard with ${shapes.length} ${shapes.length === 1 ? 'shape' : 'shapes'}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas takes keyboard tool shortcuts
        tabIndex={0}
        className="size-full touch-none outline-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <defs>
          <pattern
            id="wb-dots"
            width={24 * view.k}
            height={24 * view.k}
            patternUnits="userSpaceOnUse"
            x={view.x}
            y={view.y}
          >
            <circle cx={1} cy={1} r={1} fill="var(--border-strong)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#wb-dots)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {shapes.map((s) => (
            <ShapeView key={s.id} s={s} selected={s.id === selected} />
          ))}
          {draft && <ShapeView s={draft} selected={false} />}
        </g>
      </svg>

      {textAt && (
        <input
          // biome-ignore lint/a11y/noAutofocus: the user just clicked to place text
          autoFocus
          aria-label="Text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitText();
            if (e.key === 'Escape') setTextAt(null);
          }}
          onBlur={commitText}
          className="absolute rounded-sm border border-accent bg-surface px-1 text-base text-fg outline-none"
          style={{ left: textAt.sx, top: textAt.sy - 14, minWidth: 120 }}
          placeholder="Type, then Enter"
        />
      )}

      {/* Toolbar */}
      <div
        className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-pop"
        role="toolbar"
        aria-label="Whiteboard tools"
      >
        {TOOLS.map((t) => (
          <Tooltip key={t.id} label={t.label} shortcut={t.key}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t.label}
              aria-pressed={effectiveTool === t.id}
              disabled={readOnly && t.id !== 'hand'}
              onClick={() => setTool(t.id)}
              className={cn(
                effectiveTool === t.id &&
                  'bg-accent-soft text-accent-text hover:bg-accent-soft hover:text-accent-text',
              )}
            >
              <t.icon />
            </Button>
          </Tooltip>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <div className="flex items-center gap-1 px-1" role="radiogroup" aria-label="Colour">
          {(Object.keys(COLORS) as Color[]).map((c) => (
            // biome-ignore lint/a11y/useSemanticElements: a swatch button styled as a radio, like a segmented control
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c === 'ink' ? 'Ink' : c[0]?.toUpperCase() + c.slice(1)}
              onClick={() => setColor(c)}
              disabled={readOnly}
              className={cn(
                'size-5 rounded-full border-2 transition-transform',
                color === c ? 'scale-110 border-accent' : 'border-transparent hover:scale-110',
              )}
            >
              <span className="block size-full rounded-full" style={{ background: COLORS[c] }} />
            </button>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <div className="flex items-center" role="radiogroup" aria-label="Stroke width">
          {[2, 4, 6].map((w) => (
            // biome-ignore lint/a11y/useSemanticElements: a stroke button styled as a radio
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={width === w}
              aria-label={`Stroke ${w}`}
              disabled={readOnly}
              onClick={() => setWidth(w)}
              className={cn(
                'flex size-7 items-center justify-center rounded-md hover:bg-surface-3',
                width === w && 'bg-surface-3',
              )}
            >
              <span className="rounded-full bg-fg" style={{ width: 14, height: w }} />
            </button>
          ))}
        </div>
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-pop">
        <Tooltip label="Undo" shortcut="Mod+Z" side="top">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Undo"
            disabled={readOnly}
            onClick={() => undo?.undo()}
          >
            <Undo2Icon />
          </Button>
        </Tooltip>
        <Tooltip label="Redo" shortcut="Mod+Shift+Z" side="top">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Redo"
            disabled={readOnly}
            onClick={() => undo?.redo()}
          >
            <Redo2Icon />
          </Button>
        </Tooltip>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Tooltip label="Zoom out" side="top">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => zoom(1 / 1.2)}
          >
            <ZoomOutIcon />
          </Button>
        </Tooltip>
        <button
          type="button"
          onClick={() => setView({ x: 0, y: 0, k: 1 })}
          className="w-12 rounded-md py-1 text-xs text-fg-muted tabular hover:bg-surface-3"
          aria-label="Reset zoom"
        >
          {Math.round(view.k * 100)}%
        </button>
        <Tooltip label="Zoom in" side="top">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoom(1.2)}>
            <ZoomInIcon />
          </Button>
        </Tooltip>
      </div>

      {!readOnly && shapes.length > 0 && (
        <div className="absolute right-3 bottom-3">
          {confirmClear ? (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1 pl-3 text-xs shadow-pop">
              Clear the board for everyone?
              <Button
                size="xs"
                variant="danger"
                onClick={() => {
                  write(() => {
                    for (const k of [...(map?.keys() ?? [])]) map?.delete(k);
                  });
                  setConfirmClear(false);
                }}
              >
                Clear
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmClear(true)}
              className="shadow-pop"
            >
              <Trash2Icon /> Clear
            </Button>
          )}
        </div>
      )}

      {shapes.length === 0 && !draft && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-fg-subtle">
          Sketch your data structures, draw the recursion tree, or walk through an example.
          <br />
          Everyone in the pad sees it live.
        </p>
      )}
    </div>
  );
}
