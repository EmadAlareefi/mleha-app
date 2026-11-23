'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

function readPref(key: string, fallback: boolean) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode: the toggle still works for this visit */
  }
}

/** A per-browser on/off preference, read after mount to avoid hydration mismatches. */
function usePref(key: string, fallback: boolean) {
  const [value, setValue] = useState(fallback);
  useEffect(() => setValue(readPref(key, fallback)), [key, fallback]);
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      writePref(key, next);
    },
    [key],
  );
  return [value, update] as const;
}

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener: (type: 'release', cb: () => void) => void };

/** Keeps the screen from sleeping while the page is visible. Re-acquires after the tab comes back. */
export function useWakeLock() {
  const [enabled, setEnabled] = usePref('warehouse-live:wake-lock', true);
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && 'wakeLock' in navigator);
  }, []);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const wakeLock = (navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;

    const acquire = async () => {
      if (!enabled || document.visibilityState !== 'visible' || sentinel.current) return;
      try {
        const lock = await wakeLock.request('screen');
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel.current = lock;
        setActive(true);
        lock.addEventListener('release', () => {
          sentinel.current = null;
          setActive(false);
        });
      } catch {
        setActive(false);
      }
    };

    const onVisible = () => void acquire();
    if (enabled) void acquire();
    else if (sentinel.current) void sentinel.current.release();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, supported]);

  // Release on unmount.
  useEffect(() => () => void sentinel.current?.release(), []);

  return { supported, enabled, active, setEnabled };
}

/**
 * A short two-note chime made with Web Audio (no sound file). Browsers only
 * allow audio after the person has interacted with the page, so the audio
 * context is unlocked on the first click or key press.
 */
export function useChime() {
  const [enabled, setEnabled] = usePref('warehouse-live:sound', true);
  const [unlocked, setUnlocked] = useState(false);
  const context = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlock = () => {
      try {
        context.current ??= new AudioContext();
        void context.current.resume().then(() => setUnlocked(context.current?.state === 'running'));
      } catch {
        /* no Web Audio */
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const play = useCallback(() => {
    const ctx = context.current;
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const start = ctx.currentTime;
    [880, 1318.5].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const t = start + index * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  }, [enabled]);

  return { enabled, unlocked, setEnabled, play };
}
