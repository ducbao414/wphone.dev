// FM Radio — Windows Phone FM radio look, backed by real internet radio (radio-browser via os.net.radio).
import './style.css';
import { Heart, ListMusic } from 'lucide';

const GENRES = ['pop', 'rock', 'jazz', 'classical', 'news', 'talk', 'electronic', 'dance', 'hiphop', 'rnb', 'chillout', 'lounge', 'ambient', 'country', 'blues', 'reggae', 'latin', 'metal', 'indie', 'oldies', '80s', '90s', 'soul', 'funk', 'folk', 'world', 'sports', 'kids'];
const CELL = 84; // px width of one dial cell

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, appBar, I } = os.ui;

  let favs = await storage.get('favs', []);
  let ignoreScroll = false;
  let source = await storage.get('source', { type: 'near' });
  let index = await storage.get('index', 0);
  let list = [];
  let loading = false;
  const offs = [];

  const isFav = (s) => s && favs.some((f) => f.id === s.id);
  const saveFavs = () => storage.set('favs', favs);
  const toggleFav = (s) => {
    if (!s) return;
    if (isFav(s)) { favs = favs.filter((f) => f.id !== s.id); os.toast(`Removed ${s.name} from favorites`); }
    else { favs = [...favs, slim(s)]; os.toast(`Added ${s.name} to favorites`); }
    saveFavs();
    if (source.type === 'fav') { list = favs.slice(); index = Math.min(index, Math.max(0, list.length - 1)); buildDial(); }
    renderInfo();
  };
  const slim = (s) => ({ id: s.id, name: s.name, url: s.url, favicon: s.favicon, tags: s.tags, country: s.country, countryCode: s.countryCode, bitrate: s.bitrate, codec: s.codec });
  const tagsOf = (s) => (s.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3).join(', ');
  const freqFor = (i, n = list.length) => {
    const step = n > 1 ? Math.max(0.1, Math.min(0.8, Math.floor((20.4 / (n - 1)) * 10) / 10)) : 0;
    return (87.6 + i * step).toFixed(1);
  };
  const ours = () => os.media.current && os.media.current.appId === 'radio';
  const onAir = () => ours() && os.media.playing;

  /* ---------------- data */
  async function countryCode() {
    const cached = await storage.get('cc', null);
    if (cached && Date.now() - cached.t < 7 * 864e5) return cached;
    let cc = null, name = '';
    try {
      const loc = await os.device.locate();
      if (loc.countryCode) { cc = loc.countryCode; name = loc.country; }
      else { const r = await os.net.reverse(loc.lat, loc.lon); cc = r.countryCode; name = r.country; }
    } catch {}
    if (!cc) { const m = /[-_]([A-Z]{2})$/i.exec(navigator.language || ''); cc = m ? m[1].toUpperCase() : 'US'; name = cc; }
    const v = { code: String(cc).toUpperCase(), name: name || cc, t: Date.now() };
    storage.set('cc', v);
    return v;
  }

  async function fetchSource(src) {
    if (src.type === 'fav') return favs.slice();
    let r;
    if (src.type === 'near') {
      const cc = await countryCode();
      src.label = 'near you · ' + cc.name.toLowerCase();
      r = await os.net.radio({ countrycode: cc.code, limit: 80 });
    } else if (src.type === 'genre') r = await os.net.radio({ tag: src.value, limit: 80 });
    else if (src.type === 'search') r = await os.net.radio({ name: src.value, limit: 60 });
    const seen = new Set();
    return (r || []).filter((s) => { const k = s.name.toLowerCase(); if (!s.url || seen.has(k)) return false; seen.add(k); return true; });
  }
  const labelOf = (src) => src.label || (src.type === 'genre' ? 'genre · ' + src.value : src.type === 'search' ? 'search · ' + src.value : src.type === 'fav' ? 'favorites' : 'near you');

  /* ---------------- main (dial) page */
  const srcEl = el('div.radio-source.tilt', { onclick: () => ctx.navigate(stationsPage) });
  const logoEl = el('div.radio-logo');
  const freqEl = el('div.radio-freq', '--.-');
  const nameEl = el('div.radio-name');
  const subEl = el('div.radio-sub');
  const statusEl = el('div.radio-status');
  const dial = el('div.radio-dial.no-swipe');
  const dialWrap = el('div.radio-dial-wrap', dial, el('div.radio-needle'));
  const prevBtn = el('button.radio-seek', { 'aria-label': 'previous station', html: os.ui.iconSVG(I.left, { size: 30, stroke: 1.5 }), onclick: () => step(-1) });
  const nextBtn = el('button.radio-seek', { 'aria-label': 'next station', html: os.ui.iconSVG(I.right, { size: 30, stroke: 1.5 }), onclick: () => step(1) });
  const bodyEl = el('div.radio-body', el('div.radio-freqrow', prevBtn, el('div.radio-freqbox', freqEl, el('span.radio-mhz', 'MHz')), nextBtn), logoEl, nameEl, subEl, statusEl);
  const main = el('div.radio-main', el('div.wp-app-title.radio-apptitle', 'FM RADIO'), srcEl, bodyEl, dialWrap);

  const bar = appBar({ buttons: [], menu: [] });
  function renderBar() {
    const s = list[index];
    bar.setButtons([
      { icon: onAir() ? I.pause : I.play, label: onAir() ? 'stop' : 'play', onClick: togglePlay, disabled: !s },
      { icon: isFav(s) ? [...Heart.map(([t, a]) => [t, { ...a, fill: 'currentColor' }])] : Heart, label: isFav(s) ? 'unfavorite' : 'favorite', onClick: () => toggleFav(list[index]), disabled: !s },
      { icon: ListMusic, label: 'stations', onClick: () => ctx.navigate(stationsPage) },
      { icon: I.search, label: 'search', onClick: () => ctx.navigate(stationsPage, { pivot: 3 }) },
    ]);
    bar.setMenu([
      { label: 'stations near you', onClick: () => switchSource({ type: 'near' }) },
      { label: 'favorites', onClick: () => switchSource({ type: 'fav' }) },
      { label: 'genres', onClick: () => ctx.navigate(stationsPage, { pivot: 1 }) },
      { label: 'refresh location', onClick: async () => { await storage.del('cc'); switchSource({ type: 'near' }); } },
    ]);
  }

  function renderInfo() {
    srcEl.textContent = labelOf(source);
    const s = list[index];
    main.classList.toggle('on-air', onAir());
    if (!s) {
      freqEl.textContent = '--.-';
      nameEl.textContent = loading ? 'tuning…' : source.type === 'fav' ? 'no favorites yet' : 'no stations found';
      subEl.textContent = loading ? '' : source.type === 'fav' ? 'tap and hold a station in the list, or tap the heart, to add it here' : 'try another genre or search';
      logoEl.replaceChildren(); statusEl.textContent = '';
      renderBar();
      return;
    }
    freqEl.textContent = freqFor(index);
    nameEl.textContent = s.name;
    subEl.textContent = [tagsOf(s), s.country].filter(Boolean).join(' · ');
    logoEl.replaceChildren();
    if (s.favicon) {
      const img = el('img', { src: s.favicon, alt: '', referrerpolicy: 'no-referrer' });
      img.onerror = () => img.remove();
      logoEl.append(img);
    }
    const playingThis = ours() && os.media.current.stationId === s.id;
    statusEl.textContent = playingThis ? (os.media.playing ? (os.media.audio.readyState < 3 ? 'connecting…' : 'on air') + (s.bitrate ? ` · ${s.bitrate} kbps` : '') : 'stopped') : '';
    dial.querySelectorAll('.radio-cell').forEach((c, i) => c.classList.toggle('sel', i === index));
    renderBar();
  }

  function buildDial() {
    dial.replaceChildren(...list.map((s, i) => el('div.radio-cell', { onclick: () => scrollToIndex(i, true) },
      el('div.radio-cell-freq', freqFor(i)), el('div.radio-cell-ticks'))));
    if (!list.length) dial.append(el('div.radio-cell.empty', el('div.radio-cell-freq', ''), el('div.radio-cell-ticks')));
    ignoreScroll = true;
    requestAnimationFrame(() => { dial.scrollLeft = index * CELL; requestAnimationFrame(() => (ignoreScroll = false)); });
    renderInfo();
  }

  function scrollToIndex(i, smooth) {
    dial.scrollTo({ left: i * CELL, behavior: smooth ? 'smooth' : 'auto' });
  }

  let scrollT;
  dial.addEventListener('scroll', () => {
    if (ignoreScroll || !list.length) return;
    const i = Math.max(0, Math.min(list.length - 1, Math.round(dial.scrollLeft / CELL)));
    if (i !== index) { freqEl.textContent = freqFor(i); nameEl.textContent = list[i].name; subEl.textContent = [tagsOf(list[i]), list[i].country].filter(Boolean).join(' · '); }
    clearTimeout(scrollT);
    scrollT = setTimeout(() => { if (i !== index) tune(i, onAir()); }, 220);
  }, { passive: true });
  // Mouse wheel on desktop scrolls the dial horizontally.
  dial.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); dial.scrollLeft += e.deltaY; } }, { passive: false });

  // Mouse drag on desktop (touch scrolls natively).
  let drag = null;
  dial.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    drag = { x: e.clientX, left: dial.scrollLeft, moved: false };
    dial.style.scrollSnapType = 'none';
  });
  const onDragMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    dial.scrollLeft = drag.left - dx;
  };
  window.addEventListener('pointermove', onDragMove);
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    dial.style.scrollSnapType = '';
    if (moved) {
      const i = Math.max(0, Math.min(list.length - 1, Math.round(dial.scrollLeft / CELL)));
      scrollToIndex(i, true);
      dial.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
    }
  };
  window.addEventListener('pointerup', endDrag);
  offs.push(() => { window.removeEventListener('pointerup', endDrag); window.removeEventListener('pointermove', onDragMove); });

  function step(d) {
    if (!list.length) return;
    os.sounds.tap();
    const i = (index + d + list.length) % list.length;
    ignoreScroll = true;
    scrollToIndex(i, Math.abs(i - index) < 4);
    setTimeout(() => (ignoreScroll = false), 500);
    tune(i, onAir());
  }

  function tune(i, play) {
    index = i;
    storage.set('index', index);
    renderInfo();
    if (play) playCurrent();
  }

  function playCurrent() {
    const s = list[index];
    if (!s) return;
    os.media.playOne({ src: s.url, title: s.name, artist: tagsOf(s) || s.country || 'Internet radio', album: 'FM Radio', art: s.favicon || undefined, live: true, appId: 'radio', stationId: s.id });
    renderInfo();
  }

  function togglePlay() {
    if (onAir()) { os.media.stop(); renderInfo(); return; }
    playCurrent();
  }

  async function switchSource(src, startIndex = 0, play = false) {
    source = { ...src };
    loading = true;
    list = [];
    buildDial();
    main.classList.add('loading');
    try {
      list = await fetchSource(source);
    } catch (e) {
      list = [];
      os.toast('Couldn’t load stations. Check your connection.');
    }
    loading = false;
    main.classList.remove('loading');
    index = Math.max(0, Math.min(startIndex, list.length - 1));
    storage.set('source', { type: source.type, value: source.value });
    storage.set('index', index);
    buildDial();
    if (play) playCurrent();
  }

  function useList(stations, src, i) {
    source = { ...src };
    list = stations.slice();
    index = i;
    storage.set('source', { type: source.type, value: source.value });
    storage.set('index', index);
    buildDial();
    playCurrent();
  }

  // media state
  offs.push(os.media.on('change', renderInfo));
  const audio = os.media.audio;
  const onReady = () => renderInfo();
  ['playing', 'waiting', 'canplay'].forEach((ev) => audio.addEventListener(ev, onReady));
  offs.push(() => ['playing', 'waiting', 'canplay'].forEach((ev) => audio.removeEventListener(ev, onReady)));
  offs.push(os.media.on('error', () => {
    if (!ours()) return;
    os.toast(`Couldn’t tune in to ${os.media.current?.title || 'this station'}`);
    renderInfo();
  }));

  /* ---------------- stations page (pivot) */
  function stationRow(s) {
    const row = os.ui.listItem({ title: s.name, subtitle: [tagsOf(s), s.country].filter(Boolean).join(' · ') || 'internet radio', image: s.favicon || undefined, icon: s.favicon ? undefined : I.music,
      right: isFav(s) ? el('div.radio-favmark', { html: os.ui.iconSVG(Heart, { size: 16, stroke: 2 }) }) : null });
    if (ours() && os.media.current.stationId === s.id) row.classList.add('radio-row-playing');
    return row;
  }
  function stationList(stations, src, { onChanged } = {}) {
    return os.ui.list(stations, {
      render: stationRow,
      empty: 'no stations',
      onClick: (s) => { useList(stations, src, stations.indexOf(s)); ctx.back(); },
      onHold: (s, row) => os.ui.contextMenu(row, [
        { label: isFav(s) ? 'remove from favorites' : 'add to favorites', onClick: () => { toggleFav(s); onChanged?.(); } },
        { label: 'play', onClick: () => { useList(stations, src, stations.indexOf(s)); ctx.back(); } },
      ]),
    });
  }
  async function loadInto(c, src) {
    const dots = os.ui.loadingDots({ inline: true });
    c.replaceChildren(dots);
    try {
      const st = await fetchSource(src);
      c.replaceChildren(stationList(st, src));
    } catch {
      c.replaceChildren(os.ui.empty('couldn’t load stations — check your connection'), os.ui.button('try again', () => loadInto(c, src)));
    }
  }

  function stationsPage(page) {
    const p = os.ui.pivot({
      app: 'FM RADIO',
      index: page.params.pivot || 0,
      items: [
        { header: 'near you', render: async (c) => {
          const head = el('div.wp-desc', 'finding your location…');
          const body = el('div');
          c.append(head, body);
          const cc = await countryCode();
          head.textContent = `popular stations in ${cc.name}`;
          loadInto(body, { type: 'near' });
        } },
        { header: 'genres', render: (c) => {
          c.append(el('div.radio-genres', GENRES.map((g) => el('div.radio-genre.tilt', { onclick: () => ctx.navigate(genrePage, { genre: g }) }, g))));
        } },
        { header: 'favorites', render: (c) => {
          const draw = () => c.replaceChildren(favs.length ? stationList(favs.slice(), { type: 'fav' }, { onChanged: draw }) : os.ui.empty('no favorites yet. tap and hold a station to add it.'));
          draw();
          p.onChange((i) => { if (i === 2) draw(); });
        } },
        { header: 'search', render: (c) => {
          const results = el('div');
          const run = async (q) => {
            q = q.trim(); if (!q) return;
            inp.blur();
            loadInto(results, { type: 'search', value: q });
          };
          const inp = os.ui.textbox({ placeholder: 'station name', onEnter: run, type: 'search' });
          c.append(el('div.radio-searchrow', inp, os.ui.button('', () => run(inp.value), { icon: I.search, cls: 'radio-searchbtn' })), results);
          setTimeout(() => inp.focus(), 300);
        } },
      ],
    });
    page.el.append(p.el);
  }

  function genrePage(page) {
    const g = page.params.genre;
    const pg = os.ui.page({ app: 'FM RADIO', title: g });
    loadInto(pg.content, { type: 'genre', value: g });
    page.el.append(pg.el);
  }

  /* ---------------- boot */
  await ctx.navigate((page) => { page.el.append(main, bar.el); return { onShow: renderInfo }; });
  renderInfo();
  // If radio is already playing, show that station.
  await switchSource(source, index);
  if (ours()) {
    const i = list.findIndex((s) => s.id === os.media.current.stationId);
    if (i >= 0 && i !== index) { index = i; buildDial(); }
  }
  if (!list.length && source.type !== 'near' && source.type !== 'fav') switchSource({ type: 'near' });

  return {
    onDestroy() { offs.forEach((f) => f()); clearTimeout(scrollT); },
  };
}
