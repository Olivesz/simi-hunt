// Deterministic wild-Simi spawns. No server: every phone derives the same
// spawns from (geohash cell, 3-hour window, slot).
import ngeohash from 'https://esm.sh/ngeohash@0.6.3';

const PRECISION = 7;                     // ~153 m x 153 m cells
const WINDOW_MS = 3 * 3600 * 1000;       // clock-aligned (UTC) windows
const SEED = 'simi-hunt-v1';
const FALLBACK_COMMON = ['classic', 'gym', 'sleepy', 'futbol', 'bombero', 'chef', 'beisbolista'];
const EVENT_IDS = ['muertos', 'luchador', 'santa'];
const RARITY_W = { common: 60, uncommon: 30, rare: 10 };
const EVENT_CHANCE = 0.08;               // per slot, when an event is live
const POI_NEAR_M = 250;

// Default biome tags per Simi; simis.json `biome` text adds to these.
const BIOME_DEFAULT = {
  futbol: ['park'], beisbolista: ['park'], chef: ['downtown'], gym: ['gym'], sleepy: ['night'],
};
const CTX_RE = {
  park: /park|garden|playground|pitch|stadium|sport|recreation|field|green/,
  downtown: /downtown|plaza|office|commercial|mall|retail|square|restaurant|cafe|food|city|urban/,
  gym: /gym|fitness/,
  water: /water|river|lake|pond|bay|reservoir/,
};

// ---------- PRNG ----------
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngFor = (...parts) => mulberry32(hash32([SEED, ...parts].join('|')));

// ---------- local time ----------
const fmtCache = new Map();
function localParts(ms, tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour % 24, weekday: p.weekday };
}
function tzFor(lon, data) {
  return (data && data.region && (data.region.tz || data.region.timezone)) ||
    (lon > -105 ? 'America/Chicago' : 'America/Los_Angeles');
}
const pad = (n) => String(n).padStart(2, '0');
export function dayKey(ms, tz = 'America/Chicago') {
  const p = localParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// ---------- data helpers ----------
function simiPool(data) {
  const all = (data && Array.isArray(data.simis)) ? data.simis : [];
  const common = all.filter((s) => s.tier === 'common');
  const commons = common.length ? common : FALLBACK_COMMON.map((id) => ({ id, rarity: 'common' }));
  const events = all.length
    ? all.filter((s) => s.tier === 'event' && EVENT_IDS.includes(s.id))
    : EVENT_IDS.map((id) => ({ id, tier: 'event' }));
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  return { commons: commons.slice().sort(byId), events: events.slice().sort(byId) };
}

function activeEventIds(ms, tz) {
  const p = localParts(ms, tz);
  const live = [];
  if (p.m === 11 && p.d >= 1 && p.d <= 3) live.push('muertos');
  if (p.weekday === 'Sat' || p.weekday === 'Sun') live.push('luchador');
  if (p.m === 12 && p.d >= 1 && p.d <= 25) live.push('santa');
  return live;
}

const M_LAT = 111320;
const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
function distM(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * M_LAT, dx = (lon2 - lon1) * mLon((lat1 + lat2) / 2);
  return Math.hypot(dx, dy);
}

function ringsOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (lon, lat, poly) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h));

function featuresOf(x) {
  if (!x) return [];
  if (x.type === 'FeatureCollection') return x.features || [];
  if (x.type === 'Feature') return [x];
  if (x.type === 'Polygon' || x.type === 'MultiPolygon') return [{ type: 'Feature', properties: {}, geometry: x }];
  if (Array.isArray(x)) return x.flatMap(featuresOf);
  return [];
}
function tagText(props) {
  return Object.values(props || {}).filter((v) => typeof v === 'string').join(' ').toLowerCase() +
    ' ' + Object.keys(props || {}).join(' ').toLowerCase();
}

// Per-data index of POIs and water polygons, cached on the data object.
const indexCache = new WeakMap();
function indexOf(data) {
  if (!data || typeof data !== 'object') return { pois: [], water: [] };
  let idx = indexCache.get(data);
  if (idx) return idx;
  idx = { pois: [], water: [] };
  for (const f of featuresOf(data.pois)) {
    const g = f.geometry; if (!g) continue;
    const text = tagText(f.properties);
    const kinds = Object.keys(CTX_RE).filter((k) => CTX_RE[k].test(text));
    if (!kinds.length) continue;
    const polys = ringsOf(g);
    if (kinds.includes('water') && polys.length) { idx.water.push(...polys); kinds.splice(kinds.indexOf('water'), 1); }
    if (!kinds.length) continue;
    let pt = null;
    if (g.type === 'Point') pt = g.coordinates;
    else if (polys.length) {
      const r = polys[0][0];
      pt = [r.reduce((s, c) => s + c[0], 0) / r.length, r.reduce((s, c) => s + c[1], 0) / r.length];
    }
    if (pt) idx.pois.push({ lon: pt[0], lat: pt[1], kinds, polys });
  }
  for (const f of featuresOf(data.region && data.region.water)) idx.water.push(...ringsOf(f.geometry));
  indexCache.set(data, idx);
  return idx;
}
const isWater = (idx, lat, lon) => idx.water.some((poly) => inPoly(lon, lat, poly));
function cellContext(idx, lat, lon) {
  const ctx = new Set();
  for (const p of idx.pois) {
    if (distM(lat, lon, p.lat, p.lon) <= POI_NEAR_M || p.polys.some((poly) => inPoly(lon, lat, poly))) {
      p.kinds.forEach((k) => ctx.add(k));
    }
  }
  return ctx;
}

function biomeTags(simi) {
  const tags = new Set(BIOME_DEFAULT[simi.id] || []);
  const b = String(simi.biome || '').toLowerCase();
  for (const k of ['park', 'downtown', 'gym']) if (CTX_RE[k].test(b)) tags.add(k);
  if (/night|sleep/.test(b)) tags.add('night');
  return tags;
}

function weightFor(simi, ctx, hasPois, isNight) {
  let w = RARITY_W[simi.rarity] ?? RARITY_W.common;
  const tags = biomeTags(simi);
  if (tags.has('night')) w *= isNight ? 4 : 0.25;
  const place = [...tags].filter((t) => t !== 'night');
  if (place.length && hasPois) w *= place.some((t) => ctx.has(t)) ? 3 : 0.6;
  return w;
}

// ---------- spawn generation ----------
function generateCell(cell, w, data) {
  const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(cell);
  const cLat = (minLat + maxLat) / 2, cLon = (minLon + maxLon) / 2;
  const tz = tzFor(cLon, data);
  const mid = w * WINDOW_MS + WINDOW_MS / 2;
  const hour = localParts(mid, tz).hour;
  const isNight = hour >= 21 || hour < 6;
  const events = activeEventIds(mid, tz);
  const idx = indexOf(data);
  const ctx = cellContext(idx, cLat, cLon);
  const hasPois = idx.pois.length > 0;
  const { commons, events: eventSimis } = simiPool(data);
  const count = rngFor(cell, w, 'count')() < 0.4 ? 1 : 0;   // sparse: ~40% of ~150 m cells get one Simi
  const expiresAt = (w + 1) * WINDOW_MS;
  const out = [];
  const used = new Set();
  for (let slot = 0; slot < count; slot++) {
    const rng = rngFor(cell, w, slot);
    let simiId = null;
    const liveEvents = eventSimis.filter((s) => events.includes(s.id));
    if (liveEvents.length && rng() < EVENT_CHANCE) {
      simiId = liveEvents[Math.floor(rng() * liveEvents.length)].id;
    } else {
      let pool = commons.filter((s) => !used.has(s.id));
      if (!pool.length) pool = commons;
      const ws = pool.map((s) => weightFor(s, ctx, hasPois, isNight));
      let r = rng() * ws.reduce((a, b) => a + b, 0), i = 0;
      while (i < pool.length - 1 && r >= ws[i]) { r -= ws[i]; i++; }
      simiId = pool[i].id;
    }
    used.add(simiId);
    // jitter inside the cell (10%-90%), retry off water
    let lat = cLat, lon = cLon;
    for (let t = 0; t < 8; t++) {
      lat = minLat + (0.1 + 0.8 * rng()) * (maxLat - minLat);
      lon = minLon + (0.1 + 0.8 * rng()) * (maxLon - minLon);
      if (!isWater(idx, lat, lon)) break;
      if (t === 7) lat = NaN;                        // all tries wet: drop this slot
    }
    if (Number.isNaN(lat)) continue;
    out.push({ spawnId: `${cell}-${w.toString(36)}-${slot}`, simiId, lat, lon, expiresAt });
  }
  return out;
}

export function spawnsNear(lat, lon, radiusM, now, data) {
  const w = Math.floor(now / WINDOW_MS);
  const [bl, bn, bt, bx] = ngeohash.decode_bbox(ngeohash.encode(lat, lon, PRECISION));
  const hLat = bt - bl, hLon = bx - bn;
  const dLat = radiusM / M_LAT + hLat, dLon = radiusM / mLon(lat) + hLon;
  const cells = new Set();
  for (let a = lat - dLat; a <= lat + dLat + hLat; a += hLat) {
    for (let o = lon - dLon; o <= lon + dLon + hLon; o += hLon) {
      cells.add(ngeohash.encode(Math.max(-89.9, Math.min(89.9, a)), o, PRECISION));
    }
  }
  const out = [];
  for (const cell of [...cells].sort()) {
    for (const s of generateCell(cell, w, data)) {
      if (distM(lat, lon, s.lat, s.lon) <= radiusM) out.push(s);
    }
  }
  return out;
}

export function getSpawn(spawnId, data) {
  const m = /^([0-9b-hjkmnp-z]{7})-([0-9a-z]+)-(\d)$/.exec(String(spawnId));
  if (!m) return null;
  const w = parseInt(m[2], 36);
  return generateCell(m[1], w, data).find((s) => s.spawnId === spawnId) || null;
}

// ---------- daily streak ----------
// state: the shell's state module (or any object with get()); reads
// state.get().streak = {count, lastDay}. Pure: it never writes.
export function dailyStreak(state, now = Date.now(), tz = 'America/Chicago') {
  const s = (state && state.get && state.get().streak) || { count: 0, lastDay: null };
  const today = dayKey(now, tz);
  const yesterday = dayKey(now - 24 * 3600 * 1000, tz);
  const doneToday = s.lastDay === today;
  const alive = doneToday || s.lastDay === yesterday;
  const count = alive ? s.count : 0;
  return { count, lastDay: s.lastDay || null, doneToday, atRisk: alive && !doneToday && count > 0,
    broken: !alive && s.count > 0, dayInCycle: count ? ((count - 1) % 7) + 1 : 0, bonusDue: doneToday && count > 0 && count % 7 === 0 };
}

// The streak value to persist after the first catch/scan of a day.
export function nextStreak(streak, now = Date.now(), tz = 'America/Chicago') {
  const s = streak || { count: 0, lastDay: null };
  const today = dayKey(now, tz);
  if (s.lastDay === today) return { count: s.count, lastDay: today };
  const yesterday = dayKey(now - 24 * 3600 * 1000, tz);
  return { count: s.lastDay === yesterday ? s.count + 1 : 1, lastDay: today };
}
