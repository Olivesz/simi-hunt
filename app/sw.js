// Service worker: lets a phone that has opened the app once reload it on a
// dropped network, with its modules, game data and Simi art.
//
// Same-origin GETs are network-first, revalidated with the server each time, so
// edits show up on the next load and every file comes from the same version.
// The cached copy answers when the network fails, or when it stalls for more
// than NET_TIMEOUT_MS. Third-party requests (CDN libraries, map tiles, fonts)
// are left to the browser's HTTP cache.
//
// Bump CACHE for each demo build so a rehearsal never mixes two versions.

const CACHE = 'simihunt-v2';
const NET_TIMEOUT_MS = 4000;

const JS = ['main', 'router', 'state', 'data', 'map', 'spawns', 'encounter', 'qr', 'claim', 'unlock', 'shelf', 'simidex'];
const CSS = ['app', 'map', 'encounter', 'shelf', 'simidex'];
const DATA = [
  'simis.json', 'products.json', 'codes.json',
  'region-austin.json', 'stores-austin.json', 'pois-austin.geojson', 'demo-route-austin.geojson',
  'region-lasvegas.json', 'stores-lasvegas.json', 'pois-lasvegas.geojson', 'demo-route-lasvegas.geojson',
];
const SIMIS = [
  'classic', 'gym', 'sleepy', 'futbol', 'bombero', 'chef', 'beisbolista',
  'beach', 'spa', 'astronaut', 'flu', 'boxeador',
  'texas', 'rockstar', 'mariachi',
  'muertos', 'luchador', 'santa',
];
// The map's player avatar frames (art/player/AVATAR.md).
const PLAYER = ['heading', 'shadow', ...['idle', 'walk1', 'walk2'].flatMap((f) => [f, `${f}-green`, `${f}-red`])];
const PRECACHE = [
  './index.html',
  './manifest.webmanifest',
  './map/style.json',
  './keys/public.jwk',
  ...JS.map((n) => `./js/${n}.js`),
  ...CSS.map((n) => `./css/${n}.css`),
  ...DATA.map((n) => `./data/${n}`),
  '../art/base/simi-base.svg',
  ...SIMIS.map((id) => `../art/simis/${id}.svg`),
  ...PLAYER.map((n) => `../art/player/${n}.svg`),
];

const SCOPE = new URL('./', self.location).href;
const INDEX = new URL('./index.html', self.location).href;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One by one, so a file that doesn't exist yet can't fail the whole install.
    await Promise.all(PRECACHE.map(async (p) => {
      try {
        const res = await fetch(new URL(p, self.location), { cache: 'no-cache' });
        if (res.ok) await cache.put(new URL(p, self.location).href, res);
      } catch { /* offline or missing: cached later on first use */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('simihunt-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  url.hash = '';
  const path = url.href.split('?')[0];
  // The app page itself, with any ?demo=1&presenter=1 flags, maps to one cache entry.
  const isAppPage = req.mode === 'navigate' && (path === SCOPE || path === INDEX);
  const key = isAppPage ? INDEX : url.href;

  let saved = Promise.resolve();
  const net = (req.mode === 'navigate'
    ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(req, { cache: 'no-cache' })
  ).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      saved = caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    return res;
  });
  e.waitUntil(net.then(() => saved, () => {}));
  e.respondWith(answer(net, key));
});

async function answer(net, key) {
  const cached = await (await caches.open(CACHE)).match(key);
  if (!cached) return net.catch(() => Response.error());
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(cached), NET_TIMEOUT_MS);
    net.then(
      (res) => { clearTimeout(timer); resolve(res.status >= 500 ? cached : res); },
      () => { clearTimeout(timer); resolve(cached); },
    );
  });
}
