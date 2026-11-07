// #/claim/:token: verify a signed shelf-sign code, grant its Simi once, then hand
// off to #/unlock.
//
// Token = base64url(JSON {c: codeId, s: storeId, h: shelfType, m: simiId, v: 1})
//       + "." + base64url(ECDSA P-256 / SHA-256 signature over the first segment, raw r||s).
// Codes are signed offline by tools/sign/sign.py; the app ships only the public key
// (app/keys/public.jwk), so a code cannot be forged without the private key.
// Without a server this does not stop a real code being shared or re-scanned on
// another device; one claim per code per device is enforced via state.hasClaimed.
//
// Short codes: each sign can also carry a short code a player types by hand
// (SUN24 for QR-A). resolveCode() maps it to the sign's signed token, read from
// codes.json (`short` and `token` per code) when present, else from SHORT_CODES
// below. The token is already public in the printed QR, so this adds no way to
// forge a code; the signature is still checked as usual.
//
// Active codes: codes.json (made by sign.py) lists every live code. When it is
// loaded, a signed code it leaves out, or whose store, shelf or Simi differ from
// the payload, is refused as "no longer active". codes.json is unsigned, so it can
// only take codes away, never add one. To retire a code, delete it from
// tools/sign/config.json and re-run sign.py.
//
// Geofence: off in this prototype. Set GEOFENCE.enabled = true to require a real
// GPS fix (source 'gps', and no older than maxAgeMs when the fix carries an `at`
// time) within radiusM of the store. Demo mode is the stated exception, so the
// on-stage scan works. Codes for storeId "any" and stores without coordinates
// are not fenced.

export const GEOFENCE = { enabled: false, radiusM: 100, maxAgeMs: 120000 };

const KEY_URL = new URL('../keys/public.jwk', import.meta.url);
const TOKEN_RE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{40,}$/;
const STYLE_ID = 'claim-style';

// Fallback for the two demo signs, used only when codes.json is missing or has no
// `short`/`token` fields. Any token signed with the current key works here.
const SHORT_CODES = {
  SUN24: { id: 'qr-a', token: 'eyJjIjoicXItYSIsInMiOiJjdnMtZ3VhZGFsdXBlLTI0MDIiLCJoIjoic3VuLWNhcmUiLCJtIjoiYmVhY2giLCJ2IjoxfQ.-CSms7RlhmTSTWwxiuTdkBLXGQAOr4XglyChAQsm2iNm_013IG7rMW4pZsDkNNkZPZPC-8NeooCQZ3PzIHazgg' },
  TEX24: { id: 'qr-b', token: 'eyJjIjoicXItYiIsInMiOiJjdnMtZ3VhZGFsdXBlLTI0MDIiLCJoIjoiZHItc2ltaSIsIm0iOiJ0ZXhhcyIsInYiOjF9.exxtNZg-Jox3C7DzbnnZW463Zo2ynDpzN6lNeXHdbIoVgMerR53hqlTcIf3c4T1Ong2B8nyyd2pWzK14IqI85g' },
};

let root = null;
let keyPromise = null;
let fresh = null; // one-shot marker: the claim that just happened, for unlock.js

// Pull a claim token out of a scanned URL, a pasted link, or a bare token.
export function extractToken(text) {
  const s = String(text || '').trim();
  const m = s.match(/#\/claim\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return TOKEN_RE.test(s) ? s : null;
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Token for anything a player might type or paste: a full link, a bare token,
// a short code from the sign (SUN24) or a code id (qr-a). null when nothing matches.
export function resolveCode(text, data = {}) {
  const t = extractToken(text);
  if (t) return t;
  const v = norm(text);
  if (!v) return null;
  for (const [id, c] of Object.entries(data.codes || {})) {
    if (c && c.token && (norm(c.short) === v || norm(id) === v)) return c.token;
  }
  if (SHORT_CODES[v]) return SHORT_CODES[v].token;
  const byId = Object.values(SHORT_CODES).find((c) => norm(c.id) === v);
  return byId ? byId.token : null;
}

function b64urlBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function publicKey() {
  if (!keyPromise) {
    // A normal fetch, then any cached copy if the network is down.
    keyPromise = fetch(KEY_URL).catch(() => fetch(KEY_URL, { cache: 'force-cache' }))
      .then((r) => { if (!r.ok) throw new Error('public key missing'); return r.json(); })
      .then((jwk) => crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']))
      .catch((e) => { keyPromise = null; throw e; });
  }
  return keyPromise;
}

// Load the verification key ahead of time (the scanner calls this on mount).
export function warmKey() {
  if (globalThis.crypto && crypto.subtle) publicKey().catch(() => {});
}

// Resolves to the payload {c, s, h, m, v} when the signature checks out.
// Throws an Error whose .code is 'malformed' | 'forged' | 'insecure' | 'nokey'.
// The signature must be the exact, canonical base64url of 64 bytes: atob ignores
// the 4 spare bits of the last character, so without this check some one-character
// edits would still verify.
export async function verifyToken(token) {
  const fail = (code, msg) => Object.assign(new Error(msg), { code });
  if (!TOKEN_RE.test(token || '')) throw fail('malformed', 'not a Simi Hunt code');
  const [head, sig] = token.split('.');
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlBytes(head)));
  } catch {
    throw fail('malformed', 'unreadable code');
  }
  if (!payload || payload.v !== 1 || ![payload.c, payload.s, payload.h, payload.m].every((x) => typeof x === 'string' && x)) {
    throw fail('malformed', 'unknown code format');
  }
  if (!globalThis.crypto || !crypto.subtle) throw fail('insecure', 'this page needs HTTPS or localhost to check codes');
  let key;
  try { key = await publicKey(); } catch { throw fail('nokey', 'could not load the verification key'); }
  let sigBytes;
  try { sigBytes = b64urlBytes(sig); } catch { throw fail('malformed', 'unreadable signature'); }
  if (sigBytes.length !== 64 || b64url(sigBytes) !== sig) throw fail('forged', 'signature does not match');
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, new TextEncoder().encode(head));
  if (!ok) throw fail('forged', 'signature does not match');
  return payload;
}

function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function unlockHash(p) {
  return `#/unlock/${encodeURIComponent(p.m)}?store=${encodeURIComponent(p.s)}&shelf=${encodeURIComponent(p.h)}`;
}

// A genuine code that codes.json no longer lists (or lists differently), or whose
// Simi isn't in simis.json, is refused. Skipped when those files didn't load.
function checkActive(p, data) {
  const retired = () => Object.assign(new Error('code is not active'), { code: 'retired' });
  const codes = data.codes && typeof data.codes === 'object' ? data.codes : {};
  if (Object.keys(codes).length) {
    const c = codes[p.c];
    if (!c || c.storeId !== p.s || c.shelfType !== p.h || c.simiId !== p.m) throw retired();
  }
  const simis = Array.isArray(data.simis) ? data.simis : [];
  if (simis.length && !simis.some((x) => x && x.id === p.m)) throw retired();
}

function checkGeofence(p, snap, data) {
  if (!GEOFENCE.enabled || p.s === 'any' || snap.demo) return;
  const store = (data.stores || []).find((x) => x.id === p.s);
  if (!store || !Number.isFinite(store.lat) || !Number.isFinite(store.lon)) return;
  const pos = snap.position;
  const fresh = pos && pos.source === 'gps' && (!Number.isFinite(pos.at) || Date.now() - pos.at <= GEOFENCE.maxAgeMs);
  if (!fresh || distanceM(pos, store) > GEOFENCE.radiusM) {
    throw Object.assign(new Error('too far from the store'), { code: 'geofence' });
  }
}

// Verify a token and grant its Simi once. Used by this screen and by the scanner,
// which claims in place so the player goes straight from the camera to the reveal.
// Resolves to { payload, already, isNew, hash }; throws like verifyToken, or with
// .code 'retired' or 'geofence'.
export async function claimToken(token, { state, data = {} }) {
  const p = await verifyToken(token);
  checkActive(p, data);
  if (state.hasClaimed(p.c)) return { payload: p, already: true, isNew: false, hash: unlockHash(p) };
  checkGeofence(p, state.get(), data);
  const had = typeof state.has === 'function' ? state.has(p.m) : false;
  state.recordClaim(p.c);
  const res = state.addCatch({ simiId: p.m, source: 'qr', storeId: p.s, shelfType: p.h });
  const isNew = typeof res?.isNew === 'boolean' ? res.isNew : !had;
  fresh = { simiId: p.m, isNew, at: Date.now() };
  return { payload: p, already: false, isNew, hash: unlockHash(p) };
}

// unlock.js calls this once on mount: returns the claim that just happened for
// this Simi (and forgets it), so the celebration plays once and never on Back
// or a shared link.
export function takeFresh(simiId) {
  const f = fresh;
  if (!f || f.simiId !== simiId || Date.now() - f.at > 60000) return null;
  fresh = null;
  return f;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function artUrl(simi) {
  if (!simi?.art) return '';
  try { return new URL(simi.art, document.baseURI).href; } catch { return ''; }
}

// Fetch and decode a Simi's art before the reveal, so its pop never plays on an
// empty image. Always resolves, after at most `ms`.
export function preloadArt(simiId, data = {}, ms = 600) {
  const simi = (data.simis || []).find((x) => x.id === simiId);
  const url = artUrl(simi) || new URL(`../../art/simis/${encodeURIComponent(simiId)}.svg`, import.meta.url).href;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => { clearTimeout(timer); resolve(); };
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    (img.decode ? img.decode() : new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; })).then(done, done);
  });
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
  body[data-route="scan"] #screen-layer, body[data-route="claim"] #screen-layer, body[data-route="unlock"] #screen-layer { background: #07142b; }
  .clm { position: relative; min-height: 100%; display: grid; place-items: center; padding: calc(64px + env(safe-area-inset-top, 0px)) 16px calc(24px + env(safe-area-inset-bottom, 0px));
         box-sizing: border-box; background: radial-gradient(120% 70% at 50% 30%, #123063 0%, #07142b 70%); font-family: var(--font-body, system-ui, sans-serif); color: #14305f; }
  .clm-x { position: absolute; top: calc(12px + env(safe-area-inset-top, 0px)); left: 12px; width: 44px; height: 44px; border: 0; border-radius: 50%;
           background: rgba(255,255,255,.16); color: #fff; font-size: 20px; line-height: 1; display: grid; place-items: center; cursor: pointer; }
  .clm-wait { text-align: center; color: #fff; animation: clm-in .25s ease-out both; }
  .clm-wait h2 { font-family: var(--font-display, system-ui, sans-serif); font-size: 24px; margin: 0 0 4px; }
  .clm-wait p { margin: 0; opacity: .75; font-size: 15px; }
  .clm-spin { width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 50%; border: 6px solid rgba(255,255,255,.18); border-top-color: var(--sun, #FFC72C); animation: clm-r .8s linear infinite; }
  .clm-card { width: 100%; max-width: 360px; background: #fff; border-radius: 26px; padding: 26px 20px 20px; text-align: center; box-sizing: border-box;
              box-shadow: 0 18px 50px rgba(0,0,0,.35); animation: clm-in .28s cubic-bezier(.2,1.2,.4,1) both; }
  .clm-icon { width: 72px; height: 72px; margin: 0 auto 12px; border-radius: 50%; display: grid; place-items: center; font: 800 36px var(--font-display, system-ui, sans-serif); color: #fff; background: var(--simi-sky, #0798E8); }
  .clm-icon.bad { background: var(--danger, #D23A3A); }
  .clm-art { width: 112px; height: 112px; margin: -8px auto 6px; display: block; object-fit: contain; filter: drop-shadow(0 6px 10px rgba(20,48,95,.25)); }
  .clm h2 { margin: 0 0 6px; font-family: var(--font-display, system-ui, sans-serif); font-size: 26px; line-height: 1.1; }
  .clm-card p { margin: 0 0 16px; font-size: 16px; line-height: 1.4; color: #3c4b63; }
  .clm-btn { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 54px; margin-top: 10px; border: 0; border-radius: var(--r-md, 18px);
             font: 800 17px var(--font-display, system-ui, sans-serif); cursor: pointer; background: var(--simi-blue, #024EA2); color: #fff;
             box-shadow: 0 4px 0 var(--simi-navy, #1C4889);
             touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: transform .08s ease-out; }
  .clm-btn.alt { background: var(--simi-ice, #E8F1FC); color: var(--simi-blue, #024EA2); box-shadow: 0 4px 0 var(--line, #DCE4F2); }
  .clm-btn:active, .clm-x:active { transform: scale(.96); }
  .clm-btn:focus-visible, .clm-x:focus-visible { outline: 3px solid var(--sun, #FFC72C); outline-offset: 2px; }
  @keyframes clm-r { to { transform: rotate(360deg); } }
  @keyframes clm-in { from { opacity: 0; transform: translateY(10px) scale(.98); } }
  @media (prefers-reduced-motion: reduce) { .clm-card, .clm-wait { animation: none; } .clm-btn:active, .clm-x:active { transform: none; } }
  `;
  document.head.appendChild(st);
}

const CLOSE_X = '<button class="clm-x" data-act="close" aria-label="Close">✕</button>';

function render(html, card = true) {
  if (root) root.innerHTML = `<div class="clm">${CLOSE_X}${card ? `<div class="clm-card">${html}</div>` : html}</div>`;
}

const ERROR_COPY = {
  forged: ['This code isn’t genuine', 'It doesn’t match a real Simi Hunt sign, so nothing was added. Scan the sign on the shelf.'],
  malformed: ['That’s not a Simi Hunt code', 'Try scanning the shelf sign again, or type the code printed under it.'],
  retired: ['This sign is no longer active', 'Nothing was added. Look for a current Simi sign on the shelf.'],
  insecure: ['Open the secure link', 'Codes can only be checked on the app’s https:// address. Open it there and scan again.'],
  nokey: ['Can’t check codes right now', 'Check your connection and try again.'],
  geofence: ['Get a little closer', 'This code only works in the store. Head to the shelf and scan again.'],
};

function errorCard(err) {
  const copy = (typeof err?.code === 'string' && ERROR_COPY[err.code])
    || ['Something went wrong', 'This code couldn’t be checked. Try scanning again.'];
  render(`<div class="clm-icon bad">!</div><h2>${esc(copy[0])}</h2><p>${esc(copy[1])}</p>
    <button class="clm-btn" data-go="#/scan">Scan again</button>
    <button class="clm-btn alt" data-go="#/map">Back to map</button>`);
}

export function mount(el, ctx, params = {}) {
  root = el;
  injectStyle();
  const { state, data = {}, go } = ctx;
  el.onclick = (e) => {
    if (e.target.closest('[data-act="close"]')) { (ctx.back || go)('#/map'); return; }
    const b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  };
  render('<div class="clm-wait" role="status"><div class="clm-spin"></div><h2>Checking the sign…</h2><p>Revisando el letrero</p></div>', false);
  const token = resolveCode(params.token, data) || params.token;
  const mine = el;

  claimToken(token, ctx).then((r) => {
    if (root !== mine) return;
    const p = r.payload;
    if (r.already) {
      const simi = (data.simis || []).find((x) => x.id === p.m);
      const art = artUrl(simi);
      const shelfLink = `#/shelf/${encodeURIComponent(p.s)}/${encodeURIComponent(p.h)}`;
      render(`${art ? `<img class="clm-art" src="${esc(art)}" alt="">` : '<div class="clm-icon">✓</div>'}
        <h2>¡Ya lo tienes!</h2>
        <p>${esc(simi?.name || 'This Simi')} is already in your SimiDex. Each sign unlocks once.</p>
        <button class="clm-btn" data-go="${esc(shelfLink)}">See this shelf’s products</button>
        <button class="clm-btn alt" data-go="#/dex/${esc(encodeURIComponent(p.m))}">Open SimiDex</button>`);
      const img = el.querySelector('.clm-art');
      if (img) img.onerror = () => { const ok = document.createElement('div'); ok.className = 'clm-icon'; ok.textContent = '✓'; img.replaceWith(ok); };
      return;
    }
    return preloadArt(p.m, data).then(() => { if (root === mine) go(r.hash, { replace: true }); });
  }).catch((err) => {
    if (root !== mine) return;
    console.warn('[claim] rejected:', err.code || 'unknown', err);
    errorCard(err);
  });
}

export function unmount() {
  if (root) { root.onclick = null; root.innerHTML = ''; }
  root = null;
}
