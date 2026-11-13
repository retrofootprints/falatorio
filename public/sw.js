// Minimal offline support.
// - App shell (same origin): network-first for pages, cache-first for hashed assets.
// - ONNX Runtime + Piper phonemizer runtimes on jsDelivr/cdnjs: cache-first.
// Model weights are NOT handled here: Transformers.js / kokoro-js keep them in
// Cache Storage and Piper keeps them in OPFS.
//
// It also adds COOP/COEP headers to same-origin responses (GitHub Pages can't
// set headers), which makes the page cross-origin isolated so ONNX Runtime can
// use multithreaded WASM. All cross-origin loads (Hugging Face, jsDelivr) are
// CORS fetches, which "require-corp" allows.
const SHELL = 'falatorio-shell-v2';
const CDN = 'falatorio-cdn-v1';
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './favicon.svg'])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('./', res.clone());
    return res;
  } catch {
    return (await cache.match('./')) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') e.respondWith(networkFirst(req).then(isolate));
    else e.respondWith(cacheFirst(req, SHELL).then(isolate));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req, CDN));
  }
});
