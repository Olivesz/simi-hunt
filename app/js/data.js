// Loads the game data for the current region from app/data/.
// Every file is optional: a missing or broken file resolves to an empty
// array, object or FeatureCollection, so each module can be built alone.

import { state } from './state.js';

const DATA_DIR = new URL('../data/', import.meta.url);
const GEN_MANIFEST = new URL('../../art/gen/manifest.json', import.meta.url);
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const cache = new Map();

async function fetchJSON(name, fallback) {
  try {
    // Default cache mode: the service worker revalidates same-origin files and
    // answers from its cache when the network is down.
    const res = await fetch(name instanceof URL ? name : new URL(name, DATA_DIR));
    if (!res.ok) return fallback();
    return await res.json();
  } catch (e) {
    console.warn(`[data] ${name} could not be loaded, using an empty default`, e);
    return fallback();
  }
}

export function loadData(region = state.get().region) {
  if (!cache.has(region)) {
    const p = (async () => {
      const [simis, regionInfo, stores, pois, route, products, codes, gen] = await Promise.all([
        fetchJSON('simis.json', () => []),
        fetchJSON(`region-${region}.json`, () => ({})),
        fetchJSON(`stores-${region}.json`, () => []),
        fetchJSON(`pois-${region}.geojson`, emptyFC),
        fetchJSON(`demo-route-${region}.geojson`, emptyFC),
        fetchJSON('products.json', () => ({})),
        fetchJSON('codes.json', () => ({})),
        fetchJSON(GEN_MANIFEST, () => ({})),
      ]);
      // Generated art (art/gen/manifest.json) overrides art and adds icon.
      const withGen = (x) => (gen && gen[x.id] ? { ...x, art: gen[x.id].art || x.art, icon: gen[x.id].icon || x.icon } : x);
      return {
        simis: Array.isArray(simis) ? simis.map(withGen).sort((a, b) => (a.dexNo ?? 999) - (b.dexNo ?? 999)) : [],
        region: regionInfo && typeof regionInfo === 'object' ? regionInfo : {},
        stores: Array.isArray(stores) ? stores : [],
        pois: pois && pois.features ? pois : emptyFC(),
        route: route && route.features ? route : emptyFC(),
        products: products && typeof products === 'object' ? products : {},
        codes: codes && typeof codes === 'object' ? codes : {},
      };
    })();
    cache.set(region, p);
  }
  return cache.get(region);
}

// Drop cached data, e.g. after a region switch or to pick up edited files.
export function clearDataCache() {
  cache.clear();
}

export function findSimi(data, id) {
  return data.simis.find((x) => x.id === id) || null;
}

export function findStore(data, id) {
  return data.stores.find((x) => x.id === id) || null;
}

export default loadData;
