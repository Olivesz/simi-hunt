// #/scan: in-app camera scanner for Simi Hunt shelf signs.
// Decoding uses the browser's own BarcodeDetector when it reads QR codes (Chrome
// on Android), else the barcode-detector ponyfill (ZXing-C++ in WASM), which also
// works on iOS. The wasm is loaded from a pinned jsDelivr URL; to self-host it,
// change WASM_URL to a local path.
// A good scan is claimed right here (claim.js claimToken), so the player goes
// straight from the camera to the reveal; anything else hands off to #/claim,
// which explains what went wrong.
// Fallbacks: type the short code printed on the sign, or scan a photo of it.
// warm() lets the shell fetch the decoder ahead of the first scan.

import { extractToken, resolveCode, claimToken, warmKey, preloadArt } from './claim.js';

const BD_URL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/dist/es/ponyfill.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.6/dist/reader/zxing_reader.wasm';
const STYLE_ID = 'qr-style';

let root = null;
let stream = null;
let loopTimer = null;
let wrongTimer = null;
let detectorPromise = null;
let nativeBroken = false;
let gen = 0; // bumps on every camera (re)start, so an old scan loop stops itself
let detachLifecycle = null;
const DECODER_TIMEOUT_MS = 30000; // the wasm is ~1 MB; slow 3G takes ~15 s

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
// Haptics only after the player has touched the page (browsers block it otherwise).
const buzz = (p) => {
  if (reduced() || navigator.userActivation?.hasBeenActive === false) return;
  try { navigator.vibrate?.(p); } catch { /* no haptics */ }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(what + ' timed out')), ms))]);

async function makeDetector() {
  const Native = globalThis.BarcodeDetector;
  if (!nativeBroken && Native && typeof Native.getSupportedFormats === 'function') {
    try {
      if ((await withTimeout(Native.getSupportedFormats(), 1500, 'formats')).includes('qr_code')) {
        const d = new Native({ formats: ['qr_code'] });
        // Some builds list qr_code but never answer detect(); a tiny probe proves it works.
        await withTimeout(d.detect(new ImageData(8, 8)), 1500, 'native probe');
        d.native = true;
        return d;
      }
    } catch (e) { console.info('[qr] using the ZXing decoder:', e.message); }
  }
  // fireImmediately fetches and compiles the wasm now, so "ready" means ready.
  // A stalled download gives up, so the scanner can say so and offer a retry.
  return withTimeout((async () => {
    const m = await import(BD_URL);
    await m.prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? WASM_URL : prefix + path) },
      fireImmediately: true,
    });
    return new m.BarcodeDetector({ formats: ['qr_code'] });
  })(), DECODER_TIMEOUT_MS, 'scanner download');
}

function detector() {
  if (!detectorPromise) detectorPromise = makeDetector().catch((e) => { detectorPromise = null; throw e; });
  return detectorPromise;
}

// Fetch the decoder, the verification key and the reveal ahead of the first scan.
// Safe to call any time (the shell can call it when the map is idle); it never
// asks for the camera.
export function warm() {
  if (!globalThis.isSecureContext) return;
  detector().catch(() => {});
  warmKey();
  import('./unlock.js').then((m) => m.warm?.()).catch(() => {});
}

// A native detector that stops answering is dropped for the rest of the session.
function dropNative(d, err) {
  if (!d?.native) return false;
  console.info('[qr] native detector stalled, switching to ZXing:', err?.message || err);
  nativeBroken = true;
  detectorPromise = null;
  return true;
}

// Decode the first QR in an image source (video, canvas, ImageBitmap, Blob...).
export async function decodeQR(source) {
  for (let attempt = 0; ; attempt++) {
    const d = await detector();
    try {
      const hits = await withTimeout(d.detect(source), 5000, 'decode');
      return hits.length ? hits[0].rawValue : null;
    } catch (err) {
      if (attempt || !dropNative(d, err)) throw err;
    }
  }
}

const ICON = {
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.2 4h5.6l1.6 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.6zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.2 4h5.6l1.6 2H20a2 2 0 0 1 2 2v10c0 .4-.1.7-.3 1L7.4 4.7zM2.3 3.3 3.7 1.9l18.4 18.4-1.4 1.4-1.7-1.7H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.5-1.9zM8.5 11.5A4 4 0 0 0 12.5 17z"/></svg>',
  torch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h10v4l-3 4v11a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V10L7 6zm4 10v3h2v-3z"/></svg>',
  flip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.2 4h5.6l1.6 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.6zM12 8.5a4.5 4.5 0 0 0-4.2 2.9l1.6.6A2.8 2.8 0 0 1 14.6 12H13l2.5 3 2.5-3h-1.7A4.5 4.5 0 0 0 12 8.5m-3.5 4.5L6 16h1.7a4.5 4.5 0 0 0 8.5 1.1l-1.6-.6A2.8 2.8 0 0 1 9.4 16H11z"/></svg>',
  keys: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1m2 3v2h2V9zm4 0v2h2V9zm4 0v2h2V9zm4 0v2h2V9zM7 14v2h10v-2z"/></svg>',
  photo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m0 12.5V18h16v-3l-4-4-5 5-3-3zM8 6.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/></svg>',
};

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
  body[data-route="scan"] #screen-layer, body[data-route="claim"] #screen-layer, body[data-route="unlock"] #screen-layer { background: #07142b; }
  .qrs { --box: min(76vw, 300px, 46vh); position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden;
         background: #07142b; color: #fff; font-family: var(--font-body, system-ui, sans-serif); }
  @supports (height: 1dvh) { .qrs { --box: min(76vw, 300px, 46dvh); } }
  .qrs video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .3s ease-out; }
  .qrs.live video { opacity: 1; }
  .qrs.typing video { opacity: .25; }
  .qrs video.mirror { transform: scaleX(-1); }
  .qrs-top { position: relative; z-index: 3; display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; gap: 8px;
             padding: calc(12px + env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) 4px max(12px, env(safe-area-inset-left, 0px)); }
  .qrs-top h2 { margin: 0; text-align: center; font: 800 21px var(--font-display, system-ui, sans-serif); text-shadow: 0 1px 6px rgba(0,0,0,.4); }
  .qrs-x { width: 44px; height: 44px; border: 0; border-radius: 50%; background: rgba(255,255,255,.18); color: #fff; font-size: 20px; line-height: 1;
           display: grid; place-items: center; cursor: pointer; }
  .qrs-mid { position: relative; z-index: 1; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
             gap: 16px; padding: 8px 16px; transition: opacity .18s ease-out; }
  .qrs.typing .qrs-mid { opacity: 0; pointer-events: none; }
  .qrs-box { position: relative; flex: none; width: var(--box); height: var(--box); border-radius: 28px; box-shadow: 0 0 0 200vmax rgba(5,14,32,.6); }
  .qrs-frame { position: absolute; inset: 0; }
  .qrs-frame i { position: absolute; width: 54px; height: 54px; border: 7px solid var(--sun, #FFC72C); transition: border-color .12s; }
  .qrs-frame i:nth-child(1) { top: -4px; left: -4px; border-right: 0; border-bottom: 0; border-top-left-radius: 30px; }
  .qrs-frame i:nth-child(2) { top: -4px; right: -4px; border-left: 0; border-bottom: 0; border-top-right-radius: 30px; }
  .qrs-frame i:nth-child(3) { bottom: -4px; left: -4px; border-right: 0; border-top: 0; border-bottom-left-radius: 30px; }
  .qrs-frame i:nth-child(4) { bottom: -4px; right: -4px; border-left: 0; border-top: 0; border-bottom-right-radius: 30px; }
  .qrs-line { position: absolute; left: 8%; right: 8%; top: 0; height: 3px; border-radius: 3px; opacity: 0; will-change: transform;
              background: linear-gradient(90deg, transparent, var(--sun, #FFC72C), transparent); transform: translateY(calc(var(--box) * .49)); transition: opacity .2s; }
  .qrs[data-state="loading"] .qrs-line { opacity: .3; }
  .qrs[data-state="ready"] .qrs-line { opacity: 1; animation: qrs-sweep 2.2s ease-in-out infinite; }
  .qrs[data-state="hit"] .qrs-frame i { border-color: #3ddc84; }
  .qrs[data-state="hit"] .qrs-frame { animation: qrs-hit .18s ease-out; }
  .qrs-msg { position: absolute; inset: 18px; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; }
  .qrs[data-state="priming"] .qrs-msg, .qrs[data-state="off"] .qrs-msg { display: flex; animation: qrs-in .2s ease-out both; }
  .qrs-msg svg { width: 52px; height: 52px; color: var(--sun, #FFC72C); }
  .qrs-msg b { font: 800 22px/1.15 var(--font-display, system-ui, sans-serif); }
  .qrs-msg p { margin: 0; font-size: 16px; line-height: 1.35; opacity: .92; }
  .qrs-msg .qrs-btn { flex: none; min-height: 48px; padding: 0 22px; margin-top: 6px; }
  .qrs-hint { position: relative; min-height: 46px; max-width: 340px; text-align: center; font-size: 17px; font-weight: 700; line-height: 1.35;
              text-shadow: 0 1px 6px rgba(0,0,0,.55); }
  .qrs-hint small { display: block; font-size: 15px; font-weight: 600; opacity: .8; }
  .qrs-hint.err { color: #ffc2cd; }
  .qrs-tools { position: relative; display: flex; gap: 18px; }
  .qrs-round { width: 56px; height: 56px; border: 0; border-radius: 50%; background: rgba(255,255,255,.18); color: #fff; display: grid; place-items: center; cursor: pointer; }
  .qrs-round svg { width: 26px; height: 26px; }
  .qrs-round.on { background: var(--sun, #FFC72C); color: #3a2600; }
  .qrs-round[hidden] { display: none; }
  .qrs-bottom { position: relative; z-index: 3; display: flex; gap: 10px;
                padding: 12px max(16px, env(safe-area-inset-right, 0px)) max(18px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
                background: linear-gradient(rgba(5,14,32,0), rgba(5,14,32,.85) 35%); }
  .qrs.insecure .qrs-bottom { display: none; }
  .qrs-btn { flex: 1; min-height: 56px; border: 0; border-radius: 18px; display: flex; gap: 8px; align-items: center; justify-content: center; cursor: pointer;
             font: 800 17px var(--font-display, system-ui, sans-serif); background: rgba(255,255,255,.18); color: #fff; }
  .qrs-btn svg { width: 22px; height: 22px; flex: none; }
  .qrs-btn.main, .qrs[data-state="off"] .qrs-bottom [data-act="enter"] { background: var(--sun, #FFC72C); color: #3a2600; box-shadow: 0 4px 0 var(--sun-deep, #F5A300); }
  .qrs.typing .qrs-bottom [data-act="enter"] { background: rgba(255,255,255,.18); color: #fff; box-shadow: none; }
  .qrs-enter { position: absolute; z-index: 4; left: max(16px, env(safe-area-inset-left, 0px)); right: max(16px, env(safe-area-inset-right, 0px));
               top: calc(70px + env(safe-area-inset-top, 0px)); box-sizing: border-box; max-width: 520px; margin: 0 auto;
               padding: 18px 16px 16px; border-radius: 24px; background: #fff; color: var(--ink, #10204A); box-shadow: 0 18px 50px rgba(0,0,0,.45);
               opacity: 0; visibility: hidden; transform: translateY(-10px); transition: opacity .18s ease-out, transform .18s ease-out, visibility 0s linear .18s; }
  .qrs.typing .qrs-enter { opacity: 1; visibility: visible; transform: none; transition: opacity .18s ease-out, transform .18s ease-out; }
  .qrs-enter h3 { margin: 0; font: 800 21px/1.15 var(--font-display, system-ui, sans-serif); }
  .qrs-enter h3 small { display: block; margin: 2px 0 12px; font: 600 14px var(--font-body, system-ui, sans-serif); color: var(--ink-2, #44507A); }
  .qrs-enter input { display: block; width: 100%; box-sizing: border-box; min-height: 62px; padding: 0 14px; border: 3px solid var(--line, #DCE4F2); border-radius: 16px;
                     background: var(--bg, #F4F8FE); color: var(--ink, #10204A); font: 800 24px var(--font-display, system-ui, sans-serif); letter-spacing: .2em; text-transform: uppercase;
                     text-align: center; outline: none; transition: border-color .12s; }
  .qrs-enter input:focus { border-color: var(--simi-blue, #024EA2); background: #fff; }
  .qrs-enter input::placeholder { font: 600 16px var(--font-body, system-ui, sans-serif); letter-spacing: 0; text-transform: none; color: var(--ink-3, #7A85A8); }
  .qrs-enter input.bad { border-color: var(--danger, #D23A3A); animation: qrs-shake .3s ease-in-out; }
  .qrs-err { min-height: 20px; margin: 8px 2px 0; font-size: 15px; font-weight: 700; color: #C02929; }
  .qrs-enter .qrs-btn { width: 100%; margin-top: 6px; }
  .qrs-btn, .qrs-x, .qrs-round { touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: transform .08s ease-out, background-color .15s; }
  .qrs-btn:active, .qrs-x:active, .qrs-round:active { transform: scale(.96); }
  .qrs-btn:focus-visible, .qrs-x:focus-visible, .qrs-round:focus-visible { outline: 3px solid var(--sun, #FFC72C); outline-offset: 2px; }
  .qrs-enter .qrs-btn:focus-visible { outline-color: var(--simi-blue, #024EA2); }
  @keyframes qrs-sweep { 0%, 100% { transform: translateY(calc(var(--box) * .08)); } 50% { transform: translateY(calc(var(--box) * .9)); } }
  @keyframes qrs-hit { 50% { transform: scale(1.06); } }
  @keyframes qrs-shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
  @keyframes qrs-in { from { opacity: 0; } }
  /* Short landscape (a phone on its side): box, hint and tools in one row, so nothing sits under the bottom bar. */
  @media (orientation: landscape) and (max-height: 500px) {
    .qrs-top { padding-top: calc(6px + env(safe-area-inset-top, 0px)); padding-bottom: 0; }
    .qrs-mid { flex-direction: row; gap: 24px; padding: 4px max(16px, env(safe-area-inset-right, 0px)) 4px max(16px, env(safe-area-inset-left, 0px)); }
    .qrs-hint { max-width: 240px; min-height: 0; }
    .qrs-tools { flex-direction: column; gap: 12px; }
    .qrs-round { width: 48px; height: 48px; }
    .qrs-bottom { padding-top: 6px; padding-bottom: max(10px, env(safe-area-inset-bottom, 0px)); }
    .qrs-btn { min-height: 48px; }
    .qrs-enter { top: calc(8px + env(safe-area-inset-top, 0px)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .qrs *, .qrs { animation: none !important; transition: none !important; }
    .qrs-btn:active, .qrs-x:active, .qrs-round:active { transform: none; }
  }
  `;
  document.head.appendChild(st);
}

function stopStream() {
  gen++;
  clearTimeout(loopTimer);
  loopTimer = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

function stop() {
  stopStream();
  clearTimeout(wrongTimer);
  wrongTimer = null;
}

const OFF = {
  denied: { title: 'Camera is off', text: 'Turn it on in Settings, or type the code on the sign.', retry: true },
  nocam: { title: 'No camera found', text: 'Type the code on the sign, or scan a photo of it.', retry: true },
  insecure: { title: 'Open the secure link', text: 'Scanning and typing codes need the app’s https:// address. Open Simi Hunt there.', retry: false },
  nodecoder: { title: 'Scanner didn’t load', text: 'Check your connection, or type the code on the sign.', retry: true },
};

export function mount(el, ctx) {
  root = el;
  injectStyle();
  const { go } = ctx;
  const mine = el;
  el.innerHTML = `
    <div class="qrs" data-state="starting">
      <video playsinline muted autoplay></video>
      <div class="qrs-top">
        <button class="qrs-x" data-act="close" aria-label="Close">✕</button>
        <h2>Scan a Simi sign</h2>
        <span></span>
      </div>
      <div class="qrs-mid">
        <div class="qrs-box">
          <div class="qrs-frame"><i></i><i></i><i></i><i></i><div class="qrs-line"></div></div>
          <div class="qrs-msg"></div>
        </div>
        <div class="qrs-hint" role="status" aria-live="polite">Starting camera…</div>
        <div class="qrs-tools">
          <button class="qrs-round" data-act="torch" aria-label="Flashlight" aria-pressed="false" hidden>${ICON.torch}</button>
          <button class="qrs-round" data-act="flip" aria-label="Switch camera" hidden>${ICON.flip}</button>
        </div>
      </div>
      <form class="qrs-enter" novalidate>
        <h3>Type the code on the sign<small>Escribe el código del letrero</small></h3>
        <input name="code" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false"
               enterkeyhint="go" placeholder="Code on the sign, e.g. SUN24" aria-label="Code on the sign">
        <div class="qrs-err" role="alert"></div>
        <button class="qrs-btn main" type="submit">Go</button>
      </form>
      <div class="qrs-bottom">
        <button class="qrs-btn" type="button" data-act="enter">${ICON.keys}<span>Type code</span></button>
        <button class="qrs-btn" type="button" data-act="photo">${ICON.photo}<span>Scan photo</span></button>
        <input type="file" accept="image/*" hidden>
      </div>
    </div>`;

  const qrs = el.querySelector('.qrs');
  const video = el.querySelector('video');
  const hint = el.querySelector('.qrs-hint');
  const msg = el.querySelector('.qrs-msg');
  const form = el.querySelector('.qrs-enter');
  const input = form.querySelector('input');
  const errEl = form.querySelector('.qrs-err');
  const enterBtn = el.querySelector('.qrs-bottom [data-act="enter"]');
  const torchBtn = el.querySelector('[data-act="torch"]');
  const flipBtn = el.querySelector('[data-act="flip"]');
  const fileInput = el.querySelector('input[type=file]');
  let facing = 'environment';
  let torchOn = false;
  let busy = false;

  const alive = () => root === mine;
  const say = (text, sub = '', err = false) => {
    hint.innerHTML = '';
    hint.append(text);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; hint.append(s); }
    hint.classList.toggle('err', err);
  };
  const setState = (s) => { qrs.dataset.state = s; };
  const sayReady = () => say('Point at the Simi sign', 'Apunta al letrero');

  function showOff(kind) {
    stopStream();
    qrs.classList.remove('live');
    // On a plain-http page codes can't be checked either, so hide the fallbacks.
    qrs.classList.toggle('insecure', kind === 'insecure');
    const o = OFF[kind] || OFF.nocam;
    msg.innerHTML = `${ICON.off}<b></b><p></p>${o.retry ? '<button class="qrs-btn" type="button" data-act="retry">Try again</button>' : ''}`;
    msg.querySelector('b').textContent = o.title;
    msg.querySelector('p').textContent = o.text;
    setState('off');
    say('');
    torchBtn.hidden = true;
    flipBtn.hidden = true;
  }

  // ---- code entry ----
  const openForm = () => {
    qrs.classList.add('typing');
    enterBtn.querySelector('span').textContent = 'Cancel';
    enterBtn.setAttribute('aria-expanded', 'true');
    errEl.textContent = '';
    input.classList.remove('bad');
    input.focus({ preventScroll: true });
  };
  const closeForm = () => {
    qrs.classList.remove('typing');
    enterBtn.querySelector('span').textContent = 'Type code';
    enterBtn.setAttribute('aria-expanded', 'false');
    input.blur();
  };
  const formErr = (text) => {
    errEl.textContent = text;
    input.classList.remove('bad');
    void input.offsetWidth; // restart the shake
    input.classList.add('bad');
    buzz([30, 40, 30]);
    input.focus({ preventScroll: true });
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) { formErr('Type the letters printed under the QR code.'); return; }
    const token = resolveCode(v, ctx.data);
    if (!token) { formErr('Hmm, that code isn’t on a Simi sign. Check the letters?'); return; }
    claimInPlace(token);
  };
  input.oninput = () => { if (errEl.textContent) { errEl.textContent = ''; input.classList.remove('bad'); } };
  form.onkeydown = (e) => { if (e.key === 'Escape') closeForm(); };

  // ---- a code was read: claim it here, then go straight to the reveal ----
  async function claimInPlace(token) {
    if (busy) return;
    busy = true;
    clearTimeout(loopTimer);
    clearTimeout(wrongTimer);
    try { video.pause(); } catch { /* not playing */ }
    closeForm();
    setState('hit');
    say('Got it!', '¡Listo!');
    buzz(25);
    const beat = sleep(reduced() ? 0 : 260);
    let next;
    try {
      const r = await claimToken(token, ctx);
      if (r.already) next = '#/claim/' + token;
      else { await preloadArt(r.payload.m, ctx.data); next = r.hash; }
    } catch (err) {
      console.warn('[qr] claim failed:', err.code || err);
      next = '#/claim/' + token; // the claim screen explains what went wrong
    }
    await beat;
    if (!alive()) return;
    stop();
    go(next, { replace: true });
  }

  const wrong = () => {
    say('That’s not a Simi sign.', 'Try the one on the shelf.', true);
    clearTimeout(wrongTimer);
    wrongTimer = setTimeout(() => { if (alive() && qrs.dataset.state === 'ready') sayReady(); }, 2500);
  };

  const handle = (raw) => {
    const token = extractToken(raw);
    if (!token) { wrong(); return false; }
    claimInPlace(token);
    return true;
  };

  // ---- camera ----
  function setupTrack(s) {
    const track = s.getVideoTracks()[0];
    if (track) {
      track.addEventListener('ended', () => { if (stream === s) revive(); });
      track.addEventListener('unmute', () => { if (stream === s) revive(); });
    }
    let caps = {};
    try { caps = track?.getCapabilities?.() || {}; } catch { /* not supported */ }
    torchOn = false;
    torchBtn.classList.remove('on');
    torchBtn.setAttribute('aria-pressed', 'false');
    torchBtn.hidden = !caps.torch;
    if (caps.zoom && facing === 'environment' && caps.zoom.max >= 1.5) {
      track.applyConstraints({ advanced: [{ zoom: Math.max(caps.zoom.min || 1, 1.5) }] }).catch(() => {});
    }
    navigator.mediaDevices.enumerateDevices?.()
      .then((list) => { if (alive()) flipBtn.hidden = list.filter((d) => d.kind === 'videoinput').length < 2; })
      .catch(() => {});
  }

  // Bring the camera back after an app switch, a call or a photo: restart it if
  // the track ended, or resume a paused video. Never stop it on hide, since a
  // new getUserMedia call can bring back the permission prompt on iPhone.
  function revive() {
    if (!alive() || busy || document.visibilityState !== 'visible') return;
    if (!['loading', 'ready'].includes(qrs.dataset.state)) return;
    const live = stream?.getVideoTracks().some((t) => t.readyState === 'live');
    if (!live) startCamera();
    else if (video.paused) video.play().catch(() => {});
  }

  async function startCamera() {
    stopStream();
    const my = gen;
    const current = () => alive() && gen === my;
    qrs.classList.remove('live');
    msg.innerHTML = '';
    setState('starting');
    say('Starting camera…');
    if (!globalThis.isSecureContext) { showOff('insecure'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { showOff('nocam'); return; }
    let perm = null;
    try { perm = (await navigator.permissions?.query({ name: 'camera' }))?.state; } catch { /* Safari before 16 */ }
    if (!current()) return;
    if (perm === 'denied') { showOff('denied'); return; }
    if (perm !== 'granted') {
      msg.innerHTML = `${ICON.camera}<b>Dr. Simi needs your camera</b><p>to read the shelf sign.</p>`;
      setState('priming');
      say('Tap Allow when your phone asks', 'Toca Permitir');
    }
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
    } catch (err) {
      if (!current()) return;
      console.warn('[qr] camera unavailable', err);
      showOff(err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'denied' : 'nocam');
      return;
    }
    if (!current()) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    video.srcObject = s;
    video.classList.toggle('mirror', facing === 'user');
    video.onplaying = () => { if (alive()) qrs.classList.add('live'); };
    await video.play().catch(() => {});
    if (!current()) return;
    setupTrack(s);
    setState('loading');
    say('Getting the scanner ready…');
    let d;
    try { d = await detector(); } catch (err) {
      if (!current()) return;
      console.warn('[qr] decoder failed to load', err);
      showOff('nodecoder');
      return;
    }
    if (!current() || busy) return;
    setState('ready');
    sayReady();
    let errs = 0;
    let pausedTicks = 0;
    const tick = async () => {
      if (!current() || busy) return;
      try {
        if (video.readyState >= 2 && !video.paused) {
          pausedTicks = 0;
          const hits = await withTimeout(d.detect(video), 2000, 'detect');
          if (!current() || busy) return;
          errs = 0;
          if (hits.length && handle(hits[0].rawValue)) return;
        } else if (video.paused && !document.hidden && ++pausedTicks % 8 === 1) {
          video.play().catch(() => {}); // a paused preview never scans; nudge it about once a second
        }
      } catch (err) {
        if (dropNative(d, err)) {
          try { d = await detector(); } catch (e) { if (current()) showOff('nodecoder'); return; }
          if (!current() || busy) return;
        } else if (++errs >= 25) { console.warn('[qr] decoder keeps failing', err); showOff('nodecoder'); return; }
      }
      loopTimer = setTimeout(tick, 120);
    };
    tick();
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const want = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: want }] });
      torchOn = want;
    } catch (err) { console.warn('[qr] torch failed', err); }
    torchBtn.classList.toggle('on', torchOn);
    torchBtn.setAttribute('aria-pressed', String(torchOn));
    buzz(10);
  }

  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    const act = b.dataset.act;
    if (act === 'close') { stop(); (ctx.back || go)('#/map'); }
    else if (act === 'enter') { if (qrs.classList.contains('typing')) closeForm(); else openForm(); }
    else if (act === 'photo') fileInput.click();
    else if (act === 'retry') startCamera();
    else if (act === 'torch') toggleTorch();
    else if (act === 'flip') { facing = facing === 'environment' ? 'user' : 'environment'; buzz(10); startCamera(); }
  };

  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f || busy) return;
    closeForm();
    say('Reading photo…');
    try {
      const bmp = await createImageBitmap(f);
      const raw = await decodeQR(bmp);
      if (!alive()) return;
      if (raw) handle(raw);
      else say('No code in that photo.', 'Try a closer, sharper shot.', true);
    } catch (err) {
      if (!alive()) return;
      console.warn('[qr] photo decode failed', err);
      say('Couldn’t read that photo.', 'Try again, or type the code.', true);
    }
  };

  const onVisible = () => revive();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  detachLifecycle = () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onVisible);
  };

  // Warm everything the reveal needs while the camera spins up.
  warm();
  startCamera();
}

export function unmount() {
  detachLifecycle?.();
  detachLifecycle = null;
  stop();
  if (root) { root.onclick = null; root.innerHTML = ''; }
  root = null;
}
