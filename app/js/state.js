// Player state, persisted in localStorage under `simihunt.v1`.
// Every read and write of storage is wrapped in try/catch: private windows and
// blocked storage fall back to an in-memory copy for the session.

const KEY = 'simihunt.v1';
const POSITION_SAVE_MS = 800;

function defaults() {
  return {
    catches: [],
    seen: [],
    capsules: 20,
    streak: { count: 0, lastDay: null },
    claims: {},
    position: null,
    region: 'austin',
    demo: false,
    presenter: false,
  };
}

const REGIONS = ['austin', 'lasvegas'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// Keeps only well-formed fields, so one bad entry in saved state can't break
// the HUD or the SimiDex on boot.
function sanitize(saved) {
  const d = defaults();
  if (!isObj(saved)) return d;
  const s = { ...d, ...saved };
  s.catches = Array.isArray(saved.catches)
    ? saved.catches.filter((c) => isObj(c) && typeof c.simiId === 'string' && c.simiId) : [];
  s.seen = Array.isArray(saved.seen) ? [...new Set(saved.seen.filter((x) => typeof x === 'string' && x))] : [];
  s.claims = isObj(saved.claims) ? saved.claims : {};
  s.capsules = Number.isFinite(saved.capsules) && saved.capsules >= 0 ? Math.floor(saved.capsules) : d.capsules;
  const st = isObj(saved.streak) ? saved.streak : {};
  s.streak = {
    count: Number.isFinite(st.count) && st.count >= 0 ? Math.floor(st.count) : 0,
    lastDay: typeof st.lastDay === 'string' && DAY_RE.test(st.lastDay) ? st.lastDay : null,
  };
  const p = saved.position;
  s.position = isObj(p) && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    ? { lat: p.lat, lon: p.lon, source: p.source === 'demo' ? 'demo' : 'gps' } : null;
  s.region = REGIONS.includes(saved.region) ? saved.region : d.region;
  s.demo = !!saved.demo;
  s.presenter = !!saved.presenter;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return sanitize(JSON.parse(raw));
  } catch (e) {
    console.warn('[state] could not read saved state, starting fresh', e);
    return defaults();
  }
}

let s = load();
let posTimer = null;
const listeners = { change: new Set(), catch: new Set(), position: new Set() };

function save() {
  clearTimeout(posTimer);
  posTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('[state] could not save state', e);
  }
}

function emit(type, detail) {
  for (const fn of [...listeners[type]]) {
    try { fn(get(), detail); } catch (e) { console.error(`[state] ${type} listener failed`, e); }
  }
}

function commit(kind, detail) {
  save();
  emit('change', { kind, ...detail });
}

// The streak follows spawns.js nextStreak(), as CONTRACT.md asks. spawns.js is
// loaded lazily so a problem there can never stop the app from booting; until it
// arrives, the same rule runs here (local day in the region's time zone).
const REGION_TZ = { austin: 'America/Chicago', lasvegas: 'America/Los_Angeles' };
let nextStreakFn = null;
import('./spawns.js')
  .then((m) => { if (typeof m.nextStreak === 'function') nextStreakFn = m.nextStreak; })
  .catch((e) => console.warn('[state] spawns.js not loaded, using the built-in streak rule', e));

function localDay(ms, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  } catch {
    const d = new Date(ms), pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

function fallbackNextStreak(streak, now, tz) {
  const today = localDay(now, tz);
  if (streak.lastDay === today) return { count: streak.count, lastDay: today };
  const yesterday = localDay(now - 24 * 3600 * 1000, tz);
  return { count: streak.lastDay === yesterday ? streak.count + 1 : 1, lastDay: today };
}

function bumpStreak() {
  const now = Date.now();
  const tz = REGION_TZ[s.region] || REGION_TZ.austin;
  let next = null;
  try { next = nextStreakFn?.({ ...s.streak }, now, tz); } catch (e) { console.warn('[state] nextStreak failed', e); }
  if (!next || !Number.isFinite(next.count) || typeof next.lastDay !== 'string') next = fallbackNextStreak(s.streak, now, tz);
  s.streak = { count: next.count, lastDay: next.lastDay };
}

// Returns a copy, so callers can't mutate state behind the write API.
export function get() {
  return structuredClone(s);
}

export function has(simiId) {
  return s.catches.some((c) => c.simiId === simiId);
}

// spawnId (map catches) is kept so the map can hide spawns already caught.
export function addCatch({ simiId, source = 'map', storeId, shelfType, spawnId } = {}) {
  if (!simiId) throw new Error('addCatch needs a simiId');
  const isNew = !has(simiId);
  const rec = { simiId, at: Date.now(), source };
  if (storeId) rec.storeId = storeId;
  if (shelfType) rec.shelfType = shelfType;
  if (spawnId) rec.spawnId = spawnId;
  s.catches.push(rec);
  if (!s.seen.includes(simiId)) s.seen.push(simiId);
  bumpStreak();
  commit('catch', { simiId, isNew });
  emit('catch', { ...rec, isNew });
  return { isNew };
}

export function caughtSpawn(spawnId) {
  return !!spawnId && s.catches.some((c) => c.spawnId === spawnId);
}

export function markSeen(simiId) {
  if (!simiId || s.seen.includes(simiId)) return;
  s.seen.push(simiId);
  commit('seen', { simiId });
}

export function useCapsule() {
  if (s.capsules <= 0) return false;
  s.capsules -= 1;
  commit('capsules', { capsules: s.capsules });
  return true;
}

export function addCapsules(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  if (!k) return;
  s.capsules += k;
  commit('capsules', { capsules: s.capsules });
}

export function hasClaimed(codeId) {
  return Object.prototype.hasOwnProperty.call(s.claims, codeId);
}

export function recordClaim(codeId) {
  s.claims[codeId] = Date.now();
  commit('claim', { codeId });
}

// Position changes often (GPS, demo joystick), so its save is debounced.
// Listeners still fire on every update.
export function setPosition({ lat, lon, source = 'gps' } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  s.position = { lat, lon, source };
  if (!posTimer) posTimer = setTimeout(save, POSITION_SAVE_MS);
  emit('position', s.position);
  emit('change', { kind: 'position' });
}

export function setRegion(id) {
  if (!id || id === s.region) return;
  s.region = id;
  s.position = null;
  commit('region', { region: id });
}

export function setDemo(on) {
  s.demo = !!on;
  commit('demo', { demo: s.demo });
}

// Presenter mode: map.js shows presenter controls for a live demo.
export function setPresenter(on) {
  s.presenter = !!on;
  commit('presenter', { presenter: s.presenter });
}

// Other modules keep per-device progress under their own simihunt.* keys
// (hidden spawns, stop cooldowns, SimiDex filter, hints). Reset clears those
// too; these keys are settings and survive.
const KEEP_ON_RESET = new Set([KEY, 'simihunt.map.hunterColor']);

// Wipes progress but keeps the chosen region, demo and presenter modes.
export function reset() {
  const { region, demo, presenter } = s;
  s = { ...defaults(), region, demo, presenter };
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('simihunt.') && !KEEP_ON_RESET.has(k)) localStorage.removeItem(k);
    }
  } catch (e) {
    console.warn('[state] could not clear saved progress keys', e);
  }
  commit('reset', {});
}

export function on(type, fn) {
  if (!listeners[type]) throw new Error(`unknown state event "${type}"`);
  listeners[type].add(fn);
  return () => listeners[type].delete(fn);
}

// Another tab wrote state: pick it up.
try {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    s = load();
    emit('change', { kind: 'external' });
  });
} catch { /* no window, e.g. a worker */ }

export const state = {
  get, has, addCatch, caughtSpawn, markSeen, useCapsule, addCapsules, hasClaimed, recordClaim,
  setPosition, setRegion, setDemo, setPresenter, reset, on,
};
export default state;
