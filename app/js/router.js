// Hash router. Routes and the module that renders each are fixed in CONTRACT.md.
// Query parameters after the path (e.g. #/unlock/beach?store=x&shelf=y) are
// merged into params next to the path parameters.

export const ROUTES = [
  { name: 'map', path: '/map', module: 'map' },
  { name: 'encounter', path: '/encounter/:spawnId', module: 'encounter' },
  { name: 'scan', path: '/scan', module: 'qr' },
  { name: 'claim', path: '/claim/:token', module: 'claim' },
  { name: 'unlock', path: '/unlock/:simiId', module: 'unlock' },
  { name: 'shelf', path: '/shelf/:storeId/:shelfType', module: 'shelf' },
  { name: 'dex', path: '/dex', module: 'simidex' },
  { name: 'dexEntry', path: '/dex/:simiId', module: 'simidex' },
  { name: 'stop', path: '/stop/:storeId', module: 'map' },
];

export const DEFAULT_HASH = '#/map';

const compiled = ROUTES.map((r) => {
  const keys = [];
  const re = new RegExp('^' + r.path.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { ...r, re, keys };
});

function decode(v) {
  try { return decodeURIComponent(v); } catch { return v; }
}

// Returns { name, module, params, hash } or null when nothing matches.
export function match(hash = location.hash) {
  const raw = (hash || '').replace(/^#/, '') || DEFAULT_HASH.slice(1);
  const qAt = raw.indexOf('?');
  const path = qAt === -1 ? raw : raw.slice(0, qAt);
  const query = qAt === -1 ? '' : raw.slice(qAt + 1);
  for (const r of compiled) {
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(new URLSearchParams(query));
    r.keys.forEach((k, i) => { params[k] = decode(m[i + 1]); });
    return { name: r.name, module: r.module, params, hash: '#' + raw };
  }
  return null;
}

export function current() {
  return match(location.hash) || match(DEFAULT_HASH);
}

const handlers = new Set();
// In-memory trail of visited hashes, so back() never leaves the app.
const trail = [];

function dispatch() {
  let route = match(location.hash);
  if (!route) {
    history.replaceState(null, '', DEFAULT_HASH);
    route = match(DEFAULT_HASH);
  }
  if (trail.length > 1 && trail[trail.length - 2] === route.hash) trail.pop();
  else if (trail[trail.length - 1] !== route.hash) trail.push(route.hash);
  for (const fn of [...handlers]) {
    try { fn(route); } catch (e) { console.error('[router] handler failed', e); }
  }
}

// go('#/dex') or go('/dex'). Re-dispatches when the hash is already current.
export function go(hash, { replace = false } = {}) {
  let h = String(hash || DEFAULT_HASH);
  if (!h.startsWith('#')) h = '#' + (h.startsWith('/') ? h : '/' + h);
  if (location.hash === h) { dispatch(); return; }
  if (replace) { trail.pop(); history.replaceState(null, '', h); dispatch(); return; }
  location.hash = h;
}

// Back one step if there is in-app history, otherwise to the fallback.
export function back(fallback = DEFAULT_HASH) {
  if (trail.length > 1) history.back();
  else go(fallback, { replace: true });
}

export function onRoute(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

let started = false;
export function start(fn) {
  if (fn) onRoute(fn);
  if (started) return;
  started = true;
  window.addEventListener('hashchange', dispatch);
  if (!location.hash) history.replaceState(null, '', DEFAULT_HASH);
  dispatch();
}

export default { ROUTES, match, current, go, back, onRoute, start };
