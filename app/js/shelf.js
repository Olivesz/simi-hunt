// "On this shelf" screen (#/shelf/:storeId/:shelfType): the Simi tied to the shelf,
// the real products on it, and a demo coupon.

// Per-shelf names, demo offer and coupon code, kept together so the copy lives in one place.
// `ask` shelves carry supplements or medicines, so they show the "ask your pharmacist" line.
const SHELVES = {
  'sun-care': { en: 'Sun Care', code: 'SUNCARE', off: '$1 off', what: 'any Sun Care item' },
  'skincare': { en: 'Skincare', code: 'SKINCARE', off: '$1 off', what: 'any Skincare item' },
  'vitamins': { en: 'Vitamins', code: 'VITAMINS', off: '$2 off', what: 'any vitamin or gummy', ask: true },
  'sleep': { en: 'Sleep', code: 'SLEEP', off: '$1 off', what: 'any Sleep item', ask: true },
  'sports-nutrition': { en: 'Sports Nutrition', code: 'SPORTS', off: '$2 off', what: 'any protein or creatine', ask: true },
  'cold-flu': { en: 'Cold & Flu', code: 'COLDFLU', off: '$1 off', what: 'any cough or throat drop', ask: true },
  'dr-simi': { en: 'Dr. Simi', code: 'DRSIMI', off: '20% off', what: 'any Dr. Simi product', ask: true },
};

// Sleep has no shelf Simi, so Sleepy Simi (a map Simi) greets there instead.
const GREETERS = { sleep: 'sleepy' };

// Screen copy, with the Spanish line next to the English one.
const T = {
  eyebrow: 'On this shelf', eyebrowEs: 'En este estante',
  map: 'Map', backToMap: 'Back to map', backToMapEs: 'Volver al mapa',
  inDex: (name) => `${name} is in your SimiDex`,
  scanHint: 'Scan the Simi sign on this shelf to catch them',
  scan: 'Scan', storeOnly: 'Store exclusive', hello: (name) => `${name} says hi!`,
  pick: 'Simi’s pick',
  couponSub: 'Mi cupón Simi',
  demo: 'Demo coupon', checkout: 'Show this at checkout', checkoutEs: 'Muéstralo en caja',
  done: 'Done · Listo', fine: 'Demo only. Not redeemable.',
  empty: 'No products listed here yet.', emptyEs: 'Aún no hay productos aquí.',
  lostTitle: 'Shelf not found', lost: 'We couldn’t find this shelf', lostEs: 'No encontramos este estante',
  lostBody: 'Scan the Simi sign again, or pick a shelf from a SimiStop on the map.',
  scanSign: 'Scan a sign', anyStore: 'Any participating CVS',
  ask: 'Ask your pharmacist which one is right for you.',
  askEs: 'Pregúntale a tu farmacéutico cuál te conviene.',
};

// The product each shelf Simi points players to (shown first, with a "Simi's pick" tag).
// No picks on the cold & flu or sleep shelves: a doctor mascot doesn't choose medicine for you.
const SIMI_PICKS = {
  beach: 'off-0075486091125', spa: 'drsimi-eternal-scrub', astronaut: 'drsimi-multigomi',
  boxeador: 'off-0748927069518', texas: 'drsimi-vitc',
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const abs = u => (/^(https?:)?\/\//.test(u) ? u : new URL('../' + u, import.meta.url).href);
// Light haptic tap; skipped before the first real tap, when browsers block it anyway.
const buzz = () => {
  try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(10); } catch { /* unsupported */ }
};

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  qr: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><path d="M14 14h2.5v2.5M20 14v.01M14 20h.01M17.5 20H20v-2.5" stroke-linecap="round"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V7a1 1 0 0 1 1-1z" fill="currentColor" opacity=".9"/><path d="M15 7.5v9" stroke="var(--simi-blue)" stroke-width="1.6" stroke-dasharray="2 2"/></svg>',
  ask: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M12 7.5v6M9 10.5h6"/></svg>',
};

const BASE_ART = '../art/base/simi-base.svg';

// Simple product pictograms for items without a usable photo.
const PICTO = {
  bottle: '<rect x="17" y="5" width="14" height="7" rx="2" fill="currentColor"/><rect x="13" y="12" width="22" height="31" rx="6" fill="currentColor" opacity=".22"/><rect x="13" y="21" width="22" height="13" fill="currentColor" opacity=".5"/><path d="M20 27.5h8M24 23.5v8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  tub: '<rect x="8" y="10" width="32" height="8" rx="3" fill="currentColor"/><path d="M10 18h28l-2.2 22a3 3 0 0 1-3 2.7H15.2a3 3 0 0 1-3-2.7z" fill="currentColor" opacity=".22"/><path d="M11.2 24h25.6l-1 10H12.2z" fill="currentColor" opacity=".5"/>',
  tube: '<rect x="12" y="4" width="24" height="5" rx="1.5" fill="currentColor" opacity=".55"/><path d="M13 9h22l-4 27H17z" fill="currentColor" opacity=".22"/><path d="M14.6 16h18.8l-1.4 10H16z" fill="currentColor" opacity=".5"/><rect x="18" y="36" width="12" height="8" rx="2.5" fill="currentColor"/>',
  spray: '<rect x="19" y="3" width="11" height="6" rx="1.5" fill="currentColor"/><path d="M30 5.5h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="21" y="9" width="7" height="4" fill="currentColor" opacity=".55"/><rect x="14" y="13" width="21" height="31" rx="7" fill="currentColor" opacity=".22"/><rect x="14" y="21" width="21" height="13" fill="currentColor" opacity=".5"/>',
  drops: '<path d="M5 15l9 9-9 9zM43 15l-9 9 9 9z" fill="currentColor" opacity=".5"/><circle cx="24" cy="24" r="11" fill="currentColor" opacity=".3"/><circle cx="24" cy="24" r="6" fill="currentColor" opacity=".55"/>',
  syrup: '<rect x="19" y="3" width="10" height="7" rx="2" fill="currentColor"/><path d="M20.5 10h7v5l5 5v21a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V20l5-5z" fill="currentColor" opacity=".22"/><rect x="15.5" y="24" width="17" height="11" fill="currentColor" opacity=".5"/>',
};

function kindOf(p) {
  const s = `${p.name || ''} ${p.size || ''}`.toLowerCase();
  if (/spray/.test(s)) return 'spray';
  if (/syrup/.test(s)) return 'syrup';
  if (/drops?\b|lozenge|menthol/.test(s)) return 'drops';
  if (/powder|whey|protein|creatine|\blb\b/.test(s)) return 'tub';
  if (/scrub|lotion|cream|sunscreen|\bgel\b|balm/.test(s)) return 'tube';
  return 'bottle';
}

// Up to two key facts a shopper scans for, read from the name and blurb.
// Strengths (mg) are left to the label and the pharmacist, never pulled out as a chip.
function factsOf(p) {
  const s = `${p.name || ''} ${p.blurb || ''}`;
  const out = [];
  const spf = s.match(/SPF\s*(\d+)/i);
  if (spf) out.push(['SPF ' + spf[1], 'sun']);
  if (/\bmineral\b|zinc oxide/i.test(s)) out.push(['Mineral', '']);
  if (/sugar[- ]free/i.test(s)) out.push(['Sugar-free', '']);
  if (/fragrance[- ]free/i.test(s)) out.push(['Fragrance-free', '']);
  if (/melatonin[- ]free/i.test(s)) out.push(['No melatonin', '']);
  return out.slice(0, 2);
}

function shortStore(store, storeId) {
  if (!store) return storeId && storeId !== 'any' ? 'CVS SimiStop' : T.anyStore;
  const street = String(store.address || '').split(',')[0]
    .replace(/\bStreet\b/, 'St').replace(/\bAvenue\b/, 'Ave').replace(/\bBoulevard\b/, 'Blvd');
  const name = String(store.name || 'CVS').replace(/\s+Pharmacy$/i, '');
  return street ? `${name} · ${street}` : name;
}

// Deterministic barcode-style bars from a string (decorative demo, not a real symbology).
function barcodeSvg(text) {
  let h = 2166136261, x = 8, bars = '';
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = h || 1;
  bars += '<rect x="8" y="6" width="2" height="54"/><rect x="12" y="6" width="2" height="54"/>';
  x = 18;
  while (x < 232) {
    const w = 1 + Math.floor(rnd() * 3);
    if (rnd() > 0.45) bars += `<rect x="${x}" y="6" width="${w}" height="54"/>`;
    x += w + 1 + Math.floor(rnd() * 2);
  }
  bars += '<rect x="236" y="6" width="2" height="54"/><rect x="240" y="6" width="2" height="54"/>';
  return `<svg viewBox="0 0 250 66" preserveAspectRatio="none" role="img" aria-label="Demo coupon barcode" fill="#10204A">${bars}</svg>`;
}

// A price shows only when the data says where it came from.
const hasPrice = p => typeof p.price === 'number' && !!p.priceSource;

function productRow(p, i, { pickId, allDr }) {
  const isPick = p.id === pickId;
  const showDr = p.drSimi && !allDr;
  const price = hasPrice(p) ? `<span class="sh-chip is-price">$${p.price.toFixed(2)}</span>` : '';
  const facts = factsOf(p).map(([t, k]) => `<span class="sh-chip${k ? ' is-' + k : ''}">${esc(t)}</span>`).join('');
  const size = p.size ? `<span class="sh-chip is-size">${esc(p.size)}</span>` : '';
  const aisle = p.aisle ? `<span class="sh-chip is-aisle">Aisle ${esc(p.aisle)}</span>` : '';
  const sub = [allDr ? '' : `<b>${esc(p.brand)}</b>`, esc(p.blurb)].filter(Boolean).join(' · ');
  return `<li class="sh-row${showDr ? ' is-dr' : ''}${isPick ? ' is-pick' : ''}" style="--i:${Math.min(i, 8)}">
    <div class="sh-thumb">
      <div class="sh-ph" aria-hidden="true"><svg viewBox="0 0 48 48">${PICTO[kindOf(p)]}</svg></div>
      ${p.image ? `<img class="sh-photo" src="${esc(abs(p.image))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
      ${showDr ? '<span class="sh-drtag">Dr. Simi</span>' : ''}
    </div>
    <div class="sh-info">
      ${isPick ? `<p class="sh-pick">★ ${T.pick}</p>` : ''}
      <h3 class="sh-name">${esc(p.name)}</h3>
      ${sub ? `<p class="sh-sub">${sub}</p>` : ''}
      <p class="sh-chips">${price}${facts}${size}${aisle}</p>
    </div>
  </li>`;
}

// The Simi card under the title: caught, still to catch, or a plain greeting.
function simiBanner(simi, { owned, ownShelf }) {
  const art = esc(new URL(simi.art || `../art/simis/${simi.id}.svg`, document.baseURI).href);
  const quote = simi.catchphrase
    ? `<span class="sh-simi-line sh-quote">“${esc(simi.catchphrase)}”</span>${simi.catchphraseEs ? `<span class="sh-simi-line sh-quote is-es" lang="es">“${esc(simi.catchphraseEs)}”</span>` : ''}`
    : '';
  if (owned) {
    return `<button type="button" class="sh-simi is-owned" data-go="#/dex/${esc(encodeURIComponent(simi.id))}" aria-label="${esc(T.inDex(simi.name))}. Open SimiDex entry">
      <span class="sh-simi-art"><img src="${art}" alt=""></span>
      <span class="sh-simi-text"><span class="sh-simi-name">${esc(T.inDex(simi.name))} <span class="sh-check" aria-hidden="true">✓</span></span>${quote}</span>
      <span class="sh-chev">${ICON.chev}</span>
    </button>`;
  }
  if (ownShelf) {
    const secret = simi.tier === 'store';
    return `<button type="button" class="sh-simi is-locked" data-go="#/scan" aria-label="${esc(T.scanHint)}. Open the scanner">
      <span class="sh-simi-art"><img src="${art}" alt=""></span>
      <span class="sh-simi-text"><span class="sh-simi-name">${secret ? `??? <span class="sh-badge">${T.storeOnly}</span>` : esc(simi.name)}</span>
        <span class="sh-simi-line">${T.scanHint}</span></span>
      <span class="sh-scan-pill">${ICON.qr}${T.scan}</span>
    </button>`;
  }
  return `<section class="sh-simi">
    <span class="sh-simi-art"><img src="${art}" alt=""></span>
    <span class="sh-simi-text"><span class="sh-simi-name">${esc(T.hello(simi.name))}</span>${quote}</span>
  </section>`;
}

const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

// Credits under the list: the ODbL notice for product data, one line for brand packshots,
// any other photo credit as given, and where the prices came from.
function footNotes(products) {
  const out = [];
  if (products.some(p => /ODbL/i.test(p.license || ''))) {
    out.push(`Product data © ${ext('https://world.openfoodfacts.org/', 'Open Food Facts')} / ${ext('https://world.openbeautyfacts.org/', 'Open Beauty Facts')} contributors, ${ext('https://opendatacommons.org/licenses/odbl/1-0/', 'ODbL 1.0')}.`);
  }
  const brands = new Set();
  const other = new Set();
  for (const p of products) {
    const c = String(p.imageCredit || '').trim();
    const m = c.match(/^©\s*(.+?)\s*—\s*product image/i);
    if (m) brands.add(m[1]);
    else if (c) other.add(c);
  }
  if (brands.size) out.push(`Product images © their brand owners (${esc([...brands].join(', '))}), for demo use only.`);
  for (const c of other) out.push(esc(c));
  const checked = new Set();
  for (const p of products.filter(hasPrice)) {
    const m = String(p.priceSource).match(/^(\S+)(?:.*checked (\d{4}-\d{2}-\d{2}))?/);
    let host = '';
    try { host = new URL(m[1]).hostname.replace(/^www\./, ''); } catch { /* not a URL */ }
    if (host) checked.add(m[2] ? `${host} (checked ${m[2]})` : host);
  }
  if (checked.size) out.push(`Prices from ${esc([...checked].join(', '))}; store prices may differ.`);
  return out.map(t => `<p>${t}</p>`).join('');
}

function couponHtml(shelf, where, code) {
  return `<div class="sh-ticket">
      <div class="sh-ticket-top">
        <span class="sh-demo">${T.demo}</span>
        <p class="sh-off">${esc(shelf.off)}</p>
        <p class="sh-what">${esc(shelf.what)}</p>
        <p class="sh-where">${esc(where)}</p>
      </div>
      <div class="sh-ticket-bot">
        <div class="sh-bars">${barcodeSvg(code)}</div>
        <p class="sh-code">${esc(code)}</p>
        <p class="sh-how">${T.checkout} · <span lang="es">${T.checkoutEs}</span></p>
      </div>
    </div>
    <button type="button" class="pill pill-primary sh-done" data-close>${T.done}</button>
    <p class="sh-fine">${T.fine}</p>`;
}

let root = null;
let seq = 0;
let cleanup = null;
let cssReady = null;

// Resolves once shelf.css has loaded (or after a short cap), so the screen never paints unstyled.
function ensureCss() {
  if (!cssReady) {
    const existing = document.getElementById('shelf-css');
    if (existing) cssReady = Promise.resolve();
    else {
      const l = document.createElement('link');
      l.id = 'shelf-css'; l.rel = 'stylesheet';
      l.href = new URL('../css/shelf.css', import.meta.url).href;
      cssReady = new Promise(r => { l.onload = l.onerror = () => r(); });
      document.head.appendChild(l);
    }
  }
  return Promise.race([cssReady, new Promise(r => setTimeout(r, 1200))]);
}

export async function mount(el, ctx, params = {}) {
  const my = ++seq;
  root = el;
  await ensureCss();
  if (my !== seq || root !== el) return;
  render(el, ctx, params);
}

function render(el, ctx, params) {
  const { storeId, shelfType } = params;
  const data = ctx.data || {};
  const store = (data.stores || []).find(s => s.id === storeId);
  const products = ((data.products || {})[shelfType] || []).slice();
  const known = SHELVES[shelfType];
  const shelf = known || {
    en: String(shelfType || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    code: String(shelfType || '').toUpperCase().replace(/[^A-Z]/g, '') || 'SHELF',
    off: '$1 off', what: 'any item on this shelf',
  };
  const where = shortStore(store, storeId);
  const backHash = store ? '#/stop/' + encodeURIComponent(storeId) : '#/map';
  const sims = data.simis || [];
  const simi = sims.find(s => s.shelf === shelfType && s.storeId === storeId)
    || sims.find(s => s.shelf === shelfType && !s.storeId)
    || sims.find(s => s.id === GREETERS[shelfType])
    // Classic Simi's catchphrase is the Dr. Simi brand slogan, so he greets only on the brand's own shelf.
    || (shelfType === 'dr-simi' ? sims.find(s => s.id === 'classic') : null);
  const ownShelf = !!simi && simi.shelf === shelfType;
  let owned = false;
  try { owned = !!simi && !!ctx.state?.has?.(simi.id); } catch { /* state unavailable */ }

  const top = `<header class="sh-top">
      <button type="button" class="sh-back" data-go="${esc(backHash)}" aria-label="${T.backToMap}">${ICON.back}<span>${T.map}</span></button>
      <div class="sh-title">
        <p class="sh-eyebrow">${T.eyebrow} · <span lang="es">${T.eyebrowEs}</span></p>
        <h1>${esc(known || products.length ? shelf.en : T.lostTitle)}</h1>
        <p class="sh-store">${esc(where)}</p>
      </div>
    </header>`;

  // Bad or unknown link: say so and offer the two ways forward.
  if (!known && !products.length) {
    const art = sims.find(s => s.id === 'classic');
    el.innerHTML = `<div class="shelf">${top}
      <section class="sh-lost">
        ${art ? `<img src="${esc(new URL(art.art || '../art/simis/classic.svg', document.baseURI).href)}" alt="">` : ''}
        <h2>${T.lost}</h2><p class="sh-es" lang="es">${T.lostEs}</p>
        <p>${T.lostBody}</p>
        <button type="button" class="pill pill-primary" data-go="#/scan">${ICON.qr}${T.scanSign}</button>
        <button type="button" class="pill pill-ghost" data-go="${esc(backHash)}">${T.backToMap}</button>
      </section></div>`;
    wire(el, ctx, null);
    return;
  }

  const pickId = simi && products.some(p => p.id === SIMI_PICKS[simi.id]) ? SIMI_PICKS[simi.id] : null;
  const allDr = products.length > 0 && products.every(p => p.drSimi);
  // Photos first (local before hotlinked), the Simi's pick first within its group.
  const rank = p => (p.image ? (/^(https?:)?\/\//.test(p.image) ? 1 : 0) : 3) * 2 - (p.id === pickId ? 1 : 0);
  products.sort((a, b) => rank(a) - rank(b));

  const code = `SIMI-${shelf.code}-DEMO`;
  const ask = shelf.ask && products.length
    ? `<p class="sh-ask">${ICON.ask}<span><b>${T.ask}</b><span class="is-es" lang="es">${T.askEs}</span></span></p>`
    : '';

  el.innerHTML = `<div class="shelf">${top}
    ${simi ? simiBanner(simi, { owned, ownShelf }) : ''}
    ${ask}
    <ul class="sh-list">${products.length
      ? products.map((p, i) => productRow(p, i, { pickId, allDr })).join('')
      : `<li class="sh-empty">${T.empty}<br><span lang="es">${T.emptyEs}</span></li>`}</ul>
    <div class="sh-cta">
      <button type="button" class="pill pill-primary sh-coupon-btn" data-act="coupon">
        <span class="sh-cta-main">${ICON.ticket}Get ${esc(shelf.off)} ${esc(shelf.en)}</span>
        <small lang="es">${T.couponSub}</small>
      </button>
    </div>
    <footer class="sh-foot">
      <button type="button" class="pill pill-ghost sh-home" data-go="${esc(backHash)}">${ICON.back}${T.backToMap} · <span lang="es">${T.backToMapEs}</span></button>
      <p>Products shown are examples of this kind of item and may not match what your store stocks today.</p>
      ${footNotes(products)}
    </footer>
  </div>`;

  // Photos fade in over their pictogram; a broken or blocked photo leaves the pictogram.
  el.querySelectorAll('.sh-photo').forEach(img => {
    // Wait for decode so the fade never shows an empty white tile.
    const show = () => Promise.resolve(img.decode?.()).catch(() => {}).then(() => img.classList.add('is-in'));
    if (img.complete) { if (img.naturalWidth) show(); else img.remove(); return; }
    img.addEventListener('load', show, { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
  });
  // Art that fails to load falls back to the base Simi, then to an empty disc.
  const simiImg = el.querySelector('.sh-simi-art img');
  if (simiImg) simiImg.onerror = () => {
    const base = new URL(BASE_ART, document.baseURI).href;
    if (simiImg.src === base) simiImg.remove();
    else simiImg.src = base;
  };

  let coupon = null;
  const openCoupon = () => {
    if (coupon || !ctx.sheet) return;
    coupon = ctx.sheet(couponHtml(shelf, where, code), { className: 'sh-coupon' });
    coupon.el.setAttribute('aria-label', 'Simi coupon');
    coupon.closed.then(() => { coupon = null; });
  };
  wire(el, ctx, openCoupon);
}

function wire(el, ctx, openCoupon) {
  const onClick = e => {
    const t = e.target.closest('[data-go],[data-act]');
    if (!t || !el.contains(t)) return;
    buzz();
    if (t.dataset.act === 'coupon') openCoupon?.();
    else if (t.dataset.go) ctx.go(t.dataset.go);
  };
  // Shadow under the sticky title bar once the list scrolls beneath it.
  const bar = el.querySelector('.sh-top');
  const onScroll = () => bar?.classList.toggle('is-stuck', el.scrollTop > 4);
  el.addEventListener('click', onClick);
  el.addEventListener('scroll', onScroll, { passive: true });
  cleanup = () => {
    el.removeEventListener('click', onClick);
    el.removeEventListener('scroll', onScroll);
  };
}

export function unmount() {
  seq++;
  cleanup?.();
  cleanup = null;
  if (root) root.innerHTML = '';
  root = null;
}
