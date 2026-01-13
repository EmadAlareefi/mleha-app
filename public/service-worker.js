const VERSION = "20240217";
const STATIC_CACHE = `mleha-static-${VERSION}`;
const RUNTIME_CACHE = `mleha-runtime-${VERSION}`;
const APP_SHELL = ["/", "/manifest.webmanifest", "/logo.png"];
const PASS_THROUGH_PATHS = [/^\/api\//];
const STATIC_FILE_EXTENSIONS = /\.(?:png|svg|ico|jpg|jpeg|webp|mp4|pdf|woff2?)$/i;
const STATIC_DESTINATIONS = new Set(["style", "script", "font", "image"]);

const OFFLINE_RESPONSE = new Response("لا يمكن تحميل الصفحة حالياً. يرجى المحاولة مرة أخرى.", {
  status: 503,
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (PASS_THROUGH_PATHS.some((pattern) => pattern.test(url.pathname))) {
    return;
  }

  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (STATIC_FILE_EXTENSIONS.test(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/image")) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }
});

async function networkFirst(request) {
  try {
    const freshResponse = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, freshResponse.clone());
    return freshResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    return cachedResponse || OFFLINE_RESPONSE;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cachedResponse);

  return cachedResponse || networkFetch;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const freshResponse = await fetch(request);
  if (freshResponse && freshResponse.status === 200) {
    cache.put(request, freshResponse.clone());
  }
  return freshResponse;
}
