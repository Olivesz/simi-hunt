// Map screen: stylized tilted map that follows the player, with Simi spawns,
// SimiStops (participating CVS stores) and park/landmark accents.
// Routes: #/map and #/stop/:storeId (store bottom sheet).

const ML_VER = '6.16.0';
const ML_JS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${ML_VER}/dist/maplibre-gl.mjs`;
const ML_CSS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${ML_VER}/dist/maplibre-gl.css`;
const NIPPLE_JS = 'https://cdn.jsdelivr.net/npm/nipplejs@1.0.4/dist/index.mjs';
const STYLE_URL = new URL('../map/style.json', import.meta.url).href;
const MAP_CSS = new URL('../css/map.css', import.meta.url).href;

const RANGE_M = 40;            // catch / spin range
const SPIN_CAPSULES = 3;
const SPIN_COOLDOWN_MS = 5 * 60 * 1000;
const SPAWN_RADIUS_M = 320;
const MAX_SPAWNS = 6;          // keep the map uncluttered; summoned Simis still show
const MAX_STOPS = 12;
const DEMO_MAX_SPEED = 40;     // m/s at full joystick (demo, fast on purpose)
const ROUTE_SPEED = 45;        // m/s: the ~2 km demo route takes ~45 s
const PRESENTER_ROUTE_SPEED = 45; // m/s, same as demo route so presenters never wait
const TAP_MOVE_SPEED = 30;     // m/s for presenter tap-to-move (clamped to 0.4-2.5 s)
const GUADALUPE_ID = 'cvs-guadalupe-2402';
const STAGE_BACK_M = 100;      // a fresh game opens this far before CVS Guadalupe on the demo route
const ZOOM = 17.2;
const MIN_ZOOM = 15.5;         // a full pinch-out stays near 1 MB of tiles
const PITCH = 56;
const MAX_GPS_ACC_M = 100;     // fuzzier fixes (e.g. Precise Location off) can't drive a 40 m catch ring
const PRESENTER_SPIN_MS = 3000; // presenter mode shows the used stop this long, then resets it
const SPIN_KEY = 'simihunt.map.spins';
const HINT_KEY = 'simihunt.map.hinted';
const COMMON_IDS = ['classic', 'gym', 'sleepy', 'futbol', 'bombero', 'chef', 'beisbolista'];
const SHELF_LABEL = {
  'sun-care': 'Sun Care', skincare: 'Skincare', vitamins: 'Vitamins', sleep: 'Sleep',
  'sports-nutrition': 'Sports Nutrition', 'cold-flu': 'Cold & Flu', 'dr-simi': 'Dr. Simi',
};

// Central Austin, UT campus to downtown.
const AUSTIN_DEFAULT = {
  center: { lat: 30.2790, lon: -97.7400 },
  bounds: [[-97.790, 30.245], [-97.690, 30.315]],
  zoom: ZOOM,
};

let ml = null;          // maplibre namespace
let map = null;
let root = null;        // persistent DOM (map survives unmount/remount)
let ctx = null;
let mounted = false;
let region = AUSTIN_DEFAULT;
let pos = null;         // {lat, lon, source}
let demo = false;
let forcedDemo = false;
let gpsWatch = null;
let joystick = null;
let joyVec = null;      // {x, y} screen vector, up positive, 0..1
let rafId = 0;
let lastFrame = 0;
let walk = null;        // {coords, cum, total, d}
let spawnApi = null;
let spawnTimer = 0;
let lastQueryPos = null;
let lastStatePush = 0;
let lastRangeCheck = 0;
let avatar = null;
// Player avatar art and wiring: art/player/AVATAR.md
const PLAYER_ART = new URL('../../art/player/', import.meta.url).href;
const PLAYER_H = 72; // keep equal to .sm-hunter height
const COLOR_KEY = 'simihunt.map.hunterColor';
let heading = null;  // cone marker
let walkTimer = 0;
let headingAngle = 0;
let ring = null;
let spawnMarkers = new Map();   // spawnId -> {marker, el, spawn}
let stopMarkers = new Map();    // storeId -> {marker, el, store}
let sheetStoreId = null;
let unsubs = [];
let toastTimer = 0;
let outsideWarned = false;
let routeStoreId = null; // store sheet the current route asks for
let ready = false;        // mount finished; update() may act directly
let presenter = false;    // stage mode: tap-to-move, toolbar, no range checks or cooldowns
let summoned = new Map(); // spawnId -> spawn, presenter "Summon Simi" (spawnId demo:<simiId>)
let starting = null;      // promise while the map is being created
let regionChanged = false;
let startBearing = null;  // camera bearing for a freshly staged start
let paused = false;       // another screen covers the map: no timers, GPS or walking
let spawnLoading = null;  // spawns.js import, started before the map
let hinted = false;
// GPS: asked for only after a tap (or when the site already has permission).
let gpsWanted = false;    // the player asked for location, or granted it before
let gpsState = 'off';     // off | asking | on | denied | weak | outside
let gpsFix = null;        // last usable fix inside the play area
let manual = false;       // joystick, walk or presenter move: GPS fixes wait for "Use my location"
let sheetTick = 0;
const presenterSpun = new Map(); // storeId -> time the presenter-mode "used" look ends

// ---------- small helpers ----------

function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distTo = (p) => (pos ? haversine(pos.lat, pos.lon, p.lat, p.lon) : Infinity);
// US units, the same rule as the SimiDex: feet under 0.1 mi, then miles.
function fmtDist(m) {
  if (!isFinite(m)) return '—';
  const mi = m / 1609.344;
  return mi < 0.1 ? `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}
const RANGE_FT = Math.round((RANGE_M * 3.28084) / 10) * 10;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Every store is named "CVS Pharmacy", so the street tells them apart (same rule as the SimiDex).
function storeLabel(s) {
  const street = s.address ? String(s.address).split(',')[0].trim() : '';
  if (s.name && /\d/.test(s.name)) return s.name;
  return street ? `CVS · ${street}` : (s.name || 'CVS Pharmacy');
}

function hue(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Accepts [lon,lat], [lat,lon], {lat,lon|lng}.
function toLatLon(c) {
  if (!c) return null;
  if (Array.isArray(c)) {
    const [a, b] = c.map(Number);
    if (Math.abs(a) > 90) return { lat: b, lon: a };
    if (Math.abs(b) > 90) return { lat: a, lon: b };
    return { lat: b, lon: a };
  }
  const lat = Number(c.lat ?? c.latitude), lon = Number(c.lon ?? c.lng ?? c.longitude);
  return isFinite(lat) && isFinite(lon) ? { lat, lon } : null;
}

// Accepts [[w,s],[e,n]], [w,s,e,n], {west,south,east,north}, {sw,ne}. Returns [[w,s],[e,n]].
function toBounds(b) {
  if (!b) return null;
  let p1, p2;
  if (Array.isArray(b) && b.length === 4) { p1 = toLatLon([b[0], b[1]]); p2 = toLatLon([b[2], b[3]]); }
  else if (Array.isArray(b) && b.length === 2) { p1 = toLatLon(b[0]); p2 = toLatLon(b[1]); }
  else if (typeof b === 'object') {
    if (b.sw && b.ne) { p1 = toLatLon(b.sw); p2 = toLatLon(b.ne); }
    else {
      const w = b.west ?? b.minLon ?? b.w, s = b.south ?? b.minLat ?? b.s;
      const e = b.east ?? b.maxLon ?? b.e, n = b.north ?? b.maxLat ?? b.n;
      if ([w, s, e, n].every((v) => isFinite(Number(v)))) { p1 = { lat: +s, lon: +w }; p2 = { lat: +n, lon: +e }; }
    }
  }
  if (!p1 || !p2) return null;
  return [[Math.min(p1.lon, p2.lon), Math.min(p1.lat, p2.lat)], [Math.max(p1.lon, p2.lon), Math.max(p1.lat, p2.lat)]];
}

function normRegion(r) {
  const center = toLatLon(r?.center);
  const bounds = toBounds(r?.bounds);
  if (!center && !bounds) return AUSTIN_DEFAULT;
  const b = bounds || [[center.lon - 0.05, center.lat - 0.035], [center.lon + 0.05, center.lat + 0.035]];
  const c = center || { lat: (b[0][1] + b[1][1]) / 2, lon: (b[0][0] + b[1][0]) / 2 };
  return { center: c, bounds: b, zoom: Number(r?.zoom) || ZOOM };
}

const inRegion = (p) => {
  const [[w, s], [e, n]] = region.bounds;
  return p && p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
};

// Resolves once the stylesheet applies. A failed one is removed, so the next call tries again
// (a dead <link> left behind would leave MapLibre markers unpositioned after a retry).
const cssLoads = new Map();
function loadCss(href) {
  if (cssLoads.has(href)) return cssLoads.get(href);
  const done = new Promise((res, rej) => {
    let l = document.querySelector(`link[href="${href}"]`);
    if (l?.sheet) { res(); return; }
    l?.remove();
    l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.addEventListener('load', () => res(), { once: true });
    l.addEventListener('error', () => { l.remove(); cssLoads.delete(href); rej(new Error(`stylesheet failed: ${href}`)); }, { once: true });
    document.head.appendChild(l);
  });
  cssLoads.set(href, done);
  return done;
}

function toast(msg) {
  if (typeof ctx?.toast === 'function') return ctx.toast(msg);
  const t = root?.querySelector('.sm-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

let spinsCache = null;
function readSpins() {
  if (!spinsCache) { try { spinsCache = JSON.parse(localStorage.getItem(SPIN_KEY) || '{}') || {}; } catch { spinsCache = {}; } }
  return spinsCache;
}
function writeSpin(id) {
  readSpins()[id] = Date.now();
  try { localStorage.setItem(SPIN_KEY, JSON.stringify(spinsCache)); } catch { /* storage off */ }
}

// Spawns stay hidden once caught (state.caughtSpawn, or the 'catch' event below) or once they fled
// (encounter.js's record). Backing out of an encounter without a throw leaves the Simi in place.
const GONE_KEY = 'simihunt.map.gone';
const FLED_KEY = 'simihunt.enc.fled'; // set by encounter.js
let fled = null, fledAt = 0;
function fledMap() {
  if (!fled || Date.now() - fledAt > 1000) {
    try { fled = JSON.parse(localStorage.getItem(FLED_KEY) || '{}') || {}; } catch { fled = {}; }
    fledAt = Date.now();
  }
  return fled;
}
let gone = null;          // spawnId -> expiresAt
let pendingEncounter = null;
function goneMap() {
  if (!gone) {
    try { gone = JSON.parse(localStorage.getItem(GONE_KEY) || '{}') || {}; } catch { gone = {}; }
    const now = Date.now();
    for (const k of Object.keys(gone)) if (gone[k] < now) delete gone[k];
  }
  return gone;
}
function setGone(spawnId, until) {
  const g = goneMap();
  if (until) g[spawnId] = until; else delete g[spawnId];
  try { localStorage.setItem(GONE_KEY, JSON.stringify(g)); } catch { /* storage off */ }
}
const isGone = (id) => !!goneMap()[id] || fledMap()[id] > Date.now()
  || !!ctx?.state?.caughtSpawn?.(id) || !!ctx?.state?.spawnGone?.(id);

const buzz = () => { try { navigator.vibrate?.(10); } catch { /* unsupported */ } };
// Pressed look for touch (iOS does not apply :active without a touch listener).
function pressable(el) {
  el.addEventListener('pointerdown', () => el.classList.add('pressed'));
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, () => el.classList.remove('pressed'));
}
// Add a marker hidden, then fade it in; fade out before removing.
function addFaded(el, lngLat) {
  el.classList.add('sm-hide');
  const marker = new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat(lngLat).addTo(map);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('sm-hide')));
  return marker;
}
function fadeRemove(m) {
  m.el.classList.add('sm-hide');
  m.el.style.pointerEvents = 'none';
  setTimeout(() => m.marker.remove(), 400);
}
const cooldownLeft = (id) => Math.max(0, (readSpins()[id] || 0) + SPIN_COOLDOWN_MS - Date.now());
// Presenter mode skips the 5-minute cooldown but still shows a short "used" state.
const coolLeft = (id) => (presenter ? Math.max(0, (presenterSpun.get(id) || 0) - Date.now()) : cooldownLeft(id));

const stores = () => (Array.isArray(ctx?.data?.stores) ? ctx.data.stores : [])
  .map((s) => ({ ...s, lat: Number(s.lat), lon: Number(s.lon) }))
  .filter((s) => isFinite(s.lat) && isFinite(s.lon));
const simiById = (id) => (Array.isArray(ctx?.data?.simis) ? ctx.data.simis.find((s) => s.id === id) : null);
const artFor = (id) => { const m = simiById(id); return m?.icon || m?.art || `../art/simis/${id}.svg`; };

function simiImg(id, cls = '') {
  const img = document.createElement('img');
  img.className = cls;
  img.alt = simiById(id)?.name || id;
  img.draggable = false;
  img.src = artFor(id);
  img.onerror = () => {
    // Art for this outfit isn't drawn yet: show the base Dr. Simi instead of a letter.
    if (img.dataset.fb !== '1') { img.dataset.fb = '1'; img.src = '../art/base/simi-base.svg'; return; }
    const d = document.createElement('div');
    d.className = `${cls} sm-art-fallback`;
    d.style.setProperty('--h', hue(id));
    d.textContent = (simiById(id)?.name || id).charAt(0).toUpperCase();
    img.replaceWith(d);
  };
  return img;
}

// ---------- spawns ----------

function stubSpawnApi() {
  // Used only when app/js/spawns.js can't load: 4 random commons around the player.
  // Ids carry the Simi after a colon, which encounter.js reads without spawns.js.
  let cache = [];
  const ids = () => {
    const c = (ctx?.data?.simis || []).filter((s) => s.tier === 'common').map((s) => s.id);
    return c.length ? c : COMMON_IDS;
  };
  return {
    spawnsNear(lat, lon, radiusM, now) {
      cache = cache.filter((s) => s.expiresAt > now && haversine(lat, lon, s.lat, s.lon) < radiusM * 1.5);
      while (cache.length < 4) {
        const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * (radiusM * 0.6);
        const sLat = lat + (d * Math.cos(a)) / 111320, sLon = lon + (d * Math.sin(a)) / (111320 * Math.cos(lat * Math.PI / 180));
        const simiId = ids()[Math.floor(Math.random() * ids().length)];
        cache.push({ spawnId: `stub:${simiId}:${Math.round(now).toString(36)}-${cache.length}`, simiId, lat: sLat, lon: sLon, expiresAt: now + 10 * 60 * 1000 });
      }
      return cache.slice();
    },
    getSpawn: (id) => cache.find((s) => s.spawnId === id) || null,
  };
}

async function loadSpawnApi() {
  try {
    const m = await import('./spawns.js');
    if (typeof m.spawnsNear === 'function') return m;
  } catch { /* not built yet */ }
  return stubSpawnApi();
}

function refreshSpawns(force = false) {
  if (!map || !pos || !spawnApi) return;
  if (!force && lastQueryPos && haversine(pos.lat, pos.lon, lastQueryPos.lat, lastQueryPos.lon) < 20) return;
  lastQueryPos = { ...pos };
  const now = Date.now();
  let list = [];
  try { list = spawnApi.spawnsNear(pos.lat, pos.lon, SPAWN_RADIUS_M, now, ctx.data) || []; } catch (e) { console.warn('spawnsNear failed', e); }
  for (const [id, sp] of summoned) if (sp.expiresAt <= now || isGone(id)) summoned.delete(id);
  list = list.filter((s) => (!s.expiresAt || s.expiresAt > now) && !summoned.has(s.spawnId) && !isGone(s.spawnId))
    .map((s) => ({ ...s, _d: distTo(s) }))
    .sort((a, b) => a._d - b._d);
  // Summoned Simis first (newest first), then nearest; drop any spawn within RANGE_M of one already shown.
  const shown = [];
  for (const sp of [...[...summoned.values()].reverse(), ...list]) {
    if (shown.length >= MAX_SPAWNS) break;
    if (shown.some((o) => haversine(o.lat, o.lon, sp.lat, sp.lon) < RANGE_M)) continue;
    shown.push(sp);
  }
  list = shown;
  const keep = new Set(list.map((s) => s.spawnId));
  for (const [id, m] of spawnMarkers) if (!keep.has(id)) { spawnMarkers.delete(id); fadeRemove(m); }
  for (const s of list) {
    if (spawnMarkers.has(s.spawnId)) continue;
    const el = document.createElement('button');
    el.className = 'sm-spawn';
    el.type = 'button';
    el.dataset.spawnId = s.spawnId;
    el.dataset.lngLat = `${s.lon},${s.lat}`;
    el.setAttribute('aria-label', `Wild ${simiById(s.simiId)?.name || s.simiId}`);
    el.style.setProperty('--delay', `${-(hue(s.spawnId) % 20) / 10}s`);
    const bob = document.createElement('div');
    bob.className = 'sm-spawn-bob';
    bob.appendChild(simiImg(s.simiId, 'sm-spawn-art'));
    const shadow = document.createElement('div');
    shadow.className = 'sm-spawn-shadow';
    el.append(shadow, bob);
    el.addEventListener('click', (ev) => { ev.stopPropagation(); buzz(); tapSpawn(s.spawnId); });
    pressable(el);
    const marker = addFaded(el, [s.lon, s.lat]);
    spawnMarkers.set(s.spawnId, { marker, el, spawn: s, inRange: null });
  }
  updateRangeClasses();
  maybeHint();
}

// True when a shown spawn sits in the open part of the screen (clear of the top and bottom HUD).
function spawnOnScreen() {
  if (!map) return false;
  const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight;
  for (const m of spawnMarkers.values()) {
    const p = map.project([m.spawn.lon, m.spawn.lat]);
    if (p.x > 30 && p.x < W - 30 && p.y > 110 && p.y < H - 130) return true;
  }
  return false;
}

// First-run tip, shown only once a Simi is actually on screen to tap.
function maybeHint() {
  if (hinted || paused || sheetStoreId || !spawnOnScreen()) return;
  hinted = true;
  try {
    if (localStorage.getItem(HINT_KEY)) return;
    localStorage.setItem(HINT_KEY, '1');
  } catch { return; }
  setTimeout(() => { if (mounted && !paused) toast('Tap a Simi near you to catch it'); }, 700);
}

function tapSpawn(spawnId) {
  const m = spawnMarkers.get(spawnId);
  if (!m) return;
  if (presenter || distTo(m.spawn) <= RANGE_M) { pendingEncounter = m.spawn; ctx.go('#/encounter/' + spawnId); }
  else toast(`${simiById(m.spawn.simiId)?.name || 'This Simi'} · ${fmtDist(distTo(m.spawn))} away`);
}

// Touch the DOM only when a marker's state actually changes.
function updateRangeClasses() {
  for (const m of spawnMarkers.values()) {
    const r = distTo(m.spawn) <= RANGE_M;
    if (m.inRange !== r) { m.inRange = r; m.el.classList.toggle('in-range', r); }
  }
  for (const m of stopMarkers.values()) {
    const r = distTo(m.store) <= RANGE_M, c = coolLeft(m.store.id) > 0;
    if (m.inRange !== r) { m.inRange = r; m.el.classList.toggle('in-range', r); }
    if (m.cooling !== c) { m.cooling = c; m.el.classList.toggle('cooling', c); }
  }
}

// ---------- SimiStops ----------

function refreshStops() {
  if (!map) return;
  const list = stores().map((s) => ({ s, d: pos ? distTo(s) : 0 })).sort((a, b) => a.d - b.d).slice(0, MAX_STOPS).map((x) => x.s);
  const keep = new Set(list.map((s) => s.id));
  for (const [id, m] of stopMarkers) if (!keep.has(id)) { stopMarkers.delete(id); fadeRemove(m); }
  for (const s of list) {
    if (stopMarkers.has(s.id)) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sm-stop';
    el.dataset.storeId = s.id;
    el.dataset.lngLat = `${s.lon},${s.lat}`;
    el.setAttribute('aria-label', `SimiStop ${storeLabel(s)}`);
    el.innerHTML = `<div class="sm-stop-float"><div class="sm-stop-disc"><span class="sm-stop-cross"></span></div></div>
      <div class="sm-stop-pole"></div><div class="sm-stop-base"></div>`;
    if (s.exclusiveSimi) {
      const badge = document.createElement('div');
      badge.className = 'sm-stop-badge';
      badge.appendChild(simiImg(s.exclusiveSimi, 'sm-stop-badge-art'));
      el.querySelector('.sm-stop-float').appendChild(badge);
    }
    el.addEventListener('click', (ev) => { ev.stopPropagation(); buzz(); ctx.go('#/stop/' + s.id); });
    pressable(el);
    const marker = addFaded(el, [s.lon, s.lat]);
    stopMarkers.set(s.id, { marker, el, store: s, inRange: null, cooling: null });
  }
}

let sheetEl = null;      // content element of the open store sheet
let shellSheet = null;   // handle from ctx.sheet() when the shell provides it

// Shelves at this store where a Simi code can be found: a shelf-tier Simi's shelf type, or this
// store's exclusive on its shelf. Without Simi data, every listed shelf.
function codeShelves(s) {
  const shelves = Array.isArray(s.shelves) ? s.shelves : [];
  const simis = Array.isArray(ctx?.data?.simis) ? ctx.data.simis : [];
  if (!simis.length) return shelves;
  return shelves.filter((t) => simis.some((m) => m.shelf === t && (m.tier === 'shelf' || (m.tier === 'store' && m.storeId === s.id))));
}

function sheetHtml(s, withClose) {
  const ex = s.exclusiveSimi;
  const owned = ex && ctx.state?.has?.(ex);
  const label = storeLabel(s);
  // The full address sits right under the title, so the title can drop the street suffix and fit one line.
  const title = label.replace(/\s+(Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Parkway|Pkwy\.?)$/i, '');
  const shelves = codeShelves(s);
  return `
    <div class="sm-sheet-card" aria-label="${esc(label)}">
      ${withClose ? '<button class="sm-sheet-close" type="button" aria-label="Close">×</button>' : ''}
      <div class="sm-sheet-kicker">SimiStop</div>
      <h2 class="sm-sheet-title">${esc(title)}</h2>
      <div class="sm-sheet-addr">${esc(s.address || '')}</div>
      ${s.drSimiStocked ? '<div class="sm-ex-label">Dr. Simi sold here</div>' : ''}
      <div class="sm-sheet-dist"></div>
      <div class="sm-spin-wrap"><button class="sm-spin-disc" type="button" aria-label="Spin this SimiStop"><span class="sm-stop-cross"></span></button></div>
      <div class="sm-spin-hint"></div>
      <button class="sm-scan" type="button">Scan shelf QR</button>
      ${ex ? `<div class="sm-ex"><div class="sm-ex-art ${owned ? 'owned' : ''}"></div>
        <div><div class="sm-ex-label">Store-exclusive Simi</div>
        <div class="sm-ex-name">${owned ? esc(simiById(ex)?.name || ex) : '??? Scan a shelf code here to find out'}</div></div></div>` : ''}
      ${shelves.length ? `<div class="sm-shelves-label">Shelves with Simi codes</div>
        <div class="sm-shelves">${shelves.map((t) => `<button type="button" class="sm-shelf" data-shelf="${esc(t)}">${esc(SHELF_LABEL[t] || t)}</button>`).join('')}</div>` : ''}
    </div>`;
}

// Drag the sheet down to dismiss it (touch, and mouse for desktop demos).
function addSwipeDown(el, onClose) {
  let y0 = null, dy = 0;
  const start = (y) => { if (el.scrollTop > 0) return; y0 = y; dy = 0; el.style.transition = 'none'; };
  const move = (y, ev) => {
    if (y0 == null) return;
    dy = Math.max(0, y - y0);
    if (dy > 0 && ev?.cancelable) ev.preventDefault();
    el.style.transform = dy ? `translateY(${dy}px)` : '';
  };
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    el.style.transition = '';
    el.style.transform = '';
    if (dy > 70) onClose();
  };
  el.addEventListener('touchstart', (e) => { if (e.touches.length === 1) start(e.touches[0].clientY); }, { passive: true });
  el.addEventListener('touchmove', (e) => move(e.touches[0].clientY, e), { passive: false });
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && !e.target.closest('button')) start(e.clientY); });
  el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') move(e.clientY); });
  el.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') end(); });
}

let escHandler = null;

function openSheet(storeId) {
  const s = stores().find((x) => x.id === storeId);
  if (!s) { toast('Store not found'); closeSheet(); return; }
  if (sheetStoreId === storeId && sheetEl) { updateSheet(); return; }
  if (walk?.route) stopWalk(); // the sheet's distance must not climb while the walk runs on
  closeSheet({ recenter: false });
  sheetStoreId = storeId;
  const leave = (hash) => { closeSheet(); ctx.go(hash); };
  if (typeof ctx.sheet === 'function') {
    shellSheet = ctx.sheet(sheetHtml(s, false), { className: 'sm-stop-sheet' });
    sheetEl = shellSheet.el;
    const mine = shellSheet;
    shellSheet.closed.then(() => {
      if (shellSheet !== mine) return;
      shellSheet = null; sheetEl = null; sheetStoreId = null;
      clearInterval(sheetTick); sheetTick = 0;
      root?.classList.remove('sheet-open');
      recenter();
      if (/^#\/stop\//.test(location.hash)) ctx.go('#/map');
    });
  } else {
    sheetEl = root.querySelector('.sm-sheet');
    sheetEl.innerHTML = sheetHtml(s, true);
    sheetEl.classList.add('open');
    sheetEl.onclick = (ev) => { if (ev.target === sheetEl) leave('#/map'); };
    escHandler = (ev) => { if (ev.key === 'Escape') leave('#/map'); };
    document.addEventListener('keydown', escHandler);
  }
  if (!shellSheet) addSwipeDown(sheetEl.querySelector('.sm-sheet-card'), () => leave('#/map')); // the shell sheet has its own
  const ex = s.exclusiveSimi;
  if (ex) sheetEl.querySelector('.sm-ex-art').appendChild(simiImg(ex, 'sm-ex-img'));
  const x = sheetEl.querySelector('.sm-sheet-close');
  if (x) x.onclick = () => leave('#/map');
  sheetEl.querySelector('.sm-scan').onclick = () => leave('#/scan');
  sheetEl.querySelector('.sm-spin-disc').onclick = () => { buzz(); spin(s); };
  sheetEl.querySelectorAll('.sm-shelf').forEach((b) => { b.onclick = () => leave(`#/shelf/${s.id}/${b.dataset.shelf}`); });
  root.classList.add('sheet-open');
  updateSheet();
  clearInterval(sheetTick);
  sheetTick = setInterval(updateSheet, 1000); // the recharge countdown ticks while the sheet is open
  pauseFollow();
  if (map) map.easeTo({ center: [s.lon, s.lat], duration: 600 });
}

function updateSheet() {
  if (!sheetStoreId || !sheetEl) return;
  const s = stores().find((x) => x.id === sheetStoreId);
  if (!s) return;
  const d = distTo(s), cd = coolLeft(s.id);
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  setText(sheetEl.querySelector('.sm-sheet-dist'), `${fmtDist(d)} away`);
  const disc = sheetEl.querySelector('.sm-spin-disc');
  const hint = sheetEl.querySelector('.sm-spin-hint');
  disc.classList.toggle('cooling', cd > 0);
  disc.classList.toggle('far', !presenter && d > RANGE_M);
  let t = `Tap the disc to spin for ${SPIN_CAPSULES} Simi Capsules`;
  const sec = Math.ceil(cd / 1000);
  if (cd > 0) t = `Recharging · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  else if (!presenter && d > RANGE_M) t = `Walk within about ${RANGE_FT} ft to spin`;
  setText(hint, t);
}

function spin(s) {
  if (coolLeft(s.id) > 0) { toast('This stop is recharging'); return; }
  if (presenter) {
    presenterSpun.set(s.id, Date.now() + PRESENTER_SPIN_MS);
    setTimeout(() => { updateRangeClasses(); updateSheet(); }, PRESENTER_SPIN_MS + 50);
  } else {
    if (distTo(s) > RANGE_M) { toast(`${fmtDist(distTo(s))} away · walk closer to spin`); return; }
    writeSpin(s.id);
  }
  ctx.state?.addCapsules?.(SPIN_CAPSULES);
  const disc = sheetEl?.querySelector('.sm-spin-disc');
  if (disc) { disc.classList.remove('spinning'); void disc.offsetWidth; disc.classList.add('spinning'); }
  const total = ctx.state?.get?.()?.capsules;
  toast(`+${SPIN_CAPSULES} Simi Capsules${isFinite(total) ? ` · ${total} total` : ''}`);
  updateRangeClasses();
  updateSheet();
}

function closeSheet({ recenter: back = true } = {}) {
  const wasOpen = !!sheetStoreId;
  clearInterval(sheetTick);
  sheetTick = 0;
  sheetStoreId = null;
  if (shellSheet) { const h = shellSheet; shellSheet = null; h.close(); }
  const own = root?.querySelector('.sm-sheet');
  if (own) { own.classList.remove('open'); own.innerHTML = ''; }
  sheetEl = null;
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  root?.classList.remove('sheet-open');
  if (wasOpen && back) recenter();
}

// ---------- POIs and route (GL layers, no DOM cost) ----------

function asFC(x) {
  if (!x) return { type: 'FeatureCollection', features: [] };
  if (x.type === 'FeatureCollection') return x;
  if (x.type === 'Feature') return { type: 'FeatureCollection', features: [x] };
  if (Array.isArray(x)) {
    return {
      type: 'FeatureCollection',
      features: x.map((p) => (p.type === 'Feature' ? p : { type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [Number(p.lon ?? p.lng), Number(p.lat)] } }))
        .filter((f) => f.geometry),
    };
  }
  if (x.type && x.coordinates) return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: x }] };
  return { type: 'FeatureCollection', features: [] };
}

function routeCoords() {
  const fc = asFC(ctx?.data?.route);
  for (const f of fc.features) {
    const g = f.geometry;
    if (g?.type === 'LineString') return g.coordinates;
    if (g?.type === 'MultiLineString') return g.coordinates.flat();
  }
  const pts = fc.features.filter((f) => f.geometry?.type === 'Point').map((f) => f.geometry.coordinates);
  return pts.length > 1 ? pts : null;
}

function addDataLayers() {
  const pois = asFC(ctx?.data?.pois);
  const kindExpr = ['downcase', ['to-string', ['coalesce', ['get', 'kind'], ['get', 'type'], ['get', 'category'], ['get', 'class'], '']]];
  const isPark = ['any', ['in', 'park', kindExpr], ['in', 'garden', kindExpr], ['in', 'green', kindExpr], ['in', 'nature', kindExpr]];
  const isArea = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
  const accentArea = ['all', isArea, ['any', isPark, ['in', 'landmark', kindExpr], ['in', 'campus', kindExpr]]];
  const setOrAdd = (id, data) => {
    const src = map.getSource(id);
    if (src) src.setData(data); else map.addSource(id, { type: 'geojson', data });
  };
  setOrAdd('sm-pois', pois);
  if (!map.getLayer('sm-poi-area')) {
    map.addLayer({ id: 'sm-poi-area', type: 'fill', source: 'sm-pois', filter: accentArea,
      paint: { 'fill-color': ['case', isPark, '#36b24f', ['in', 'campus', kindExpr], '#fff3b0', '#ffd76a'],
        'fill-opacity': ['case', isPark, 0.35, 0.22] } }, 'building');
    map.addLayer({ id: 'sm-poi-edge', type: 'line', source: 'sm-pois', filter: accentArea,
      paint: { 'line-color': ['case', isPark, '#2a9a45', '#e0b440'], 'line-width': 1.5, 'line-opacity': 0.5, 'line-dasharray': [2, 2] } }, 'building');
    map.addLayer({ id: 'sm-poi-glow', type: 'circle', source: 'sm-pois', filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': ['case', isPark, '#2fd07a', '#ffe27a'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 10, 19, 34],
        'circle-blur': 0.9, 'circle-opacity': 0.55, 'circle-pitch-alignment': 'map',
      } });
    map.addLayer({ id: 'sm-poi-dot', type: 'circle', source: 'sm-pois', filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': ['case', isPark, '#1fae5b', '#f2b630'], 'circle-radius': 4,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map',
      } });
    map.addLayer({ id: 'sm-poi-label', type: 'symbol', source: 'sm-pois', minzoom: 16, filter: ['all', ['has', 'name'], ['any', ['==', ['geometry-type'], 'Point'], ['in', 'landmark', kindExpr]]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': '#2d6b3a', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4, 'text-opacity': 0.8 } });
  }
  const rc = routeCoords();
  setOrAdd('sm-route', { type: 'FeatureCollection', features: rc ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: rc } }] : [] });
  if (!map.getLayer('sm-route-line')) {
    // Shown from the first frame, so the demo walk's path and its SimiStop are visible before any tap.
    map.addLayer({ id: 'sm-route-line', type: 'line', source: 'sm-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0798E8', 'line-width': 5, 'line-opacity': 0.75, 'line-dasharray': [1, 2] } }, 'building');
  }
  root.querySelector('.sm-walk').hidden = !rc;
  const pw = root.querySelector('[data-pa="walk"]');
  if (pw) pw.hidden = !rc;
}

// ---------- route geometry ----------

function measure(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  return { coords, cum, total: cum[cum.length - 1] };
}

// Point d metres along a measured path.
function pointAt(w, d) {
  let i = 1;
  while (i < w.cum.length - 1 && w.cum[i] < d) i++;
  const [a, b] = [w.coords[i - 1], w.coords[i]];
  const k = Math.max(0, Math.min(1, (d - w.cum[i - 1]) / Math.max(1e-6, w.cum[i] - w.cum[i - 1])));
  return { lon: a[0] + (b[0] - a[0]) * k, lat: a[1] + (b[1] - a[1]) * k };
}

const bearingTo = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180) / Math.PI;

// Opening spot for a fresh game: on the demo route, STAGE_BACK_M before CVS Guadalupe and facing it,
// so the route, the SimiStop and the player share the first frame. Falls back to the route start.
function stagedStart() {
  const coords = routeCoords();
  const s = stores().find((x) => x.id === GUADALUPE_ID);
  if (coords && s) {
    const w = measure(coords);
    const r = onRoute(w, s.lat, s.lon);
    if (r.off < RANGE_M) {
      const p = pointAt(w, Math.max(0, r.along - STAGE_BACK_M));
      return { ...p, bearing: bearingTo(p, s) };
    }
  }
  if (coords) return { lat: coords[0][1], lon: coords[0][0], bearing: 0 };
  return { ...region.center, bearing: 0 };
}

// The first SimiStop listed in the route's waypoints that lies on the route past `from` metres.
function nextRouteStop(w, from) {
  const fc = asFC(ctx?.data?.route);
  const ids = fc.features.flatMap((f) => (Array.isArray(f.properties?.waypoints) ? f.properties.waypoints : []));
  let best = null;
  for (const s of stores()) {
    if (!ids.includes(s.id)) continue;
    const r = onRoute(w, s.lat, s.lon);
    if (r.off <= RANGE_M && r.along > from + 5 && (!best || r.along < best.along)) best = { id: s.id, along: r.along };
  }
  return best;
}

// ---------- player ----------

function metersPerPixel() {
  const lat = pos?.lat ?? region.center.lat;
  return (40075016.686 * Math.cos(lat * Math.PI / 180)) / (512 * 2 ** map.getZoom());
}
function sizeRing() {
  if (!ring) return;
  const px = (2 * RANGE_M) / metersPerPixel();
  ring.getElement().style.setProperty('--ring', `${px.toFixed(1)}px`);
}

// ---------- player avatar ----------

const hunterFrames = (color = 'blue') =>
  ['idle', 'walk1', 'walk2'].map((f) => `${PLAYER_ART}${f}${color === 'blue' ? '' : `-${color}`}.svg`);

function savedColor() {
  try { const c = localStorage.getItem(COLOR_KEY); return ['blue', 'red', 'green'].includes(c) ? c : 'blue'; } catch { return 'blue'; }
}

/** Jacket color: 'blue' | 'red' | 'green'. */
export function setHunterColor(color) {
  const imgs = avatar?.getElement().querySelectorAll('.sm-hunter-f');
  if (!imgs || !['blue', 'red', 'green'].includes(color)) return;
  hunterFrames(color).forEach((src, i) => { imgs[i].src = src; });
  try { localStorage.setItem(COLOR_KEY, color); } catch { /* storage off */ }
  root?.querySelectorAll('.sm-swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === color));
}

function setHeading(deg) {
  if (!heading) return;
  headingAngle += ((deg - headingAngle) % 360 + 540) % 360 - 180; // 350 -> 10 turns 20 degrees, not 340
  const el = heading.getElement();
  el.style.setProperty('--sm-heading', `${headingAngle}deg`);
  el.classList.add('on');
}

function markWalking(prev, next) {
  if (!prev || !avatar) return;
  const east = (next.lon - prev.lon) * 111320 * Math.cos(next.lat * Math.PI / 180);
  const north = (next.lat - prev.lat) * 111320;
  const gps = next.source === 'gps';
  if (Math.hypot(east, north) < (gps ? 1.5 : 0.01)) return; // ignore GPS jitter and no-op calls
  const el = avatar.getElement();
  el.classList.add('is-walking');
  clearTimeout(walkTimer);
  walkTimer = setTimeout(() => el.classList.remove('is-walking'), gps ? 1500 : 220);
  setHeading(Math.atan2(east, north) * 180 / Math.PI);
}

function onOrient(e) {
  if (avatar?.getElement().classList.contains('is-walking')) return; // travel direction wins while moving
  const h = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading
    : e.absolute && e.alpha != null ? 360 - e.alpha : null;
  if (h != null) setHeading(h + (screen.orientation?.angle || 0));
}

// ---------- camera follow ----------
// While following, the camera glides after the player; any user pan/zoom/rotate pauses it
// and the recenter button brings it back.
let following = true;
let camRaf = 0;
let camBusyUntil = 0;     // a camera easeTo is running; don't fight it

function setFollowing(on) {
  following = on;
  root?.classList.toggle('following', on);
}
function pauseFollow() {
  setFollowing(false);
  cancelAnimationFrame(camRaf);
  camRaf = 0;
}
function resumeFollow() {
  if (!following) setFollowing(true);
  followCam();
}
function recenter() {
  setFollowing(true);
  if (!map || !pos) return;
  if (walk || joyVec) { map.easeTo({ zoom: ZOOM, pitch: PITCH, duration: 300 }); followCam(); return; } // keep up while moving
  camBusyUntil = performance.now() + 850;
  map.easeTo({ center: [pos.lon, pos.lat], zoom: ZOOM, pitch: PITCH, duration: 800 });
}
function followCam() {
  if (camRaf || !map) return;
  let last = performance.now(), prevGap = Infinity;
  const step = (t) => {
    camRaf = 0;
    if (!map || !following || !pos || !mounted) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (t < camBusyUntil && !walk && !joyVec) { camRaf = requestAnimationFrame(step); return; }
    const c = map.getCenter();
    const dLat = pos.lat - c.lat, dLon = pos.lon - c.lng;
    const gap = Math.hypot(dLat * 111320, dLon * 111320 * Math.cos(pos.lat * Math.PI / 180));
    // Close enough, a far teleport, or clamped by maxBounds: snap and stop.
    if (gap < 0.2 || gap > 400 || Math.abs(prevGap - gap) < 0.005) { map.jumpTo({ center: [pos.lon, pos.lat] }); return; }
    // Walking or driving the joystick (up to 45 m/s): lock on, no lag.
    if ((walk || joyVec) && gap < 40) { map.jumpTo({ center: [pos.lon, pos.lat] }); camRaf = requestAnimationFrame(step); return; }
    prevGap = gap;
    const k = 1 - Math.exp(-dt * 10);
    map.jumpTo({ center: [c.lng + dLon * k, c.lat + dLat * k] });
    camRaf = requestAnimationFrame(step);
  };
  camRaf = requestAnimationFrame(step);
}

function setPos(p, { ease = false, push = false } = {}) {
  const prev = pos;
  pos = { lat: p.lat, lon: p.lon, source: p.source };
  if (!map) return;
  avatar.setLngLat([pos.lon, pos.lat]);
  heading?.setLngLat([pos.lon, pos.lat]);
  markWalking(prev, pos);
  ring.setLngLat([pos.lon, pos.lat]);
  if (following && !sheetStoreId) {
    if (ease) { camBusyUntil = performance.now() + 950; map.easeTo({ center: [pos.lon, pos.lat], duration: 900 }); }
    else followCam();
  }
  const now = performance.now();
  if (push || now - lastStatePush > 150) {
    lastStatePush = now;
    try { ctx.state?.setPosition?.(pos); } catch (e) { console.warn(e); }
  }
  if (push || now - lastRangeCheck > 200) {
    lastRangeCheck = now;
    updateRangeClasses();
    updateSheet();
    refreshSpawns();
    if (!lastQueryPos || push) refreshStops();
  }
}

// demo: the position is simulated (joystick shown). Forced by ?demo=1, Settings or presenter mode;
// otherwise on until a usable GPS fix arrives, and again whenever the player moves by hand.
function setDemo(on) {
  demo = on;
  root.classList.toggle('demo', on);
  updateLocBtn();
  if (on && !joystick) initJoystick();
}

// ---------- GPS ----------

const LOC_TEXT = {
  off: 'Use my location', asking: 'Finding you…', on: 'Use my location',
  denied: 'Location off', weak: 'Weak GPS · demo', outside: 'Outside play area',
};

// "Use my location": shown while the position is simulated and real GPS could take over.
function updateLocBtn() {
  const b = root?.querySelector('.sm-loc');
  if (!b) return;
  b.hidden = forcedDemo || presenter || !navigator.geolocation || !demo;
  const t = LOC_TEXT[gpsState] || LOC_TEXT.off;
  const label = b.querySelector('.sm-loc-text');
  if (label.textContent !== t) label.textContent = t;
  b.dataset.state = gpsState;
}

function setGpsState(s) {
  gpsState = s;
  updateLocBtn();
}

function stopGps() {
  if (gpsWatch == null) return;
  try { navigator.geolocation.clearWatch(gpsWatch); } catch { /* ignore */ }
  gpsWatch = null;
}

// Watches GPS only once the player asked (ask=true, from a tap) or granted it on an earlier visit.
function startGps(ask = false) {
  if (gpsWatch != null || forcedDemo || presenter || paused || !navigator.geolocation) return;
  if (ask) gpsWanted = true;
  if (!gpsWanted) return;
  if (gpsState !== 'on') setGpsState('asking');
  try {
    gpsWatch = navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  } catch { setGpsState('weak'); }
}

function onFix(g) {
  if (forcedDemo || presenter) return;
  const p = { lat: g.coords.latitude, lon: g.coords.longitude, source: 'gps' };
  const acc = g.coords.accuracy;
  if (Number.isFinite(acc) && acc > MAX_GPS_ACC_M) {
    if (!gpsFix && gpsState !== 'weak') { setGpsState('weak'); toast('Weak GPS · using demo mode'); }
    return;
  }
  if (!inRegion(p)) {
    if (!outsideWarned) { outsideWarned = true; toast('Outside the play area · demo mode'); }
    gpsFix = null;
    setGpsState('outside');
    setDemo(true);
    return;
  }
  gpsFix = p;
  setGpsState('on');
  if (manual) return; // the player is moving by hand; "Use my location" hands the position back to GPS
  setDemo(false);
  setPos(p, { ease: true, push: true });
}

function onGpsError(e) {
  if (e?.code === 1) { // permission denied
    stopGps();
    gpsWanted = false;
    gpsFix = null;
    setGpsState('denied');
    setDemo(true);
    toast('Location is blocked. Allow it for this site in your browser settings, or play on in demo mode.');
    return;
  }
  // Unavailable or timed out: the watch keeps trying; play on in demo meanwhile.
  if (gpsFix) return;
  if (gpsState !== 'weak') { setGpsState('weak'); toast('Weak GPS · using demo mode'); }
  setDemo(true);
}

function useMyLocation() {
  if (gpsState === 'outside') { toast('You are outside the play area, so the map stays in demo mode'); return; }
  manual = false;
  if (walk) stopWalk();
  if (gpsFix && gpsWatch != null) {
    setDemo(false);
    resumeFollow();
    setPos(gpsFix, { ease: true, push: true });
    return;
  }
  stopGps(); // a fresh watch retries after "denied" or "weak"
  startGps(true);
}

async function initJoystick() {
  const zone = root.querySelector('.sm-joy');
  let nipple;
  try { nipple = await import(NIPPLE_JS); } catch (e) { console.warn('joystick load failed', e); return; }
  if (joystick || !mounted) return;
  const create = nipple.create || nipple.default?.create;
  joystick = create({ zone, mode: 'static', position: { left: '50%', top: '50%' }, size: 110,
    color: { front: '#024EA2', back: 'rgba(255,255,255,0.55)' }, restOpacity: 0.75 });
  const data = (a, b) => b || a?.data || a;
  joystick.on('move', (a, b) => {
    const d = data(a, b);
    if (!d?.angle) return;
    const f = Math.min(1, d.force ?? 1);
    joyVec = { x: Math.cos(d.angle.radian) * f, y: Math.sin(d.angle.radian) * f };
    manual = true;
    resumeFollow();
    if (walk) stopWalk();
    setDemo(true);
    loop();
  });
  joystick.on('end', () => { joyVec = null; if (pos) setPos(pos, { push: true }); });
}

function moveBy(east, north) {
  const lat = pos.lat + north / 111320;
  const lon = pos.lon + east / (111320 * Math.cos(pos.lat * Math.PI / 180));
  const [[w, s], [e, n]] = region.bounds;
  setPos({ lat: Math.min(n, Math.max(s, lat)), lon: Math.min(e, Math.max(w, lon)), source: 'demo' });
}

function loop() {
  if (rafId) return;
  lastFrame = performance.now();
  const step = (t) => {
    const dt = Math.min(0.1, (t - lastFrame) / 1000);
    lastFrame = t;
    if (!mounted || (!joyVec && !walk)) { rafId = 0; return; }
    if (joyVec) {
      const b = (map.getBearing() * Math.PI) / 180;
      const speed = DEMO_MAX_SPEED * Math.hypot(joyVec.x, joyVec.y) ** 1.5;
      const heading = b + Math.atan2(joyVec.x, joyVec.y);
      moveBy(Math.sin(heading) * speed * dt, Math.cos(heading) * speed * dt);
    } else if (walk) {
      walk.t += dt;
      const end = walk.stopAt ? walk.stopAt.along : walk.total;
      let v = walk.speed;
      // Route walks ease in, then slow over the last ~20 m so the player arrives at a stop instead of passing it.
      if (walk.route) v = Math.min(v * Math.min(1, 0.3 + walk.t * 1.4), Math.max(4, (end - walk.d) * 2.2));
      walk.d = Math.min(end, walk.d + v * dt);
      setPos({ ...pointAt(walk, walk.d), source: 'demo' });
      if (walk.d >= end) {
        const stop = walk.stopAt;
        stopWalk();
        rafId = 0;
        if (stop) ctx.go('#/stop/' + stop.id);
        return;
      }
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

function walkPath(coords, speed, route, from = 0, stopAt = null) {
  manual = true;
  resumeFollow();
  walk = { ...measure(coords), d: from, t: 0, speed, route, stopAt };
  loop();
}

// Walks the demo route from where the player stands on it (or from its start) and stops at the next
// SimiStop it lists, opening that store's sheet.
function startWalk() {
  const coords = routeCoords();
  if (!coords || !map) return;
  if (walk) stopWalk();
  setDemo(true);
  closeSheetIfOpen();
  const w = measure(coords);
  const here = pos ? onRoute(w, pos.lat, pos.lon) : null;
  const from = here && here.off < 30 && here.along < w.total - 30 ? here.along : 0;
  if (!from) setPos({ lon: coords[0][0], lat: coords[0][1], source: 'demo' }, { push: true });
  root.querySelectorAll('.sm-walk, [data-pa="walk"]').forEach((b) => { b.classList.add('on'); b.textContent = 'Skip ahead ⏭'; });
  root.classList.add('route-walking');
  walkPath(coords, presenter ? PRESENTER_ROUTE_SPEED : ROUTE_SPEED, true, from, nextRouteStop(w, from));
}

function stopWalk() {
  const wasRoute = walk?.route;
  walk = null;
  if (!root) return;
  if (wasRoute) {
    root.querySelector('.sm-walk').textContent = 'Walk the demo route';
    const pb = root.querySelector('[data-pa="walk"]');
    if (pb) pb.textContent = 'Walk route';
    root.querySelectorAll('.sm-walk, [data-pa="walk"]').forEach((b) => b.classList.remove('on'));
    root.classList.remove('route-walking');
  }
  if (pos) setPos(pos, { push: true });
}

// Route distance and offset (m) of a point from the walk polyline.
function onRoute(w, lat, lon) {
  let best = { off: Infinity, along: 0 };
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 111320;
  for (let i = 1; i < w.coords.length; i++) {
    const [ax, ay] = [(w.coords[i - 1][0] - lon) * kx, (w.coords[i - 1][1] - lat) * ky];
    const [bx, by] = [(w.coords[i][0] - lon) * kx, (w.coords[i][1] - lat) * ky];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
    const off = Math.hypot(ax + dx * t, ay + dy * t);
    if (off < best.off) best = { off, along: w.cum[i - 1] + (w.cum[i] - w.cum[i - 1]) * t };
  }
  return best;
}

// Tap Walk while walking: jump to just before the next stop or Simi on the route.
function skipAhead() {
  if (!walk?.route) return;
  const cands = stores().map((x) => ({ lat: x.lat, lon: x.lon, label: 'SimiStop' }));
  for (let d = walk.d; d < walk.total; d += 120) {
    let i = 1;
    while (i < walk.cum.length - 1 && walk.cum[i] < d) i++;
    const [lon, lat] = walk.coords[i];
    try {
      for (const sp of spawnApi?.spawnsNear?.(lat, lon, 90, Date.now(), ctx.data) || []) {
        if (!isGone(sp.spawnId)) cands.push({ lat: sp.lat, lon: sp.lon, label: simiById(sp.simiId)?.name || 'a Simi' });
      }
    } catch { /* spawns unavailable */ }
  }
  let next = null;
  for (const c of cands) {
    const r = onRoute(walk, c.lat, c.lon);
    if (r.off < 60 && r.along > walk.d + 30 && (!next || r.along < next.along)) next = { ...c, along: r.along };
  }
  if (!next) { walk.d = walk.total - 1; toast('Last stretch'); return; }
  walk.d = Math.max(walk.d, next.along - 20);
  lastQueryPos = null; // re-query spawns at the new spot
  toast(`Next up: ${next.label}`);
}

// ---------- presenter mode ----------

function readPresenterFlag() {
  const q = new URLSearchParams(location.search + '&' + (location.hash.split('?')[1] || ''));
  return !!ctx?.state?.get?.()?.presenter || q.get('presenter') === '1';
}

function setPresenter(on) {
  presenter = on;
  root.classList.toggle('presenter', on);
  if (on) {
    stopGps();
    setDemo(true);
    root.querySelector('[data-pa="walk"]').hidden = !routeCoords();
  } else if (mounted && ready && !forcedDemo) startGps();
  updateLocBtn();
  updateRangeClasses();
  updateSheet();
}

// Quick walk from the player to a tapped point.
function walkTo(lat, lon) {
  if (walk?.route) stopWalk();
  const d = pos ? haversine(pos.lat, pos.lon, lat, lon) : 0;
  if (!pos || d < 1) return;
  const secs = Math.min(2.5, Math.max(0.4, d / TAP_MOVE_SPEED));
  walkPath([[pos.lon, pos.lat], [lon, lat]], d / secs, false);
}

function summonSimi({ quiet = false } = {}) {
  const commons = (ctx?.data?.simis || []).filter((x) => x.tier === 'common').map((x) => x.id);
  const ids = commons.length ? commons : COMMON_IDS;
  const simiId = ids[Math.floor(Math.random() * ids.length)];
  // About 18 m off the player's right shoulder: inside the 40 m ring, clear of the avatar and the toolbar.
  const heading = (map.getBearing() + 65 + Math.random() * 30) * Math.PI / 180;
  const d = 18;
  const sp = {
    spawnId: `demo:${simiId}:${Date.now().toString(36)}`, simiId,
    lat: pos.lat + (d * Math.cos(heading)) / 111320,
    lon: pos.lon + (d * Math.sin(heading)) / (111320 * Math.cos(pos.lat * Math.PI / 180)),
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  const old = spawnMarkers.get(sp.spawnId);
  if (old) { old.marker.remove(); spawnMarkers.delete(sp.spawnId); }
  setGone(sp.spawnId, 0);
  summoned.set(sp.spawnId, sp);
  refreshSpawns(true);
  if (!quiet) toast(`A wild ${simiById(simiId)?.name || simiId} appeared`);
}

function jumpTo(lat, lon) {
  if (walk) stopWalk();
  manual = true;
  setFollowing(true);
  setPos({ lat, lon, source: 'demo' }, { push: true, ease: true });
  refreshSpawns(true);
  refreshStops();
}

function jumpToGuadalupe() {
  const s = stores().find((x) => x.id === GUADALUPE_ID);
  if (!s) { toast('CVS Guadalupe is not in this region'); return; }
  closeSheet({ recenter: false });
  jumpTo(s.lat - 0.00012, s.lon); // about 13 m south of the door
  ctx.go('#/stop/' + GUADALUPE_ID);
}

// Back to the opening frame: on the route before CVS Guadalupe, facing it.
function jumpToStart() {
  closeSheetIfOpen();
  const s = stagedStart();
  jumpTo(s.lat, s.lon);
  camBusyUntil = performance.now() + 950;
  map.easeTo({ center: [s.lon, s.lat], bearing: s.bearing, zoom: ZOOM, pitch: PITCH, duration: 900 });
}

function closeSheetIfOpen() { if (sheetStoreId) { closeSheet(); ctx.go('#/map'); } }

// ---------- map lifecycle ----------

function buildRoot() {
  root = document.createElement('div');
  root.className = 'sm-root following';
  root.innerHTML = `
    <div class="sm-map"></div>
    <button class="sm-loc" type="button" hidden title="The position is simulated until GPS takes over">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c-3.9 0-7 3-7 6.9 0 5 7 12.1 7 12.1s7-7.1 7-12.1c0-3.9-3.1-6.9-7-6.9Z" fill="currentColor"/><circle cx="12" cy="9.4" r="2.6" fill="#fff"/></svg>
      <span class="sm-loc-text">Use my location</span>
    </button>
    <div class="sm-joy" aria-label="Move (demo)"></div>
    <button class="sm-walk" type="button" hidden>Walk the demo route</button>
    <button class="sm-walk-stop" type="button" aria-label="Stop walking">Stop</button>
    <button class="sm-recenter" type="button" aria-label="Back to my location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19.5 20 12 16.3 4.5 20Z" fill="currentColor"/></svg></button>
    <div class="sm-pbar collapsed">
      <button class="sm-pbar-toggle" type="button" aria-expanded="false">Presenter <span aria-hidden="true">▾</span></button>
      <div class="sm-pbar-items">
        <button type="button" data-pa="summon">Summon Simi</button>
        <button type="button" data-pa="walk">Walk route</button>
        <button type="button" data-pa="stopwalk" class="sm-only-walking">Stop walking</button>
        <button type="button" data-pa="cvs">Jump to CVS Guadalupe</button>
        <button type="button" data-pa="start">Jump to start</button>
        <div class="sm-pbar-colors" role="group" aria-label="Jacket color">
          <button type="button" class="sm-swatch" data-color="blue" aria-label="Blue jacket"></button>
          <button type="button" class="sm-swatch" data-color="red" aria-label="Red jacket"></button>
          <button type="button" class="sm-swatch" data-color="green" aria-label="Green jacket"></button>
        </div>
      </div>
    </div>
    <div class="sm-loading">Loading map…</div>
    <div class="sm-sheet"></div>
    <div class="sm-toast" role="status" aria-live="polite"></div>`;
  root.querySelector('.sm-walk').onclick = () => { buzz(); walk?.route ? skipAhead() : startWalk(); };
  root.querySelector('.sm-walk-stop').onclick = () => { buzz(); stopWalk(); };
  root.querySelector('.sm-loc').onclick = () => { buzz(); useMyLocation(); };
  const bar = root.querySelector('.sm-pbar');
  bar.querySelector('.sm-pbar-toggle').onclick = () => {
    const open = bar.classList.toggle('collapsed');
    bar.querySelector('.sm-pbar-toggle').setAttribute('aria-expanded', String(!open));
  };
  const acts = {
    summon: summonSimi,
    walk: () => (walk?.route ? skipAhead() : startWalk()),
    stopwalk: () => stopWalk(),
    cvs: jumpToGuadalupe,
    start: jumpToStart,
  };
  bar.querySelectorAll('[data-pa]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); buzz(); if (map && pos) acts[b.dataset.pa](); }; });
  const rc = root.querySelector('.sm-recenter');
  pressable(rc);
  rc.onclick = () => {
    buzz();
    try { DeviceOrientationEvent.requestPermission?.().catch(() => {}); } catch { /* not iOS */ }
    recenter();
  };
  root.querySelectorAll('.sm-swatch').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); buzz(); setHunterColor(b.dataset.color); }; });
}

// MapLibre does not retry a failed TileJSON request, and one network blip leaves the map
// blank. Resolve the tile URLs here with retries and hand MapLibre the finished style.
async function loadStyle() {
  let style;
  try { style = await (await fetch(STYLE_URL)).json(); } catch { return STYLE_URL; }
  for (const src of Object.values(style.sources || {})) {
    if (src.type !== 'vector' || !src.url) continue;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(src.url);
        if (r.ok) {
          const tj = await r.json();
          if (Array.isArray(tj.tiles)) {
            Object.assign(src, { tiles: tj.tiles, minzoom: tj.minzoom ?? 0, maxzoom: tj.maxzoom ?? 14 });
            delete src.url;
            break;
          }
        }
      } catch { /* retry */ }
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  return style;
}

async function createMap() {
  // MapLibre's stylesheet positions every marker; without it the map is unusable, so it must load too.
  const [mod, style] = await Promise.all([import(ML_JS), loadStyle(), loadCss(ML_CSS)]);
  ml = mod;
  const start = pos || region.center;
  map = new ml.Map({
    container: root.querySelector('.sm-map'),
    style,
    center: [start.lon, start.lat],
    bearing: startBearing ?? 0,
    zoom: ZOOM, // region.zoom is an overview level; the game camera stays close
    pitch: PITCH,
    maxPitch: 62,
    minZoom: MIN_ZOOM,
    maxZoom: 19,
    maxBounds: region.bounds,
    attributionControl: false,
    // Free movement: pan, zoom, rotate and tilt all work; the recenter button returns to the player.
    dragPan: true,
    dragRotate: true,
    doubleClickZoom: true,
    touchPitch: true,
    keyboard: true,
    // Phones at DPR 3 would fill a 3 Mpx canvas every walking frame; 2 looks the same at arm's length.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    canvasContextAttributes: { antialias: true },
  });
  startBearing = null;
  map.touchZoomRotate.enable();
  map.scrollZoom.enable();
  map.addControl(new ml.AttributionControl({ compact: false }), 'bottom-right');
  const padTop = () => map.setPadding({ top: Math.round(root.clientHeight * 0.32), bottom: 0, left: 0, right: 0 });
  padTop();
  map.on('resize', padTop);
  map.on('zoom', sizeRing);
  for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
    map.on(ev, (e) => { if (e.originalEvent) pauseFollow(); }); // camera easeTo/jumpTo carry no originalEvent
  }
  map.on('click', (e) => { if (presenter && !sheetStoreId) { buzz(); walkTo(e.lngLat.lat, e.lngLat.lng); } });

  const ringEl = document.createElement('div');
  ringEl.className = 'sm-ring';
  ringEl.innerHTML = '<div class="sm-ring-pulse"></div>';
  ring = new ml.Marker({ element: ringEl, pitchAlignment: 'map', rotationAlignment: 'map' }).setLngLat([start.lon, start.lat]).addTo(map);
  const hdEl = document.createElement('div');
  hdEl.className = 'sm-hunter-heading';
  hdEl.innerHTML = `<img src="${PLAYER_ART}heading.svg" alt="">`;
  heading = new ml.Marker({ element: hdEl, pitchAlignment: 'map', rotationAlignment: 'map' })
    .setLngLat([start.lon, start.lat]).addTo(map);

  const avEl = document.createElement('div');
  avEl.className = 'sm-hunter';
  const color = savedColor();
  const [idle, w1, w2] = hunterFrames(color);
  avEl.innerHTML = `<img class="sm-hunter-shadow" src="${PLAYER_ART}shadow.svg" alt="">`
    + `<div class="sm-hunter-sprite"><img class="sm-hunter-f sm-hunter-idle" src="${idle}" alt="">`
    + `<img class="sm-hunter-f sm-hunter-w1" src="${w1}" alt=""><img class="sm-hunter-f sm-hunter-w2" src="${w2}" alt=""></div>`;
  // The soles sit 9/192 above the canvas bottom; the offset puts them, not the canvas edge, on the position.
  avatar = new ml.Marker({ element: avEl, anchor: 'bottom', offset: [0, Math.round(PLAYER_H * 9 / 192)] })
    .setLngLat([start.lon, start.lat]).addTo(map);
  root.querySelectorAll('.sm-swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === color));
  sizeRing();

  // Wait for the style only, not every tile: one slow tile must not hold up spawns and the player.
  await new Promise((res, rej) => {
    if (map.isStyleLoaded()) { res(); return; }
    map.once('style.load', res);
    map.once('error', (e) => { if (!map?.isStyleLoaded()) rej(e?.error || new Error('map style failed to load')); });
  });
  root.querySelector('.sm-loading')?.remove();
  addDataLayers();
}

// A failed start leaves no half-built map behind and offers a retry; update() also retries on the
// next visit to #/map, so an app launched from the Home Screen recovers without a reload.
function mapFailed(e) {
  console.error('map failed to start', e);
  if (map) { try { map.remove(); } catch { /* already gone */ } }
  map = null; ml = null; avatar = null; ring = null; heading = null;
  spawnMarkers.clear(); stopMarkers.clear();
  lastQueryPos = null;
  let l = root.querySelector('.sm-loading');
  if (!l) { l = document.createElement('div'); l.className = 'sm-loading'; root.querySelector('.sm-map').after(l); }
  l.innerHTML = '<p>Map could not load. Check the connection.</p><button type="button" class="sm-retry">Try again</button>';
  l.querySelector('.sm-retry').onclick = () => { buzz(); startMap(); };
}

function startMap() {
  if (!starting) starting = runStart().finally(() => { starting = null; });
  return starting;
}

async function runStart() {
  const l = root.querySelector('.sm-loading');
  if (l) l.textContent = 'Loading map…';
  try {
    if (!map) await createMap();
    else {
      map.resize();
      if (regionChanged) map.setMaxBounds(region.bounds);
      if (startBearing != null) { map.jumpTo({ center: [pos.lon, pos.lat], bearing: startBearing }); startBearing = null; }
      addDataLayers();
    }
  } catch (e) {
    mapFailed(e);
    return;
  }
  regionChanged = false;
  if (mounted) afterMapReady();
}

export async function mount(el, c, params = {}) {
  if (mounted) unmount();
  mounted = true;
  paused = false;
  ctx = c;
  loadCss(ML_CSS).catch(() => { /* createMap awaits it and reports the failure */ });
  loadCss(MAP_CSS).catch(() => { /* the map still works, unstyled */ });
  if (!root) buildRoot();
  el.appendChild(root);
  // spawns.js pulls a CDN dependency; start it now so it loads alongside MapLibre.
  if (!spawnApi && !spawnLoading) spawnLoading = loadSpawnApi();

  const st = ctx.state?.get?.() || {};
  const q = new URLSearchParams(location.search + '&' + (location.hash.split('?')[1] || ''));
  forcedDemo = !!st.demo || q.get('demo') === '1';
  const newRegion = normRegion(ctx.data?.region);
  regionChanged = regionChanged || JSON.stringify(newRegion.bounds) !== JSON.stringify(region.bounds);
  region = newRegion;
  if (!pos || regionChanged) {
    const saved = st.position && toLatLon(st.position);
    if (saved && inRegion(saved)) pos = { ...saved, source: st.position.source || 'demo' };
    else {
      const s0 = stagedStart();
      pos = { lat: s0.lat, lon: s0.lon, source: 'demo' };
      startBearing = s0.bearing;
    }
  }

  ready = false;
  routeStoreId = params.storeId || decodeURIComponent((location.hash.match(/^#\/stop\/([^/?]+)/) || [])[1] || '') || null;
  await startMap();
}

function startSpawnTimer() {
  clearInterval(spawnTimer);
  spawnTimer = setInterval(() => { refreshSpawns(true); refreshStops(); updateRangeClasses(); updateSheet(); }, 10000);
}

// Rehearsal leftovers go with Settings > Reset progress: hidden spawns, stop cooldowns, the first-run tip.
function clearMapMemory() {
  gone = {}; spinsCache = {}; hinted = false;
  presenterSpun.clear();
  for (const k of [GONE_KEY, SPIN_KEY, HINT_KEY]) { try { localStorage.removeItem(k); } catch { /* storage off */ } }
  refreshSpawns(true);
  updateRangeClasses();
  updateSheet();
}

function afterMapReady() {
  setPresenter(readPresenterFlag());
  // Simulated until GPS has a usable fix and the player isn't moving by hand.
  setDemo(forcedDemo || presenter || !navigator.geolocation || !gpsFix || manual);
  setPos(pos, { push: true });
  refreshStops();
  startGps();
  // A site granted location on an earlier visit starts GPS without asking again.
  if (!gpsWanted && !forcedDemo && !presenter && navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' })
      .then((r) => { if (r.state === 'granted' && mounted && !paused) startGps(true); })
      .catch(() => { /* not supported */ });
  }
  const spawnsIn = (api) => {
    spawnApi = api;
    if (!mounted || !map) return;
    refreshSpawns(true);
    // Presenter mode: make sure the opening frame has a Simi to catch.
    if (presenter && !spawnOnScreen()) summonSimi({ quiet: true });
  };
  if (spawnApi) spawnsIn(spawnApi);
  else (spawnLoading || (spawnLoading = loadSpawnApi())).then(spawnsIn);
  startSpawnTimer();
  const onCatch = ctx.state?.on?.('catch', (snap, detail) => {
    const sid = detail?.spawnId ?? snap?.spawnId;
    if (sid) { setGone(sid, Date.now() + 3 * 3600 * 1000); summoned.delete(sid); }
    refreshSpawns(true);
  });
  if (typeof onCatch === 'function') unsubs.push(onCatch);
  // Listeners get (snapshot, detail); position updates arrive many times a second, so skip them first.
  const onChange = ctx.state?.on?.('change', (snap, detail) => {
    const kind = detail?.kind;
    if (kind === 'position') return;
    if (kind === 'reset') clearMapMemory();
    const pf = readPresenterFlag();
    if (pf !== presenter) setPresenter(pf);
    const f = !!(snap || ctx.state.get())?.demo;
    if (f === forcedDemo) return;
    forcedDemo = f;
    if (f) { stopGps(); setDemo(true); }
    else if (!presenter) { setDemo(!gpsFix || manual); startGps(); }
  });
  if (typeof onChange === 'function') unsubs.push(onChange);
  window.addEventListener('hashchange', onHash);
  window.addEventListener('deviceorientationabsolute', onOrient); // Android Chrome
  window.addEventListener('deviceorientation', onOrient);         // iOS (webkitCompassHeading)
  unsubs.push(() => {
    window.removeEventListener('deviceorientationabsolute', onOrient);
    window.removeEventListener('deviceorientation', onOrient);
  });
  unsubs.push(() => window.removeEventListener('hashchange', onHash));

  ready = true;
  if (routeStoreId) openSheet(routeStoreId);
  else closeSheet();
}

// The shell keeps the map mounted and calls update() for #/map <-> #/stop/:storeId.
export function update(params = {}, c) {
  if (c) ctx = c;
  routeStoreId = params.storeId || null;
  if (!mounted) return;
  if (!ready) { if (!map && !starting) startMap(); return; } // a failed start retries here; mount applies routeStoreId
  resume();
  if (params.storeId) openSheet(params.storeId);
  else closeSheet();
  if (map) { refreshStops(); updateRangeClasses(); }
}

const isMapHash = (h) => !h || h === '#' || h === '#/' || /^#\/(map|stop\/)/.test(h);

// Another screen covers the map: stop its timers, GPS watch and any walk until update() brings it back.
function pause() {
  if (paused) return;
  paused = true;
  clearInterval(spawnTimer);
  spawnTimer = 0;
  stopGps();
  joyVec = null;
  if (walk) stopWalk();
  cancelAnimationFrame(camRaf);
  camRaf = 0;
}

function resume() {
  if (!paused) return;
  paused = false;
  startSpawnTimer();
  startGps();
  if (pos) setPos(pos, { push: true });
  refreshSpawns(true);
  refreshStops();
}

function onHash() {
  const h = location.hash;
  // A sheet must not linger over another screen (e.g. after the back button).
  if (sheetStoreId && !/^#\/stop\//.test(h)) closeSheet();
  if (pendingEncounter) {
    let d = h;
    try { d = decodeURIComponent(h); } catch { /* keep raw */ }
    // Out of the encounter: a catch hides the spawn through the 'catch' event and a flee through
    // encounter.js's record; backing out without a throw leaves the Simi where it was.
    if (!d.startsWith('#/encounter/' + pendingEncounter.spawnId)) {
      pendingEncounter = null;
      refreshSpawns(true);
    }
  }
  if (!isMapHash(h)) pause();
}

export function unmount() {
  mounted = false;
  ready = false;
  stopGps();
  clearInterval(spawnTimer);
  spawnTimer = 0;
  clearTimeout(walkTimer);
  cancelAnimationFrame(rafId);
  rafId = 0;
  joyVec = null;
  if (walk) stopWalk();
  unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
  unsubs = [];
  if (joystick) { try { joystick.destroy(); } catch { /* ignore */ } joystick = null; }
  if (pos) { try { ctx?.state?.setPosition?.(pos); } catch { /* ignore */ } }
  closeSheet({ recenter: false });
  cancelAnimationFrame(camRaf);
  camRaf = 0;
  root?.remove();
}

// Test hook for headless checks (marker placement vs map.project).
export const _debugMap = () => map;
