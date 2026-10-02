import './style.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  LocateFixed, Navigation, Layers, Route, MapPin, Star, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  CornerUpLeft, CornerUpRight, Undo2, RotateCw, Flag, Car, List, Plus, Minus, X, History,
} from 'lucide';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const TILES = {
  road: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { subdomains: 'abc', maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } },
  // CARTO dark tiles now need an API key: render OSM tiles inverted instead (see .maps-invert in style.css)
  dark: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { subdomains: 'abc', maxZoom: 19, className: 'maps-invert', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } },
  aerial: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' } },
};

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, appBar, I, iconSVG } = os.ui;

  let view = await storage.get('view', { lat: 47.64, lon: -122.13, zoom: 3 });
  let layerMode = await storage.get('layer', 'road'); // 'road' | 'aerial'
  let favorites = await storage.get('favorites', []);
  let recents = await storage.get('recents', []);

  let map, baseLayer, meMarker, meCircle, placeMarker, routeLine, routeMarkers = [];
  let me = null;           // last known { lat, lon, accuracy, heading }
  let follow = false;
  let stopWatch = null, stopOrient = null;
  let place = null;        // currently shown place { name, sub, lat, lon }
  let route = null;        // { distance, duration, steps, from, to }
  let mapEl, cardEl, bar, ro, popTop;

  const imperial = () => os.settings.get('units') === 'imperial';
  const fmtDist = (m) => {
    if (imperial()) { const mi = m / 1609.34; return mi < 0.2 ? `${Math.round(m * 3.281 / 10) * 10} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`; }
    return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  };
  const fmtDur = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} hr ${m} min` : `${Math.max(1, m)} min`; };

  /* ------------------------------------------------------------- main page */

  await ctx.navigate((page) => {
    popTop = page.close;
    mapEl = el('div.maps-map');
    cardEl = el('div.maps-card', { hidden: true });
    const zoom = el('div.maps-zoom',
      el('button.maps-zbtn', { 'aria-label': 'zoom in', onclick: () => map.zoomIn(), html: iconSVG(Plus, { size: 20 }) }),
      el('button.maps-zbtn', { 'aria-label': 'zoom out', onclick: () => map.zoomOut(), html: iconSVG(Minus, { size: 20 }) }));
    bar = appBar({
      buttons: [
        { icon: LocateFixed, label: 'me', onClick: locateMe },
        { icon: Route, label: 'directions', onClick: () => ctx.navigate(directionsPage, { to: place }) },
        { icon: I.search, label: 'search', onClick: () => ctx.navigate(searchPage) },
        { icon: Layers, label: 'aerial', onClick: toggleAerial },
      ],
      menu: menuItems(),
    });
    page.el.append(el('div.maps-app', mapEl, zoom, cardEl), bar.el);
    return { onShow: () => setTimeout(() => map?.invalidateSize(), 50) };
  });

  function menuItems() {
    return [
      { label: 'favorites', onClick: () => ctx.navigate(favoritesPage) },
      { label: 'add current view to favorites', onClick: addViewFavorite },
      route ? { label: 'directions list', onClick: () => ctx.navigate(stepsPage) } : null,
      route ? { label: 'clear route', onClick: clearRoute } : null,
      place ? { label: 'clear pin', onClick: () => clearPlace() } : null,
      { label: 'share location', onClick: shareView },
      { label: layerMode === 'aerial' ? 'road view' : 'aerial view', onClick: toggleAerial },
    ].filter(Boolean);
  }
  const refreshMenu = () => bar.setMenu(menuItems());

  map = L.map(mapEl, { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([view.lat, view.lon], view.zoom);
  map.attributionControl.setPrefix(false);
  setBase();

  const offTheme = os.settings.on('change:theme', () => setBase());
  ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(mapEl);
  setTimeout(() => map.invalidateSize(), 300);

  const saveView = os.util.debounce(() => {
    const c = map.getCenter();
    view = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
    storage.set('view', view);
  }, 600);
  map.on('moveend', saveView);
  map.on('dragstart', () => { follow = false; });
  // tap-and-hold (touch) / right-click (mouse) drops a pin
  map.on('contextmenu', async (e) => {
    os.device.vibrate(30);
    const p = { name: 'dropped pin', sub: `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`, lat: e.latlng.lat, lon: e.latlng.lng };
    showPlace(p, { fly: false });
    try {
      const r = await os.net.reverse(p.lat, p.lon);
      if (place === p) { p.name = r.name || p.name; p.sub = r.display || p.sub; showPlace(p, { fly: false }); }
    } catch {}
  });

  function setBase() {
    const mode = layerMode === 'aerial' ? 'aerial' : os.theme.isDark() ? 'dark' : 'road';
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = L.tileLayer(TILES[mode].url, TILES[mode].opts).addTo(map);
    baseLayer.on('tileerror', os.util.debounce(() => { if (!navigator.onLine) os.toast('You’re offline. Map tiles can’t be downloaded.'); }, 3000));
    mapEl.classList.toggle('dark', mode !== 'road');
  }
  function toggleAerial() {
    layerMode = layerMode === 'aerial' ? 'road' : 'aerial';
    storage.set('layer', layerMode);
    setBase();
    refreshMenu();
  }

  /* ------------------------------------------------------------- my location */

  const meIcon = () => L.divIcon({
    className: 'maps-me-icon',
    html: `<div class="maps-me-cone" style="${me?.heading != null && !isNaN(me.heading) ? `transform:rotate(${me.heading}deg)` : 'display:none'}"></div><div class="maps-me-dot"></div>`,
    iconSize: [60, 60], iconAnchor: [30, 30],
  });
  function updateMe(p, center) {
    me = { ...me, ...p, heading: p.heading ?? me?.heading };
    const ll = [me.lat, me.lon];
    if (!meMarker) {
      meCircle = L.circle(ll, { radius: me.accuracy || 50, className: 'maps-me-acc', weight: 1 }).addTo(map);
      meMarker = L.marker(ll, { icon: meIcon(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    } else {
      meMarker.setLatLng(ll).setIcon(meIcon());
      meCircle.setLatLng(ll).setRadius(me.accuracy || 50);
    }
    if (center || follow) map.setView(ll, center ? Math.max(map.getZoom(), me.accuracy > 2000 ? 12 : 16) : map.getZoom(), { animate: true });
  }
  async function locateMe() {
    follow = true;
    if (me) map.setView([me.lat, me.lon], Math.max(map.getZoom(), 16));
    startWatch(true);
    // compass heading (needs a user gesture on iOS)
    if (!stopOrient) {
      try {
        stopOrient = await os.device.watchOrientation((o) => {
          if (o.heading == null || !me) return;
          me.heading = o.heading;
          meMarker?.setIcon(meIcon());
        });
      } catch { stopOrient = null; }
    }
  }
  function startWatch(center) {
    if (!os.settings.get('location')) { os.ui.alert('Location is turned off. Turn it on in Settings to see where you are.', 'location'); return; }
    let first = center;
    let got = false;
    if (!stopWatch) {
      stopWatch = os.device.watchLocation((p) => { got = true; updateMe(p, first); first = false; });
    }
    if (center) {
      os.toast('Finding your location…');
      setTimeout(async () => {
        if (got || me) return;
        try {
          const p = await os.device.locate();
          if (!got) { updateMe({ lat: p.lat, lon: p.lon, accuracy: p.approximate ? 5000 : p.accuracy }, true); if (p.approximate) os.toast('Showing approximate location'); }
        } catch { os.ui.alert('We couldn’t find your location right now.', 'location'); }
      }, 6000);
    }
  }
  function stopWatching() {
    stopWatch?.(); stopWatch = null;
    stopOrient?.(); stopOrient = null;
  }

  /* ------------------------------------------------------------- places */

  const pinIcon = (cls = '') => L.divIcon({ className: 'maps-pin-icon ' + cls, html: `<div class="maps-pin">${iconSVG(MapPin, { size: 18, stroke: 2.2 })}</div>`, iconSize: [36, 44], iconAnchor: [18, 44] });
  const isFav = (p) => p && favorites.some((f) => Math.abs(f.lat - p.lat) < 1e-5 && Math.abs(f.lon - p.lon) < 1e-5);

  function showPlace(p, { fly = true, zoom = 16, bounds } = {}) {
    place = p;
    if (!placeMarker) placeMarker = L.marker([p.lat, p.lon], { icon: pinIcon() }).addTo(map).on('click', () => showPlace(place, { fly: false }));
    else placeMarker.setLatLng([p.lat, p.lon]);
    if (fly) {
      if (bounds) map.flyToBounds(bounds, { maxZoom: 17, duration: 0.8, paddingBottomRight: [0, 120] });
      else map.flyTo([p.lat, p.lon], zoom, { duration: 0.8 });
    }
    follow = false;
    renderCard();
    refreshMenu();
  }
  function clearPlace() {
    place = null;
    if (placeMarker) { map.removeLayer(placeMarker); placeMarker = null; }
    renderCard();
    refreshMenu();
  }

  function renderCard() {
    cardEl.replaceChildren();
    if (route) {
      cardEl.hidden = false;
      cardEl.append(
        el('div.maps-card-head',
          el('div.maps-card-icon', { html: iconSVG(Car, { size: 22 }) }),
          el('div.maps-card-text',
            el('div.maps-card-title', `${fmtDur(route.duration)} · ${fmtDist(route.distance)}`),
            el('div.maps-card-sub', `to ${route.to.name}`)),
          el('button.maps-card-x', { 'aria-label': 'clear route', onclick: clearRoute, html: iconSVG(X, { size: 18 }) })),
        el('div.maps-card-actions',
          cardBtn(List, 'directions list', () => ctx.navigate(stepsPage)),
          cardBtn(Navigation, 'follow me', locateMe)));
      return;
    }
    if (!place) { cardEl.hidden = true; return; }
    cardEl.hidden = false;
    const p = place;
    cardEl.append(
      el('div.maps-card-head',
        el('div.maps-card-text',
          el('div.maps-card-title', p.name),
          el('div.maps-card-sub', [p.sub, me ? fmtDist(L.latLng(me.lat, me.lon).distanceTo([p.lat, p.lon])) + ' away' : ''].filter(Boolean).join(' · '))),
        el('button.maps-card-x', { 'aria-label': 'close', onclick: () => clearPlace(), html: iconSVG(X, { size: 18 }) })),
      el('div.maps-card-actions',
        cardBtn(Route, 'directions', () => getRoute(null, p)),
        cardBtn(Star, isFav(p) ? 'saved' : 'save', () => toggleFav(p)),
        cardBtn(I.share, 'share', () => sharePlace(p))));
  }
  const cardBtn = (ic, label, fn) => el('button.maps-card-btn.tilt', { onclick: fn }, el('span', { html: iconSVG(ic, { size: 18 }) }), label);

  async function toggleFav(p) {
    if (isFav(p)) {
      favorites = favorites.filter((f) => !(Math.abs(f.lat - p.lat) < 1e-5 && Math.abs(f.lon - p.lon) < 1e-5));
      os.toast('Removed from favorites');
    } else {
      const name = await os.ui.prompt('Name this favorite', p.name === 'dropped pin' ? '' : p.name, 'add favorite');
      if (name == null) return;
      favorites = [{ name: name.trim() || p.name, sub: p.sub || '', lat: p.lat, lon: p.lon }, ...favorites];
      os.toast('Added to favorites');
    }
    await storage.set('favorites', favorites);
    renderCard();
  }
  async function addViewFavorite() {
    const c = map.getCenter();
    let name = '';
    try { name = (await os.net.reverse(c.lat, c.lng)).name; } catch {}
    const p = { name: name || 'favorite place', sub: `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`, lat: c.lat, lon: c.lng };
    showPlace(p, { fly: false });
    toggleFav(p);
  }
  const osmUrl = (lat, lon, z = 16) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=${z}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
  const sharePlace = (p) => os.share({ title: p.name, text: `${p.name}${p.sub ? ' — ' + p.sub : ''}`, url: osmUrl(p.lat, p.lon) });
  function shareView() {
    if (place) return sharePlace(place);
    if (me) return os.share({ title: 'My location', text: 'Here’s where I am', url: osmUrl(me.lat, me.lon) });
    const c = map.getCenter();
    os.share({ title: 'Map location', url: osmUrl(c.lat, c.lng, map.getZoom()) });
  }

  /* ------------------------------------------------------------- search */

  let lastNominatim = 0;
  async function nominatim(q, { bias = true, limit = 10 } = {}) {
    const wait = 1100 - (Date.now() - lastNominatim);   // usage policy: max 1 request/second
    if (wait > 0) await os.util.sleep(wait);
    lastNominatim = Date.now();
    const b = map.getBounds();
    const params = new URLSearchParams({ format: 'jsonv2', q, limit: String(limit), addressdetails: '0', 'accept-language': navigator.language || 'en' });
    if (bias && map.getZoom() >= 5) params.set('viewbox', [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map((x) => x.toFixed(4)).join(','));
    const r = await fetch(`${NOMINATIM}/search?${params}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('search failed');
    const d = await r.json();
    return d.map((x) => {
      const parts = (x.display_name || '').split(', ');
      return {
        name: x.name || parts[0], sub: parts.slice(x.name ? (parts[0] === x.name ? 1 : 0) : 1, 5).join(', '), lat: +x.lat, lon: +x.lon, type: x.type,
        bounds: x.boundingbox ? [[+x.boundingbox[0], +x.boundingbox[2]], [+x.boundingbox[1], +x.boundingbox[3]]] : null,
      };
    });
  }
  async function searchPlaces(q) {
    let res = [];
    try { res = await nominatim(q); } catch {
      // fall back to the backend city geocoder
      const g = await os.net.geocode(q);
      res = g.map((x) => ({ name: x.name, sub: [x.admin1, x.country].filter(Boolean).join(', '), lat: x.lat, lon: x.lon }));
    }
    return res;
  }
  async function addRecent(q) {
    recents = [q, ...recents.filter((x) => x !== q)].slice(0, 12);
    await storage.set('recents', recents);
  }
  const selectResult = (r) => showPlace({ name: r.name, sub: r.sub, lat: r.lat, lon: r.lon }, { bounds: r.bounds && r.type !== 'house' ? r.bounds : null });

  function searchPage(page) {
    const p = os.ui.page({ app: 'MAPS', title: 'search' });
    const results = el('div');
    const run = async (q) => {
      q = q.trim();
      if (!q) return;
      addRecent(q);
      results.replaceChildren(os.ui.loadingDots({ inline: true }));
      try {
        const r = await searchPlaces(q);
        results.replaceChildren(os.ui.list(r, {
          empty: 'no results found',
          render: (x) => os.ui.listItem({ title: x.name, subtitle: x.sub, icon: MapPin }),
          onClick: (x) => { page.close(); selectResult(x); },
        }));
        if (r.length === 1) { page.close(); selectResult(r[0]); }
      } catch {
        results.replaceChildren(os.ui.empty(navigator.onLine ? 'Search isn’t available right now.' : 'You’re offline. Connect to search.'));
      }
    };
    const box = os.ui.textbox({ placeholder: 'search for a place or address', type: 'search', onEnter: run });
    const showIdle = () => {
      const kids = [];
      if (favorites.length) {
        kids.push(os.ui.header('favorites'), os.ui.list(favorites, {
          render: (f) => os.ui.listItem({ title: f.name, subtitle: f.sub, icon: Star }),
          onClick: (f) => { page.close(); showPlace(f); },
        }));
      }
      if (recents.length) {
        kids.push(os.ui.header('recent'), os.ui.list(recents, {
          render: (q) => os.ui.listItem({ title: q, icon: History }),
          onClick: (q) => { box.value = q; run(q); },
        }));
      }
      if (!kids.length) kids.push(os.ui.desc('Type a place, address or business and press Enter.'));
      results.replaceChildren(...kids);
    };
    box.addEventListener('input', () => { if (!box.value.trim()) showIdle(); });
    showIdle();
    const b = appBar({ buttons: [{ icon: I.search, label: 'search', onClick: () => run(box.value) }] });
    p.content.append(box, results);
    page.el.append(p.el, b.el);
    setTimeout(() => box.focus(), 350);
  }

  /* ------------------------------------------------------------- directions */

  async function resolveEnd(text, preset) {
    if (preset && (!text || text === preset.name)) return preset;
    if (!text || /^(my location|current location)$/i.test(text.trim())) {
      if (me) return { name: 'my location', lat: me.lat, lon: me.lon };
      const p = await os.device.locate();
      updateMe({ lat: p.lat, lon: p.lon, accuracy: p.approximate ? 5000 : p.accuracy });
      return { name: 'my location', lat: p.lat, lon: p.lon };
    }
    const r = await searchPlaces(text);
    if (!r.length) throw new Error(`Couldn’t find “${text}”.`);
    return { name: r[0].name, sub: r[0].sub, lat: r[0].lat, lon: r[0].lon };
  }

  async function getRoute(from, to) {
    try {
      os.toast('Getting directions…');
      from = from || (await resolveEnd(''));
      const r = await fetch(`${OSRM}${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`);
      const d = await r.json();
      if (d.code !== 'Ok' || !d.routes?.length) throw new Error(d.code === 'NoRoute' ? 'There’s no driving route between these places.' : 'Directions aren’t available right now.');
      const rt = d.routes[0];
      clearRoute(true);
      route = { distance: rt.distance, duration: rt.duration, steps: rt.legs.flatMap((l) => l.steps), from, to };
      const ll = rt.geometry.coordinates.map(([x, y]) => [y, x]);
      routeLine = L.layerGroup([
        L.polyline(ll, { className: 'maps-route-casing', weight: 9, opacity: 1 }),
        L.polyline(ll, { className: 'maps-route', weight: 5, opacity: 1 }),
      ]).addTo(map);
      routeMarkers = [
        L.marker([from.lat, from.lon], { icon: L.divIcon({ className: 'maps-end-icon', html: '<div class="maps-end start"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map),
        L.marker([to.lat, to.lon], { icon: pinIcon('dest') }).addTo(map),
      ];
      if (placeMarker) { map.removeLayer(placeMarker); placeMarker = null; }
      map.fitBounds(L.latLngBounds(ll), { paddingTopLeft: [30, 30], paddingBottomRight: [30, 150] });
      renderCard();
      refreshMenu();
    } catch (e) {
      os.ui.alert(navigator.onLine ? e.message || 'Directions aren’t available right now.' : 'You’re offline. Connect to get directions.', 'directions');
    }
  }
  function clearRoute(silent) {
    if (routeLine) map.removeLayer(routeLine);
    routeMarkers.forEach((m) => map.removeLayer(m));
    routeLine = null; routeMarkers = []; route = null;
    if (silent !== true) { renderCard(); refreshMenu(); }
  }

  function directionsPage(page) {
    const to = page.params.to;
    const p = os.ui.page({ app: 'MAPS', title: 'directions' });
    const fromBox = os.ui.textbox({ label: 'start', placeholder: 'my location' });
    const toBox = os.ui.textbox({ label: 'end', placeholder: 'search for a place', value: to?.name || '' });
    const status = el('div');
    const go = async () => {
      if (!toBox.value.trim() && !to) { toBox.input.focus(); return; }
      status.replaceChildren(os.ui.loadingDots({ inline: true }));
      try {
        const [a, b] = [await resolveEnd(fromBox.value.trim()), await resolveEnd(toBox.value.trim(), to)];
        page.close();
        getRoute(a, b);
      } catch (e) {
        status.replaceChildren(os.ui.desc(navigator.onLine ? e.message || 'Something went wrong.' : 'You’re offline.'));
      }
    };
    [fromBox.input, toBox.input].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
    const swap = os.ui.button('swap start and end', () => { const v = fromBox.value; fromBox.value = toBox.value; toBox.value = v; });
    const favs = favorites.length ? [os.ui.header('favorites'), os.ui.list(favorites, {
      render: (f) => os.ui.listItem({ title: f.name, subtitle: f.sub, icon: Star }),
      onClick: (f) => { page.close(); getRoute(null, f); },
    })] : [];
    p.content.append(fromBox, toBox, swap, status, os.ui.desc('Driving directions by OSRM. Leave start empty to use your location.'), ...favs);
    const b = appBar({ buttons: [{ icon: Route, label: 'get directions', onClick: go }] });
    page.el.append(p.el, b.el);
    setTimeout(() => (to ? fromBox.input : toBox.input).focus(), 350);
  }

  const MANEUVER = (s) => {
    const t = s.maneuver.type, m = s.maneuver.modifier || '';
    if (t === 'depart') return ArrowUp;
    if (t === 'arrive') return Flag;
    if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn' || t === 'exit roundabout' || t === 'exit rotary') return RotateCw;
    if (m === 'uturn') return Undo2;
    if (m === 'sharp left') return CornerUpLeft;
    if (m === 'sharp right') return CornerUpRight;
    if (m === 'slight left') return ArrowUpLeft;
    if (m === 'slight right') return ArrowUpRight;
    if (m === 'left') return ArrowLeft;
    if (m === 'right') return ArrowRight;
    return ArrowUp;
  };
  function instruction(s, i, all) {
    const t = s.maneuver.type, m = s.maneuver.modifier, road = s.name || s.ref || '';
    const onto = road ? ` onto ${road}` : '';
    switch (t) {
      case 'depart': return `Head ${dirWord(s.maneuver.bearing_after)}${road ? ' on ' + road : ''}`;
      case 'arrive': return `Arrive at ${all.to?.name || 'your destination'}${m && m !== 'straight' ? ` (on the ${m})` : ''}`;
      case 'roundabout': case 'rotary': return `At the roundabout, take exit ${s.maneuver.exit || 1}${onto}`;
      case 'exit roundabout': case 'exit rotary': return `Exit the roundabout${onto}`;
      case 'merge': return `Merge${m ? ' ' + m : ''}${onto}`;
      case 'on ramp': return `Take the ramp${m ? ' on the ' + m.replace('slight ', '') : ''}${onto}`;
      case 'off ramp': return `Take the exit${m ? ' on the ' + m.replace('slight ', '') : ''}${onto}`;
      case 'fork': return `Keep ${(m || 'straight').replace('slight ', '')} at the fork${onto}`;
      case 'end of road': return `At the end of the road, turn ${(m || '').replace('slight ', '')}${onto}`;
      case 'continue': case 'new name': return m === 'uturn' ? `Make a U-turn${onto}` : `Continue${m && m !== 'straight' ? ' ' + m : ''}${onto}`;
      default: return m === 'uturn' ? `Make a U-turn${onto}` : m === 'straight' ? `Go straight${onto}` : `Turn ${m || ''}${onto}`;
    }
  }
  const dirWord = (b) => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round((b || 0) / 45) % 8];

  function stepsPage(page) {
    if (!route) { page.el.append(os.ui.page({ app: 'MAPS', title: 'directions' }).el); return; }
    const p = os.ui.page({ app: 'MAPS', title: 'directions' });
    p.content.append(
      el('div.maps-sum', el('div.maps-sum-big', fmtDur(route.duration)), el('div.maps-sum-sub', `${fmtDist(route.distance)} · ${route.from.name} → ${route.to.name}`)),
      os.ui.list(route.steps, {
        render: (s, i) => el('div.maps-step',
          el('div.maps-step-icon', { html: iconSVG(MANEUVER(s), { size: 24 }) }),
          el('div.maps-step-text',
            el('div.maps-step-title', instruction(s, i, route)),
            s.distance > 0 ? el('div.maps-step-sub', fmtDist(s.distance)) : null)),
        onClick: (s) => {
          page.close();
          const [lon, lat] = s.maneuver.location;
          follow = false;
          setTimeout(() => map.flyTo([lat, lon], 17, { duration: 0.6 }), 200);
        },
      }));
    const b = appBar({ buttons: [{ icon: X, label: 'clear route', onClick: () => { clearRoute(); page.close(); } }] });
    page.el.append(p.el, b.el);
  }

  /* ------------------------------------------------------------- favorites */

  function favoritesPage(page) {
    const p = os.ui.page({ app: 'MAPS', title: 'favorites' });
    const draw = () => p.content.replaceChildren(
      os.ui.list(favorites, {
        empty: 'no favorites yet — tap a place and choose save',
        render: (f) => os.ui.listItem({ title: f.name, subtitle: f.sub || `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`, icon: Star }),
        onClick: (f) => { page.close(); showPlace(f); },
        onHold: (f, row) => os.ui.contextMenu(row, [
          { label: 'directions', onClick: () => { page.close(); getRoute(null, f); } },
          { label: 'rename', onClick: async () => { const n = await os.ui.prompt('Name', f.name, 'rename'); if (n && n.trim()) { f.name = n.trim(); await storage.set('favorites', favorites); draw(); } } },
          { label: 'share', onClick: () => sharePlace(f) },
          { label: 'remove', onClick: async () => { favorites = favorites.filter((x) => x !== f); await storage.set('favorites', favorites); draw(); } },
        ]),
      }),
      favorites.length ? os.ui.desc('Tap and hold a favorite for more options.') : '');
    draw();
    page.el.append(p.el);
  }

  /* ------------------------------------------------------------- args & lifecycle */

  async function handleArgs(a) {
    if (!a) return;
    if (a.lat != null && a.lon != null) {
      showPlace({ name: a.label || a.name || 'pinned place', sub: a.sub || `${(+a.lat).toFixed(5)}, ${(+a.lon).toFixed(5)}`, lat: +a.lat, lon: +a.lon }, { zoom: a.zoom || 15 });
    } else if (a.q) {
      try {
        const r = await searchPlaces(a.q);
        if (r.length) selectResult(r[0]); else os.toast(`No results for “${a.q}”`);
      } catch { os.toast('Search isn’t available right now'); }
    } else if (a.directions) {
      getRoute(null, a.directions);
    }
  }
  ctx.on('args', async (a) => {
    for (let i = 0; ctx.pageCount > 1 && i < 10; i++) await popTop();
    handleArgs(a);
  });

  handleArgs(ctx.args);

  return {
    onSuspend: () => stopWatching(),
    onResume: () => {
      setTimeout(() => map.invalidateSize(), 60);
      if ((me || follow) && os.settings.get('location')) startWatch(false);
    },
    onDestroy: () => { stopWatching(); offTheme(); ro?.disconnect(); map.remove(); },
  };
}
