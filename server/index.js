// Backend for the Windows Phone web simulator.
// Serves the built SPA (dist/) and a handful of /api endpoints that work around CORS for public data sources.
// No user data is stored here — user files live in each browser's IndexedDB.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { compress } from 'hono/compress';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { parseFeed, extractReadable, parseDDG } from './parse.js';

const PORT = Number(process.env.PORT || 8787);
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const app = new Hono();

/* ------------------------------------------------------------------ helpers */

const cache = new Map(); // key -> { t, ttl, v }
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), ttl: ttlMs, v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return v;
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIP(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Bad URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Only http(s) URLs');
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new HttpError(400, 'Port not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new HttpError(400, 'Host not allowed');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new HttpError(502, 'DNS failed'); });
  if (addrs.some((a) => isPrivateIP(a.address))) throw new HttpError(400, 'Private address not allowed');
  return u;
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/** Fetch an arbitrary public URL safely (re-validates each redirect hop). */
async function safeFetch(raw, { headers = {}, timeout = 12000 } = {}) {
  let url = raw;
  for (let hop = 0; hop < 5; hop++) {
    const u = await assertPublicUrl(url);
    const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', ...headers }, signal: AbortSignal.timeout(timeout) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), u).href; continue; }
    r.finalUrl = u.href;
    return r;
  }
  throw new HttpError(508, 'Too many redirects');
}

/** Fetch JSON from a known upstream API. */
async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `Upstream ${r.status}`);
  return r.json();
}
async function getText(url, headers = {}) {
  const r = await safeFetch(url, { headers });
  if (!r.ok) throw new HttpError(502, `Upstream ${r.status}`);
  return r.text();
}

// Tiny per-IP rate limiter
const buckets = new Map();
function rateLimit(limit, windowMs) {
  return async (c, next) => {
    const ip = clientIP(c) || 'x';
    const now = Date.now();
    const b = buckets.get(ip) || { n: 0, t: now };
    if (now - b.t > windowMs) { b.n = 0; b.t = now; }
    b.n++;
    buckets.set(ip, b);
    if (b.n > limit) return c.json({ error: 'Too many requests' }, 429);
    await next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 120000) buckets.delete(k); }, 60000).unref();

function clientIP(c) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.env?.incoming?.socket?.remoteAddress || '';
}

app.onError((err, c) => {
  const status = err.status || (err.name === 'TimeoutError' ? 504 : 500);
  if (status >= 500) console.error(c.req.path, err.message);
  return c.json({ error: err.message || 'Server error' }, status);
});

app.use('/api/*', compress());
app.use('/api/*', rateLimit(240, 60000));
app.use('/api/*', async (c, next) => { await next(); if (!c.res.headers.get('cache-control')) c.header('cache-control', 'public, max-age=300'); });

/* ------------------------------------------------------------------ Bing image of the day */

app.get('/api/bing', async (c) => {
  const idx = Math.max(0, Math.min(7, Number(c.req.query('idx') || 0)));
  const mkt = c.req.query('mkt') || 'en-US';
  const data = await cached(`bing:${idx}:${mkt}`, 3 * 3600e3, () => getJSON(`https://www.bing.com/HPImageArchive.aspx?format=js&idx=${idx}&n=1&mkt=${encodeURIComponent(mkt)}`));
  const img = data.images?.[0];
  if (!img) throw new HttpError(502, 'No image');
  const base = 'https://www.bing.com' + img.urlbase;
  const p = (s) => `/api/bing/image?u=${encodeURIComponent(base + s)}`;
  return c.json({
    url: p('_1080x1920.jpg'),         // portrait (phone)
    landscape: p('_1920x1080.jpg'),
    title: img.title, copyright: img.copyright, date: img.startdate, link: img.copyrightlink,
  });
});

app.get('/api/bing/image', async (c) => {
  const u = c.req.query('u') || '';
  if (!/^https:\/\/www\.bing\.com\/th\?id=/.test(u)) throw new HttpError(400, 'Bad image');
  const r = await fetch(u, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new HttpError(502, 'Image fetch failed');
  return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
});

/* ------------------------------------------------------------------ weather & location */

app.get('/api/weather', async (c) => {
  const lat = Number(c.req.query('lat')), lon = Number(c.req.query('lon'));
  if (!isFinite(lat) || !isFinite(lon)) throw new HttpError(400, 'lat/lon required');
  const imperial = c.req.query('units') === 'imperial';
  const key = `wx:${lat.toFixed(2)}:${lon.toFixed(2)}:${imperial}`;
  const d = await cached(key, 15 * 60e3, () => getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,uv_index,visibility' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max,wind_speed_10m_max' +
    `&timezone=auto&forecast_days=10${imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' : ''}`));
  return c.json({ ...d, units: imperial ? 'imperial' : 'metric' });
});

app.get('/api/geocode', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json([]);
  const d = await cached('geo:' + q.toLowerCase(), 864e5, () => getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&format=json`));
  return c.json((d.results || []).map((r) => ({ name: r.name, country: r.country, countryCode: r.country_code, admin1: r.admin1, lat: r.latitude, lon: r.longitude, timezone: r.timezone, population: r.population })));
});

app.get('/api/reverse', async (c) => {
  const lat = Number(c.req.query('lat')), lon = Number(c.req.query('lon'));
  const d = await cached(`rev:${lat.toFixed(3)}:${lon.toFixed(3)}`, 864e5, () => getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`));
  const name = d.city || d.locality || d.principalSubdivision || d.countryName || 'Unknown';
  return c.json({ name, country: d.countryName, countryCode: d.countryCode, admin1: d.principalSubdivision, display: [d.locality || d.city, d.principalSubdivision, d.countryName].filter(Boolean).join(', ') });
});

app.get('/api/ip-location', async (c) => {
  let ip = clientIP(c);
  if (!ip || isPrivateIP(ip.replace(/^::ffff:/, ''))) ip = '';
  const d = await cached('ip:' + ip, 3600e3, () => getJSON(`https://ipwho.is/${ip}`));
  if (!d.success) throw new HttpError(502, 'IP lookup failed');
  return c.json({ lat: d.latitude, lon: d.longitude, city: d.city, country: d.country, countryCode: d.country_code, timezone: d.timezone?.id });
});

/* ------------------------------------------------------------------ news & feeds */

const NEWS = {
  top: 'https://feeds.bbci.co.uk/news/rss.xml',
  world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  entertainment: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
  health: 'https://feeds.bbci.co.uk/news/health/rss.xml',
  sports: 'https://feeds.bbci.co.uk/sport/rss.xml',
  football: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
  tennis: 'https://feeds.bbci.co.uk/sport/tennis/rss.xml',
  f1: 'https://feeds.bbci.co.uk/sport/formula1/rss.xml',
  food: 'https://www.bbcgoodfood.com/feed/rss',
  travel: 'https://www.lonelyplanet.com/news/feed/atom/',
  wp: 'https://www.windowscentral.com/feeds.xml',
};

app.get('/api/news', async (c) => {
  const cat = c.req.query('category') || 'top';
  const url = NEWS[cat];
  if (!url) throw new HttpError(400, 'Unknown category. Use: ' + Object.keys(NEWS).join(', '));
  const feed = await cached('rss:' + url, 10 * 60e3, async () => parseFeed(await getText(url), url));
  return c.json(feed);
});

app.get('/api/rss', async (c) => {
  const url = c.req.query('url');
  if (!url) throw new HttpError(400, 'url required');
  const feed = await cached('rss:' + url, 10 * 60e3, async () => parseFeed(await getText(url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }), url));
  return c.json(feed);
});

app.get('/api/readable', async (c) => {
  const url = c.req.query('url');
  if (!url) throw new HttpError(400, 'url required');
  const r = await cached('read:' + url, 3600e3, async () => {
    const res = await safeFetch(url, { headers: { accept: 'text/html' } });
    const html = (await res.text()).slice(0, 3_000_000);
    return extractReadable(html, res.finalUrl || url);
  });
  return c.json(r);
});

/* ------------------------------------------------------------------ money */

app.get('/api/rates', async (c) => {
  const base = (c.req.query('base') || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const d = await cached('fx:' + base, 3600e3, () => getJSON(`https://open.er-api.com/v6/latest/${base}`));
  if (d.result !== 'success') throw new HttpError(502, 'Rates unavailable');
  return c.json({ base, date: d.time_last_update_utc, rates: d.rates });
});

app.get('/api/quotes', async (c) => {
  const symbols = (c.req.query('symbols') || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[\^A-Z0-9.=\-]{1,15}$/.test(s)).slice(0, 20);
  const out = await Promise.all(symbols.map((s) => cached('q:' + s, 5 * 60e3, async () => {
    try {
      const path = `/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=15m`;
      const d = await getJSON('https://query2.finance.yahoo.com' + path, { 'user-agent': 'Mozilla/5.0' })
        .catch(() => getJSON('https://query1.finance.yahoo.com' + path, { 'user-agent': 'Mozilla/5.0' }));
      const r = d.chart?.result?.[0];
      const m = r.meta;
      const prev = m.chartPreviousClose ?? m.previousClose;
      const price = m.regularMarketPrice;
      return { symbol: s, name: m.longName || m.shortName || s, price, previousClose: prev, change: price - prev, changePercent: ((price - prev) / prev) * 100, currency: m.currency, points: (r.indicators?.quote?.[0]?.close || []).filter((x) => x != null) };
    } catch { return { symbol: s, error: true }; }
  })));
  return c.json(out);
});

/* ------------------------------------------------------------------ translate, search */

app.get('/api/translate', async (c) => {
  const q = (c.req.query('q') || '').slice(0, 500);
  const from = c.req.query('from') || 'en', to = c.req.query('to') || 'es';
  if (!q) return c.json({ text: '' });
  const d = await cached(`tr:${from}:${to}:${q}`, 864e5, () => getJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`));
  return c.json({ text: d.responseData?.translatedText || '', match: d.responseData?.match });
});

app.get('/api/suggest', async (c) => {
  const q = (c.req.query('q') || '').slice(0, 200);
  if (!q) return c.json([]);
  const d = await cached('sg:' + q, 3600e3, () => getJSON(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`));
  return c.json(Array.isArray(d) ? d[1] || [] : []);
});

app.get('/api/search', async (c) => {
  const q = (c.req.query('q') || '').slice(0, 300);
  if (!q) return c.json({ results: [] });
  const results = await cached('s:' + q, 3600e3, async () => {
    const r = await fetch('https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'q=' + encodeURIComponent(q), signal: AbortSignal.timeout(12000) });
    return parseDDG(await r.text());
  });
  return c.json({ query: q, results });
});

/* ------------------------------------------------------------------ radio & podcasts */

app.get('/api/radio', async (c) => {
  const p = new URLSearchParams({ limit: String(Math.min(100, Number(c.req.query('limit') || 60))), hidebroken: 'true', order: c.req.query('order') || 'clickcount', reverse: 'true' });
  for (const k of ['name', 'tag', 'countrycode', 'language']) if (c.req.query(k)) p.set(k, c.req.query(k));
  const d = await cached('radio:' + p, 3600e3, () => getJSON(`https://de1.api.radio-browser.info/json/stations/search?${p}`));
  return c.json(d.filter((s) => s.url_resolved?.startsWith('https://')).map((s) => ({ id: s.stationuuid, name: s.name.trim(), url: s.url_resolved, favicon: s.favicon, tags: s.tags, country: s.country, countryCode: s.countrycode, bitrate: s.bitrate, codec: s.codec })));
});

app.get('/api/podcasts', async (c) => {
  const q = (c.req.query('q') || '').slice(0, 200);
  const d = await cached('pod:' + q, 3600e3, () => getJSON(q ? `https://itunes.apple.com/search?media=podcast&limit=30&term=${encodeURIComponent(q)}` : 'https://itunes.apple.com/search?media=podcast&limit=30&term=technology'));
  return c.json((d.results || []).map((p) => ({ id: p.collectionId, title: p.collectionName, author: p.artistName, artwork: p.artworkUrl600 || p.artworkUrl100, feedUrl: p.feedUrl, genre: p.primaryGenreName })));
});

/* ------------------------------------------------------------------ generic proxy (sandboxed) */

app.get('/api/proxy', rateLimit(120, 60000), async (c) => {
  const url = c.req.query('url');
  if (!url) throw new HttpError(400, 'url required');
  const r = await safeFetch(url, { headers: { accept: c.req.header('accept') || '*/*' }, timeout: 20000 });
  const type = r.headers.get('content-type') || 'application/octet-stream';
  const len = Number(r.headers.get('content-length') || 0);
  if (len > 25 * 1024 * 1024) throw new HttpError(413, 'Too large');
  const headers = {
    'content-type': type,
    'cache-control': 'public, max-age=600',
    // Opaque origin for anything served from here: proxied pages can never touch the simulator's storage.
    'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
    'x-content-type-options': 'nosniff',
    'x-proxied-url': r.finalUrl,
  };
  if (/text\/html/i.test(type)) {
    let html = await r.text();
    const base = `<base href="${r.finalUrl.replace(/"/g, '&quot;')}">`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html;
    return c.body(html, r.status, headers);
  }
  return new Response(r.body, { status: r.status, headers });
});

app.get('/api/health', (c) => c.json({ ok: true, time: Date.now() }));
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

/* ------------------------------------------------------------------ static SPA */

if (existsSync('./dist')) {
  app.use('/assets/*', async (c, next) => { await next(); c.header('cache-control', 'public, max-age=31536000, immutable'); });
  app.use('/*', serveStatic({ root: './dist' }));
  const index = readFileSync('./dist/index.html', 'utf8');
  app.get('*', (c) => c.html(index));
}

serve({ fetch: app.fetch, port: PORT }, (i) => console.log(`wphone server on http://localhost:${i.port}`));
