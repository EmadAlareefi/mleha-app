'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { canOfferInstall, detectInstallPlatform, type InstallPlatform } from '@/lib/pwa';

export type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

declare global {
  interface Window {
    /** Captured by the inline script in app/layout.tsx, before React hydrates. */
    __installPrompt?: BeforeInstallPromptEvent | null;
  }
}

type InstallState = {
  installed: boolean;
  hasPrompt: boolean;
  platform: InstallPlatform;
  guideOpen: boolean;
};

const SERVER_STATE: InstallState = {
  installed: true, // render nothing install-related on the server
  hasPrompt: false,
  platform: 'desktop',
  guideOpen: false,
};

// One shared store: Chrome fires `beforeinstallprompt` once per page load,
// so every button and the badge must read the same captured event.
let state: InstallState = SERVER_STATE;
let initialised = false;
const listeners = new Set<() => void>();

function setState(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function init() {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;

  state = {
    installed: isStandalone(),
    hasPrompt: Boolean(window.__installPrompt),
    platform: detectInstallPlatform(
      navigator.userAgent,
      navigator.platform,
      navigator.maxTouchPoints
    ),
    guideOpen: false,
  };

  // The inline script captures the event; it re-dispatches `installable`.
  document.addEventListener('installable', () => setState({ hasPrompt: true }));
  window.addEventListener('appinstalled', () => {
    window.__installPrompt = null;
    setState({ installed: true, hasPrompt: false, guideOpen: false });
  });
  window
    .matchMedia?.('(display-mode: standalone)')
    .addEventListener?.('change', () => setState({ installed: isStandalone() }));
}

function subscribe(listener: () => void) {
  init();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => {
  init();
  return state;
};
const getServerSnapshot = () => SERVER_STATE;

export type InstallResult = 'accepted' | 'dismissed' | 'guide';

/** Opens the native install dialog, or our step-by-step guide when there is none. */
export async function requestInstall(): Promise<InstallResult> {
  const deferred = window.__installPrompt;
  if (!deferred) {
    setState({ guideOpen: true });
    return 'guide';
  }
  // A captured prompt can only be used once.
  window.__installPrompt = null;
  setState({ hasPrompt: false });
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  if (outcome === 'accepted') setState({ installed: true });
  return outcome;
}

export function setInstallGuideOpen(open: boolean) {
  setState({ guideOpen: open });
}

export function usePwaInstallPrompt() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const request = useCallback(() => requestInstall(), []);

  return {
    isInstalled: current.installed,
    isInstallPromptReady: current.hasPrompt,
    platform: current.platform,
    guideOpen: current.guideOpen,
    /** True when an install button would do something useful on this device. */
    showInstallButton: canOfferInstall({
      installed: current.installed,
      hasPrompt: current.hasPrompt,
      platform: current.platform,
    }),
    requestInstall: request,
  };
}
