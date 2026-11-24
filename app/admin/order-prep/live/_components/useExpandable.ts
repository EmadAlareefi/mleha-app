'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const OPEN_MS = 560;
const CLOSE_MS = 440;
// Fast start, long soft landing: reads as a spring without overshooting the screen edge.
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

type Box = { top: number; left: number; right: number; bottom: number };

function boxOf(rect: DOMRect): Box {
  const root = document.documentElement;
  return { top: rect.top, left: rect.left, right: root.clientWidth - rect.right, bottom: root.clientHeight - rect.bottom };
}

function px(box: Box) {
  return { top: `${box.top}px`, left: `${box.left}px`, right: `${box.right}px`, bottom: `${box.bottom}px` };
}

/**
 * Lets a card grow from its spot in the grid to fill the screen and shrink
 * back into place. The card stays mounted the whole time (no portal), so its
 * filters, scroll and open menus survive; a placeholder holds its grid slot.
 */
export function useExpandable() {
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const animating = useRef(false);
  const unlock = useRef<(() => void) | null>(null);

  const lockScroll = () => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    unlock.current = () => {
      root.style.overflow = previous;
      unlock.current = null;
    };
  };

  const open = useCallback(() => {
    const section = sectionRef.current;
    if (!section || animating.current) return;
    lockScroll();
    const rect = section.getBoundingClientRect();
    const from = boxOf(rect);
    flushSync(() => {
      setSize({ width: rect.width, height: rect.height });
      setExpanded(true);
    });
    buttonRef.current?.focus({ preventScroll: true });
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const to = boxOf(section.getBoundingClientRect());
    const radius = getComputedStyle(section).borderRadius;
    animating.current = true;
    const morph = section.animate(
      [
        { ...px(from), borderRadius: '16px' },
        { ...px(to), borderRadius: radius },
      ],
      { duration: OPEN_MS, easing: EASE },
    );
    backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.7, easing: 'ease-out' });
    // Rows reflow as the card widens; a soft fade hides the shuffle.
    section.querySelector('[data-panel-body]')?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: OPEN_MS, easing: 'ease-out' });
    const done = () => (animating.current = false);
    morph.onfinish = done;
    morph.oncancel = done;
  }, []);

  const close = useCallback(() => {
    const section = sectionRef.current;
    const placeholder = placeholderRef.current;
    if (!section || animating.current) return;
    const finish = () => {
      flushSync(() => setExpanded(false));
      unlock.current?.();
      animating.current = false;
      buttonRef.current?.focus({ preventScroll: true });
    };
    if (!placeholder || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return finish();

    const from = boxOf(section.getBoundingClientRect());
    const to = boxOf(placeholder.getBoundingClientRect());
    animating.current = true;
    const morph = section.animate(
      [
        { ...px(from), borderRadius: getComputedStyle(section).borderRadius },
        { ...px(to), borderRadius: '16px' },
      ],
      { duration: CLOSE_MS, easing: EASE, fill: 'forwards' },
    );
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards' });
    section.querySelector('[data-panel-body]')?.animate([{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], { duration: CLOSE_MS, easing: 'ease-in-out' });
    morph.onfinish = () => {
      finish();
      morph.cancel(); // drop the held end frame now that the card is back in the grid
    };
    morph.oncancel = () => (animating.current = false);
  }, []);

  const toggle = useCallback(() => (expanded ? close() : open()), [expanded, open, close]);

  // Esc shrinks the card, unless a dialog or sheet opened from inside it is on top.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, close]);

  useEffect(() => () => unlock.current?.(), []);

  return { expanded, size, toggle, close, sectionRef, placeholderRef, backdropRef, buttonRef };
}
