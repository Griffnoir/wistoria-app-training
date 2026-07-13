const CACHE_NAME = "wistoria-training-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./dashboard.html",
  "./workout.html",
  "./session.html",
  "./music.html",
  "./manual.html",
  "./calendar.html",
  "./statistics.html",
  "./settings.html",
  "./manifest.json",
  "./css/style.css",
  "./css/dashboard.css",
  "./css/workout.css",
  "./css/music.css",
  "./css/manual.css",
  "./css/animations.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/storage.js",
  "./js/timer.js",
  "./js/workout.js",
  "./js/calendar.js",
  "./js/statistics.js",
  "./js/sound.js",
  "./js/music.js",
  "./js/manual.js",
  "./js/animation.js",
  "./js/notifications.js",
  "./js/vendor/chart.umd.min.js",
  "./assets/icons/icon.svg",
  "./assets/images/martial-flow.svg",
  "./assets/images/stretch-hips.svg",
  "./assets/images/stretch-split.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
