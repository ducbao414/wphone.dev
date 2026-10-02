// Podcasts — search (iTunes), subscribe, stream episodes through the global media player, resume where you left off.
import './style.css';
import { epKey, parseDuration } from './shared.js';
import { Podcast, CircleCheck, Circle } from 'lucide';

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I } = os.ui;
  const { formatDuration } = os.util;
  const offs = [];

  let subs = await storage.get('subs', []);
  const isSub = (p) => subs.some((s) => s.feedUrl === p.feedUrl);
  const slimPod = (p) => ({ id: p.id, title: p.title, author: p.author, artwork: p.artwork, feedUrl: p.feedUrl, genre: p.genre });
  const slimEp = (e) => ({ title: e.title, enclosure: e.enclosure, date: e.date, duration: e.duration, description: (e.description || '').slice(0, 4000), link: e.link, image: e.image });
  async function toggleSub(p) {
    if (isSub(p)) { subs = subs.filter((s) => s.feedUrl !== p.feedUrl); os.toast(`Unsubscribed from ${p.title}`); }
    else { subs = [slimPod(p), ...subs]; os.toast(`Subscribed to ${p.title}`); }
    await storage.set('subs', subs);
    renderCollection?.();
  }

  const getState = (url) => storage.get(epKey(url), null);
  const isCurrent = (ep) => os.media.current?.appId === 'podcasts' && os.media.current.src === ep.enclosure;
  const fmtDate = (d) => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString([], { month: 'short', day: 'numeric', year: x.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).toLowerCase(); };
  const fmtLen = (s) => { s = Math.round(s); if (!s) return ''; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} hr ${m} min` : `${Math.max(1, m)} min`; };
  const stripHtml = (s) => { const d = document.createElement('div'); d.innerHTML = String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n'); return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };

  function statusText(ep, st) {
    const total = (st && st.d) || parseDuration(ep.duration);
    if (st?.played) return 'played';
    if (st && st.t > 5 && total) return `${fmtLen(total - st.t)} left`;
    return fmtLen(total);
  }

  async function playEpisode(ep, pod) {
    if (!ep.enclosure) { os.toast('This episode has no audio'); return; }
    if (isCurrent(ep)) { os.media.toggle(); return; }
    const key = epKey(ep.enclosure);
    const st = await getState(ep.enclosure);
    const resume = st && !st.played && st.t > 5 ? st.t : 0;
    const audio = os.media.audio;
    if (resume) {
      const on = () => { audio.removeEventListener('loadedmetadata', on); if (os.media.current?.src === ep.enclosure) os.media.seek(resume); };
      audio.addEventListener('loadedmetadata', on);
    }
    const item = { src: ep.enclosure, title: ep.title, artist: pod.title, album: pod.title, art: ep.image || pod.artwork, appId: 'podcasts', ep: slimEp(ep), pod: slimPod(pod) };
    await storage.set(key, { ...(st || {}), url: ep.enclosure, title: ep.title, podcast: pod.title, art: item.art, ep: item.ep, pod: item.pod, t: resume, d: st?.d || parseDuration(ep.duration), played: false, updated: Date.now() });
    os.media.playOne(item);
  }

  async function setPlayed(ep, pod, played) {
    await storage.update(epKey(ep.enclosure), (v) => ({ ...(v || {}), url: ep.enclosure, title: ep.title, podcast: pod.title, art: ep.image || pod.artwork, ep: slimEp(ep), pod: slimPod(pod), played, t: played ? (v?.t || 0) : 0, updated: Date.now() }), null);
  }

  /* ---------------- now playing mini bar */
  function miniBar() {
    const art = el('div.podcasts-mini-art');
    const title = el('div.podcasts-mini-title');
    const sub = el('div.podcasts-mini-sub');
    const btn = el('button.podcasts-mini-btn', { onclick: (e) => { e.stopPropagation(); os.media.toggle(); } });
    const prog = el('div.podcasts-mini-prog');
    const n = el('div.podcasts-mini.tilt', { onclick: () => { const c = os.media.current; if (c?.ep && c?.pod) ctx.navigate(episodePage, { ep: c.ep, pod: c.pod }); } },
      prog, art, el('div.podcasts-mini-text', title, sub), btn);
    const draw = () => {
      const c = os.media.current;
      const show = c && c.appId === 'podcasts';
      n.hidden = !show;
      if (!show) return;
      art.style.backgroundImage = c.art ? `url("${c.art}")` : '';
      title.textContent = c.title || '';
      sub.textContent = c.artist || '';
      btn.innerHTML = os.ui.iconSVG(os.media.playing ? I.pause : I.play, { size: 22, stroke: 2 });
    };
    const time = (t, d) => { if (os.media.current?.appId === 'podcasts') prog.style.width = (d ? (t / d) * 100 : 0) + '%'; };
    offs.push(os.media.on('change', draw), os.media.on('time', time));
    draw();
    return n;
  }

  /* ---------------- main pivot */
  var renderCollection = null, renderProgress = null; // var: avoid TDZ (used by callbacks defined above)
  function mainPage(page) {
    const p = os.ui.pivot({
      app: 'PODCASTS',
      items: [
        { header: 'collection', render: (c) => { renderCollection = () => drawCollection(c, p); renderCollection(); } },
        { header: 'in progress', render: (c) => { renderProgress = () => drawProgress(c); renderProgress(); } },
        { header: 'discover', render: (c) => drawDiscover(c) },
      ],
    });
    p.onChange((i) => { if (i === 0) renderCollection?.(); if (i === 1) renderProgress?.(); });
    const bar = os.ui.appBar({
      buttons: [
        { icon: I.search, label: 'search', onClick: () => { p.select(2); setTimeout(() => p.items[2].container.querySelector('input')?.focus(), 350); } },
        { icon: I.refresh, label: 'refresh', onClick: () => { renderCollection?.(); renderProgress?.(); } },
      ],
      menu: [{ label: 'add podcast by feed url', onClick: addByUrl }],
    });
    page.el.append(p.el, miniBar(), bar.el);
    page.el.classList.add('podcasts-has-mini');
    return { onShow: () => { if (p.index === 0) renderCollection?.(); if (p.index === 1) renderProgress?.(); } };
  }

  async function addByUrl() {
    const url = await os.ui.prompt('Paste the RSS feed address of a podcast.', 'https://', 'add podcast', { type: 'url' });
    if (!url || !/^https?:\/\/.+/.test(url.trim())) return;
    try {
      const f = await os.net.rss(url.trim());
      const pod = { id: url.trim(), title: f.title || url, author: '', artwork: f.image || '', feedUrl: url.trim() };
      ctx.navigate(podcastPage, { pod });
    } catch { os.ui.alert('That doesn’t look like a podcast feed.', 'add podcast'); }
  }

  function podTile(pod) {
    const img = el('div.podcasts-art');
    if (pod.artwork) img.style.backgroundImage = `url("${pod.artwork}")`;
    else img.innerHTML = os.ui.iconSVG(Podcast, { size: 48, stroke: 1.4 });
    const t = el('div.podcasts-tile.tilt', { onclick: () => ctx.navigate(podcastPage, { pod }) }, img, el('div.podcasts-tile-title', pod.title), el('div.podcasts-tile-sub', pod.author || ''));
    os.util.onLongPress(t, () => os.ui.contextMenu(t, [
      { label: isSub(pod) ? 'unsubscribe' : 'subscribe', onClick: () => toggleSub(pod) },
      { label: 'pin to start', onClick: () => ctx.pinTile({ key: 'podcasts:' + (pod.id || pod.feedUrl), title: pod.title, args: { pod: slimPod(pod) }, size: 'medium' }) },
    ]));
    return t;
  }

  function drawCollection(c, p) {
    if (!subs.length) {
      c.replaceChildren(os.ui.empty('you haven’t subscribed to any podcasts yet.'), os.ui.desc('Find shows in discover, then tap subscribe.'),
        os.ui.button('discover podcasts', () => p.select(2), { accent: true }));
      return;
    }
    c.replaceChildren(el('div.podcasts-grid', subs.map(podTile)));
  }

  async function drawProgress(c) {
    const keys = (await storage.keys()).filter((k) => k.startsWith('ep:'));
    const all = (await Promise.all(keys.map((k) => storage.get(k)))).filter((v) => v && v.ep && v.pod && !v.played && v.t > 5).sort((a, b) => b.updated - a.updated).slice(0, 50);
    if (!all.length) { c.replaceChildren(os.ui.empty('nothing in progress. episodes you start will show up here.')); return; }
    c.replaceChildren(episodeList(all.map((v) => ({ ep: v.ep, pod: v.pod, st: v })), { showPod: true }));
  }

  function drawDiscover(c) {
    const results = el('div');
    const run = async (q) => {
      inp.blur?.();
      results.replaceChildren(os.ui.loadingDots({ inline: true }));
      try {
        const r = (await os.net.podcasts(q.trim())).filter((x) => x.feedUrl);
        results.replaceChildren(q.trim() ? os.ui.header(`results for “${q.trim()}”`) : os.ui.header('popular'),
          r.length ? os.ui.list(r, {
            render: (pod) => os.ui.listItem({ title: pod.title, subtitle: [pod.author, pod.genre].filter(Boolean).join(' · '), image: pod.artwork, right: isSub(pod) ? el('span.podcasts-subbed', { html: os.ui.iconSVG(I.check, { size: 18, stroke: 2.5 }) }) : null }),
            onClick: (pod) => ctx.navigate(podcastPage, { pod }),
            onHold: (pod, row) => os.ui.contextMenu(row, [{ label: isSub(pod) ? 'unsubscribe' : 'subscribe', onClick: () => toggleSub(pod) }]),
          }) : os.ui.empty('no podcasts found'));
      } catch {
        results.replaceChildren(os.ui.empty('couldn’t search right now — check your connection'), os.ui.button('try again', () => run(q)));
      }
    };
    const inp = os.ui.textbox({ placeholder: 'search podcasts', type: 'search', onEnter: run });
    c.append(el('div.podcasts-searchrow', inp, os.ui.button('', () => run(inp.value), { icon: I.search, cls: 'podcasts-searchbtn' })), results);
    run('');
  }

  /* ---------------- episode list */
  function episodeList(rows, { showPod = false } = {}) {
    const root = el('div.podcasts-eps');
    const draw = (row) => {
      const { ep, pod, st } = row;
      const playBtn = el('button.podcasts-ep-play', { 'aria-label': 'play', onclick: (e) => { e.stopPropagation(); playEpisode(ep, pod).then(() => setTimeout(refreshRow, 300)); } });
      const meta = el('div.podcasts-ep-meta');
      const prog = el('div.podcasts-ep-prog');
      const n = el('div.podcasts-ep.tilt', { onclick: () => ctx.navigate(episodePage, { ep, pod }) },
        el('div.podcasts-ep-text',
          showPod ? el('div.podcasts-ep-pod', pod.title) : null,
          el('div.podcasts-ep-title', ep.title), meta, prog),
        playBtn);
      let state = st;
      const paint = () => {
        const cur = isCurrent(ep);
        n.classList.toggle('current', cur);
        n.classList.toggle('played', !!state?.played);
        playBtn.innerHTML = os.ui.iconSVG(cur && os.media.playing ? I.pause : I.play, { size: 18, stroke: 2 });
        meta.textContent = [fmtDate(ep.date), statusText(ep, state)].filter(Boolean).join(' · ');
        const total = state?.d || parseDuration(ep.duration);
        prog.hidden = !(state && state.t > 5 && total && !state.played);
        if (!prog.hidden) prog.style.setProperty('--p', Math.min(100, (state.t / total) * 100) + '%');
      };
      const refreshRow = async () => { state = await getState(ep.enclosure); paint(); };
      n._paint = paint; n._refresh = refreshRow;
      os.util.onLongPress(n, () => os.ui.contextMenu(n, [
        { label: state?.played ? 'mark as unplayed' : 'mark as played', onClick: async () => { await setPlayed(ep, pod, !state?.played); refreshRow(); } },
        { label: 'play', onClick: () => playEpisode(ep, pod) },
        { label: 'share', onClick: () => os.share({ title: ep.title, url: ep.link || ep.enclosure }) },
      ]));
      if (st === undefined) refreshRow(); else paint();
      return n;
    };
    const PAGE = 40;
    let shown = 0;
    const more = el('div');
    const showMore = () => {
      const next = rows.slice(shown, shown + PAGE);
      shown += next.length;
      next.forEach((r) => more.before(draw(r)));
      more.replaceChildren(shown < rows.length ? os.ui.button(`show more (${rows.length - shown})`, showMore) : '');
    };
    root.append(more);
    showMore();
    const repaint = () => root.querySelectorAll('.podcasts-ep').forEach((n) => n._paint?.());
    const off = os.media.on('change', () => { if (root.isConnected) repaint(); });
    offs.push(off);
    root.refresh = () => root.querySelectorAll('.podcasts-ep').forEach((n) => n._refresh?.());
    return root;
  }

  /* ---------------- podcast page */
  function podcastPage(page) {
    let pod = page.params.pod;
    const pg = os.ui.page({ app: 'PODCASTS', cls: 'podcasts-podpage' });
    const art = el('div.podcasts-hero-art');
    if (pod.artwork) art.style.backgroundImage = `url("${pod.artwork}")`;
    const subBtn = os.ui.button('', () => { toggleSub(pod); paintSub(); }, { accent: false, cls: 'podcasts-subbtn' });
    const paintSub = () => { subBtn.textContent = isSub(pod) ? 'unsubscribe' : 'subscribe'; subBtn.classList.toggle('accent', !isSub(pod)); bar.setButtons(buttons()); };
    const hero = el('div.podcasts-hero', art, el('div.podcasts-hero-text', el('div.podcasts-hero-title', pod.title), el('div.podcasts-hero-sub', pod.author || ''), subBtn));
    const body = el('div', os.ui.loadingDots({ inline: true }));
    const descEl = el('div.podcasts-pod-desc');
    pg.content.append(hero, descEl, os.ui.header('episodes'), body);
    let list = null, feed = null;
    const buttons = () => [
      { icon: isSub(pod) ? I.close : I.add, label: isSub(pod) ? 'unsubscribe' : 'subscribe', onClick: () => { toggleSub(pod); paintSub(); } },
      { icon: I.refresh, label: 'refresh', onClick: () => load(true) },
      { icon: I.pin, label: 'pin', onClick: () => { ctx.pinTile({ key: 'podcasts:' + (pod.id || pod.feedUrl), title: pod.title, args: { pod: slimPod(pod) }, size: 'medium' }); os.toast('Pinned to Start'); } },
    ];
    const bar = os.ui.appBar({ buttons: buttons(), menu: [{ label: 'share', onClick: () => os.share({ title: pod.title, url: feed?.link || pod.feedUrl }) }] });
    paintSub();
    async function load() {
      body.replaceChildren(os.ui.loadingDots({ inline: true }));
      try {
        feed = await os.net.rss(pod.feedUrl);
        if (!pod.artwork && feed.image) { pod = { ...pod, artwork: feed.image }; art.style.backgroundImage = `url("${feed.image}")`; }
        if (feed.description) descEl.textContent = stripHtml(feed.description).slice(0, 400);
        const eps = (feed.items || []).filter((e) => e.enclosure);
        list = eps.length ? episodeList(eps.map((ep) => ({ ep, pod, st: undefined }))) : os.ui.empty('no episodes available');
        body.replaceChildren(list);
      } catch {
        body.replaceChildren(os.ui.empty('couldn’t load episodes — check your connection'), os.ui.button('try again', () => load()));
      }
    }
    load();
    page.el.append(pg.el, bar.el);
    return { onShow: () => list?.refresh?.() };
  }

  /* ---------------- episode page */
  function episodePage(page) {
    const { ep, pod } = page.params;
    const pg = os.ui.page({ app: pod.title, cls: 'podcasts-eppage' });
    const playBig = el('button.podcasts-bigplay', { onclick: () => playEpisode(ep, pod) });
    const metaEl = el('div.podcasts-epd-meta');
    const slider = el('input.wp-slider.podcasts-seek', { type: 'range', min: 0, max: 100, step: 1, value: 0 });
    const tPos = el('span'), tLeft = el('span');
    let state = null;
    const total = () => (isCurrent(ep) && isFinite(os.media.audio.duration) ? os.media.audio.duration : state?.d || parseDuration(ep.duration));
    const paint = () => {
      const cur = isCurrent(ep);
      playBig.innerHTML = os.ui.iconSVG(cur && os.media.playing ? I.pause : I.play, { size: 30, stroke: 2 }) + `<span>${cur && os.media.playing ? 'pause' : state?.t > 5 && !state?.played ? 'resume' : 'play'}</span>`;
      const T = total();
      const t = cur ? os.media.audio.currentTime : state?.played ? 0 : state?.t || 0;
      metaEl.textContent = [fmtDate(ep.date), fmtLen(T), state?.played ? 'played' : ''].filter(Boolean).join(' · ');
      slider.max = Math.max(1, Math.round(T || 1));
      if (!dragging) { slider.value = t; slider.style.setProperty('--p', (T ? (t / T) * 100 : 0) + '%'); }
      tPos.textContent = formatDuration(t);
      tLeft.textContent = T ? '-' + formatDuration(T - t) : '';
      slider.disabled = !cur;
      bar.setButtons(buttons());
    };
    let dragging = false;
    slider.addEventListener('input', () => { dragging = true; slider.style.setProperty('--p', (slider.value / slider.max) * 100 + '%'); tPos.textContent = formatDuration(+slider.value); });
    slider.addEventListener('change', () => { dragging = false; if (isCurrent(ep)) os.media.seek(+slider.value); });
    const skip = (d) => { if (isCurrent(ep)) os.media.seek(Math.max(0, os.media.audio.currentTime + d)); };
    const buttons = () => [
      { icon: I.prev, label: 'back 10s', onClick: () => skip(-10), disabled: !isCurrent(ep) },
      { icon: isCurrent(ep) && os.media.playing ? I.pause : I.play, label: isCurrent(ep) && os.media.playing ? 'pause' : 'play', onClick: () => playEpisode(ep, pod) },
      { icon: I.next, label: 'skip 30s', onClick: () => skip(30), disabled: !isCurrent(ep) },
      { icon: state?.played ? Circle : CircleCheck, label: state?.played ? 'unplayed' : 'played', onClick: async () => { await setPlayed(ep, pod, !state?.played); state = await getState(ep.enclosure); paint(); } },
    ];
    const bar = os.ui.appBar({ buttons: [], menu: [
      { label: 'share', onClick: () => os.share({ title: ep.title, url: ep.link || ep.enclosure }) },
      { label: 'go to podcast', onClick: () => ctx.navigate(podcastPage, { pod }) },
      ...(ep.link ? [{ label: 'open website', onClick: () => os.launch('ie', { url: ep.link }) }] : []),
    ] });
    const art = el('div.podcasts-epd-art');
    if (ep.image || pod.artwork) art.style.backgroundImage = `url("${ep.image || pod.artwork}")`;
    pg.content.append(
      el('div.podcasts-epd-head', art, el('div.podcasts-epd-headtext', el('div.podcasts-epd-title', ep.title), metaEl)),
      el('div.podcasts-epd-player', playBig, el('div.podcasts-epd-seek', slider, el('div.podcasts-epd-times', tPos, tLeft))),
      el('div.podcasts-epd-desc.selectable', stripHtml(ep.description) || 'no description'));
    const offT = os.media.on('time', () => { if (isCurrent(ep)) paint(); });
    const offC = os.media.on('change', paint);
    getState(ep.enclosure).then((s) => { state = s; paint(); });
    paint();
    page.el.append(pg.el, bar.el);
    return { onDestroy: () => { offT(); offC(); }, onShow: async () => { state = await getState(ep.enclosure); paint(); } };
  }

  /* ---------------- boot */
  await ctx.navigate(mainPage);
  const handleArgs = (a) => { if (a?.pod?.feedUrl) ctx.navigate(podcastPage, { pod: a.pod }); };
  handleArgs(ctx.args);
  offs.push(ctx.on('args', handleArgs));
  return { onDestroy: () => offs.forEach((f) => f()) };
}
