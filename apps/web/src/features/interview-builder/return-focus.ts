'use client';
/**
 * Where focus goes when one of the builder's dialogs closes. A Radix dialog with no trigger of
 * its own (these are opened from a menu, a button or an edit) would leave focus on the page's
 * body: instead it goes back to what had it when the dialog opened, or, when that has gone (the
 * Save button once the plan is saved, a deleted plan's menu), to the card now chosen.
 */
import { useLayoutEffect, useRef } from 'react';

export function focusChosenCard() {
  document
    .querySelector<HTMLElement>('[data-testid="presets"] [role="radio"][aria-checked="true"]')
    ?.focus();
}

/** The dialog's `onCloseAutoFocus` while `open` says whether it is open. */
export function useReturnFocus(open: boolean) {
  const from = useRef<HTMLElement | null>(null);
  // Before the dialog's own focus moves (a layout effect runs before every passive one).
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement)
      from.current = document.activeElement;
  }, [open]);
  return (e: Event) => {
    e.preventDefault();
    const el = from.current;
    from.current = null;
    if (el?.isConnected) el.focus();
    else focusChosenCard();
  };
}
