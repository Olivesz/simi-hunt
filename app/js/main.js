// App shell: mounts screen modules by route and owns the global HUD,
// the center menu, sheets, toasts and modals.
//
// Layers: the map module mounts once into #map-layer and stays alive under
// every other screen; all other modules mount into #screen-layer, which
// covers the map. A module file that doesn't exist yet gets a placeholder.

import { state } from './state.js';
import { loadData, clearDataCache } from './data.js';
import * as router from './router.js';

const MODULES = {
  map: './map.js',
  encounter: './encounter.js',
  qr: './qr.js',
  claim: './claim.js',
  unlock: './unlock.js',
  shelf: './shelf.js',
  simidex: './simidex.js',
};

const SCREEN_NAMES = {
  map: 'Map',
  encounter: 'Catch screen',
  qr: 'QR scanner',
  claim: 'Code check',
  unlock: 'Unlock reveal',
  shelf: 'Shelf products',
  simidex: 'SimiDex',
};

const REGIONS = [
  { id: 'austin', name: 'Austin', sub: 'UT campus & Guadalupe' },
  { id: 'lasvegas', name: 'Las Vegas', sub: 'The Strip' },
];

const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const mapLayer = $('#map-layer');
const screenLayer = $('#screen-layer');

// ---------- toast / modal / sheet ----------

export function toast(msg, { ms = 2600, kind = '' } = {}) {
  const root = $('#toast-root');
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ` toast-${kind}` : '');
  t.setAttribute('role', 'status');
  t.textContent = String(msg);
  root.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const kill = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); };
  setTimeout(kill, ms);
  t.addEventListener('click', kill);
  return kill;
}

// modal(html) shows a centered card. Any element inside with [data-close]
// closes it. Returns { el, close, closed } where closed is a Promise that
// resolves with the value passed to close() (or the data-close attribute).
export function modal(html, { dismissible = true, className = '', closeButton = true } = {}) {
  return overlay('modal', html, { dismissible, className, closeButton });
}

// sheet(html) is the same, as a bottom sheet.
export function sheet(html, { dismissible = true, className = '', closeButton = true } = {}) {
  return overlay('sheet', html, { dismissible, className, closeButton });
}

// Every open sheet/modal, so a route change can close them all.
const openOverlays = new Set();

export function closeAllOverlays() {
  for (const close of [...openOverlays]) close();
}

function overlay(kind, html, { dismissible, className, closeButton }) {
  const root = $(kind === 'sheet' ? '#sheet-root' : '#modal-root');
  const wrap = document.createElement('div');
  wrap.className = `${kind}-wrap`;
  const handle = kind === 'sheet' ? '<div class="sheet-handle" aria-hidden="true"><div class="sheet-grip"></div></div>' : '';
  const x = dismissible && closeButton ? '<button type="button" class="ov-x" data-close aria-label="Close">&times;</button>' : '';
  const body = kind === 'sheet' ? `<div class="sheet-body">${html}</div>` : html;
  wrap.innerHTML = `<div class="${kind}-scrim"></div><div class="${kind} ${className}" role="dialog" aria-modal="true">${handle}${x}${body}</div>`;
  const el = wrap.lastElementChild;
  let resolve;
  const closed = new Promise((r) => { resolve = r; });
  let done = false;
  const close = (value) => {
    if (done) return;
    done = true;
    openOverlays.delete(close);
    wrap.classList.remove('in');
    el.style.transform = '';
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 260);
    resolve(value);
  };
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
  wrap.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { close(c.getAttribute('data-close') || undefined); return; }
    if (dismissible && e.target.classList.contains(`${kind}-scrim`)) close();
  });
  document.addEventListener('keydown', onKey);
  if (kind === 'sheet' && dismissible) swipeToClose(el, el.querySelector('.sheet-handle'), close);
  openOverlays.add(close);
  root.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  return { el, close, closed };
}

// Drag the sheet's grab handle down to close it; a short drag snaps back.
function swipeToClose(sheetEl, handle, close) {
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    start = { y: e.clientY, id: e.pointerId };
    handle.setPointerCapture(e.pointerId);
    sheetEl.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = Math.max(0, e.clientY - start.y);
    sheetEl.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    start = null;
    sheetEl.style.transition = '';
    if (dy > 70) close();
    else sheetEl.style.transform = '';
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

export function confirmModal(title, body, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  const m = modal(`<h2 class="m-title">${esc(title)}</h2><p class="m-body">${esc(body)}</p>
    <div class="m-actions"><button class="pill pill-ghost" data-close="no">${esc(cancel)}</button>
    <button class="pill ${danger ? 'pill-danger' : 'pill-primary'}" data-close="yes">${esc(ok)}</button></div>`);
  return m.closed.then((v) => v === 'yes');
}

// ---------- module loading and mounting ----------

const loaded = new Map();

async function loadModule(key) {
  if (loaded.has(key)) return loaded.get(key);
  const url = new URL(MODULES[key], import.meta.url).href;
  let result;
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    if (!head.ok) {
      result = { ok: false, missing: true };
      return result; // not cached: a later visit picks up the file once it exists
    }
  } catch { /* offline: try the import anyway */ }
  try {
    const mod = await import(url);
    if (typeof mod.mount !== 'function') result = { ok: false, error: new Error(`${MODULES[key]} does not export mount(el, ctx, params)`) };
    else result = { ok: true, mod };
  } catch (e) {
    console.error(`[shell] ${MODULES[key]} failed to load`, e);
    result = { ok: false, error: e };
  }
  loaded.set(key, result);
  return result;
}

let data = null;
let navSeq = 0;
let screen = null;          // { mod, host } for the module in #screen-layer
let map = null;             // { mod, hash } once map.js is mounted

function ctxFor(route) {
  return { state, data, go: router.go, back: router.back, toast, modal, sheet, route, params: route.params };
}

function safeUnmount(mod, what) {
  try { mod?.unmount?.(); } catch (e) { console.error(`[shell] ${what} unmount failed`, e); }
}

async function render(route) {
  const seq = ++navSeq;
  closeMenu();
  closeAllOverlays();
  document.body.dataset.route = route.name;
  const onMap = route.module === 'map';
  document.body.classList.toggle('on-map', onMap);

  if (screen) { safeUnmount(screen.mod, screen.key); screen = null; }
  screenLayer.replaceChildren();
  screenLayer.hidden = onMap;

  try { data = await loadData(); } catch (e) { console.error('[shell] loadData failed', e); }
  if (seq !== navSeq) return;

  if (onMap) { await showMap(route, seq); return; }

  const res = await loadModule(route.module);
  if (seq !== navSeq) return;
  const host = document.createElement('div');
  host.className = `screen screen-${route.module}`;
  screenLayer.append(host);
  if (!res.ok) { placeholder(host, route, res); return; }
  screen = { mod: res.mod, key: route.module };
  try {
    await res.mod.mount(host, ctxFor(route), route.params);
  } catch (e) {
    console.error(`[shell] ${MODULES[route.module]} mount failed`, e);
    if (seq === navSeq) placeholder(host, route, { error: e });
  }
}

async function showMap(route, seq) {
  if (map) {
    if (typeof map.mod.update === 'function') {
      try { map.mod.update(route.params, ctxFor(route)); } catch (e) { console.error('[shell] map update failed', e); }
      map.hash = route.hash;
      return;
    }
    if (map.hash === route.hash) return;
    safeUnmount(map.mod, 'map');
    mapLayer.replaceChildren();
    map = null;
  }
  const res = await loadModule('map');
  if (seq !== navSeq) return;
  if (!res.ok) {
    mapLayer.replaceChildren();
    const host = document.createElement('div');
    host.className = 'screen screen-map-placeholder';
    mapLayer.append(host);
    placeholder(host, route, res);
    return;
  }
  mapLayer.replaceChildren();
  map = { mod: res.mod, hash: route.hash };
  document.body.classList.add('map-live'); // map.js shows its own DEMO badge
  try {
    await res.mod.mount(mapLayer, ctxFor(route), route.params);
  } catch (e) {
    console.error('[shell] map.js mount failed', e);
    document.body.classList.remove('map-live');
    placeholder(mapLayer, route, { error: e });
  }
}

function remountMap() {
  if (!map) return;
  safeUnmount(map.mod, 'map');
  mapLayer.replaceChildren();
  map = null;
  const r = router.current();
  if (r.module === 'map') render(r);
}

function placeholder(host, route, res = {}) {
  const name = SCREEN_NAMES[route.module] || route.module;
  const file = MODULES[route.module]?.replace('./', 'js/') || '';
  const params = Object.entries(route.params || {});
  const isMap = route.module === 'map';
  const err = res.error ? String(res.error.message || res.error) : '';
  host.innerHTML = `
    <div class="ph ${isMap ? 'ph-map' : ''}">
      <div class="ph-card">
        <img class="ph-art" src="../art/base/simi-base.svg" alt="" onerror="this.remove()">
        <h2>${esc(name)} ${err ? 'hit a snag' : 'is on its way'}</h2>
        <p>${err
          ? 'This screen could not start. The details are in the console.'
          : 'Dr. Simi is still putting this screen together. Check back in a few minutes.'}</p>
        ${params.length ? `<dl class="ph-params">${params.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        ${err ? `<code class="ph-err">${esc(file)}: ${esc(err)}</code>` : `<code class="ph-err">${esc(file)}</code>`}
        <div class="ph-actions">
          ${isMap
            ? '<button class="pill pill-primary" data-go="#/dex">Open SimiDex</button><button class="pill pill-ghost" data-go="#/scan">Scan a code</button>'
            : '<button class="pill pill-primary" data-go="#/map">Back to map</button>'}
        </div>
      </div>
    </div>`;
  host.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => router.go(b.dataset.go)));
}

// ---------- HUD ----------

function uniqueCaught(s) {
  return new Set(s.catches.map((c) => c.simiId)).size;
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

let last = {};
function renderHud() {
  const s = state.get();
  const vals = { capsules: s.capsules, dex: uniqueCaught(s), streak: s.streak?.count || 0 };
  const ids = { capsules: 'capsule-count', dex: 'dex-count', streak: 'streak-count' };
  for (const k of Object.keys(vals)) {
    const el = document.getElementById(ids[k]);
    if (el.textContent !== String(vals[k])) {
      el.textContent = vals[k];
      if (last[k] !== undefined) bump(el.closest('button') || el);
    }
  }
  last = vals;
  $('#demo-badge').hidden = !s.demo;
  document.body.classList.toggle('demo', !!s.demo);
}

// ---------- center menu ----------

const menu = $('#menu');
const menuBtn = $('#btn-menu');

function openMenu() {
  menu.hidden = false;
  requestAnimationFrame(() => menu.classList.add('in'));
  menuBtn.classList.add('open');
  menuBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
}

function closeMenu() {
  if (menu.hidden) return;
  menu.classList.remove('in');
  menuBtn.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
  setTimeout(() => { if (!menu.classList.contains('in')) menu.hidden = true; }, 220);
}

menuBtn.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
menu.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { closeMenu(); return; }
  const item = e.target.closest('[data-action]');
  if (!item) return;
  closeMenu();
  const a = item.dataset.action;
  if (a === 'scan') router.go('#/scan');
  else if (a === 'stores') openStores();
  else if (a === 'settings') openSettings();
});

$('#btn-dex').addEventListener('click', () => router.go('#/dex'));
$('#btn-profile').addEventListener('click', openProfile);
$('#chip-capsules').addEventListener('click', () => {
  const n = state.get().capsules;
  toast(n > 0 ? `${n} Simi Capsules ready. Visit a SimiStop to stock up.` : 'Out of capsules! Spin a SimiStop to get more.');
});

// ---------- sheets: stores, profile, settings ----------

function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtDist(m) {
  if (!Number.isFinite(m)) return '';
  return m < 100 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function regionCenter(d) {
  const r = d?.region || {};
  const c = r.center;
  if (Array.isArray(c) && c.length >= 2) return { lon: c[0], lat: c[1] };
  if (c && Number.isFinite(c.lat)) return { lat: c.lat, lon: c.lon ?? c.lng };
  if (Number.isFinite(r.lat)) return { lat: r.lat, lon: r.lon ?? r.lng };
  return null;
}

async function openStores() {
  const d = data || await loadData();
  const s = state.get();
  const pos = s.position;
  const from = pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon) ? pos : regionCenter(d);
  const simiName = (id) => d.simis.find((x) => x.id === id)?.name || id;
  const far = (x) => (Number.isFinite(x) ? x : Infinity);
  const stores = d.stores
    .map((st) => ({ ...st, d: from && Number.isFinite(st.lat) && Number.isFinite(st.lon) ? distM(from, st) : NaN }))
    .sort((a, b) => far(a.d) - far(b.d));
  const rows = stores.map((st) => `
    <button class="store-row" data-store="${esc(st.id)}">
      <span class="stop-pin" aria-hidden="true"></span>
      <span class="store-main"><b>${esc(st.name || st.id)}</b><small>${esc(st.address || '')}</small>
        ${st.exclusiveSimi ? `<span class="tag tag-excl">Exclusive: ${esc(simiName(st.exclusiveSimi))}</span>` : ''}
        ${st.shelves?.length ? `<span class="tag">${st.shelves.length} scan shelves</span>` : ''}
      </span>
      <span class="store-dist">${fmtDist(st.d)}</span>
    </button>`).join('');
  const sh = sheet(`<h2 class="sheet-title"><span class="stop-pin sm" aria-hidden="true"></span> SimiStops nearby</h2>
    <p class="sheet-sub">Participating CVS Pharmacy stores, nearest first${pos ? '' : ' (from the map center)'}. Scan the Simi signs on their shelves to unlock exclusives.</p>
    <div class="store-list">${rows || '<p class="empty">No SimiStops loaded for this region yet.</p>'}</div>`);
  sh.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    sh.close();
    router.go('#/stop/' + encodeURIComponent(b.dataset.store));
  });
}

function openProfile() {
  const s = state.get();
  const total = data?.simis?.length || 18;
  const uniq = uniqueCaught(s);
  const fromQr = s.catches.filter((c) => c.source === 'qr').length;
  sheet(`<div class="profile-head">
      <span class="avatar lg"><img src="${esc($('#avatar-img').src)}" alt=""></span>
      <div><h2 class="sheet-title">Simi Hunter</h2><p class="sheet-sub">${esc(REGIONS.find((r) => r.id === s.region)?.name || s.region)}${s.demo ? ' · demo mode' : ''}</p></div>
    </div>
    <div class="stats">
      <div class="stat"><b>${uniq}<small>/${total}</small></b><span>SimiDex</span></div>
      <div class="stat"><b>${s.catches.length}</b><span>Catches</span></div>
      <div class="stat"><b>${s.streak?.count || 0}</b><span>Day streak</span></div>
      <div class="stat"><b>${s.capsules}</b><span>Capsules</span></div>
      <div class="stat"><b>${fromQr}</b><span>Shelf unlocks</span></div>
      <div class="stat"><b>${Object.keys(s.claims || {}).length}</b><span>Codes scanned</span></div>
    </div>
    <div class="dexbar"><i style="width:${Math.round((uniq / total) * 100)}%"></i></div>
    <p class="sheet-sub center">${uniq >= total ? 'SimiDex complete. ¡Felicidades!' : `${total - uniq} Simis left to find.`}</p>
    <button class="pill pill-primary wide" data-close data-go-dex>Open SimiDex</button>`)
    .el.querySelector('[data-go-dex]').addEventListener('click', () => router.go('#/dex'));
}

function openSettings() {
  const s = state.get();
  const sh = sheet(`<h2 class="sheet-title">Settings</h2>
    <div class="set-group">
      <div class="set-label">Region</div>
      <div class="seg" role="radiogroup">
        ${REGIONS.map((r) => `<button role="radio" aria-checked="${r.id === s.region}" class="seg-btn ${r.id === s.region ? 'on' : ''}" data-region="${r.id}"><b>${r.name}</b><small>${r.sub}</small></button>`).join('')}
      </div>
    </div>
    <label class="set-row">
      <span><b>Demo mode</b><small>Walk with an on-screen joystick instead of GPS. Shows a DEMO badge.</small></span>
      <input type="checkbox" class="switch" id="set-demo" ${s.demo ? 'checked' : ''}>
    </label>
    <label class="set-row">
      <span><b>Presenter mode</b><small>Shows presenter controls on the map for a live walkthrough.</small></span>
      <input type="checkbox" class="switch" id="set-presenter" ${s.presenter ? 'checked' : ''}>
    </label>
    <button class="set-row as-btn" data-about><span><b>About this demo</b><small>What Simi Hunt is and where the data comes from</small></span><span class="chev" aria-hidden="true">›</span></button>
    <button class="set-row as-btn danger" data-reset><span><b>Reset progress</b><small>Clears catches, capsules, streak and scanned codes</small></span><span class="chev" aria-hidden="true">›</span></button>`);
  sh.el.addEventListener('click', async (e) => {
    const rb = e.target.closest('[data-region]');
    if (rb) {
      if (rb.dataset.region === state.get().region) return;
      state.setRegion(rb.dataset.region);
      clearDataCache();
      toast(`Travelling to ${REGIONS.find((r) => r.id === rb.dataset.region)?.name}…`);
      setTimeout(() => { location.hash = '#/map'; location.reload(); }, 400);
      return;
    }
    if (e.target.closest('[data-about]')) { openAbout(); return; }
    if (e.target.closest('[data-reset]')) {
      if (await confirmModal('Reset progress?', 'This clears every Simi you caught, your capsules, streak and scanned codes. It cannot be undone.', { ok: 'Reset', danger: true })) {
        state.reset();
        toast('Progress reset. Fresh SimiDex!');
        setTimeout(() => { location.hash = '#/map'; location.reload(); }, 500);
      }
    }
  });
  sh.el.querySelector('#set-presenter').addEventListener('change', (e) => {
    state.setPresenter(e.target.checked);
    toast(e.target.checked ? 'Presenter mode on.' : 'Presenter mode off.');
    remountMap();
  });
  sh.el.querySelector('#set-demo').addEventListener('change', (e) => {
    state.setDemo(e.target.checked);
    toast(e.target.checked ? 'Demo mode on: use the joystick to walk.' : 'Demo mode off: using GPS.');
    remountMap();
  });
}

function openAbout() {
  const d = data || {};
  const n = (x) => (Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0);
  modal(`<h2 class="m-title">About Simi Hunt</h2>
    <p class="m-body">Simi Hunt is a concept prototype for a case competition: <b>Simi Hunts at CVS</b>. Walk the map to catch Simis, Dr. Simi in different outfits. Participating CVS stores are <b>SimiStops</b>. Scanning the Simi sign on a shelf unlocks an exclusive Simi and shows the real products on that shelf.</p>
    <p class="m-body small">Not an official Farmacias Similares, Dr. Simi or CVS Pharmacy product. Brand names belong to their owners. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>.</p>
    <p class="m-body small muted">Loaded: ${n(d.simis)} Simis · ${n(d.stores)} SimiStops · ${n(d.codes)} shelf codes · ${n(d.products)} shelf types.</p>
    <div class="m-actions"><button class="pill pill-primary" data-close>Got it</button></div>`);
}

// ---------- boot ----------

function applyQueryFlags() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('demo')) state.setDemo(q.get('demo') !== '0');
    if (q.has('presenter')) state.setPresenter(q.get('presenter') !== '0');
    if (q.has('region') && REGIONS.some((r) => r.id === q.get('region'))) state.setRegion(q.get('region'));
  } catch { /* ignore */ }
}

// ?open=menu|stores|settings|profile|about opens that panel on load, for
// presenting and for screenshot checks.
function applyOpenFlag() {
  const open = new URLSearchParams(location.search).get('open');
  const fn = { menu: openMenu, stores: openStores, settings: openSettings, profile: openProfile, about: openAbout }[open];
  if (fn) setTimeout(fn, 300);
}

function setAvatar() {
  const img = $('#avatar-img');
  const want = '../art/simis/classic.svg';
  const probe = new Image();
  probe.onload = () => { img.src = want; };
  probe.src = want;
}

applyQueryFlags();
renderHud();
setAvatar();
state.on('change', renderHud);
router.start(render);
applyOpenFlag();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[shell] service worker not registered', e));
  });
}

// Handy from the console and for integration checks.
window.SimiHunt = { state, go: router.go, toast, modal, sheet, loadData, get data() { return data; } };
