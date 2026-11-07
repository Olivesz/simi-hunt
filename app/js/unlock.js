// #/unlock/:simiId?store=&shelf= : reveal after a shelf-sign claim.
// The full celebration plays once, right after a claim (claim.js takeFresh): a
// Simi capsule wobbles twice and cracks open (about 1 s; a tap skips it), then the
// silhouette fills with color, with flash, confetti and NEW. Coming back with
// Back, or opening the link directly, shows the calm "In your SimiDex" view, or a
// locked card when the player doesn't have this Simi yet.

import { takeFresh } from './claim.js';

const CONFETTI_URL = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.4/dist/confetti.module.mjs';
const ART_DIR = new URL('../../art/simis/', import.meta.url);
const BASE_ART = new URL('../../art/base/simi-base.svg', import.meta.url);
const STYLE_ID = 'unlock-style';

// Used only when simis.json / stores-*.json are not loaded yet.
const FALLBACK_TIER = { texas: 'store', rockstar: 'store', mariachi: 'store', beach: 'shelf', spa: 'shelf', astronaut: 'shelf', flu: 'shelf', boxeador: 'shelf' };
const FALLBACK_STORE = { 'cvs-guadalupe-2402': 'CVS Guadalupe St', 'cvs-congress-500': 'CVS Congress Ave', 'cvs-airport-2213': 'CVS Airport Blvd' };
const TIER_LABEL = { store: 'Store exclusive', shelf: 'Shelf Simi', event: 'Event Simi', common: 'Wild Simi' };
const ABBR = { Street: 'St', Avenue: 'Ave', Boulevard: 'Blvd', Road: 'Rd', Drive: 'Dr', Lane: 'Ln', Parkway: 'Pkwy', Highway: 'Hwy' };
const PRE_MS = 950; // capsule wobble before it cracks open

let root = null;
let confettiFn = null;
let confettiLoad = null;
let fire = null;
let timers = [];

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function titleCase(id) {
  return String(id || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// "CVS Guadalupe St" from "2402 Guadalupe Street, Austin, TX", short enough for one line.
function shortStore(storeId, store) {
  if (!storeId || storeId === 'any') return 'a participating CVS';
  const street = store?.address ? String(store.address).split(',')[0].replace(/^\d+[A-Za-z]?\s+/, '').trim() : '';
  if (street) return 'CVS ' + street.replace(/\b(Street|Avenue|Boulevard|Road|Drive|Lane|Parkway|Highway)\b/g, (w) => ABBR[w]);
  return FALLBACK_STORE[storeId] || (store?.name && store.name !== 'CVS Pharmacy' ? store.name : `CVS ${titleCase(storeId.replace(/^cvs-/, '').replace(/-\d+$/, ''))}`);
}

function loadConfetti() {
  if (!confettiLoad) {
    confettiLoad = import(CONFETTI_URL).then((m) => { confettiFn = m.default; return confettiFn; })
      .catch((e) => { confettiLoad = null; throw e; });
  }
  return confettiLoad;
}

// The scanner calls this on mount so the reveal has nothing left to download.
export function warm() {
  if (!reduced()) loadConfetti().catch(() => {});
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
  body[data-route="scan"] #screen-layer, body[data-route="claim"] #screen-layer, body[data-route="unlock"] #screen-layer { background: #07142b; }
  .unl { position: relative; height: 100%; box-sizing: border-box; overflow: hidden auto; display: flex; flex-direction: column; align-items: center; text-align: center;
         padding: calc(12px + env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px));
         color: #fff; font-family: var(--font-body, system-ui, sans-serif);
         background: radial-gradient(110% 70% at 50% 30%, #3aa8ff 0%, var(--simi-blue, #024EA2) 48%, #0b2a5c 100%); animation: unl-in .2s ease-out both; }
  .unl.store { background: radial-gradient(110% 70% at 50% 30%, #ff7a8f 0%, #D60F3C 46%, #5c0a1e 100%); }
  .unl.locked { background: radial-gradient(110% 70% at 50% 30%, #2a4f86 0%, #13305f 50%, #07142b 100%); }
  .unl-x { position: absolute; top: calc(12px + env(safe-area-inset-top, 0px)); left: calc(12px + env(safe-area-inset-left, 0px)); z-index: 6; width: 44px; height: 44px; border: 0; border-radius: 50%;
           background: rgba(255,255,255,.18); color: #fff; font-size: 20px; line-height: 1; display: grid; place-items: center; cursor: pointer; }
  .unl-kicker { min-height: 44px; display: flex; align-items: center; padding: 0 52px; font-family: var(--font-display, system-ui, sans-serif);
                font-size: 15px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; opacity: .95; }
  .unl-stage { position: relative; flex: 1 1 0; min-height: 0; width: 100%; }
  .unl-orb { position: absolute; left: 50%; top: 50%; height: min(100%, 78vw, 320px); aspect-ratio: 1; transform: translate(-50%, -50%); display: grid; place-items: center; }
  .unl-rays { position: absolute; inset: -30%; border-radius: 50%; pointer-events: none;
              background: repeating-conic-gradient(from 0deg, rgba(255,255,255,.26) 0 9deg, rgba(255,255,255,0) 9deg 22.5deg);
              -webkit-mask: radial-gradient(circle, #000 18%, transparent 68%); mask: radial-gradient(circle, #000 18%, transparent 68%);
              animation: unl-spin 18s linear infinite; will-change: transform; }
  .unl-glow { position: absolute; width: 72%; height: 72%; border-radius: 50%; background: radial-gradient(circle, #fff 0%, rgba(255,240,180,.8) 30%, rgba(255,255,255,0) 70%);
              animation: unl-pulse 2.4s ease-in-out infinite; }
  .unl.locked .unl-rays { opacity: .35; }
  .unl.locked .unl-glow { opacity: .35; animation: none; }
  .unl-art { position: relative; width: 80%; height: 80%; object-fit: contain; filter: drop-shadow(0 10px 18px rgba(0,0,0,.35)); }
  .unl-art.sil { filter: brightness(0) drop-shadow(0 10px 18px rgba(0,0,0,.35)); opacity: .75; }
  .unl-tags { display: flex; gap: 8px; align-items: center; justify-content: center; margin-top: 8px; }
  .unl-badge, .unl-new { display: inline-block; padding: 5px 12px; border-radius: 99px; font: 800 13px var(--font-display, system-ui, sans-serif);
                         letter-spacing: .08em; text-transform: uppercase; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
  .unl-badge { background: var(--sun, #FFC72C); color: #5a3a00; }
  .unl-new { background: var(--ok, #1E9E5A); color: #fff; }
  .unl h1 { margin: 8px 0 0; font-family: var(--font-display, system-ui, sans-serif); font-size: 34px; line-height: 1.05; }
  .unl-es { margin-top: 2px; font-size: 16px; font-weight: 600; opacity: .85; }
  .unl-flavor { max-width: 340px; margin: 8px 0 0; font-size: 15px; line-height: 1.4; opacity: .95;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .unl-flavor.line { font-weight: 700; font-style: italic; }
  .unl-where { margin-top: 10px; max-width: 100%; box-sizing: border-box; font-size: 15px; padding: 8px 14px; border-radius: 12px; background: rgba(255,255,255,.14);
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .unl-where b { font-weight: 800; }
  .unl-actions { position: sticky; bottom: 0; z-index: 2; width: 100%; max-width: 380px; box-sizing: border-box; margin-top: 12px;
                 padding: 4px 0 max(16px, env(safe-area-inset-bottom, 0px)); }
  .unl-btn { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 56px; margin-top: 10px; border: 0; border-radius: 18px;
             font: 800 18px var(--font-display, system-ui, sans-serif); cursor: pointer; background: #fff; color: var(--simi-blue, #024EA2); box-shadow: 0 4px 0 rgba(0,0,0,.18), 0 6px 16px rgba(0,0,0,.18); }
  .unl.store .unl-btn:not(.alt) { color: #b30d33; }
  .unl.locked .unl-btn:not(.alt) { background: var(--sun, #FFC72C); color: #3a2600; }
  .unl-btn.alt { background: rgba(255,255,255,.16); color: #fff; box-shadow: none; }
  .unl-link { display: block; margin: 6px auto 0; min-height: 40px; padding: 0 16px; border: 0; background: none; color: #fff; opacity: .85;
              font: 700 15px var(--font-body, system-ui, sans-serif); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .unl-btn, .unl-x, .unl-link { touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: transform .08s ease-out; }
  .unl-btn:active, .unl-x:active, .unl-link:active { transform: scale(.96); }
  .unl-btn:focus-visible, .unl-x:focus-visible, .unl-link:focus-visible { outline: 3px solid var(--sun, #FFC72C); outline-offset: 2px; }
  .unl-flash { position: absolute; inset: 0; z-index: 4; pointer-events: none; background: radial-gradient(circle at 50% 36%, rgba(255,255,255,.95) 0%, rgba(255,255,255,.55) 35%, rgba(255,255,255,0) 70%);
               animation: unl-flash .45s ease-out forwards; }
  .unl canvas.unl-confetti { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; }
  .unl-cap { position: absolute; left: 50%; top: 50%; width: 26%; height: 50%; margin: -25% 0 0 -13%; display: flex; flex-direction: column; pointer-events: none;
             transform: rotate(-24deg); filter: drop-shadow(0 10px 14px rgba(0,0,0,.35)); }
  .unl-cap i { flex: 1; display: block; box-shadow: 0 0 0 4px var(--simi-navy, #1C4889); }
  .unl-cap i:first-child { border-radius: 999px 999px 0 0; border-bottom: 4px solid var(--simi-navy, #1C4889);
                           background: linear-gradient(90deg, #2C73C6, var(--simi-blue, #024EA2) 55%, var(--simi-navy, #1C4889)); }
  .unl-cap i:last-child { border-radius: 0 0 999px 999px; background: linear-gradient(90deg, #FFE07A, var(--sun, #FFC72C) 55%, var(--sun-deep, #F5A300)); }
  .unl.pre .unl-cap { animation: unl-wobble .46s ease-in-out 2; }
  .unl.open .unl-cap i:first-child { animation: unl-crack-top .38s ease-in forwards; }
  .unl.open .unl-cap i:last-child { animation: unl-crack-bot .38s ease-in forwards; }
  .unl.open .unl-cap { animation: unl-gone 0s linear .4s forwards; }
  .unl.pre .unl-rays, .unl.pre .unl-glow { opacity: .3; }
  .unl.pre .unl-tags, .unl.pre h1, .unl.pre .unl-es, .unl.pre .unl-flavor, .unl.pre .unl-where, .unl.pre .unl-actions { visibility: hidden; }
  .unl.pre { cursor: pointer; }
  .unl.fresh.open .unl-rays { animation: unl-spin 18s linear infinite, unl-burst .5s ease-out both; }
  .unl.fresh:not(.ready) .unl-art { opacity: 0; }
  .unl.fresh.ready .unl-art { animation: unl-pop .55s cubic-bezier(.2,1.5,.4,1) both, unl-fill .7s ease-out .1s both; }
  .unl.fresh.open .unl-tags { animation: unl-rise .3s ease-out .3s both; }
  .unl.fresh.open h1 { animation: unl-rise .3s ease-out .35s both; }
  .unl.fresh.open .unl-es, .unl.fresh.open .unl-flavor { animation: unl-rise .3s ease-out .4s both; }
  .unl.fresh.open .unl-where { animation: unl-rise .3s ease-out .42s both; }
  .unl.fresh.open .unl-actions { animation: unl-rise .3s ease-out .45s both; }
  @keyframes unl-in { from { opacity: 0; } }
  @keyframes unl-spin { to { transform: rotate(360deg); } }
  @keyframes unl-burst { from { opacity: 0; transform: scale(.4); } }
  @keyframes unl-pulse { 50% { transform: scale(1.1); opacity: .85; } }
  @keyframes unl-flash { from { opacity: 1; } to { opacity: 0; visibility: hidden; } }
  @keyframes unl-pop { from { transform: scale(.2) translateY(40px); opacity: 0; } }
  @keyframes unl-rise { from { transform: translateY(12px); opacity: 0; } }
  @keyframes unl-wobble { 0%, 100% { transform: rotate(-24deg); } 25% { transform: rotate(-38deg) translateY(-4%); } 60% { transform: rotate(-10deg); } }
  @keyframes unl-crack-top { to { transform: translate(-60%, -70%) rotate(-40deg); opacity: 0; } }
  @keyframes unl-crack-bot { to { transform: translate(60%, 70%) rotate(30deg); opacity: 0; } }
  @keyframes unl-gone { to { visibility: hidden; } }
  @keyframes unl-fill { from { filter: brightness(0) drop-shadow(0 10px 18px rgba(0,0,0,.35)); } to { filter: brightness(1) drop-shadow(0 10px 18px rgba(0,0,0,.35)); } }
  @media (max-height: 700px) { .unl-flavor { display: none; } }
  @media (max-height: 620px) { .unl h1 { font-size: 28px; margin-top: 6px; } .unl-where { margin-top: 8px; padding: 6px 12px; } .unl-link { display: none; } .unl-btn { min-height: 52px; } }
  /* Short landscape (a phone on its side): art on the left, words and buttons on the right. */
  @media (orientation: landscape) and (max-height: 500px) {
    .unl { justify-content: center; padding: calc(8px + env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px))
           max(8px, env(safe-area-inset-bottom, 0px)) calc(44% + env(safe-area-inset-left, 0px)); }
    .unl > .unl-stage { position: absolute; top: 0; bottom: 0; left: env(safe-area-inset-left, 0px); width: 44%; flex: none; }
    .unl-kicker { min-height: 32px; justify-content: center; padding: 0; font-size: 13px; }
    .unl h1 { font-size: 28px; margin-top: 4px; }
    .unl-where { justify-self: center; margin-top: 6px; padding: 6px 12px; }
    .unl-actions { position: static; display: flex; gap: 10px; max-width: none; margin-top: 8px; padding: 0; }
    .unl-btn { margin-top: 0; min-height: 48px; font-size: 16px; }
    .unl-link { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .unl, .unl * { animation: none !important; transition: none !important; }
    .unl-flash, .unl-cap { display: none; }
    .unl-btn:active, .unl-x:active, .unl-link:active { transform: none; }
  }
  `;
  document.head.appendChild(st);
}

async function celebrate(el, store) {
  if (reduced()) return;
  try {
    const confetti = confettiFn || await loadConfetti();
    if (root !== el) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'unl-confetti';
    el.querySelector('.unl').appendChild(canvas);
    fire = confetti.create(canvas, { resize: true, useWorker: true, disableForReducedMotion: true });
    const colors = store ? ['#FFC72C', '#ffffff', '#ff9fb1', '#D60F3C'] : ['#FFC72C', '#ffffff', '#7cc8ff', '#0798E8'];
    fire({ particleCount: 100, spread: 80, startVelocity: 46, origin: { y: 0.4 }, colors });
    timers.push(setTimeout(() => root === el && fire && fire({ particleCount: 45, angle: 60, spread: 60, origin: { x: 0, y: 0.6 }, colors }), 300));
    timers.push(setTimeout(() => root === el && fire && fire({ particleCount: 45, angle: 120, spread: 60, origin: { x: 1, y: 0.6 }, colors }), 450));
  } catch (e) {
    console.warn('[unlock] confetti unavailable', e);
  }
}

function artFor(simi, simiId) {
  try {
    if (simi.art) return new URL(simi.art, document.baseURI).href;
  } catch { /* fall through */ }
  return new URL(encodeURIComponent(simiId) + '.svg', ART_DIR).href;
}

export function mount(el, ctx, params = {}) {
  root = el;
  injectStyle();
  const { state, data = {}, go } = ctx;
  const simiId = String(params.simiId || '').split('?')[0];
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  const simis = data.simis || [];
  const simi = simis.find((x) => x.id === simiId) || {};
  const known = !!simi.id || (!simis.length && !!FALLBACK_TIER[simiId]);
  const snap = state.get();
  const owned = typeof state.has === 'function' ? state.has(simiId) : snap.catches.some((c) => c.simiId === simiId);
  const fresh = known ? takeFresh(simiId) : null;
  const view = !known ? 'missing' : (fresh || owned) ? 'reveal' : 'locked';

  const rec = snap.catches.filter((c) => c.simiId === simiId && c.storeId).pop();
  const storeId = params.store || q.get('store') || rec?.storeId || simi.storeId || '';
  const shelf = params.shelf || q.get('shelf') || rec?.shelfType || '';
  const tier = simi.tier || FALLBACK_TIER[simiId] || 'shelf';
  const store = (data.stores || []).find((x) => x.id === storeId);
  const storeName = shortStore(storeId, store);
  const name = view === 'missing' ? 'No Simi here' : (simi.name || `${titleCase(simiId)} Simi`);
  const isNew = !!fresh?.isNew;
  const few = snap.catches.length < 3;
  const dexHash = `#/dex/${encodeURIComponent(simiId)}`;

  let kicker, where = '', actions = [], link = null;
  const pre = !!fresh && !reduced();
  if (view === 'reveal') {
    kicker = fresh ? (isNew ? 'New Simi unlocked!' : 'Simi unlocked!') : 'In your SimiDex';
    where = `Unlocked at <b>${esc(storeName)}</b>`;
    if (shelf) actions.push({ go: `#/shelf/${encodeURIComponent(storeId || 'any')}/${encodeURIComponent(shelf)}`, label: 'See this shelf’s products' });
    actions.push(few ? { go: '#/map', label: 'Catch more on the map' } : { go: dexHash, label: 'View in SimiDex' });
    if (few) link = { go: dexHash, label: 'Open SimiDex' };
  } else if (view === 'locked') {
    kicker = 'Not unlocked yet';
    where = simi.storeId ? `Only at <b>${esc(shortStore(simi.storeId, (data.stores || []).find((x) => x.id === simi.storeId)))}</b>`
      : simi.shelf ? `Find it on the <b>${esc(titleCase(simi.shelf).toLowerCase())}</b> shelf` : '';
    actions = [{ go: '#/scan', label: 'Scan a sign' }, { go: '#/map', label: 'Back to map' }];
  } else {
    kicker = 'Simi not found';
    actions = [{ go: '#/scan', label: 'Scan a sign' }, { go: '#/map', label: 'Back to map' }];
  }

  const art = view === 'missing' ? BASE_ART.href : artFor(simi, simiId);
  const cls = ['unl', tier === 'store' && view === 'reveal' ? 'store' : '', view !== 'reveal' ? 'locked' : '', fresh ? 'fresh' : '',
    pre ? 'pre' : fresh ? 'open' : ''].filter(Boolean).join(' ');
  // The written QR-unlock line from the lore, when simis.json carries one.
  const line = view === 'reveal' && typeof simi.lines?.qrUnlock === 'string' ? simi.lines.qrUnlock : '';
  el.innerHTML = `
    <div class="${cls}">
      <button class="unl-x" data-act="close" aria-label="Close">✕</button>
      <div class="unl-kicker" role="status">${esc(pre ? 'Unlocking…' : kicker)}</div>
      <div class="unl-stage">
        <div class="unl-orb">
          <div class="unl-rays"></div>
          <div class="unl-glow"></div>
          <img class="unl-art${view === 'reveal' ? '' : ' sil'}" alt="${esc(view === 'reveal' ? name : '')}" src="${esc(art)}" decoding="async">
          ${pre ? '<div class="unl-cap" aria-hidden="true"><i></i><i></i></div>' : ''}
        </div>
      </div>
      ${view !== 'missing' ? `<div class="unl-tags"><span class="unl-badge">${esc(TIER_LABEL[tier] || 'Simi')}</span>${isNew ? '<span class="unl-new">New</span>' : ''}</div>` : ''}
      <h1>${esc(name)}</h1>
      ${view === 'reveal' && simi.nameEs ? `<div class="unl-es">${esc(simi.nameEs)}</div>` : ''}
      ${line ? `<p class="unl-flavor line">“${esc(line)}”</p>` : view === 'reveal' && simi.flavor ? `<p class="unl-flavor">${esc(simi.flavor)}</p>` : ''}
      ${view === 'locked' ? '<p class="unl-flavor">Scan its shelf sign to unlock it. · Escanea el letrero para desbloquearlo.</p>' : ''}
      ${view === 'missing' ? '<p class="unl-flavor">That link doesn’t match a Simi. Scan a sign on the shelf.</p>' : ''}
      ${where ? `<div class="unl-where">${where}</div>` : ''}
      <div class="unl-actions">
        ${actions.map((a, i) => `<button class="unl-btn${i ? ' alt' : ''}" data-go="${esc(a.go)}">${esc(a.label)}</button>`).join('')}
        ${link ? `<button class="unl-link" data-go="${esc(link.go)}">${esc(link.label)}</button>` : ''}
      </div>
    </div>`;

  const wrap = el.querySelector('.unl');
  const img = el.querySelector('.unl-art');
  // A failed load falls back to the base Simi: in color on a reveal, as a
  // silhouette only on the locked and missing cards.
  img.onerror = () => { img.onerror = null; if (view !== 'reveal') img.classList.add('sil'); img.src = BASE_ART.href; };
  el.onclick = (e) => {
    if (e.target.closest('[data-act="close"]')) { (ctx.back || go)('#/map'); return; }
    const b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  };
  if (view === 'reveal') { try { state.markSeen?.(simiId); } catch { /* seen is already set by addCatch */ } }

  if (fresh) {
    // The capsule cracks after PRE_MS, or at once on a tap. The art pops (and
    // fills with color) once it is open and can paint; the scanner usually
    // preloaded it, and 600 ms is the longest it waits.
    let opened = false, decoded = false, shown = false;
    const show = () => {
      if (shown || !opened || !decoded || root !== el) return;
      shown = true;
      wrap.classList.add('ready');
      if (!reduced() && navigator.userActivation?.hasBeenActive !== false) { try { navigator.vibrate?.([20, 40, 70]); } catch { /* no haptics */ } }
    };
    const markDecoded = () => { decoded = true; show(); };
    const open = () => {
      if (opened || root !== el) return;
      opened = true;
      wrap.classList.replace('pre', 'open');
      wrap.querySelector('.unl-kicker').textContent = kicker;
      if (pre) {
        const flash = document.createElement('div');
        flash.className = 'unl-flash';
        wrap.appendChild(flash);
      }
      timers.push(setTimeout(markDecoded, 600));
      show();
      celebrate(el, tier === 'store');
    };
    (img.decode ? img.decode() : Promise.resolve()).then(markDecoded, markDecoded);
    if (pre) {
      wrap.addEventListener('pointerdown', open, { once: true });
      timers.push(setTimeout(open, PRE_MS));
    } else open();
  }
}

export function unmount() {
  timers.forEach(clearTimeout);
  timers = [];
  try { fire?.reset?.(); } catch { /* already gone */ }
  fire = null;
  if (root) { root.onclick = null; root.innerHTML = ''; }
  root = null;
}
