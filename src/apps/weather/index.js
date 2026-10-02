import './style.css';
import { Wind, Droplets, Gauge, Sunrise, Sunset, Thermometer, Eye, Umbrella, Navigation, MapPin, LocateFixed } from 'lucide';
import { cond, bgFor, deg, compass, fmtHour, dayName, dateShort, parts, hourIndex, placeKey, placeLabel } from './wx.js';

export default async function launch(ctx) {
  const { root, os, storage } = ctx;
  const { el, appBar, I, iconSVG } = os.ui;

  let places = await storage.get('places', []);
  let here = await storage.get('here', null);           // last resolved current location
  let selected = ctx.args?.place || (await storage.get('selected', null)); // null => current location
  let data = null;
  let loading = false;
  let error = '';
  let lastScroll = 0;
  let loadToken = 0;
  let loadedAt = 0;

  const units = () => os.settings.get('units') || 'metric';
  const h24 = () => !!os.settings.get('h24');

  const view = el('div.weather-app');
  const bar = appBar({ buttons: [], menu: [] });
  await ctx.navigate((page) => { page.el.append(view, bar.el); });

  const setBar = () => {
    const isFav = selected && places.some((p) => placeKey(p) === placeKey(selected));
    bar.setButtons([
      { icon: I.refresh, label: 'refresh', onClick: () => load(true) },
      { icon: I.add, label: 'add place', onClick: () => ctx.navigate(searchPage) },
      { icon: LocateFixed, label: 'my location', onClick: () => select(null, true) },
      { icon: I.pin, label: 'pin', onClick: pinCurrent },
    ]);
    bar.setMenu([
      { label: units() === 'metric' ? 'show in fahrenheit' : 'show in celsius', onClick: () => os.settings.set('units', units() === 'metric' ? 'imperial' : 'metric') },
      selected && !isFav ? { label: 'add to favorites', onClick: () => addPlace(selected) } : null,
      isFav ? { label: 'remove from favorites', onClick: () => removePlace(selected) } : null,
      { label: 'open in maps', onClick: () => { const p = cur(); if (p) os.launch('maps', { lat: p.lat, lon: p.lon, label: p.name }); } },
    ].filter(Boolean));
  };

  const cur = () => selected || here;
  const curName = () => (selected ? selected.name : here?.name || 'current location');

  async function pinCurrent() {
    const p = cur();
    if (!p) return;
    const key = selected ? 'weather:' + placeKey(selected) : 'weather:here';
    if (!selected) {
      if (os.tiles.isPinned('weather')) { os.toast('Weather is already pinned to Start'); return; }
      await os.tiles.pin('weather', { size: 'wide' });
    } else {
      if (os.tiles.isPinned('weather', key)) { os.toast(`${p.name} is already pinned`); return; }
      await ctx.pinTile({ key, title: p.name, size: 'medium', args: { place: { name: p.name, country: p.country, admin1: p.admin1, lat: p.lat, lon: p.lon } } });
    }
    os.toast(`Pinned ${p.name} to Start`);
  }

  async function addPlace(p) {
    const clean = { name: p.name, country: p.country, admin1: p.admin1, lat: p.lat, lon: p.lon };
    if (!places.some((x) => placeKey(x) === placeKey(clean))) places = [...places, clean];
    await storage.set('places', places);
    render();
  }
  async function removePlace(p) {
    places = places.filter((x) => placeKey(x) !== placeKey(p));
    await storage.set('places', places);
    if (selected && placeKey(selected) === placeKey(p)) { select(null); return; }
    render();
  }

  function select(p, scrollHome) {
    selected = p ? { name: p.name, country: p.country, admin1: p.admin1, lat: p.lat, lon: p.lon } : null;
    storage.set('selected', selected);
    data = null;
    lastScroll = 0;
    load();
  }

  async function locateHere() {
    const loc = await os.device.locate();
    let name = loc.city, country = loc.country, admin1;
    try { const r = await os.net.reverse(loc.lat, loc.lon); name = r.name || name; country = r.country || country; admin1 = r.admin1; } catch {}
    here = { lat: loc.lat, lon: loc.lon, name: name || 'Current location', country, admin1, approximate: !!loc.approximate };
    storage.set('here', here);
    return here;
  }

  async function load(force) {
    const token = ++loadToken;
    error = '';
    loading = true;
    // instant: cached data
    const cacheKey = 'wx:' + (selected ? placeKey(selected) : 'here') + ':' + units();
    if (!data) {
      const c = await storage.get(cacheKey, null);
      if (c && token === loadToken) data = c;
    }
    render();
    try {
      let p = selected;
      if (!p) {
        if (!here || force || !data) {
          try { p = await locateHere(); } catch (e) { if (here) p = here; else throw new Error('We couldn’t find your location. Turn on location in Settings, or add a place.'); }
        } else {
          p = here;
          locateHere().then((h) => { if (!selected && token === loadToken && placeKey(h) !== placeKey(p)) load(); }).catch(() => {});
        }
      }
      const d = await os.net.weather(p.lat, p.lon, units());
      if (!d?.current) throw new Error('Weather data unavailable');
      if (token !== loadToken) return;
      data = d;
      loadedAt = Date.now();
      storage.set(cacheKey, d);
      if (!selected) os.tiles.refresh('weather');
    } catch (e) {
      if (token !== loadToken) return;
      error = !navigator.onLine ? 'You’re offline. Showing the last forecast we downloaded.' : e.message || 'Something went wrong.';
    } finally {
      if (token === loadToken) { loading = false; render(); }
    }
  }

  /* ------------------------------------------------------------- rendering */

  function render() {
    setBar();
    const prevStrip = view.querySelector('.wp-pano-strip');
    if (prevStrip) lastScroll = prevStrip.scrollLeft;
    const c = data ? cond(data.current.weather_code, data.current.is_day) : null;
    const bg = c ? bgFor(c.kind, data.current.is_day) : '#2b4b6b';
    const pano = os.ui.panorama({
      title: curName().toLowerCase(),
      sections: [
        { header: 'now', render: renderNow },
        { header: 'hourly', render: renderHourly },
        { header: 'daily', render: renderDaily },
        { header: 'places', render: renderPlaces },
      ],
    });
    pano.el.classList.add('weather-pano');
    pano.el.style.background = bg;
    if (c) pano.el.querySelector('.wp-pano-bg').append(el('div.weather-bgicon', { html: iconSVG(c.icon, { size: '100%', stroke: 0.6 }) }));
    view.replaceChildren(pano.el);
    view.style.background = bg;
    requestAnimationFrame(() => { pano.strip.scrollLeft = lastScroll; });
  }

  const status = () => {
    if (loading) return el('div.weather-status', os.ui.loadingDots());
    if (error) return el('div.weather-error', error);
    return null;
  };

  function renderNow(c) {
    c.append(status() || el('div'));
    if (!data) { if (!loading && !error) c.append(os.ui.empty('no data yet')); return; }
    const d = data, x = d.current, u = d.current_units || {};
    const cc = cond(x.weather_code, x.is_day);
    const today = d.daily;
    const loc = selected || here;
    c.append(
      el('div.weather-now',
        el('div.weather-now-icon', { html: iconSVG(cc.icon, { size: 72, stroke: 1.3 }) }),
        el('div.weather-now-temp', deg(x.temperature_2m)),
      ),
      el('div.weather-now-cond', cc.label),
      el('div.weather-now-sub', `Feels like ${deg(x.apparent_temperature)}`),
      el('div.weather-now-sub', `High ${deg(today.temperature_2m_max[0])}  ·  Low ${deg(today.temperature_2m_min[0])}`),
      el('div.weather-details',
        detail(Wind, 'wind', el('span', el('span.weather-arrow', { style: { transform: `rotate(${(x.wind_direction_10m + 180) % 360}deg)` }, html: iconSVG(Navigation, { size: 14, stroke: 2 }) }), ` ${Math.round(x.wind_speed_10m)} ${(u.wind_speed_10m || '').replace('mp/h', 'mph')} ${compass(x.wind_direction_10m)}`)),
        detail(Droplets, 'humidity', `${Math.round(x.relative_humidity_2m)}%`),
        detail(Gauge, 'pressure', units() === 'imperial' ? `${(x.pressure_msl * 0.02953).toFixed(2)} inHg` : `${Math.round(x.pressure_msl)} hPa`),
        detail(Thermometer, 'uv index', `${Math.round(x.uv_index ?? 0)} ${uvLabel(x.uv_index)}`),
        detail(Eye, 'visibility', x.visibility != null ? (units() === 'imperial' ? `${(x.visibility / 1609).toFixed(1)} mi` : `${(x.visibility / 1000).toFixed(1)} km`) : '--'),
        detail(Umbrella, 'precipitation', `${today.precipitation_probability_max?.[0] ?? 0}%`),
        detail(Sunrise, 'sunrise', fmtHour(today.sunrise[0], h24())),
        detail(Sunset, 'sunset', fmtHour(today.sunset[0], h24())),
      ),
      el('div.weather-foot',
        el('span', { html: iconSVG(MapPin, { size: 12 }) }),
        ` ${loc ? placeLabel(loc) : ''}${!selected && here?.approximate ? ' (approximate)' : ''}`),
      el('div.weather-foot', `Updated ${fmtHour(x.time, h24())} local time · Open-Meteo`),
    );
  }

  const uvLabel = (v) => (v == null ? '' : v < 3 ? 'low' : v < 6 ? 'moderate' : v < 8 ? 'high' : v < 11 ? 'very high' : 'extreme');
  const detail = (ic, label, value) => el('div.weather-detail',
    el('div.weather-detail-label', el('span', { html: iconSVG(ic, { size: 14 }) }), ' ' + label),
    el('div.weather-detail-value', value));

  function renderHourly(c) {
    if (!data) { c.append(status() || os.ui.empty('no data yet')); return; }
    const h = data.hourly, start = hourIndex(data);
    const temps = h.temperature_2m.slice(start, start + 24);
    const min = Math.min(...temps), max = Math.max(...temps);
    // temperature curve
    const W = 300, H = 60;
    const pts = temps.map((t, i) => `${(i / (temps.length - 1)) * W},${H - 6 - ((t - min) / (max - min || 1)) * (H - 12)}`).join(' ');
    c.append(el('div.weather-curve', { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>` }));
    const listEl = el('div.weather-hours');
    for (let i = start; i < start + 24 && i < h.time.length; i++) {
      const cc = cond(h.weather_code[i], h.is_day[i]);
      const p = parts(h.time[i]);
      listEl.append(el('div.weather-hour',
        el('div.weather-hour-time', i === start ? 'Now' : fmtHour(h.time[i], h24())),
        el('div.weather-hour-icon', { html: iconSVG(cc.icon, { size: 26, stroke: 1.5 }) }),
        el('div.weather-hour-temp', deg(h.temperature_2m[i])),
        el('div.weather-hour-cond', cc.label),
        el('div.weather-hour-pop', h.precipitation_probability[i] ? `${h.precipitation_probability[i]}%` : ''),
        p.h === 0 && i !== start ? el('div.weather-hour-day', dayName(h.time[i], 1)) : null));
    }
    c.append(listEl);
  }

  function renderDaily(c) {
    if (!data) { c.append(status() || os.ui.empty('no data yet')); return; }
    const d = data.daily;
    const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
    d.time.forEach((t, i) => {
      const cc = cond(d.weather_code[i], 1);
      const a = ((d.temperature_2m_min[i] - lo) / (hi - lo || 1)) * 100, b = ((d.temperature_2m_max[i] - lo) / (hi - lo || 1)) * 100;
      const row = el('div.weather-day.tilt',
        el('div.weather-day-icon', { html: iconSVG(cc.icon, { size: 34, stroke: 1.4 }) }),
        el('div.weather-day-text',
          el('div.weather-day-name', dayName(t, i).toLowerCase()),
          el('div.weather-day-sub', `${dateShort(t)} · ${cc.label}${d.precipitation_probability_max[i] ? ' · ' + d.precipitation_probability_max[i] + '%' : ''}`),
          el('div.weather-day-range', el('i', { style: { left: a + '%', width: Math.max(4, b - a) + '%' } }))),
        el('div.weather-day-temps', el('b', deg(d.temperature_2m_max[i])), el('span', deg(d.temperature_2m_min[i]))));
      const more = el('div.weather-day-more', { hidden: true },
        `Sunrise ${fmtHour(d.sunrise[i], h24())} · Sunset ${fmtHour(d.sunset[i], h24())}\nMax wind ${Math.round(d.wind_speed_10m_max[i])} ${(data.daily_units?.wind_speed_10m_max || '').replace('mp/h', 'mph')} · UV ${Math.round(d.uv_index_max[i] ?? 0)}`);
      row.addEventListener('click', () => { more.hidden = !more.hidden; });
      c.append(row, more);
    });
  }

  function renderPlaces(c) {
    const items = [{ here: true, name: here?.name || 'current location' }, ...places];
    const listEl = os.ui.list(items, {
      render: (p) => {
        const active = p.here ? !selected : selected && placeKey(selected) === placeKey(p);
        const n = el('div.weather-place' + (active ? '.active' : ''),
          el('div.weather-place-icon', { html: iconSVG(p.here ? LocateFixed : MapPin, { size: 22 }) }),
          el('div.weather-place-text',
            el('div.weather-place-name', p.here ? 'current location' : p.name.toLowerCase()),
            el('div.weather-place-sub', p.here ? (here ? placeLabel(here) : 'find me') : [p.admin1, p.country].filter(Boolean).join(', '))),
          el('div.weather-place-temp'));
        if (!p.here) os.net.weather(p.lat, p.lon, units()).then((d) => {
          const cc = cond(d.current.weather_code, d.current.is_day);
          n.querySelector('.weather-place-temp').innerHTML = iconSVG(cc.icon, { size: 22 }) + ' ' + os.ui.esc(deg(d.current.temperature_2m));
        }).catch(() => {});
        return n;
      },
      onClick: (p) => select(p.here ? null : p),
      onHold: (p, row) => {
        if (p.here) return;
        os.ui.contextMenu(row, [
          { label: 'pin to start', onClick: async () => { await ctx.pinTile({ key: 'weather:' + placeKey(p), title: p.name, size: 'medium', args: { place: p } }); os.toast(`Pinned ${p.name}`); } },
          { label: 'remove', onClick: () => removePlace(p) },
        ]);
      },
    });
    c.append(listEl, el('button.weather-addbtn.tilt', { onclick: () => ctx.navigate(searchPage) },
      el('span', { html: iconSVG(I.add, { size: 20 }) }), ' add a place'),
    el('div.weather-hint', 'Tap and hold a place to pin it to Start.'));
  }

  /* ------------------------------------------------------------- search page */

  function searchPage(page) {
    const p = os.ui.page({ app: 'MSN WEATHER', title: 'add place' });
    const results = el('div');
    let t = 0;
    const run = os.util.debounce(async (q) => {
      const my = ++t;
      q = q.trim();
      if (!q) { results.replaceChildren(); return; }
      results.replaceChildren(os.ui.loadingDots({ inline: true }));
      try {
        const r = await os.net.geocode(q);
        if (my !== t) return;
        results.replaceChildren(os.ui.list(r, {
          empty: 'no places found',
          render: (x) => os.ui.listItem({ title: x.name.toLowerCase(), subtitle: [x.admin1, x.country].filter(Boolean).join(', '), icon: MapPin }),
          onClick: async (x) => { await addPlace(x); page.close(); select(x); },
        }));
      } catch {
        if (my === t) results.replaceChildren(os.ui.empty(navigator.onLine ? 'Couldn’t search right now.' : 'You’re offline.'));
      }
    }, 300);
    const box = os.ui.textbox({ placeholder: 'city name', onInput: run, onEnter: run });
    p.content.append(box, results);
    page.el.append(p.el);
    setTimeout(() => box.focus(), 350);
  }

  /* ------------------------------------------------------------- lifecycle */

  const offUnits = os.settings.on('change:units', () => { data = null; load(); });
  const offH24 = os.settings.on('change:h24', () => render());
  ctx.on('args', (a) => { if (a?.place) select(a.place); });

  load();
  return {
    onResume: () => { if (Date.now() - loadedAt > 15 * 60e3) load(); },
    onDestroy: () => { offUnits?.(); offH24?.(); },
  };
}
