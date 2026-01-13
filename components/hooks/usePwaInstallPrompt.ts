'use client';

import { useCallback, useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function resolveStandaloneState() {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  const mediaQuery = window.matchMedia?.("(display-mode: standalone)");
  return Boolean(navigatorStandalone) || Boolean(mediaQuery?.matches);
}

export function usePwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(resolveStandaloneState());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery =
      typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)") : null;
    const onDisplayModeChange = () => setIsInstalled(resolveStandaloneState());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    const addDisplayModeListener = () => {
      if (!mediaQuery) {
        return;
      }

      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", onDisplayModeChange);
      } else if (typeof mediaQuery.addListener === "function") {
        mediaQuery.addListener(onDisplayModeChange);
      }
    };

    const removeDisplayModeListener = () => {
      if (!mediaQuery) {
        return;
      }

      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", onDisplayModeChange);
      } else if (typeof mediaQuery.removeListener === "function") {
        mediaQuery.removeListener(onDisplayModeChange);
      }
    };

    addDisplayModeListener();

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      removeDisplayModeListener();
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const requestInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return false;
    }

    deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;
    setDeferredPrompt(null);

    if (choiceResult.outcome === "accepted") {
      setIsInstalled(true);
      return true;
    }

    return false;
  }, [deferredPrompt]);

  const showInstallButton = useMemo(() => !isInstalled, [isInstalled]);

  return {
    isInstalled,
    isInstallPromptReady: Boolean(deferredPrompt),
    requestInstall,
    showInstallButton,
  };
}
