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

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw);
    const s = { ...defaults(), ...saved };
    s.streak = { ...defaults().streak, ...(saved.streak || {}) };
    if (!Array.isArray(s.catches)) s.catches = [];
    if (!Array.isArray(s.seen)) s.seen = [];
    if (!s.claims || typeof s.claims !== 'object') s.claims = {};
    if (typeof s.capsules !== 'number') s.capsules = 20;
    s.demo = !!s.demo;
    s.presenter = !!s.presenter;
    return s;
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

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function bumpStreak() {
  const today = dayKey();
  if (s.streak.lastDay === today) return;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  s.streak = { count: s.streak.lastDay === dayKey(y) ? s.streak.count + 1 : 1, lastDay: today };
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

// Wipes progress but keeps the chosen region, demo and presenter modes.
export function reset() {
  const { region, demo, presenter } = s;
  s = { ...defaults(), region, demo, presenter };
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
