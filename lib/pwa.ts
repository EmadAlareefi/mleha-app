// Pure helpers for the "install the app" flow. Kept free of React and of
// browser globals so they can be unit-tested with node:test.

export type InstallPlatform = 'ios' | 'android' | 'desktop';

export const INSTALL_DISMISS_KEY = 'pwa-install-dismissed-at';
/** After "x" on the badge, stay quiet for a week. */
export const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export function detectInstallPlatform(
  userAgent: string,
  platform = '',
  maxTouchPoints = 0
): InstallPlatform {
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  if (/iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/.test(userAgent)) return 'android';
  return 'desktop';
}

/** iOS only lets Safari add to the home screen (Chrome/Firefox on iOS 16.4+ can too, via Share). */
export function isIosInAppBrowser(userAgent: string) {
  return /FBAN|FBAV|Instagram|Snapchat|Line\/|TikTok|musical_ly/i.test(userAgent);
}

export function isSnoozed(dismissedAt: string | null | undefined, now: number) {
  const at = Number(dismissedAt || 0);
  return Number.isFinite(at) && at > 0 && now - at < INSTALL_SNOOZE_MS;
}

/**
 * Whether an "install" entry point is worth showing. Android and desktop
 * Chrome/Edge hand us a native prompt; iOS never does, so we show the
 * Share -> Add to Home Screen steps instead. Android browsers without the
 * prompt (Samsung Internet, Firefox) get the browser-menu steps.
 */
export function canOfferInstall(opts: {
  installed: boolean;
  hasPrompt: boolean;
  platform: InstallPlatform;
}) {
  if (opts.installed) return false;
  return opts.hasPrompt || opts.platform !== 'desktop';
}

/** Routes where the floating badge must never appear. */
export function isInstallBadgeSuppressed(pathname: string) {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/embed') ||
    // Full-screen warehouse TV dashboard.
    pathname.startsWith('/admin/order-prep/live')
  );
}
