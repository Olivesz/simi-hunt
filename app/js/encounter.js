// Encounter / catch screen. Plain pointer-event flick physics; no game library.
// Confetti: canvas-confetti (ISC), pinned CDN import, an optional extra on top of the
// local star burst so the catch still celebrates offline. No sound: haptics only.
const CONFETTI = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.module.mjs';
const RING_COLOR = { common: '#2ecc40', uncommon: '#ffcc00', rare: '#ff3b30', legendary: '#ff3b30' };
// Catch odds for a hit with the biggest ring. A smaller ring and each break-out add to it.
const BASE_CHANCE = { common: 0.72, uncommon: 0.6, rare: 0.45, legendary: 0.32 };
const RING_MS = 2400;
const FLIGHT_MS = 480;
const COACH_KEY = 'simihunt.coach.throw'; // per device: first-throw coach already seen
const FLED_KEY = 'simihunt.enc.fled';     // per device, until state.js records fled spawns
let cleanup = null;

const vib = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = k => 1 - (1 - k) * (1 - k);
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const anim = (el, kf, o) => el.animate(kf, o).finished.catch(() => {});

function fledMap() {
  try {
    const m = JSON.parse(lsGet(FLED_KEY) || '{}') || {}, now = Date.now();
    for (const k of Object.keys(m)) if (!(m[k] > now)) delete m[k];
    return m;
  } catch (e) { return {}; }
}
function markFledLocal(id, until) { const m = fledMap(); m[id] = until; lsSet(FLED_KEY, JSON.stringify(m)); }

// Ids with a colon (presenter `demo:<simiId>`, dev `x:<simiId>`) name the Simi directly,
// so they skip the spawns.js lookup and its CDN import.
async function lookupSpawn(spawnId, data) {
  const parts = spawnId.split(':');
  if (parts.length > 1) return { spawnId, simiId: parts[1] };
  try {
    const m = await import('./spawns.js');
    const s = m.getSpawn(spawnId, data);
    if (s) return s;
  } catch (e) {}
  return { spawnId, simiId: spawnId };
}

function ensureCss() {
  let l = document.getElementById('enc-css');
  if (!l) {
    l = document.createElement('link');
    l.id = 'enc-css'; l.rel = 'stylesheet'; l.href = new URL('../css/encounter.css', import.meta.url).href;
    document.head.appendChild(l);
  }
  if (l.sheet) return Promise.resolve();
  return new Promise(r => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); setTimeout(r, 3000); });
}

const CAPSULE_SVG = `<svg viewBox="0 0 44 72" aria-hidden="true"><rect x="2" y="2" width="40" height="68" rx="20" fill="#fff"/><path d="M2 22a20 20 0 0 1 40 0v12H2z" fill="#024EA2"/><rect x="2" y="33" width="40" height="5" fill="#1C4889"/><rect x="2" y="2" width="40" height="68" rx="20" fill="none" stroke="#1C4889" stroke-width="3"/><circle cx="22" cy="35.5" r="6" fill="#fff" stroke="#1C4889" stroke-width="3"/><path d="M19.5 9h5v5h5v5h-5v5h-5v-5h-5v-5h5z" fill="#fff"/><ellipse cx="11" cy="52" rx="2.6" ry="7" fill="#E8F1FC"/></svg>`;
const X_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
const CAM_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8h3.5l2-3h6l2 3h3.5v11h-17z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;
const SMILEY = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="#0a6cff"/><circle cx="38" cy="42" r="6" fill="#fff"/><circle cx="62" cy="42" r="6" fill="#fff"/><path d="M34 62q16 14 32 0" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
const BACKDROP = `<svg viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice"><circle cx="320" cy="110" r="40" fill="#fff6b0"/><g fill="#fff" opacity=".9"><ellipse cx="90" cy="130" rx="55" ry="18"/><ellipse cx="130" cy="118" rx="35" ry="16"/><ellipse cx="260" cy="210" rx="50" ry="15"/></g><g><rect x="55" y="330" width="14" height="70" fill="#7a4b22"/><circle cx="62" cy="310" r="55" fill="#2f8f4a"/><rect x="320" y="350" width="12" height="60" fill="#7a4b22"/><circle cx="326" cy="335" r="45" fill="#3aa35a"/></g><path d="M-20 844C80 640 160 560 200 400L260 400C260 560 330 700 420 844Z" fill="#e9d9a6" opacity=".75"/><g fill="#ffd1e6"><circle cx="40" cy="620" r="6"/><circle cx="350" cy="560" r="6"/><circle cx="90" cy="740" r="6"/></g></svg>`;

export function mount(el, ctx, params = {}) {
  const { state, data, go } = ctx;
  const cssReady = ensureCss();
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sid = String(params.spawnId || params.id || '');
  // Inline size and opacity until encounter.css arrives, so nothing is measured or shown unstyled.
  el.innerHTML = `<div class="enc loading${RM ? ' rm' : ''}" style="position:absolute;inset:0;overflow:hidden;opacity:0">
    <div class="enc-bg">${BACKDROP}</div><video class="enc-video" playsinline muted autoplay></video>
    <div class="enc-stage"><div class="enc-shadow"></div><div class="enc-ring outer"></div><div class="enc-ring"></div>
      <div class="enc-simi"><div class="enc-sprite"><div class="enc-sil"></div></div></div></div>
    <div class="enc-tag" hidden><b></b><span></span></div>
    <div class="enc-ticks"><i></i><i></i><i></i></div>
    <div class="enc-coach" hidden><svg class="enc-arc" aria-hidden="true"><defs><marker id="enc-ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker></defs><path class="enc-arcp" marker-end="url(#enc-ah)"/></svg><i class="enc-finger"></i></div>
    <div class="enc-grab" aria-hidden="true"></div>
    <button class="enc-cap off" type="button" aria-label="Throw capsule" aria-disabled="true">${CAPSULE_SVG}</button>
    <div class="enc-fx"></div>
    <div class="enc-pill" aria-live="polite"><b></b><span></span></div>
    <div class="enc-fbw"><div class="enc-fb" role="status"></div></div>
    <div class="enc-hud">
      <button class="enc-ico" type="button" data-a="leave" aria-label="Leave" title="Leave">${X_SVG}</button>
      <div class="enc-hud-r"><span class="enc-caps"><i>${CAPSULE_SVG}</i><b></b></span>
        <button class="enc-ico" type="button" data-a="ar" aria-pressed="false" aria-label="Camera view" title="Camera view">${CAM_SVG}</button></div>
    </div></div>`;
  const $ = s => el.querySelector(s);
  const root = $('.enc'), simiEl = $('.enc-simi'), sprite = $('.enc-sprite'), shadow = $('.enc-shadow'),
    ring = $('.enc-ring:not(.outer)'), outer = $('.enc-ring.outer'), cap = $('.enc-cap'), capSvg = cap.firstElementChild,
    fbw = $('.enc-fbw'), fb = $('.enc-fb'), video = $('.enc-video'), capsChip = $('.enc-caps'), capsLbl = $('.enc-caps b'),
    pill = $('.enc-pill'), arBtn = $('[data-a=ar]'), bg = $('.enc-bg'), tag = $('.enc-tag'), coach = $('.enc-coach'),
    ticks = $('.enc-ticks'), fx = $('.enc-fx');

  let alive = true, raf = 0, dragRaf = 0, simi = null, rarity = 'common', stream = null, card = null, confetti = null;
  // phase: loading -> ready <-> throwing -> over
  let phase = 'loading', kb = false, hold = false, mt = 0, last = 0, throws = 0, breaks = 0, drag = null, coachOn = false;
  let par = { x: 0, y: 0 };
  const off = { x: 0, y: 0, s: 1 }; // capsule offset from its CSS home
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms); timers.add(id); return id; };
  const wait = ms => new Promise(r => later(r, ms));
  const demoSpawn = sid.startsWith('demo:') || !!state.get().presenter;
  const W = () => root.clientWidth || 390, H = () => root.clientHeight || 844;
  const home = () => ({ x: cap.offsetLeft + cap.offsetWidth / 2, y: cap.offsetTop + cap.offsetHeight / 2 });
  const setCap = (x, y, s = 1, r = 0) => { off.x = x; off.y = y; off.s = s; cap.style.transform = `translate(${x}px,${y}px) scale(${s}) rotate(${r}deg)`; };
  const setCapAbs = (x, y, s, r, h) => setCap(x - h.x, y - h.y, s, r);
  const caps = () => state.get().capsules;
  // The Simi's path is a pure function of its own clock (mt), so a throw can aim where it will be.
  const posAt = t => RM ? { x: W() / 2, y: H() * 0.38 }
    : { x: W() / 2 + Math.sin(t / 900) * Math.min(90, W() * 0.22), y: H() * 0.38 + Math.sin(t / 380) * 10 };
  const ringAt = t => RM ? 0.5 : 1 - 0.78 * ((t % RING_MS) / RING_MS); // 1 -> 0.22, then resets
  let pos = posAt(0);

  function setPill(en, es = '') { pill.querySelector('b').textContent = en; pill.querySelector('span').textContent = es; pill.hidden = !en; }
  const readyPill = () => throws ? setPill('Throw when the ring is small', 'Lanza cuando el aro esté chico')
    : setPill('Swipe up to throw', 'Desliza hacia arriba');
  function pulse(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
  function updCaps(bump) {
    const n = caps();
    capsLbl.textContent = n; capsChip.setAttribute('aria-label', `${n} capsules`);
    cap.classList.toggle('empty', n <= 0);
    if (bump) pulse(capsChip, 'bump');
  }
  let fbTimer = 0;
  function feedback(en, es = '', kind = '') {
    fbw.style.transform = `translateY(${Math.round(Math.max(120, pos.y - 178))}px)`; // above the outer ring
    fb.className = 'enc-fb' + (kind ? ' ' + kind : '');
    fb.innerHTML = `<b>${esc(en)}</b>${es ? `<span>${esc(es)}</span>` : ''}`;
    pulse(fb, 'show');
    clearTimeout(fbTimer); fbTimer = later(() => fb.classList.remove('show'), 1100);
  }
  const notify = msg => (ctx.toast ? ctx.toast(msg, { ms: 2000 }) : feedback(msg));

  // Loop: sidestep, bob and ring. Paused (hold) while the Simi is inside the capsule.
  function frame(now) {
    if (!alive) return;
    const dt = last ? Math.min(50, now - last) : 16; last = now;
    if (!hold) {
      mt += dt; pos = posAt(mt);
      const sx = pos.x + par.x * 18, sy = pos.y + par.y * 12, b = RM ? 0 : Math.sin(mt / 380);
      simiEl.style.transform = `translate(${sx}px,${sy}px) scale(${1 + b * 0.02})`;
      shadow.style.transform = `translate(${sx}px,${H() * 0.38 + 80}px) scale(${1 + b * 0.06})`;
      ring.style.transform = `translate(${sx}px,${sy}px) scale(${ringAt(mt)})`;
      outer.style.transform = `translate(${sx}px,${sy}px)`;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  updCaps(false);
  setPill('Finding the Simi…', 'Buscando al Simi…');
  cssReady.then(() => { if (alive) { root.style.opacity = ''; layoutCoach(); } });

  const artUrl = () => (simi.art ? new URL(simi.art, document.baseURI) : new URL(`../../art/simis/${simi.id}.svg`, import.meta.url)).href;
  function loadSprite() {
    return new Promise(res => {
      let done = false;
      const img = new Image();
      const finish = ok => {
        if (done || !alive) return; done = true;
        sprite.innerHTML = '';
        if (ok) { const f = img.cloneNode(); f.className = 'enc-flash'; sprite.append(img, f); }
        else sprite.innerHTML = SMILEY + SMILEY.replace('<svg', '<svg class="enc-flash"');
        if (!RM) anim(sprite, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'ease-out' });
        res();
      };
      img.alt = ''; img.decoding = 'async';
      img.onload = () => finish(true); img.onerror = () => finish(false);
      later(() => finish(false), 5000);
      img.src = artUrl();
    });
  }

  (async () => {
    const spawn = await lookupSpawn(sid, data);
    if (!alive) return;
    const list = (data && data.simis) || [];
    simi = list.find(s => s.id === spawn.simiId) || null;
    // Expired or unknown spawn: never record a catch for an id that isn't a real Simi.
    if ((!simi && list.length) || (spawn.expiresAt && spawn.expiresAt < Date.now())) return wanderedOff();
    if (!simi) simi = { id: spawn.simiId, name: spawn.simiId, rarity: 'common', flavor: '' };
    rarity = simi.rarity || 'common';
    root.style.setProperty('--rc', RING_COLOR[rarity] || RING_COLOR.common);
    if (state.caughtSpawn?.(sid)) return alreadyCaught();
    if (state.spawnGone?.(sid) || fledMap()[sid]) return ranAway();
    tag.querySelector('b').textContent = simi.name || simi.id;
    tag.querySelector('span').textContent = simi.nameEs || '';
    tag.hidden = false;
    state.markSeen(simi.id);
    await Promise.all([loadSprite(), cssReady]);
    if (!alive) return;
    root.classList.remove('loading');
    if (caps() <= 0) return outOfCaps();
    phase = 'ready';
    cap.classList.remove('off'); cap.setAttribute('aria-disabled', 'false');
    readyPill();
    if (!lsGet(COACH_KEY)) { coachOn = true; coach.hidden = false; layoutCoach(); }
  })();

  // First-use coach: a ghost touch that slides up from the capsule and a dotted arc to the Simi.
  function layoutCoach() {
    if (!coachOn) return;
    const h = home(), w = W(), sx = w / 2, sy = H() * 0.38 + 92, y0 = h.y - 118;
    const svg = coach.querySelector('svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${H()}`);
    svg.querySelector('.enc-arcp').setAttribute('d', `M${h.x} ${y0}Q${h.x + 46} ${(y0 + sy) / 2} ${sx} ${sy}`);
    const f = coach.querySelector('.enc-finger');
    f.style.left = h.x + 'px'; f.style.top = h.y + 'px';
    f.style.setProperty('--dy', `${-Math.round((h.y - sy) * 0.55)}px`);
  }
  const ro = new ResizeObserver(layoutCoach);
  ro.observe(root);

  // Grab: the capsule or anywhere in the bottom third picks it up; it glides to the finger.
  const onDown = e => {
    if (!e.target.closest('.enc-cap,.enc-grab') || e.button > 0 || drag || phase !== 'ready') return;
    e.preventDefault();
    try { root.setPointerCapture(e.pointerId); } catch (err) {}
    cap.getAnimations().forEach(a => a.cancel()); capSvg.getAnimations().forEach(a => a.cancel());
    coach.hidden = true;
    const r = root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    drag = { id: e.pointerId, r, h: home(), x0: x, y0: y, x, y, pts: [{ x, y, t: e.timeStamp }], last: 0 };
    cap.classList.add('held'); vib(8);
    cancelAnimationFrame(dragRaf); dragRaf = requestAnimationFrame(follow);
  };
  function follow(now) {
    if (!drag || !alive) return;
    const dt = drag.last ? Math.min(50, now - drag.last) : 16; drag.last = now;
    const k = 1 - Math.exp(-dt / 27); // ~80 ms to settle on the finger
    setCap(off.x + (drag.x - drag.h.x - off.x) * k, off.y + (drag.y - drag.h.y - off.y) * k, off.s + (1.15 - off.s) * k);
    dragRaf = requestAnimationFrame(follow);
  }
  const onMove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX - drag.r.left; drag.y = e.clientY - drag.r.top;
    drag.pts.push({ x: drag.x, y: drag.y, t: e.timeStamp }); if (drag.pts.length > 12) drag.pts.shift();
  };
  const onUp = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; cancelAnimationFrame(dragRaf); cap.classList.remove('held');
    if (e.type === 'pointercancel') return springHome();
    d.pts.push({ x: e.clientX - d.r.left, y: e.clientY - d.r.top, t: e.timeStamp });
    const end = d.pts[d.pts.length - 1], a = d.pts.find(p => end.t - p.t <= 120) || end;
    const dt = Math.max(16, end.t - a.t), vx = (end.x - a.x) / dt, vy = (end.y - a.y) / dt; // px/ms
    const up = d.y0 - end.y;
    // A flick throws along its release direction; a slow drag upward is an aimed lob.
    if (up >= 40 || (vy <= -0.15 && up > 12)) {
      const fast = vy <= -0.3;
      return throwFrom(d.h.x + off.x, d.h.y + off.y, fast ? vx : end.x - d.x0, fast ? vy : end.y - d.y0, d.h);
    }
    if (Math.hypot(end.x - d.x0, end.y - d.y0) < 14) return tapNudge();
    springHome();
  };
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS apply :active
  root.addEventListener('contextmenu', e => e.preventDefault());
  root.addEventListener('keydown', () => { kb = true; });
  root.addEventListener('pointerdown', () => { kb = false; }, true);

  function springHome() {
    const from = cap.style.transform;
    setCap(0, 0, 1);
    if (!RM && from) cap.animate([{ transform: from }, { transform: cap.style.transform }], { duration: 260, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  }
  function tapNudge() {
    springHome(); vib(10);
    if (!RM) anim(capSvg, [{ transform: 'none' }, { transform: 'translateY(-12px)', offset: 0.4 }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
    setPill('Swipe up to throw', 'Desliza hacia arriba'); pulse(pill, 'pulse');
    if (coachOn) coach.hidden = false;
    later(() => { if (phase === 'ready') readyPill(); }, 1800);
  }
  // Keyboard, screen reader or a tap on the Simi: an aimed throw in one action.
  function autoThrow() {
    if (phase !== 'ready' || drag) return;
    const h = home(), p = posAt(mt + FLIGHT_MS);
    throwFrom(h.x, h.y, p.x - h.x, p.y - h.y, h);
  }

  function tween(ms, fn) {
    return new Promise(res => {
      const s0 = performance.now();
      const step = now => {
        if (!alive) return;
        const k = clamp((now - s0) / ms, 0, 1); fn(k);
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }
  async function fade(node, a, b, ms) { await anim(node, [{ opacity: a }, { opacity: b }], { duration: ms }); node.style.opacity = b; }

  async function throwFrom(sx, sy, dx, dy, h) {
    if (phase !== 'ready') return;
    if (!state.useCapsule()) { updCaps(); springHome(); return outOfCaps(); }
    phase = 'throwing'; throws++; updCaps(true); vib(15);
    coachOn = false; coach.hidden = true; lsSet(COACH_KEY, '1');
    const p = posAt(mt + FLIGHT_MS); // where the Simi will be when the capsule arrives
    let tx = sx + dx * ((p.y - sy) / dy);
    if (Math.abs(tx - p.x) < 220) tx = p.x + (tx - p.x) * 0.5; // aim assist pulls near throws in
    tx = clamp(tx, -40, W() + 40);
    const ty = p.y, s0 = off.s;
    if (RM) { await fade(cap, 1, 0, 75); setCapAbs(tx, ty, 0.58, 0, h); await fade(cap, 0, 1, 75); }
    else await tween(FLIGHT_MS, k => { const e = easeOut(k); setCapAbs(sx + (tx - sx) * e, sy + (ty - sy) * e - 520 * k * (1 - k), s0 + (0.58 - s0) * k, 720 * k, h); });
    if (!alive) return;
    const miss = tx - pos.x;
    return Math.abs(miss) < 90 ? onHit(tx, ty, h) : onMiss(tx, ty, miss, h);
  }

  async function onMiss(tx, ty, miss, h) {
    vib(30);
    if (miss > 0) feedback('Aim a bit left', 'Un poco a la izquierda', 'miss');
    else feedback('Aim a bit right', 'Un poco a la derecha', 'miss');
    if (!RM) await tween(320, k => { setCapAbs(tx + Math.sign(miss) * 30 * k, ty + 150 * k * k, 0.58 - 0.12 * k, 720, h); cap.style.opacity = 1 - k; });
    await respawn();
    afterFail(false);
  }

  async function onHit(tx, ty, h) {
    const rs = ringAt(mt);
    const [en, es] = rs < 0.4 ? ['Excellent!', '¡Excelente!'] : rs < 0.65 ? ['Great!', '¡Genial!'] : ['Nice!', '¡Bien!'];
    feedback(en, es, 'good'); vib([20, 30, 20]); setPill('');
    const chance = demoSpawn ? 1 : Math.min(0.97, (BASE_CHANCE[rarity] || 0.5) + (1 - rs) * 0.3 + (rs < 0.4 ? 0.08 : 0) + breaks * 0.12);
    const ok = Math.random() < chance, breakAt = ok ? 0 : 1 + Math.floor(Math.random() * 3);
    hold = true; root.classList.add('capturing');
    const gy = ty + 70;
    if (RM) {
      await anim(sprite, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
      await fade(cap, 1, 0, 75); setCapAbs(tx, gy, 0.58, 0, h); await fade(cap, 0, 1, 75);
    } else {
      // Capsule pops up, the Simi flashes white and is pulled in, the capsule drops to the ground.
      await tween(120, k => setCapAbs(tx, ty - 24 * easeOut(k), 0.58, 0, h));
      const flash = sprite.querySelector('.enc-flash');
      if (flash) flash.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 110, fill: 'forwards' });
      const dx = tx - pos.x, dy = ty - 24 - pos.y;
      await anim(sprite, [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.35 }, { transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }], { duration: 250, easing: 'ease-in', fill: 'forwards' });
      await tween(220, k => setCapAbs(tx, ty - 24 + 94 * k * k, 0.58, 0, h));
      vib(20);
      await anim(capSvg, [{ transform: 'scale(1.25,.75)' }, { transform: 'scale(.92,1.08)', offset: 0.5 }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }
    if (!alive) return;
    ticks.style.transform = `translate(${tx}px,${gy + 40}px)`;
    [...ticks.children].forEach(t => t.classList.remove('on'));
    ticks.classList.add('show');
    for (let i = 1; i <= 3; i++) {
      await wait(i === 1 ? 350 : 450);
      vib(25);
      if (RM) await anim(capSvg, [{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], { duration: 280 });
      else await anim(capSvg, [{ transform: 'none' }, { transform: 'rotate(-24deg)', offset: 0.3 }, { transform: 'rotate(16deg)', offset: 0.65 }, { transform: 'none' }], { duration: 280, easing: 'ease-in-out' });
      if (!alive) return;
      if (i === breakAt) return breakOut();
      ticks.children[i - 1].classList.add('on');
    }
    await wait(250);
    success(tx, gy);
  }

  async function breakOut() {
    vib(80); breaks++;
    ticks.classList.remove('show');
    const opened = RM ? fade(capSvg, 1, 0, 120)
      : anim(capSvg, [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
    sprite.getAnimations({ subtree: true }).forEach(a => a.cancel());
    hold = false; root.classList.remove('capturing');
    feedback('Almost!', '¡Casi!', 'miss');
    if (RM) anim(sprite, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    else anim(sprite, [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    await opened; await wait(300);
    await respawn();
    afterFail(true);
  }

  async function respawn() {
    if (!alive) return;
    cap.style.opacity = 0; capSvg.getAnimations().forEach(a => a.cancel()); capSvg.style.opacity = '';
    setCap(0, 0, 1);
    if (!RM) await anim(cap, [{ opacity: 0, transform: 'translate(0,24px) scale(.6)' }, { opacity: 1, transform: 'scale(1.08)', offset: 0.7 }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
    cap.style.opacity = '';
  }

  function afterFail(brokeOut) {
    if (!alive) return;
    // Never on a miss, never in the first two throws, never for presenter spawns.
    if (brokeOut && !demoSpawn && throws >= 3 && Math.random() < 0.25) return flee();
    if (caps() <= 0) return outOfCaps();
    phase = 'ready'; readyPill();
  }

  async function flee() {
    phase = 'over'; hold = true; root.classList.add('capturing'); setPill('');
    const until = Date.now() + 3 * 3600e3;
    state.markFled?.(sid, until); markFledLocal(sid, until);
    if (RM) await anim(sprite, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    else await anim(sprite, [{ transform: 'none', opacity: 1 }, { transform: 'translate(0,-24px) rotate(-10deg)', opacity: 1, offset: 0.2 },
      { transform: `translate(${W()}px,-120px) rotate(30deg) scale(.5)`, opacity: 0 }], { duration: 900, easing: 'ease-in', fill: 'forwards' });
    if (alive) ranAway();
  }

  async function success(tx, gy) {
    phase = 'over';
    const { isNew } = state.addCatch({ simiId: simi.id, source: 'map', spawnId: sid }) || {};
    vib([30, 40, 90]);
    fx.style.transform = `translate(${tx}px,${gy}px)`;
    fx.innerHTML = '<i class="enc-click"></i>' + Array.from({ length: 8 }, (_, i) => `<i class="enc-star" style="--a:${i * 45}deg"></i>`).join('');
    pulse(fx, 'go');
    if (!RM) anim(capSvg, [{ transform: 'none' }, { transform: 'scale(1.14)', offset: 0.3 }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
    import(CONFETTI).then(m => {
      if (!alive) return;
      confetti = m.default;
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ['#024EA2', '#fff', '#FFC72C', '#ff5a8a'], disableForReducedMotion: true });
    }).catch(() => {});
    await wait(RM ? 300 : 700);
    const say = simi.catchphrase
      ? `<div class="enc-say">“${esc(simi.catchphrase)}”${simi.catchphraseEs ? `<span>${esc(simi.catchphraseEs)}</span>` : ''}</div>`
      : (simi.flavor ? `<p>${esc(simi.flavor)}</p>` : '');
    showCard(`<h2>Gotcha! <small>¡Atrapado!</small></h2>${say}${cardArt()}
      <h3>${esc(simi.name)}</h3>${simi.nameEs ? `<div class="es">${esc(simi.nameEs)}</div>` : ''}
      ${isNew ? '<div class="new">New SimiDex entry! · ¡Nuevo!</div>' : ''}
      ${buttons(['dex', 'View in SimiDex', 1], ['map', 'Back to map'])}`);
  }

  // ---- end states ----
  function hideStage(noSimi) {
    cap.hidden = true; coachOn = false; coach.hidden = true; setPill('');
    root.classList.remove('loading'); root.classList.add('capturing');
    if (noSimi) { simiEl.hidden = true; shadow.hidden = true; tag.hidden = true; }
  }
  const cardArt = () => `<div class="enc-cimg"><img src="${esc(artUrl())}" alt="" decoding="async"></div>`;
  const buttons = (...bs) => `<div class="row">${bs.map(([a, label, pri]) => `<button type="button" class="enc-btn${pri ? ' pri' : ''}" data-a="${a}">${label}</button>`).join('')}</div>`;
  function showCard(html) {
    phase = 'over';
    if (card) card.remove();
    card = document.createElement('div'); card.className = 'enc-card';
    card.innerHTML = `<div class="enc-cardin" role="dialog" aria-modal="true">${html}</div>`;
    root.appendChild(card); setPill('');
    const im = card.querySelector('.enc-cimg img');
    if (im) im.onerror = () => { im.insertAdjacentHTML('afterend', SMILEY); im.remove(); };
    if (kb) try { card.querySelector('.enc-btn')?.focus({ preventScroll: true }); } catch (e) {}
  }
  function wanderedOff() {
    hideStage(true);
    showCard(`<h2>This Simi wandered off <small>Se fue a pasear</small></h2><p>New Simis pop up every few hours.</p>${buttons(['map', 'Back to map', 1])}`);
  }
  function alreadyCaught() {
    hideStage(true);
    showCard(`<h2>Already caught! <small>¡Ya lo atrapaste!</small></h2>${cardArt()}<p>${esc(simi.name)} is in your SimiDex.</p>
      ${buttons(['dex', 'View in SimiDex', 1], ['map', 'Back to map'])}`);
  }
  function ranAway() {
    hideStage(true);
    showCard(`<h2>${esc(simi.name)} ran away! <small>¡Se escapó!</small></h2><p>More Simis are out there.</p>${buttons(['map', 'Back to map', 1])}`);
  }
  function outOfCaps() {
    phase = 'over'; cap.classList.add('empty'); cap.setAttribute('aria-disabled', 'true'); coach.hidden = true;
    showCard(`<h2>Out of capsules <small>Sin cápsulas</small></h2><div class="enc-cimg sm">${CAPSULE_SVG}</div>
      <p>Spin a SimiStop to get more.</p>${buttons(['stop', 'Find a SimiStop', 1], ['map', 'Back to map'])}`);
  }

  function nearestStop() {
    const st = (data && data.stores) || [], p = state.get().position;
    if (!st.length) return null;
    if (!p) return st[0].id;
    const d = s => (s.lat - p.lat) ** 2 + ((s.lon - p.lon) * Math.cos(p.lat * Math.PI / 180)) ** 2;
    return st.reduce((a, b) => (d(b) < d(a) ? b : a)).id;
  }
  // Leaving goes back in history (or replaces a deep link), so a finished encounter is never
  // one back-gesture away; result cards that open another screen replace this entry.
  const toMap = () => (ctx.back ? ctx.back('#/map') : go('#/map'));

  // AR toggle
  const onOrient = e => {
    if (e.gamma == null) return;
    par.x = clamp(e.gamma / 30, -1, 1); par.y = clamp((e.beta - 60) / 30, -1, 1);
    bg.style.transform = `translate(${-par.x * 10}px,${-par.y * 8}px)`; video.style.transform = bg.style.transform;
  };
  async function setAR(on) {
    if (!on) {
      root.classList.remove('ar'); arBtn.setAttribute('aria-pressed', 'false');
      if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null;
      removeEventListener('deviceorientation', onOrient); par = { x: 0, y: 0 }; return;
    }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { if (await DeviceOrientationEvent.requestPermission() === 'granted') addEventListener('deviceorientation', onOrient); } catch (e) {}
      } else addEventListener('deviceorientation', onOrient);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream; video.play().catch(() => {});
      root.classList.add('ar'); arBtn.setAttribute('aria-pressed', 'true');
    } catch (e) { setAR(false); notify('Camera unavailable · Cámara no disponible'); }
  }

  const onClick = e => {
    if (e.target.closest('.enc-cap')) { if (e.detail === 0) autoThrow(); return; } // pointer taps are handled above
    if (e.target.closest('.enc-simi')) return autoThrow();
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    vib(8);
    if (a === 'leave' || a === 'map') toMap();
    else if (a === 'dex') go('#/dex/' + simi.id, { replace: true });
    else if (a === 'stop') { const id = nearestStop(); if (id) go('#/stop/' + id, { replace: true }); else toMap(); }
    else if (a === 'ar') setAR(!root.classList.contains('ar'));
  };
  el.addEventListener('click', onClick);

  cleanup = () => {
    alive = false; ro.disconnect(); cancelAnimationFrame(raf); cancelAnimationFrame(dragRaf);
    timers.forEach(clearTimeout); timers.clear();
    el.removeEventListener('click', onClick);
    removeEventListener('deviceorientation', onOrient);
    if (stream) stream.getTracks().forEach(t => t.stop());
    try { confetti?.reset?.(); } catch (e) {}
    el.innerHTML = '';
  };
}

export function unmount() { if (cleanup) cleanup(); cleanup = null; }
