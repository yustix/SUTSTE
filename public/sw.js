/* SUT STE - Service Worker
   Estrategia: app shell con cache, navegacion red-primero con respaldo,
   API siempre en red (la consistencia la garantiza la cola de sincronizacion). */

const VERSION = "sut-ste-v2";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const PRECACHE = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

// Activos pesados del OCR: se precargan en segundo plano y quedan en caché para siempre.
const OCR_CACHE = `${VERSION}-ocr`;
const OCR_ASSETS = [
  "/ocr/worker.min.js",
  "/ocr/core/tesseract-core-simd-lstm.wasm.js",
  "/ocr/lang/spa.traineddata.gz",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
  // Precarga diferida: no bloquea la instalación
  event.waitUntil(
    caches.open(OCR_CACHE).then((c) =>
      Promise.all(OCR_ASSETS.map((u) => fetch(u).then((r) => (r.ok ? c.put(u, r) : undefined)).catch(() => undefined))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // nunca cachear API

  // Navegacion: red primero, respaldo en cache (offline)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || caches.match(req))),
    );
    return;
  }

  // OCR: caché primero sin revalidación (archivos grandes e inmutables)
  if (url.pathname.startsWith("/ocr/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(OCR_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Assets: cache primero con revalidación en segundo plano
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(ASSETS).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
