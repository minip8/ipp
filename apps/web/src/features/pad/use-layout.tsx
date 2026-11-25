'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DESKTOP_QUERY, keyboardBox } from './layout';

function subscribeDesktop(cb: () => void) {
  const m = window.matchMedia(DESKTOP_QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

/**
 * Whether the pad gets its three-column desktop layout. The pad only renders in the browser (it
 * waits for the session and the pad's data), so the first render already has the right answer:
 * no flash of the wrong layout. The server snapshot is only a fallback.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

/**
 * While the on-screen keyboard is open, the part of the screen left above it (see keyboardBox).
 * Null when it is closed, or when `enabled` is false (the desktop layout).
 */
export function useKeyboardBox(enabled: boolean): { height: number; top: number } | null {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) {
      setBox(null);
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = keyboardBox(window.innerHeight, vv);
        setBox((cur) =>
          cur === next || (cur && next && cur.height === next.height && cur.top === next.top)
            ? cur
            : next,
        );
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [enabled]);
  return box;
}

/**
 * A DOM node created once and kept for the life of the component. Content is rendered into it
 * with a portal, and whichever layout is showing attaches the node where it wants it (PortalSlot),
 * so switching layouts moves the DOM without unmounting the React tree inside.
 */
export function usePortalNode(className: string): HTMLDivElement | null {
  const [node] = useState(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.className = className;
    return el;
  });
  return node;
}

/** Where a portal node from usePortalNode is shown in the current layout. */
export function PortalSlot({ node, className }: { node: HTMLElement | null; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !node) return;
    host.appendChild(node);
    return () => {
      if (node.parentNode === host) host.removeChild(node);
    };
  }, [node]);
  return <div ref={ref} className={className} />;
}
