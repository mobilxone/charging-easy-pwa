const CACHE_NAME = "charging-easy-pwa-v21";
const APP_SHELL = [
  "/pwa/index.html",
  "/pwa/styles.css?v=1.4.5",
  "/pwa/cloud.js",
  "/pwa/app.js?v=1.4.5",
  "/pwa/manifest.webmanifest",
  "/pwa/icons/icon-192.png",
  "/pwa/icons/icon-512.png",
  "/pwa/icons/icon-maskable-512.png",
  "/pwa/icons/apple-touch-icon.png",
  "/pwa/personal-logo.png",
  "/pwa/startup/apple-launch-750x1334.png",
  "/pwa/startup/apple-launch-828x1792.png",
  "/pwa/startup/apple-launch-1125x2436.png",
  "/pwa/startup/apple-launch-1242x2688.png",
  "/pwa/startup/apple-launch-1170x2532.png",
  "/pwa/startup/apple-launch-1284x2778.png",
  "/pwa/startup/apple-launch-1179x2556.png",
  "/pwa/startup/apple-launch-1290x2796.png",
  "/pwa/startup/apple-launch-1206x2622.png",
  "/pwa/startup/apple-launch-1320x2868.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/pwa/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/pwa/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
