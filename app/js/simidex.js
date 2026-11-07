// SimiDex: the collection grid (#/dex) and the entry page (#/dex/:simiId).
// Reads data.simis (falls back to the contract roster with placeholder names)
// and each Simi's art (falls back to a tier-colored tile).

const CONFETTI = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.module.mjs';
const CSS_URL = new URL('../css/simidex.css', import.meta.url).href;
const APP_BASE = new URL('../', import.meta.url);
const ART_DIR = new URL('../../art/simis/', import.meta.url);
const BASE_ART = new URL('../../art/base/simi-base.svg', import.meta.url).href;
const PREFS_KEY = 'simihunt.dex.v1';
const MINI_H = 56; // collapsed grid bar height; the real value (with the safe area) is read from the chips' sticky top
let stickTop = MINI_H;

// Dex order 001-018 and how each one unlocks (CONTRACT.md, "Shared ids").
const ROSTER = [
  ['classic', 'common'], ['gym', 'common'], ['sleepy', 'common'], ['futbol', 'common'],
  ['bombero', 'common'], ['chef', 'common'], ['beisbolista', 'common'],
  ['beach', 'shelf'], ['spa', 'shelf'], ['astronaut', 'shelf'], ['flu', 'shelf'], ['boxeador', 'shelf'],
  ['texas', 'store'], ['rockstar', 'store'], ['mariachi', 'store'],
  ['muertos', 'event'], ['luchador', 'event'], ['santa', 'event'],
];
const SHELF_OF = { beach: 'sun-care', spa: 'skincare', astronaut: 'vitamins', flu: 'cold-flu', boxeador: 'sports-nutrition' };
const STORE_OF = { texas: 'cvs-guadalupe-2402', rockstar: 'cvs-congress-500', mariachi: 'cvs-airport-2213' };
const PLACEHOLDER = {
  classic: ['Classic Simi', 'Simi Clásico'], gym: ['Gym Simi', 'Simi Gimnasta'], sleepy: ['Sleepy Simi', 'Simi Dormilón'],
  futbol: ['Fútbol Simi', 'Simi Futbolista'], bombero: ['Firefighter Simi', 'Simi Bombero'], chef: ['Chef Simi', 'Simi Chef'],
  beisbolista: ['Baseball Simi', 'Simi Beisbolista'], beach: ['Beach Simi', 'Simi Playero'], spa: ['Spa Simi', 'Simi Spa'],
  astronaut: ['Astronaut Simi', 'Simi Astronauta'], flu: ['Flu Fighter Simi', 'Simi Antigripal'], boxeador: ['Boxer Simi', 'Simi Boxeador'],
  texas: ['Texas Simi', 'Simi Texano'], rockstar: ['Rockstar Simi', 'Simi Rockero'], mariachi: ['Mariachi Simi', 'Simi Mariachi'],
  muertos: ['Día de Muertos Simi', 'Simi de Muertos'], luchador: ['Luchador Simi', 'Simi Luchador'], santa: ['Santa Simi', 'Simi Santa'],
};
const TIERS = {
  common: { label: 'Map', long: 'Map Simi', icon: 'pin', hint: 'Found on the map' },
  shelf: { label: 'Shelf', long: 'Shelf Simi', icon: 'shelf', hint: 'Scan a shelf sign' },
  store: { label: 'Store', long: 'Store exclusive', icon: 'store', hint: 'One CVS only' },
  event: { label: 'Event', long: 'Event Simi', icon: 'calendar', hint: 'Limited-time event' },
};
const DEFAULT_RARITY = { common: 'common', shelf: 'uncommon', store: 'rare', event: 'legendary' };
const FILTERS = [
  { id: 'all', label: 'All', icon: 'grid' }, { id: 'common', label: 'Map', icon: 'pin' }, { id: 'shelf', label: 'Shelf', icon: 'shelf' },
  { id: 'store', label: 'Store', icon: 'store' }, { id: 'event', label: 'Event', icon: 'calendar' },
];
const SHELVES = {
  'sun-care': 'Sun Care', skincare: 'Skincare', vitamins: 'Vitamins', sleep: 'Sleep',
  'sports-nutrition': 'Sports Nutrition', 'cold-flu': 'Cold & Flu', 'dr-simi': 'Dr. Simi',
};
const BADGE = { name: 'Barrio Champion', es: 'Campeón del Barrio' };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ICONS = {
  pin: '<path d="M12 21s-7-6.1-7-11.4A7 7 0 0 1 19 9.6C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.6"/>',
  shelf: '<path d="M3 10.5h18M3 20h18"/><rect x="5" y="4" width="4" height="6.5" rx="1"/><rect x="11" y="6" width="3.5" height="4.5" rx="1"/><rect x="6" y="13.5" width="3.5" height="6.5" rx="1"/><rect x="12" y="12.5" width="5" height="7.5" rx="1"/>',
  store: '<path d="M4.5 10.5V20h15v-9.5"/><path d="M3 10l2-6h14l2 6a3 3 0 0 1-6 .3 3 3 0 0 1-6 0A3 3 0 0 1 3 10z"/><path d="M10 20v-5h4v5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  nav: '<path d="M4 11.5L20 4l-7.5 16-2-6.5z"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  basket: '<path d="M4 9h16l-1.6 10.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8z"/><path d="M8.5 9L12 3.5 15.5 9"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
};
const icon = (name, cls = '') => `<svg class="sdx-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const MEDAL = `<svg class="sdx-medal" viewBox="0 0 120 140" aria-hidden="true">
  <defs><linearGradient id="sdxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE27A"/><stop offset=".55" stop-color="#F5B400"/><stop offset="1" stop-color="#E08600"/></linearGradient></defs>
  <path d="M34 0h22l12 42H46z" fill="#D60F3C"/><path d="M86 0H64L52 42h22z" fill="#024EA2"/>
  <circle cx="60" cy="86" r="46" fill="url(#sdxg)" stroke="#B87400" stroke-width="4"/>
  <circle cx="60" cy="86" r="35" fill="none" stroke="#FFF3B0" stroke-width="3" stroke-dasharray="3 5" stroke-linecap="round"/>
  <polygon points="60,64 65,79.1 79,79.8 68.1,88.6 71.8,102.2 60,94.5 48.2,102.2 51.9,88.6 41,79.8 55,79.1" fill="#fff"/>
</svg>`;

let root = null;
let ctx = null;
let current = { id: null };
let teardown = [];
let viewObs = [];
let lastDir = 0;
let renderTimer = 0;
let pendingVT = null;   // resolves the open view transition once the next screen has mounted
let vtSince = 0;        // when the running view transition started (0 = none)
let origin = { kind: null, at: 0 };
const view = {
  filter: null, gridScroll: 0, lang: 'en',
  popped: false,         // the grid's pop-in plays once per session
  entryFromGrid: false,  // the open entry was opened from this grid, so Back is a history step
  gridDeep: false,       // the grid replaced a deep-linked entry, so the map is not behind it
  returnFrom: null,      // entry id the grid was just reopened from
  lastKind: null, lastEntryId: null,
};
const missingArt = new Set();

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const title = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const pad = (n) => String(n).padStart(3, '0');
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Short vibration where the device supports it; only inside a tap, where browsers allow it.
function buzz(pattern) {
  try {
    if (!navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    navigator.vibrate(pattern);
  } catch { /* not supported */ }
}

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function writePrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch })); } catch { /* storage blocked */ }
}

function ensureCss() {
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === CSS_URL)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = CSS_URL;
  document.head.appendChild(l);
}

function safeState() {
  let st = {};
  try { st = (ctx.state && ctx.state.get && ctx.state.get()) || {}; } catch (e) { console.warn('[dex] state.get failed', e); }
  return {
    catches: Array.isArray(st.catches) ? st.catches : [],
    seen: Array.isArray(st.seen) ? st.seen : [],
    position: st.position && Number.isFinite(st.position.lat) ? st.position : null,
  };
}

function list(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v === 'string' && v.trim()) return v.split(/\s*[,;]\s*/).filter(Boolean);
  return [];
}

function buildEntries(data) {
  const byId = new Map((Array.isArray(data.simis) ? data.simis : []).filter((s) => s && s.id).map((s) => [s.id, s]));
  const out = ROSTER.map(([id, tier], i) => {
    const s = byId.get(id) || {};
    byId.delete(id);
    return normalize({ id, tier, dexNo: i + 1, ...s });
  });
  for (const s of byId.values()) out.push(normalize(s));
  return out.sort((a, b) => a.dexNo - b.dexNo);
}

function normalize(s) {
  const tier = TIERS[s.tier] ? s.tier : 'common';
  const ph = PLACEHOLDER[s.id] || [`${title(s.id)} Simi`, `Simi ${title(s.id)}`];
  return {
    ...s,
    tier,
    dexNo: Number(s.dexNo) || 999,
    name: s.name || ph[0],
    nameEs: s.nameEs || ph[1],
    rarity: s.rarity || DEFAULT_RARITY[tier],
    shelf: s.shelf || SHELF_OF[s.id] || null,
    storeId: s.storeId || STORE_OF[s.id] || null,
    personality: list(s.personality),
    funFacts: list(s.funFacts),
  };
}

function progressOf(entries, st) {
  const caught = new Set(st.catches.map((c) => c.simiId));
  const seen = new Set([...st.seen, ...caught]);
  const status = (id) => (caught.has(id) ? 'caught' : seen.has(id) ? 'seen' : 'locked');
  const byTier = {};
  for (const t of Object.keys(TIERS)) {
    const inTier = entries.filter((e) => e.tier === t);
    byTier[t] = { total: inTier.length, caught: inTier.filter((e) => caught.has(e.id)).length };
  }
  const ids = new Set(entries.map((e) => e.id));
  const nCaught = [...caught].filter((id) => ids.has(id)).length;
  const commonsDone = byTier.common.total > 0 && byTier.common.caught === byTier.common.total;
  return { status, byTier, nCaught, total: entries.length, commonsDone, caught };
}

// Caught Simis whose entry the player has not opened yet. The first time this runs,
// catches older than ten minutes count as already seen, so an existing collection
// does not light up all at once.
function viewedIds(st) {
  const p = readPrefs();
  if (Array.isArray(p.viewed)) return new Set(p.viewed);
  const cutoff = Date.now() - 10 * 60 * 1000;
  const latest = new Map();
  for (const c of st.catches) latest.set(c.simiId, Math.max(latest.get(c.simiId) || 0, Number(c.at) || 0));
  const seeded = [...latest].filter(([, at]) => at < cutoff).map(([id]) => id);
  writePrefs({ viewed: seeded });
  return new Set(seeded);
}
function newIdsOf(entries, prog, st) {
  const viewed = viewedIds(st);
  const stale = [...viewed].filter((id) => !prog.caught.has(id));
  if (stale.length) writePrefs({ viewed: [...viewed].filter((id) => prog.caught.has(id)) }); // after a reset
  return new Set(entries.filter((e) => prog.caught.has(e.id) && !viewed.has(e.id)).map((e) => e.id));
}
function markViewed(id, st) {
  const viewed = viewedIds(st);
  if (viewed.has(id)) return;
  viewed.add(id);
  writePrefs({ viewed: [...viewed] });
}

function haversineM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function distShort(store, pos) {
  if (!pos || !store || !Number.isFinite(store.lat) || !Number.isFinite(store.lon)) return '';
  const m = haversineM(pos, store);
  const mi = m / 1609.344;
  return mi < 0.1 ? `${Math.max(50, Math.round(m * 3.28084 / 50) * 50)} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}
function distText(store, pos) {
  const d = distShort(store, pos);
  return d ? `${d} away` : '';
}

function storeName(id) {
  const m = /^cvs-(.+)-(\d+)$/.exec(id || '');
  return m ? `CVS · ${m[2]} ${title(m[1])}` : (id ? title(id) : 'A participating CVS');
}
// Every store is named "CVS Pharmacy", so the street address is what tells them apart.
function storeLabel(s) {
  const street = s.address ? String(s.address).split(',')[0].trim() : '';
  if (s.name && /\d/.test(s.name)) return s.name;
  return street ? `CVS · ${street}` : (s.name || storeName(s.id));
}
function storeFor(e, data) {
  const stores = Array.isArray(data.stores) ? data.stores : [];
  const s = stores.find((x) => x.exclusiveSimi === e.id) || stores.find((x) => x.id === e.storeId);
  if (s) return { ...s, name: storeLabel(s) };
  return e.storeId ? { id: e.storeId, name: storeName(e.storeId) } : null;
}
function storeById(id, data) {
  const s = (Array.isArray(data.stores) ? data.stores : []).find((x) => x.id === id);
  return s ? { ...s, name: storeLabel(s) } : { id, name: storeName(id) };
}
// Where "See their shelf" points: the store it was caught at, else the nearest store with that shelf.
function shelfStoreId(e, catchRec, data, pos) {
  if (catchRec && catchRec.storeId) return catchRec.storeId;
  const stores = (Array.isArray(data.stores) ? data.stores : []).filter((s) => !Array.isArray(s.shelves) || s.shelves.includes(e.shelf));
  if (stores.length && pos) {
    stores.sort((a, b) => haversineM(pos, a) - haversineM(pos, b));
  }
  return (stores[0] && stores[0].id) || 'cvs-guadalupe-2402';
}

function artUrl(e) {
  try { return e.art ? new URL(e.art, APP_BASE).href : new URL(`${e.id}.svg`, ART_DIR).href; } catch { return new URL(`${e.id}.svg`, ART_DIR).href; }
}
function placeholderHTML(e) {
  return `<div class="sdx-ph"><span class="sdx-ph-letter">${esc((e.name || '?').replace(/^(Simi|Dr\.?)\s+/i, '').charAt(0))}</span><img class="sdx-img sdx-base" src="${BASE_ART}" alt=""></div>`;
}
function artHTML(e, status, cls = '') {
  const inner = missingArt.has(e.id)
    ? placeholderHTML(e)
    : `<img class="sdx-img" src="${esc(artUrl(e))}" alt="" decoding="async" data-simi="${esc(e.id)}" draggable="false">`;
  return `<div class="sdx-art ${cls}" data-status="${status}">${inner}</div>`;
}

function firstCatch(id, st) {
  const mine = st.catches.filter((c) => c.simiId === id);
  if (!mine.length) return null;
  const first = mine.reduce((a, b) => ((a.at || 0) <= (b.at || 0) ? a : b));
  return { ...first, count: mine.length };
}
function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; }
}
function biomeText(e) {
  if (!e.biome) return 'All around the neighborhood';
  return /\s/.test(e.biome) ? e.biome : title(e.biome);
}

// Reads the event window from the lore's unlock line ("... during Día de Muertos, November 1 to 3.",
// "... on weekends ...") and says whether it is on today, on the player's own clock.
function eventInfo(e, now = new Date()) {
  const txt = String(e.unlock || '');
  const phrase = ((/\bduring\s+([^.]+)/i.exec(txt) || /\bon\s+(weekends[^.]*)/i.exec(txt) || [])[1] || '').trim();
  const when = phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : 'Watch the map for the next event';
  if (/weekend|saturday|sunday/i.test(txt)) {
    const d = now.getDay();
    if (d === 0 || d === 6) return { live: true, label: 'On the map now · this weekend', when };
    return { live: false, label: d === 5 ? 'Back tomorrow · Saturday' : 'Back this Saturday', when };
  }
  const M = MONTHS.join('|');
  const m = new RegExp(`(${M})\\s+(\\d{1,2})\\s*(?:to|through|-|–)\\s*(?:(${M})\\s+)?(\\d{1,2})`, 'i').exec(txt);
  if (m) {
    const y = now.getFullYear();
    const m1 = MONTHS.indexOf(m[1].toLowerCase());
    const m2 = m[3] ? MONTHS.indexOf(m[3].toLowerCase()) : m1;
    const start = new Date(y, m1, Number(m[2]));
    const end = new Date(y, m2, Number(m[4]), 23, 59, 59);
    if (now >= start && now <= end) return { live: true, label: 'On the map now', when };
    if (now < start) return { live: false, label: `Starts ${MON[m1]} ${Number(m[2])}`, when };
    return { live: false, label: 'Event over · back next year', when };
  }
  return { live: false, label: 'Limited-time event', when };
}

// ---------- navigation ----------

function setOrigin(kind) { origin = { kind, at: performance.now() }; }
function takeOrigin() {
  const k = performance.now() - origin.at < 2000 ? origin.kind : null;
  origin = { kind: null, at: 0 };
  return k;
}
function backTo(fallback) {
  if (typeof ctx.back === 'function') ctx.back(fallback);
  else ctx.go(fallback, { replace: true });
}

const canMorph = () => typeof document.startViewTransition === 'function' && !reducedMotion();
function nameForMorph(el, name) {
  if (!el) return;
  el.style.viewTransitionName = name;
  el.dataset.vt = '1';
}
function clearMorph() {
  document.querySelectorAll('.sdx [data-vt]').forEach((el) => { el.style.viewTransitionName = ''; el.removeAttribute('data-vt'); });
  document.documentElement.classList.remove('sdx-vt');
}
// Runs navigate() inside a view transition so `fromEl` grows into (or shrinks back to)
// its counterpart on the next screen. Falls back to a plain navigation.
function morph(fromEl, navigate) {
  if (vtSince && performance.now() - vtSince < 1500) return; // a transition is already running
  if (!canMorph() || !fromEl) { navigate(); return; }
  clearMorph();
  nameForMorph(fromEl, 'sdx-hero');
  nameForMorph(root.querySelector('.sdx-close'), 'sdx-close');
  document.documentElement.classList.add('sdx-vt');
  vtSince = performance.now();
  let vt;
  try {
    vt = document.startViewTransition(() => new Promise((resolve) => {
      pendingVT = resolve;
      setTimeout(resolve, 450);
      try { navigate(); } catch (e) { console.warn('[dex] navigation failed', e); resolve(); }
    }));
  } catch {
    vtSince = 0;
    clearMorph();
    navigate();
    return;
  }
  vt.ready.catch(() => { /* skipped: the page still updates */ });
  vt.finished.catch(() => {}).finally(() => {
    vtSince = 0;
    pendingVT = null;
    clearMorph();
    pulseReturned();
  });
}
// Called at the end of mount(): name the element the old one morphs into, then let the transition run.
function finishMorph() {
  if (!pendingVT) return;
  if (current.id) {
    nameForMorph(root.querySelector('.sdx-hero-art'), 'sdx-hero');
  } else if (view.returnFrom) {
    nameForMorph(root.querySelector(`.sdx-list [data-id="${CSS.escape(view.returnFrom)}"] .sdx-art`), 'sdx-hero');
  }
  nameForMorph(root.querySelector('.sdx-close'), 'sdx-close');
  const r = pendingVT;
  pendingVT = null;
  r();
}

function openEntry(link) {
  view.gridScroll = root.scrollTop;
  setOrigin('grid');
  lastDir = 0;
  const hash = link.dataset.go;
  morph(link.querySelector('.sdx-art'), () => ctx.go(hash));
}
function closeEntry() {
  if (!current.id) return;
  const fromGrid = view.entryFromGrid;
  setOrigin(fromGrid ? 'entry-back' : 'deep-replace');
  lastDir = 0;
  morph(root.querySelector('.sdx-hero-art'), () => (fromGrid ? backTo('#/dex') : ctx.go('#/dex', { replace: true })));
}
function closeGrid() {
  if (view.gridDeep) ctx.go('#/map', { replace: true });
  else backTo('#/map');
}
function step(dir) {
  const b = root && root.querySelector(`[data-step="${dir < 0 ? -1 : 1}"]`);
  if (!b) return;
  buzz(12);
  lastDir = dir;
  setOrigin('step');
  ctx.go(b.dataset.go, { replace: true });
}
function nav(hash) {
  if (!current.id && root) view.gridScroll = root.scrollTop;
  lastDir = 0;
  ctx.go(hash);
}

// ---------- grid ----------

function ringHTML(prog) {
  const pct = prog.total ? prog.nCaught / prog.total : 0;
  const r = 24, c = 2 * Math.PI * r;
  return `<div class="sdx-ring-wrap" role="img" aria-label="${prog.nCaught} of ${prog.total} caught">
    <svg class="sdx-ring" viewBox="0 0 60 60" aria-hidden="true">
      <circle cx="30" cy="30" r="${r}" class="sdx-ring-track"/>
      <circle cx="30" cy="30" r="${r}" class="sdx-ring-val" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(1)}"/>
    </svg>
    <span class="sdx-ring-txt" aria-hidden="true"><b>${prog.nCaught}</b><small>/${prog.total}</small></span>
  </div>`;
}

function cheer(prog) {
  if (prog.total && prog.nCaught >= prog.total) return '¡Completo! You caught them all';
  if (!prog.nCaught) return `0 of ${prog.total} · Let's go! ¡Vamos!`;
  return `${prog.nCaught} of ${prog.total} caught · ¡Vamos!`;
}

// The one next thing to aim for, in a single tappable line.
function goalHTML(prog) {
  const c = prog.byTier.common;
  if (prog.total && prog.nCaught >= prog.total) {
    return `<div class="sdx-goal" data-done="true">${icon('trophy')}<span>Every Simi caught · ¡Felicidades!</span></div>`;
  }
  if (prog.commonsDone) {
    return `<button class="sdx-goal" data-act="badge" data-earned="true" aria-label="${BADGE.name} badge earned. Show it">${MEDAL}<span><b>${BADGE.name}</b> earned!</span>${icon('next', 'sdx-goal-go')}</button>`;
  }
  const left = c.total - c.caught;
  return `<button class="sdx-goal" data-filter="common" data-goal aria-label="Show Map Simis. ${left} more to earn ${BADGE.name}">${MEDAL}
    <span><b>${left} more</b> Map Simi${left === 1 ? '' : 's'} → ${BADGE.name}</span>
    <i class="sdx-goal-bar" aria-hidden="true"><i style="transform:scaleX(${c.total ? (c.caught / c.total).toFixed(3) : 0})"></i></i>${icon('next', 'sdx-goal-go')}</button>`;
}

function startHTML(entries) {
  const classic = entries.find((e) => e.id === 'classic') || entries[0];
  return `<section class="sdx-start" aria-label="Start here">
    <div class="sdx-start-top">
      ${classic ? artHTML(classic, 'caught', 'sdx-start-art') : ''}
      <div class="sdx-start-text">
        <small>Start here</small>
        <h2>Catch your first Simi</h2>
        <p lang="es">Atrapa tu primer Simi</p>
      </div>
    </div>
    <div class="sdx-start-actions">
      <button class="sdx-btn sdx-btn-xl" data-act="hunt">${icon('pin')}<span class="sdx-btn-lbl">Go hunting<small lang="es">¡A cazar!</small></span></button>
      <button class="sdx-btn sdx-btn-ghost" data-go="#/scan">${icon('qr')}<span class="sdx-btn-lbl">Scan a sign<small lang="es">Escanear</small></span></button>
    </div>
  </section>`;
}

function chipsHTML(prog) {
  return FILTERS.map((f) => {
    const n = f.id === 'all' ? `${prog.nCaught}/${prog.total}` : `${prog.byTier[f.id].caught}/${prog.byTier[f.id].total}`;
    return `<button class="sdx-chip" data-filter="${f.id}" ${f.id !== 'all' ? `data-tier="${f.id}"` : ''} aria-pressed="${view.filter === f.id}" aria-label="${f.label}, ${n} caught">
      <span class="sdx-chip-top">${icon(f.icon)}<small>${n}</small></span><span class="sdx-chip-label">${f.label}</span></button>`;
  }).join('');
}

function cardHTML(e, status, i, isNew) {
  const t = TIERS[e.tier];
  const hint = status === 'caught' ? '' : `<span class="sdx-hint">${icon(t.icon)}</span>`;
  const label = status === 'locked' ? t.label : esc(e.name);
  const aria = status === 'locked' ? `Number ${e.dexNo}, not found yet. ${t.hint}` : `Number ${e.dexNo}, ${e.name}${status === 'seen' ? ', spotted, not caught' : ''}${isNew ? ', new' : ''}`;
  return `<li><a class="sdx-card${isNew ? ' is-new' : ''}" href="#/dex/${esc(e.id)}" data-go="#/dex/${esc(e.id)}" data-id="${esc(e.id)}" data-status="${status}" data-tier="${e.tier}" style="--i:${i}" aria-label="${esc(aria)}">
    <span class="sdx-no">${pad(e.dexNo)}</span>${hint}${isNew ? '<span class="sdx-new" aria-hidden="true">NEW · NUEVO</span>' : ''}
    ${artHTML(e, status)}
    <span class="sdx-name">${label}</span>
  </a></li>`;
}

// The Store filter shows each exclusive with its store, distance and a Navigate button.
function storeRowHTML(e, status, store, pos, isNew) {
  const d = distText(store, pos);
  return `<li><div class="sdx-row" data-tier="store" data-status="${status}">
    <a class="sdx-row-main" href="#/dex/${esc(e.id)}" data-go="#/dex/${esc(e.id)}" data-id="${esc(e.id)}" aria-label="${esc(status === 'locked' ? `Store exclusive at ${store ? store.name : 'one CVS'}` : e.name)}">
      ${artHTML(e, status, 'sdx-row-art')}
      <span class="sdx-row-text">
        <span class="sdx-row-name">${status === 'locked' ? 'Store exclusive' : esc(e.name)}${status === 'caught' ? icon('check', 'sdx-row-check') : ''}${isNew ? '<span class="sdx-new sdx-new-inline">NEW</span>' : ''}</span>
        <span class="sdx-row-store">${esc(store ? store.name : 'One CVS only')}</span>
        <span class="sdx-row-dist" data-store="${esc(store?.id || '')}">${esc(d)}</span>
      </span>
    </a>
    ${store ? `<button class="sdx-row-go" data-go="#/stop/${esc(store.id)}" aria-label="Navigate to ${esc(store.name)}">${icon('nav')}</button>` : ''}
  </div></li>`;
}

function listHTML(entries, prog, st, data, newIds) {
  const shown = entries.filter((e) => view.filter === 'all' || e.tier === view.filter);
  if (!shown.length) return '<p class="sdx-empty">Nothing here yet. Check back soon.</p>';
  if (view.filter === 'store') {
    const pos = st.position;
    const rows = shown.map((e) => ({ e, store: storeFor(e, data) }));
    if (pos) rows.sort((a, b) => (Number.isFinite(a.store?.lat) ? haversineM(pos, a.store) : 1e12) - (Number.isFinite(b.store?.lat) ? haversineM(pos, b.store) : 1e12));
    return `<ol class="sdx-rows">${rows.map(({ e, store }) => storeRowHTML(e, prog.status(e.id), store, pos, newIds.has(e.id))).join('')}</ol>`;
  }
  return `<ol class="sdx-grid">${shown.map((e, i) => cardHTML(e, prog.status(e.id), i, newIds.has(e.id))).join('')}</ol>`;
}

function renderGrid(entries, prog, st, data) {
  const newIds = newIdsOf(entries, prog, st);
  root.dataset.view = 'grid';
  root.dataset.show = view.filter;
  root.removeAttribute('data-tier');
  root.removeAttribute('data-status');
  const newPill = newIds.size ? `<span class="sdx-new-pill">${newIds.size} new</span>` : '';
  root.innerHTML = `
    <div class="sdx-mini" inert>
      <button class="sdx-round sdx-round-ink" data-act="close" aria-label="Back to map">${icon('back')}</button>
      <b>SimiDex</b>${newPill}<span class="sdx-mini-count">${prog.nCaught}/${prog.total}</span>
    </div>
    <header class="sdx-head">
      <div class="sdx-head-top">
        <button class="sdx-round" data-act="close" aria-label="Back to map">${icon('back')}</button>
        <div class="sdx-head-title"><h1>SimiDex ${newPill}</h1><p>${esc(cheer(prog))}</p></div>
        ${ringHTML(prog)}
      </div>
      ${goalHTML(prog)}
    </header>
    ${prog.nCaught === 0 ? startHTML(entries) : ''}
    <i class="sdx-stick-mark" aria-hidden="true"></i>
    <nav class="sdx-chips" aria-label="Filter">${chipsHTML(prog)}</nav>
    <div class="sdx-list">${listHTML(entries, prog, st, data, newIds)}</div>
    <p class="sdx-foot">${icon('pin')}${icon('shelf')}${icon('store')}${icon('calendar')}<span>The icon on each card shows where to find it.</span></p>
    <div class="sdx-dock"><button class="sdx-close" data-act="close" aria-label="Close SimiDex, back to map">${icon('close')}</button></div>`;
  watchStuck();
  return newIds;
}

// Collapsed bar: once the filter chips reach the top, a slim bar with Back and progress slides in above them.
function watchStuck() {
  const mark = root.querySelector('.sdx-stick-mark');
  const mini = root.querySelector('.sdx-mini');
  const chips = root.querySelector('.sdx-chips');
  if (!mark || !mini || typeof IntersectionObserver !== 'function') return;
  stickTop = Math.round(parseFloat(chips ? getComputedStyle(chips).top : '') || MINI_H);
  const io = new IntersectionObserver(([en]) => {
    if (!root) return;
    const stuck = !en.isIntersecting && en.boundingClientRect.top < (en.rootBounds ? en.rootBounds.top : stickTop);
    root.classList.toggle('is-stuck', stuck);
    mini.inert = !stuck;
  }, { root, rootMargin: `-${stickTop}px 0px 0px 0px`, threshold: 0 });
  io.observe(mark);
  viewObs.push(io);
}

function refreshList() {
  const data = ctx.data || {};
  const st = safeState();
  const entries = buildEntries(data);
  const prog = progressOf(entries, st);
  root.classList.add('sdx-noanim'); // after the first pop-in, a filter change only fades
  root.querySelector('.sdx-chips').innerHTML = chipsHTML(prog);
  const listEl = root.querySelector('.sdx-list');
  listEl.innerHTML = listHTML(entries, prog, st, data, newIdsOf(entries, prog, st));
  listEl.classList.remove('is-swap');
  void listEl.offsetWidth; // restart the fade
  listEl.classList.add('is-swap');
}

function setFilter(id, fromGoal) {
  if (!FILTERS.some((f) => f.id === id)) return;
  const wasStuck = root.classList.contains('is-stuck');
  view.filter = id;
  root.dataset.show = id;
  writePrefs({ filter: id });
  refreshList();
  const mark = root.querySelector('.sdx-stick-mark');
  if (!mark) return;
  const target = Math.max(0, mark.offsetTop - stickTop + 1); // 1px past the line, so the chips count as stuck
  // Keep the chips where the thumb is: if they were stuck, they stay stuck; the goal line scrolls to them.
  if (wasStuck) root.scrollTop = target;
  else if (fromGoal) root.scrollTo({ top: target, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

// ---------- entry ----------

function badgesHTML(e, status) {
  const t = TIERS[e.tier];
  return `<div class="sdx-badges">
    <span class="sdx-badge sdx-tier-badge" data-tier="${e.tier}">${icon(t.icon)}${esc(t.long)}</span>
    ${status === 'seen' ? `<span class="sdx-badge sdx-spotted">${icon('eye')}Spotted</span>` : `<span class="sdx-badge sdx-rarity" data-rarity="${esc(e.rarity)}">${esc(title(e.rarity))}</span>`}
  </div>`;
}

function btnHTML(a, cls = '') {
  const go = a.go ? ` data-go="${esc(a.go)}"` : '';
  const aria = a.aria ? ` aria-label="${esc(a.aria)}"` : '';
  return `<button class="sdx-btn ${cls}"${go}${aria}>${icon(a.ic)}<span class="sdx-btn-lbl">${esc(a.en)}${a.es ? `<small lang="es">${esc(a.es)}</small>` : ''}</span></button>`;
}

// The one thing to do next for this Simi, by tier and status.
function mainActionHTML(e, status, data, st, rec, store) {
  const hunt = { go: '#/map', ic: 'pin', en: 'Go hunting', es: '¡A cazar!' };
  const scan = { go: '#/scan', ic: 'qr', en: 'Scan a sign', es: 'Escanea el letrero' };
  let main = hunt, extra = null;
  if (e.tier === 'shelf') {
    main = status === 'caught'
      ? { go: `#/shelf/${shelfStoreId(e, rec, data, st.position)}/${e.shelf}`, ic: 'basket', en: 'See their shelf', es: 'Ver su estante' }
      : scan;
  } else if (e.tier === 'store') {
    const d = distShort(store, st.position);
    const navTo = store ? { go: `#/stop/${store.id}`, ic: 'nav', en: `Navigate${d ? ` · ${d}` : ''}`, es: 'Cómo llegar' } : scan;
    if (status === 'caught' && rec && rec.storeId && rec.shelfType) {
      main = { go: `#/shelf/${rec.storeId}/${rec.shelfType}`, ic: 'basket', en: 'See their shelf', es: 'Ver su estante' };
      extra = store ? { go: navTo.go, ic: 'nav', en: d || 'Go', aria: `Navigate to ${store.name}` } : null;
    } else {
      main = navTo;
    }
  } else if (e.tier === 'event') {
    const ev = eventInfo(e);
    main = ev.live || status === 'caught' ? hunt : { go: '#/map', ic: 'pin', en: 'Back to map', es: 'Volver al mapa' };
  }
  return `<div class="sdx-cta">${btnHTML(main, 'sdx-btn-xl')}${extra ? btnHTML(extra, 'sdx-btn-ghost sdx-btn-side') : ''}</div>`;
}

function whereHTML(e, data, st, store) {
  let b = '', s = '';
  if (e.tier === 'common') {
    b = 'Out on the map'; s = biomeText(e);
  } else if (e.tier === 'shelf') {
    b = `${SHELVES[e.shelf] || title(e.shelf)} shelf`; s = 'Any CVS SimiStop · scan the Simi Hunt sign';
  } else if (e.tier === 'store') {
    const d = distText(store, st.position);
    b = store ? store.name : 'One CVS only'; s = `Dr. Simi shelf${d ? ` · ${d}` : ''} · only here`;
  } else {
    const ev = eventInfo(e);
    b = ev.label; s = ev.when;
  }
  return `<section class="sdx-panel sdx-where">
    <h3>Where to find it</h3>
    <div class="sdx-found-row"><span class="sdx-found-ic" data-tier="${e.tier}">${icon(TIERS[e.tier].icon)}</span><div class="sdx-found-text"><b>${esc(b)}</b><span>${esc(s)}</span></div></div>
  </section>`;
}

function recordHTML(rec, data) {
  if (!rec) return '';
  let src = 'Caught on the map', ic = 'pin';
  if (rec.source === 'qr') {
    ic = 'qr';
    src = `Scanned at ${rec.storeId ? storeById(rec.storeId, data).name : 'a CVS'}${rec.shelfType ? ` · ${SHELVES[rec.shelfType] || title(rec.shelfType)}` : ''}`;
  } else if (rec.source === 'event') { ic = 'calendar'; src = 'Caught during an event'; }
  return `<section class="sdx-record">
    <span class="sdx-record-ic">${icon(ic)}</span>
    <div><small>First caught</small><b>${esc(fmtDate(rec.at))}</b><span>${esc(src)}</span></div>
    ${rec.count > 1 ? `<span class="sdx-count">×${rec.count}</span>` : ''}
  </section>`;
}

function loreHTML(e) {
  const parts = [];
  if (e.flavor) parts.push(`<p class="sdx-flavor">${esc(e.flavor)}</p>`);
  const stats = [['Height', e.height], ['Weight', e.weight]];
  parts.push(`<div class="sdx-stats">${stats.map(([k, v]) => `<div><small>${k}</small><b>${esc(v || '—')}</b></div>`).join('')}</div>`);
  if (e.catchphrase || e.catchphraseEs) {
    const en = e.catchphrase || e.catchphraseEs, es = e.catchphraseEs || e.catchphrase;
    parts.push(`<section class="sdx-panel sdx-quote" data-lang="${view.lang}">
      <div class="sdx-quote-head"><h3>Catchphrase</h3>
        <div class="sdx-seg" role="group" aria-label="Language">
          <button data-lang="en" aria-pressed="${view.lang === 'en'}">EN</button><button data-lang="es" aria-pressed="${view.lang === 'es'}">ES</button>
        </div></div>
      <blockquote><span class="sdx-q-en" lang="en">${esc(en)}</span><span class="sdx-q-es" lang="es">${esc(es)}</span></blockquote>
    </section>`);
  }
  if (e.personality.length) {
    parts.push(`<section class="sdx-panel"><h3>Personality</h3><div class="sdx-pchips">${e.personality.map((p) => `<span>${esc(p)}</span>`).join('')}</div></section>`);
  }
  if (e.story) {
    const long = String(e.story).length > 220;
    parts.push(`<section class="sdx-panel"><h3>Story</h3><p class="sdx-story${long ? ' is-clamped' : ''}" id="sdx-story">${esc(e.story)}</p>
      ${long ? '<button class="sdx-more" data-act="more" aria-expanded="false" aria-controls="sdx-story">Read more</button>' : ''}</section>`);
  }
  if (e.favoriteProduct) parts.push(`<section class="sdx-panel sdx-fav">${icon('basket')}<div><small>Favorite product</small><b>${esc(e.favoriteProduct)}</b></div></section>`);
  if (e.funFacts.length) {
    parts.push(`<section class="sdx-panel"><h3>Fun facts</h3><ol class="sdx-facts">${e.funFacts.map((f) => `<li>${esc(f)}</li>`).join('')}</ol></section>`);
  }
  if (!e.flavor && !e.story && !e.funFacts.length) parts.push('<p class="sdx-soon">Field notes for this Simi are still being written.</p>');
  return parts.join('');
}

function renderEntry(entries, prog, st, data) {
  const idx = entries.findIndex((e) => e.id === current.id);
  root.dataset.view = 'entry';
  if (idx < 0) {
    root.removeAttribute('data-tier');
    root.removeAttribute('data-status');
    root.innerHTML = `<div class="sdx-missing"><p>That Simi isn't in the SimiDex.</p><button class="sdx-btn sdx-btn-xl" data-act="close">${icon('grid')}<span class="sdx-btn-lbl">Open the SimiDex</span></button></div>`;
    return;
  }
  const e = entries[idx];
  const status = prog.status(e.id);
  const prev = entries[(idx - 1 + entries.length) % entries.length];
  const next = entries[(idx + 1) % entries.length];
  const rec = firstCatch(e.id, st);
  const t = TIERS[e.tier];
  const store = e.tier === 'store' ? storeFor(e, data) : null;
  root.dataset.tier = e.tier;
  root.dataset.status = status;
  if (status === 'caught') markViewed(e.id, st);

  const action = mainActionHTML(e, status, data, st, rec, store);
  let sheet;
  if (status === 'locked') {
    sheet = `
      <div class="sdx-title"><h1>Mystery Simi</h1><div class="sdx-es" lang="es">Simi misterioso</div>
        <div class="sdx-hint-pill" data-tier="${e.tier}">${icon(t.icon)}${esc(t.long)} · ${esc(t.hint)}</div></div>
      ${action}
      ${whereHTML(e, data, st, store)}`;
  } else if (status === 'seen') {
    sheet = `
      <div class="sdx-title"><h1>${esc(e.name)}</h1><div class="sdx-es" lang="es">${esc(e.nameEs)}</div>${badgesHTML(e, status)}</div>
      ${action}
      <p class="sdx-seen-note">${icon('lock')}<span>Catch it to unlock its story and stats.</span></p>
      ${whereHTML(e, data, st, store)}`;
  } else {
    sheet = `
      <div class="sdx-title"><h1>${esc(e.name)}</h1><div class="sdx-es" lang="es">${esc(e.nameEs)}</div>${badgesHTML(e, status)}</div>
      ${recordHTML(rec, data)}
      ${action}
      ${loreHTML(e)}
      ${whereHTML(e, data, st, store)}`;
  }

  root.innerHTML = `
    <div class="sdx-entry" data-dir="${lastDir}">
      <div class="sdx-hero">
        <div class="sdx-rays" aria-hidden="true"></div>
        <div class="sdx-topbar">
          <button class="sdx-round" data-act="close" aria-label="Back to SimiDex">${icon('back')}</button>
          <span class="sdx-hero-no">No. ${pad(e.dexNo)}</span>
          <span class="sdx-hero-pos" aria-label="Entry ${idx + 1} of ${entries.length}">${idx + 1} / ${entries.length}</span>
        </div>
        <div class="sdx-hero-stage">${artHTML(e, status, 'sdx-hero-art')}</div>
      </div>
      <div class="sdx-sheet">${sheet}</div>
    </div>
    <div class="sdx-dock sdx-dock-3">
      <button class="sdx-step" data-step="-1" data-go="#/dex/${esc(prev.id)}" aria-label="Previous entry">${icon('back')}</button>
      <button class="sdx-close" data-act="close" aria-label="Back to SimiDex">${icon('close')}</button>
      <button class="sdx-step" data-step="1" data-go="#/dex/${esc(next.id)}" aria-label="Next entry">${icon('next')}</button>
    </div>`;
  root.scrollTop = 0;
  watchHero();
}

// Stop the spinning rays once the hero is scrolled away, so reading the lore costs nothing.
function watchHero() {
  const hero = root.querySelector('.sdx-hero');
  if (!hero || typeof IntersectionObserver !== 'function') return;
  const io = new IntersectionObserver(([en]) => {
    if (root) root.classList.toggle('is-past-hero', !en.isIntersecting);
  }, { root, threshold: 0 });
  io.observe(hero);
  viewObs.push(io);
}

// First entry ever opened: nudge the art sideways once so swiping is discoverable.
function teachSwipe() {
  if (readPrefs().swipeTaught || reducedMotion()) return;
  const stage = root.querySelector('.sdx-hero-stage');
  if (!stage) return;
  writePrefs({ swipeTaught: true });
  stage.classList.add('is-nudge');
}

// ---------- reward moment ----------

function showBadgeModal() {
  if (!root || root.querySelector('.sdx-modal')) return;
  const m = document.createElement('div');
  m.className = 'sdx-modal';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.setAttribute('aria-label', `${BADGE.name} badge earned`);
  m.innerHTML = `<div class="sdx-modal-card">
    <div class="sdx-modal-glow" aria-hidden="true"></div>
    ${MEDAL}
    <small>Badge earned</small>
    <h2>${BADGE.name}</h2>
    <p class="sdx-es" lang="es">${BADGE.es}</p>
    <p>You caught every Map Simi in the neighborhood. Next up: shelf signs and store exclusives at your local CVS.</p>
    <button class="sdx-btn sdx-btn-xl" data-act="close-modal"><span class="sdx-btn-lbl">¡Órale! Nice</span></button>
  </div>`;
  root.appendChild(m);
  const close = m.querySelector('[data-act=close-modal]');
  setTimeout(() => close.focus({ preventScroll: true }), 50);
  writePrefs({ badgeShown: true });
  buzz([20, 40, 30]);
  if (!reducedMotion()) {
    import(CONFETTI).then((mod) => {
      if (!m.isConnected) return;
      const fire = mod.default;
      const colors = ['#024EA2', '#0798E8', '#D60F3C', '#F5B400', '#ffffff'];
      fire({ particleCount: 120, spread: 80, origin: { y: 0.45 }, colors, zIndex: 10000 });
      setTimeout(() => fire({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.6 }, colors, zIndex: 10000 }), 250);
      setTimeout(() => fire({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.6 }, colors, zIndex: 10000 }), 400);
    }).catch(() => { /* offline: the medal still shows */ });
  }
}

function closeBadgeModal() {
  const m = root && root.querySelector('.sdx-modal');
  if (!m) return false;
  m.remove();
  const back = root.querySelector('.sdx-goal[data-act=badge]');
  if (back) back.focus({ preventScroll: true });
  return true;
}

// ---------- events ----------

function render(animate) {
  if (!root) return;
  for (const io of viewObs.splice(0)) io.disconnect();
  const data = ctx.data || {};
  const st = safeState();
  const entries = buildEntries(data);
  const prog = progressOf(entries, st);
  root.classList.toggle('sdx-noanim', !animate);
  if (current.id) {
    renderEntry(entries, prog, st, data);
    return { prog };
  }
  const newIds = renderGrid(entries, prog, st, data);
  root.scrollTop = view.gridScroll;
  if (prog.commonsDone && !readPrefs().badgeShown) setTimeout(showBadgeModal, animate ? 450 : 0);
  return { prog, newIds };
}

// The card the player just came back from gives one small bounce.
function pulseReturned() {
  if (!root || current.id || !view.returnFrom || reducedMotion()) return;
  const card = root.querySelector(`.sdx-list [data-id="${CSS.escape(view.returnFrom)}"]`);
  view.returnFrom = null;
  if (!card) return;
  card.classList.remove('sdx-pulse');
  void card.offsetWidth;
  card.classList.add('sdx-pulse');
}

// Bring the first unopened catch into view when the grid opens.
function revealNew(newIds, returning) {
  if (!newIds || !newIds.size || returning) return;
  const first = root.querySelector('.sdx-list .is-new');
  if (!first) return;
  const r = first.getBoundingClientRect(), box = root.getBoundingClientRect();
  if (r.top >= box.top + stickTop + 64 && r.bottom <= box.bottom - 96) return;
  setTimeout(() => {
    if (!first.isConnected) return;
    first.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, reducedMotion() ? 0 : 500);
}

function onClick(ev) {
  if (ev.target.classList && ev.target.classList.contains('sdx-modal')) { closeBadgeModal(); return; } // backdrop
  const t = ev.target.closest('[data-go],[data-filter],[data-lang],[data-act],[data-step]');
  if (!t || !root.contains(t)) return;
  const act = t.dataset.act;
  if (t.dataset.filter) {
    ev.preventDefault();
    buzz(8);
    setFilter(t.dataset.filter, t.hasAttribute('data-goal'));
    return;
  }
  if (t.dataset.lang) {
    buzz(8);
    view.lang = t.dataset.lang;
    const q = root.querySelector('.sdx-quote');
    if (q) q.dataset.lang = view.lang;
    root.querySelectorAll('.sdx-seg [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === view.lang)));
    return;
  }
  if (act === 'close-modal') { closeBadgeModal(); return; }
  if (act === 'badge') { buzz(8); showBadgeModal(); return; }
  if (act === 'more') {
    const story = root.querySelector('.sdx-story');
    const open = t.getAttribute('aria-expanded') !== 'true';
    if (story) story.classList.toggle('is-clamped', !open);
    t.setAttribute('aria-expanded', String(open));
    t.textContent = open ? 'Show less' : 'Read more';
    return;
  }
  if (act === 'close') { buzz(8); if (current.id) closeEntry(); else closeGrid(); return; }
  if (act === 'hunt') { buzz(8); closeGrid(); return; }
  if (t.dataset.step) { ev.preventDefault(); step(Number(t.dataset.step)); return; }
  if (t.dataset.go) {
    ev.preventDefault();
    buzz(8);
    if (!current.id && t.matches('.sdx-card, .sdx-row-main')) openEntry(t);
    else nav(t.dataset.go);
  }
}

function onImgError(ev) {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('sdx-img')) return;
  if (img.classList.contains('sdx-base')) { const ph = img.parentElement; img.remove(); if (ph) ph.classList.add('sdx-ph-bare'); return; }
  const id = img.dataset.simi;
  if (!id) return;
  missingArt.add(id);
  const e = buildEntries(ctx.data || {}).find((x) => x.id === id) || { id, name: id };
  const wrap = document.createElement('div');
  wrap.innerHTML = placeholderHTML(e);
  img.replaceWith(wrap.firstElementChild);
}

function onStateChange(_s, detail) {
  if (!root) return;
  if (detail && detail.kind === 'position') { updateDistances(); return; }
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (!root) return;
    const keep = root.scrollTop;
    if (!current.id) view.gridScroll = keep;
    render(false);
    if (current.id) root.scrollTop = keep;
  });
}

function updateDistances() {
  const data = ctx.data || {};
  const pos = safeState().position;
  root.querySelectorAll('.sdx-row-dist[data-store]').forEach((el) => {
    el.textContent = distText(storeById(el.dataset.store, data), pos);
  });
}

// Pressed state that shows on the first touch, before navigation replaces the screen.
function bindPress() {
  const SEL = '.sdx-card, .sdx-row-main, .sdx-chip, .sdx-btn, .sdx-round, .sdx-close, .sdx-step, .sdx-row-go, .sdx-goal, .sdx-seg button, .sdx-more';
  let el = null, t0 = 0;
  const release = () => {
    if (!el) return;
    const x = el;
    el = null;
    setTimeout(() => x.classList.remove('is-pressed'), Math.max(0, 120 - (performance.now() - t0)));
  };
  root.addEventListener('pointerdown', (e) => {
    const hit = e.target.closest && e.target.closest(SEL);
    if (!hit || !root.contains(hit)) return;
    el = hit; t0 = performance.now();
    hit.classList.add('is-pressed');
  }, { passive: true });
  root.addEventListener('pointerup', release, { passive: true });
  root.addEventListener('pointercancel', release, { passive: true });
  root.addEventListener('pointerleave', release, { passive: true });
  root.addEventListener('touchstart', () => {}, { passive: true }); // lets :active show on iOS
}

function bindSwipe() {
  let sx = 0, sy = 0, t0 = 0, on = false;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('.sdx-dock')) return;
    on = true; sx = e.clientX; sy = e.clientY; t0 = performance.now();
  }, { passive: true });
  root.addEventListener('pointerup', (e) => {
    if (!on) return;
    on = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - t0 < 900) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  root.addEventListener('pointercancel', () => { on = false; }, { passive: true });
}

function bindKeys() {
  const key = (e) => {
    if (!root || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
    if (e.key === 'Escape') {
      if (closeBadgeModal()) return;
      if (current.id) closeEntry();
      return;
    }
    if (!current.id || root.querySelector('.sdx-modal')) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  };
  window.addEventListener('keydown', key);
  teardown.push(() => window.removeEventListener('keydown', key));
}

// ---------- module interface ----------

export function mount(el, c, params = {}) {
  unmount();
  ensureCss();
  ctx = c || {};
  if (typeof ctx.go !== 'function') ctx.go = (h) => { location.hash = h; };
  if (view.filter === null) {
    const f = readPrefs().filter;
    view.filter = FILTERS.some((x) => x.id === f) ? f : 'all';
  }
  current = { id: params.simiId || null };

  // Work out where Back should lead, from how this screen was reached.
  const kind = takeOrigin();
  if (current.id) {
    if (kind === 'grid') view.entryFromGrid = true;
    else if (kind !== 'step' && !(view.lastKind === 'entry' && view.lastEntryId === current.id)) view.entryFromGrid = false;
  } else {
    const fromOwnEntry = view.lastKind === 'entry' && view.entryFromGrid;
    if (kind === 'deep-replace') view.gridDeep = true;
    else if (kind !== 'entry-back' && !fromOwnEntry) view.gridDeep = false;
    view.returnFrom = view.lastKind === 'entry' ? view.lastEntryId : null;
  }

  root = document.createElement('div');
  root.className = 'sdx';
  if (pendingVT) root.classList.add('sdx-vt-in');
  el.replaceChildren(root);
  root.addEventListener('click', onClick);
  root.addEventListener('error', onImgError, true);
  bindPress();
  bindKeys();
  if (!current.id) {
    root.addEventListener('scroll', () => { if (!current.id) view.gridScroll = root.scrollTop; }, { passive: true });
  } else {
    bindSwipe();
  }
  try {
    if (ctx.state && typeof ctx.state.on === 'function') teardown.push(ctx.state.on('change', onStateChange));
  } catch (e) { console.warn('[dex] could not subscribe to state', e); }

  const firstGrid = !current.id && !view.popped;
  const out = render(current.id ? true : firstGrid) || {};
  if (!current.id) view.popped = true;
  const morphing = Boolean(pendingVT);
  const returning = Boolean(view.returnFrom);
  finishMorph();
  if (current.id) {
    teachSwipe();
  } else {
    if (!morphing) pulseReturned();
    revealNew(out.newIds, returning);
  }
  view.lastKind = current.id ? 'entry' : 'grid';
  view.lastEntryId = current.id;
  lastDir = 0;
}

export function unmount() {
  clearTimeout(renderTimer);
  for (const io of viewObs.splice(0)) io.disconnect();
  for (const fn of teardown.splice(0)) { try { fn(); } catch { /* already gone */ } }
  if (root) root.remove();
  root = null;
}

export default { mount, unmount };
