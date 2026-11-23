// متجر مليحة — service worker.
//
// Pages and API calls always come from the network: this is a staff tool over
// live order data, so a cached page would show stale orders (and could leak one
// user's page to the next person on a shared phone). The worker only adds:
//   - an offline page when the phone has no connection,
//   - navigation preload, so the worker never slows page loads down.
// /_next/static files are content-hashed and already cached by the browser for
// a year, so the worker leaves them alone too.
//
// Bump REVISION whenever this file's logic or the precached assets change.
const REVISION = "2026-11-23";
const SHELL = `mleha-shell-${REVISION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/pwa/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Also drops the old mleha-static-*/mleha-runtime-* caches, which held HTML pages.
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        return preloaded || (await fetch(request));
      } catch {
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })()
  );
});
