// Network helpers that go through our backend (/api/*) to avoid CORS, with a small in-memory+IDB cache.
import { idb } from './db.js';

const mem = new Map();

/** GET JSON with caching. ttl in ms. Falls back to stale cache when offline. */
export async function getJSON(url, { ttl = 10 * 60e3, cache = true } = {}) {
  const key = 'net:' + url;
  const hit = mem.get(key) || (cache ? await idb.get('kv', key).catch(() => null) : null);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const v = await r.json();
    const entry = { t: Date.now(), v };
    mem.set(key, entry);
    if (cache) idb.set('kv', key, entry).catch(() => {});
    return v;
  } catch (e) {
    if (hit) return hit.v;
    throw e;
  }
}

export const api = {
  /** Bing image of the day: { url, title, copyright } (url is proxied through our server) */
  bing: (idx = 0) => getJSON(`/api/bing?idx=${idx}`, { ttl: 3 * 3600e3 }),
  /** Open-Meteo forecast: see server docs. units: 'metric'|'imperial' */
  weather: (lat, lon, units = 'metric') => getJSON(`/api/weather?lat=${lat}&lon=${lon}&units=${units}`, { ttl: 20 * 60e3 }),
  /** City search: [{ name, country, admin1, lat, lon }] */
  geocode: (q) => getJSON(`/api/geocode?q=${encodeURIComponent(q)}`, { ttl: 864e5 }),
  /** Reverse geocode: { name, country, display } */
  reverse: (lat, lon) => getJSON(`/api/reverse?lat=${lat}&lon=${lon}`, { ttl: 864e5 }),
  /** RSS/Atom feed parsed to { title, items: [{ title, link, date, description, image, source }] } */
  rss: (url) => getJSON(`/api/rss?url=${encodeURIComponent(url)}`, { ttl: 15 * 60e3 }),
  /** News by category: 'top'|'world'|'business'|'technology'|'science'|'sports'|'entertainment'|'health' */
  news: (category = 'top') => getJSON(`/api/news?category=${category}`, { ttl: 15 * 60e3 }),
  /** Exchange rates: { base, date, rates: { EUR: 0.9, ... } } */
  rates: (base = 'USD') => getJSON(`/api/rates?base=${base}`, { ttl: 3600e3 }),
  /** Stock/index quotes: [{ symbol, name, price, change, changePercent }] */
  quotes: (symbols) => getJSON(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, { ttl: 5 * 60e3 }),
  /** Translate text: { text } */
  translate: (text, from, to) => getJSON(`/api/translate?q=${encodeURIComponent(text)}&from=${from}&to=${to}`, { ttl: 864e5 }),
  /** Search suggestions & web results: { results: [{ title, url, snippet }] } */
  search: (q) => getJSON(`/api/search?q=${encodeURIComponent(q)}`, { ttl: 3600e3 }),
  suggest: (q) => getJSON(`/api/suggest?q=${encodeURIComponent(q)}`, { ttl: 3600e3 }),
  /** Internet radio stations: [{ name, url, favicon, tags, country, bitrate }] */
  radio: (params = {}) => getJSON(`/api/radio?${new URLSearchParams(params)}`, { ttl: 3600e3 }),
  /** Podcast search (iTunes): [{ id, title, author, artwork, feedUrl }] */
  podcasts: (q) => getJSON(`/api/podcasts?q=${encodeURIComponent(q)}`, { ttl: 3600e3 }),
  /** Fetch any public URL's text/HTML via proxy (http/https only). */
  proxyUrl: (url) => `/api/proxy?url=${encodeURIComponent(url)}`,
  /** Readable article extraction: { title, byline, image, description, blocks: [{ type, text }] } (text only, safe) */
  readable: (url) => getJSON(`/api/readable?url=${encodeURIComponent(url)}`, { ttl: 3600e3 }),
};
