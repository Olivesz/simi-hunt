// Minimal service worker: caches the app shell only.
// Shell files are served network-first, so edits show up on the next load and
// the cached copy is used only when offline. Everything else (modules, data,
// art, map tiles, CDN libraries) goes straight to the network.

const CACHE = 'simihunt-shell-v1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/main.js',
  './js/router.js',
  './js/state.js',
  './js/data.js',
  './manifest.webmanifest',
];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.location).href));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.hash = '';
  const scope = new URL('./', self.location).href;
  const isNav = req.mode === 'navigate' && (url.href.split('?')[0] === scope || url.href.split('?')[0] === scope + 'index.html');
  if (!isNav && !SHELL_URLS.has(url.href)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(isNav ? new URL('./index.html', self.location).href : req, res.clone());
      return res;
    } catch {
      return (await cache.match(isNav ? new URL('./index.html', self.location).href : req)) || Response.error();
    }
  })());
});
