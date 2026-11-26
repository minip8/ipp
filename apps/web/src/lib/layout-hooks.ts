'use client';
/** Layout hooks the track tabs share: their sticky setup panels and phones' bottom bars. */
import { type RefObject, useEffect, useState } from 'react';

/** Whether any of the element is on screen. */
export function useOnScreen(ref: RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) =>
      setOnScreen(Boolean(entries[entries.length - 1]?.isIntersecting)),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return onScreen;
}

/**
 * Keeps a sticky side panel no taller than the room between its top edge and the bottom of the
 * window. CSS alone cannot: before the panel sticks it starts lower on the page (under the page
 * title), so a fixed `100dvh - offset` either overflows at the top of the page or wastes space
 * once stuck. Only on the two-column layout; on phones the panel is in the page flow.
 */
export function useFitBelow(ref: RefObject<HTMLElement | null>, gap = 16) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const twoColumns = window.matchMedia('(min-width: 1024px)');
    let frame = 0;
    const measure = () => {
      frame = 0;
      el.style.maxHeight = twoColumns.matches
        ? `${Math.max(240, window.innerHeight - el.getBoundingClientRect().top - gap)}px`
        : '';
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    // Content above the panel can arrive later (interviews in progress) and push it down.
    const layout = new ResizeObserver(schedule);
    layout.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    twoColumns.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(frame);
      layout.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      twoColumns.removeEventListener('change', schedule);
    };
  }, [ref, gap]);
}
