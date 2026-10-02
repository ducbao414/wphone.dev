// Video (WP 8.1): library of videos on the phone with poster thumbnails, and a player with overlay controls.
import './style.css';
import { Upload, Maximize, Minimize, RotateCcw, RotateCw, Film } from 'lucide';

const ROLL = '/Pictures/Camera Roll';

export default async function launch(ctx) {
  const { os, storage, args } = ctx;
  const { el, I, iconSVG } = os.ui;
  let videos = [];
  let positions = await storage.get('positions', {});
  const listeners = new Set();
  const onLib = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  async function reload() {
    videos = (await os.fs.find('video/')).sort((a, b) => (b.created || b.modified) - (a.created || a.modified));
    listeners.forEach((fn) => fn());
  }
  const reloadSoon = os.util.debounce(reload, 300);
  const offFs = os.fs.on('change', ({ path }) => { if (/\.(mp4|m4v|webm|mov|mkv|ogv)$/i.test(path) || !/\.[a-z0-9]{2,4}$/i.test(path)) reloadSoon(); });

  /* ---------------- posters ---------------- */
  const jobs = new Map();
  let chain = Promise.resolve();
  function poster(m) {
    if (jobs.has(m.path)) return jobs.get(m.path);
    const p = (async () => {
      const t = await os.fs.thumb(m.path).catch(() => null);
      if (t) return t;
      // serialize frame grabs: decoding many videos at once is heavy on phones
      const run = chain.then(() => grab(m));
      chain = run.catch(() => {});
      return run;
    })();
    jobs.set(m.path, p);
    return p;
  }
  async function grab(m) {
    const url = URL.createObjectURL(await os.fs.read(m.path));
    const v = document.createElement('video');
    try {
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('decode')); setTimeout(() => rej(new Error('timeout')), 10000); });
      const dur = isFinite(v.duration) ? v.duration : 0;
      await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(dur / 3 || 0.1, 5); setTimeout(res, 3000); });
      const s = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(v.videoWidth * s)); c.height = Math.max(1, Math.round(v.videoHeight * s));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      if (dur && !m.duration) storage.update('durations', (d) => ({ ...d, [m.path]: dur }), {});
      if (!b) return null;
      await os.fs.setThumb(m.path, b);
      return os.fs.thumb(m.path);
    } catch { return null; } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
  }
  let durations = await storage.get('durations', {});
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) {
      io.unobserve(e.target);
      const n = e.target;
      poster(n._meta).then((u) => { if (u) { n.style.backgroundImage = `url("${u}")`; n.classList.add('loaded'); } });
    }
  }, { rootMargin: '200px' });

  /* ---------------- actions ---------------- */
  function importVideos() {
    const inp = el('input', { type: 'file', accept: 'video/*', multiple: true, style: { display: 'none' } });
    document.body.append(inp);
    inp.onchange = async () => {
      const files = [...inp.files];
      inp.remove();
      if (!files.length) return;
      os.toast(`Adding ${files.length} video${files.length > 1 ? 's' : ''}…`);
      await os.fs.importFiles(files, '/Videos');
      await reload();
      os.toast('Added to Videos');
    };
    inp.click();
    setTimeout(() => inp.remove(), 120000);
  }
  async function del(m) {
    if (!(await os.ui.confirm(`Delete "${m.name}" from your phone?`, 'delete', 'delete', 'cancel'))) return false;
    await os.fs.remove(m.path);
    delete positions[m.path]; storage.set('positions', positions);
    await reload();
    return true;
  }
  async function rename(m) {
    const ext = m.name.includes('.') ? m.name.slice(m.name.lastIndexOf('.')) : '';
    const n = (await os.ui.prompt('New name', m.name.slice(0, m.name.length - ext.length), 'rename'))?.trim();
    if (!n || /[/\\]/.test(n)) return;
    const target = os.path.join(m.parent, n + ext);
    if (target === m.path) return;
    if (await os.fs.exists(target)) return os.ui.alert('A file with that name already exists.');
    await os.fs.rename(m.path, n + ext);
    if (positions[m.path]) { positions[target] = positions[m.path]; delete positions[m.path]; storage.set('positions', positions); }
  }
  const menuFor = (m, anchor) => os.ui.contextMenu(anchor, [
    { label: 'play', onClick: () => ctx.navigate(playerPage, { path: m.path }) },
    { label: 'share', onClick: () => os.share({ path: m.path, title: m.name }) },
    { label: 'rename', onClick: () => rename(m) },
    { label: 'save to device', onClick: () => os.fs.download(m.path) },
    { label: 'delete', onClick: () => del(m) },
  ]);

  /* ---------------- library ---------------- */
  function card(m, list) {
    const th = el('div.video-thumb', { html: iconSVG(Film, { size: 30, stroke: 1.4 }) });
    th._meta = m;
    io.observe(th);
    const dur = m.duration || durations[m.path];
    const pos = positions[m.path];
    if (dur) th.append(el('span.video-dur', os.util.formatDuration(dur)));
    if (pos && dur) th.append(el('span.video-progress', el('i', { style: { width: Math.min(100, (pos / dur) * 100) + '%' } })));
    const c = el('div.video-card.tilt', th, el('div.video-name', m.name.replace(/\.[^.]+$/, '')), el('div.video-sub', `${os.util.formatRelative(m.created || m.modified)} · ${os.util.formatBytes(m.size)}`));
    c.addEventListener('click', () => ctx.navigate(playerPage, { path: m.path, list: list.map((x) => x.path) }));
    os.util.onLongPress(c, () => menuFor(m, c));
    return c;
  }

  function hubPage() {
    const views = {};
    const filters = {
      all: () => videos,
      'camera roll': () => videos.filter((m) => m.path.startsWith(ROLL + '/')),
      personal: () => videos.filter((m) => !m.path.startsWith(ROLL + '/')),
    };
    const render = (h, c) => {
      const list = filters[h]();
      if (!list.length) {
        c.replaceChildren(el('div.video-empty', os.ui.empty(h === 'camera roll' ? 'no camera videos yet' : 'no videos'),
          os.ui.desc(h === 'camera roll' ? 'Record a video with the Camera and it shows up here.' : 'Add videos from your device, or record one with the Camera.'),
          h === 'camera roll' ? os.ui.button('camera', () => os.launch('camera')) : os.ui.button('add videos', importVideos, { accent: true })));
        return;
      }
      c.replaceChildren(el('div.video-grid', list.map((m) => card(m, list))));
    };
    const pv = os.ui.pivot({ app: 'VIDEO', items: Object.keys(filters).map((h) => ({ header: h, render: (c) => { views[h] = c; render(h, c); } })) });
    const bar = os.ui.appBar({
      buttons: [
        { icon: Upload, label: 'add videos', onClick: importVideos },
        { icon: I.camera, label: 'record', onClick: () => os.launch('camera') },
      ],
      menu: [{ label: 'refresh', onClick: reload }],
    });
    const off = onLib(() => { for (const [h, c] of Object.entries(views)) render(h, c); });
    return { el: el('div.video-hub', pv.el, bar.el), onDestroy: off };
  }

  /* ---------------- player ---------------- */
  async function playerPage(page) {
    let path = page.params.path;
    const list = page.params.list || [path];
    const v = el('video.video-el', { playsInline: true, preload: 'auto' });
    v.setAttribute('playsinline', '');
    const title = el('div.video-title');
    const playBtn = el('button.video-big', { 'aria-label': 'play/pause', onclick: (e) => { e.stopPropagation(); toggle(); } });
    const back10 = el('button.video-skip', { 'aria-label': 'back 10 seconds', onclick: (e) => { e.stopPropagation(); v.currentTime = Math.max(0, v.currentTime - 10); poke(); }, html: iconSVG(RotateCcw, { size: 26 }) + '<b>10</b>' });
    const fwd30 = el('button.video-skip', { 'aria-label': 'forward 30 seconds', onclick: (e) => { e.stopPropagation(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 30); poke(); }, html: iconSVG(RotateCw, { size: 26 }) + '<b>30</b>' });
    const fill = el('div.video-fill'), buf = el('div.video-buf'), knob = el('div.video-knob');
    const seek = el('div.video-seek', el('div.video-track', buf, fill, knob));
    const tCur = el('span', '0:00'), tDur = el('span', '0:00');
    const fsBtn = el('button.video-fs', { 'aria-label': 'full screen', onclick: (e) => { e.stopPropagation(); toggleFs(); } });
    const prevBtn = el('button.video-nav', { 'aria-label': 'previous', onclick: (e) => { e.stopPropagation(); step(-1); }, html: iconSVG(I.prev, { size: 22 }) });
    const nextBtn = el('button.video-nav', { 'aria-label': 'next', onclick: (e) => { e.stopPropagation(); step(1); }, html: iconSVG(I.next, { size: 22 }) });
    const err = el('div.video-error');
    const overlay = el('div.video-overlay',
      el('div.video-top', title),
      el('div.video-center', back10, playBtn, fwd30),
      el('div.video-bottom', seek, el('div.video-row', el('div.video-times', tCur, ' / ', tDur), el('div.video-actions', prevBtn, nextBtn, fsBtn))));
    const root = el('div.video-player', v, overlay, err);
    let url = null, hideT = null, lastSave = 0, dragging = false;

    const icons = () => {
      playBtn.innerHTML = iconSVG(v.paused ? I.play : I.pause, { size: 34, stroke: 2 });
      const isFs = document.fullscreenElement === root || document.webkitFullscreenElement === root;
      fsBtn.innerHTML = iconSVG(isFs ? Minimize : Maximize, { size: 22 });
      const i = list.indexOf(path);
      prevBtn.hidden = nextBtn.hidden = list.length < 2;
      prevBtn.disabled = i <= 0; nextBtn.disabled = i >= list.length - 1;
    };
    const poke = () => {
      root.classList.remove('hide-ui');
      clearTimeout(hideT);
      if (!v.paused) hideT = setTimeout(() => root.classList.add('hide-ui'), 3000);
    };
    const toggle = () => { v.paused ? v.play().catch(() => {}) : v.pause(); };
    async function load(p) {
      path = p;
      err.hidden = true;
      const m = await os.fs.stat(p);
      if (!m) { err.hidden = false; err.textContent = 'This video no longer exists.'; return; }
      title.textContent = m.name.replace(/\.[^.]+$/, '');
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(await os.fs.read(p));
      v.src = url;
      const resume = positions[p];
      v.addEventListener('loadedmetadata', () => {
        if (resume && isFinite(v.duration) && resume < v.duration - 5) v.currentTime = resume;
        if (isFinite(v.duration) && !durations[p]) { durations[p] = v.duration; storage.set('durations', durations); }
      }, { once: true });
      if (os.media.playing) os.media.pause();
      v.play().catch(() => {});
      icons(); poke();
    }
    function step(d) {
      const i = list.indexOf(path) + d;
      if (i >= 0 && i < list.length) { savePos(true); load(list[i]); }
    }
    function savePos(force) {
      if (!path || !isFinite(v.duration)) return;
      const now = Date.now();
      if (!force && now - lastSave < 4000) return;
      lastSave = now;
      if (v.currentTime > 5 && v.currentTime < v.duration - 5) positions[path] = v.currentTime; else delete positions[path];
      storage.set('positions', positions);
    }
    async function toggleFs() {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else if (root.requestFullscreen) await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari
        else ctx.setFullscreen(true);
      } catch { if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); }
      setTimeout(icons, 200);
    }
    const onFsChange = () => icons();
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    const time = () => {
      if (dragging) return;
      const d = v.duration;
      const f = isFinite(d) && d ? v.currentTime / d : 0;
      fill.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%';
      tCur.textContent = os.util.formatDuration(v.currentTime);
      tDur.textContent = os.util.formatDuration(d);
      if (v.buffered.length && isFinite(d) && d) buf.style.width = (v.buffered.end(v.buffered.length - 1) / d) * 100 + '%';
      savePos();
    };
    v.addEventListener('timeupdate', time);
    v.addEventListener('durationchange', time);
    v.addEventListener('play', () => { icons(); poke(); });
    v.addEventListener('pause', () => { icons(); poke(); savePos(true); });
    v.addEventListener('ended', () => { delete positions[path]; storage.set('positions', positions); if (list.indexOf(path) < list.length - 1) step(1); else { icons(); poke(); } });
    v.addEventListener('error', () => { err.hidden = false; err.textContent = 'This video can’t be played on this device (unsupported format).'; });

    const frac = (e) => { const r = seek.getBoundingClientRect(); return os.util.clamp((e.clientX - r.left) / r.width, 0, 1); };
    seek.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!isFinite(v.duration)) return;
      dragging = true; seek.setPointerCapture(e.pointerId);
      const upd = (ev) => { const f = frac(ev); fill.style.width = knob.style.left = f * 100 + '%'; tCur.textContent = os.util.formatDuration(f * v.duration); poke(); };
      upd(e);
      const up = (ev) => { dragging = false; v.currentTime = frac(ev) * v.duration; seek.removeEventListener('pointermove', upd); seek.removeEventListener('pointerup', up); seek.removeEventListener('pointercancel', up); };
      seek.addEventListener('pointermove', upd); seek.addEventListener('pointerup', up); seek.addEventListener('pointercancel', up);
    });
    seek.addEventListener('click', (e) => e.stopPropagation());
    // tap: toggle UI; double tap on left/right third: skip
    let lastTap = 0, tapT = null;
    root.addEventListener('click', (e) => {
      if (e.target.closest('button, .wp-appbar')) return;
      const now = Date.now();
      const r = root.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      if (now - lastTap < 280) {
        clearTimeout(tapT); lastTap = 0;
        if (x < 0.33) v.currentTime = Math.max(0, v.currentTime - 10);
        else if (x > 0.67) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
        else toggleFs();
        poke();
        return;
      }
      lastTap = now;
      tapT = setTimeout(() => { if (root.classList.contains('hide-ui')) poke(); else if (!v.paused) { root.classList.add('hide-ui'); clearTimeout(hideT); } }, 280);
    });
    root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') poke(); });
    const onKey = (e) => {
      if (!root.isConnected || root.closest('.app-frame:not(.active)') || root.closest('[hidden]')) return;
      if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') v.currentTime = Math.max(0, v.currentTime - 5);
      else if (e.key === 'ArrowRight') v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      else if (e.key === 'f') toggleFs();
      else return;
      poke();
    };
    window.addEventListener('keydown', onKey);

    const bar = os.ui.appBar({
      minimized: true,
      menu: [
        { label: 'share', onClick: () => os.share({ path, title: os.path.basename(path) }) },
        { label: 'rename', onClick: async () => { const m = await os.fs.stat(path); if (m) await rename(m); } },
        { label: 'save to device', onClick: () => os.fs.download(path) },
        { label: 'delete', onClick: async () => { const m = await os.fs.stat(path); if (m && (await del(m))) ctx.back(); } },
      ],
    });
    overlay.append(bar.el);
    ctx.setFullscreen(true);
    await load(path);
    return {
      el: root,
      onHide() { v.pause(); savePos(true); },
      onShow() { ctx.setFullscreen(true); },
      onBack() { if (document.fullscreenElement) { toggleFs(); return true; } },
      onDestroy() {
        savePos(true);
        v.pause(); v.removeAttribute('src'); v.load();
        if (url) URL.revokeObjectURL(url);
        clearTimeout(hideT); clearTimeout(tapT);
        window.removeEventListener('keydown', onKey);
        document.removeEventListener('fullscreenchange', onFsChange);
        document.removeEventListener('webkitfullscreenchange', onFsChange);
        if (document.fullscreenElement === root) document.exitFullscreen?.();
        ctx.setFullscreen(false);
        reloadSoon();
      },
    };
  }

  await reload();
  await ctx.navigate(hubPage);
  const openArgs = (a) => {
    const p = a?.file || a?.share?.path;
    if (p) {
      const dir = p.slice(0, p.lastIndexOf('/'));
      const sib = videos.filter((m) => m.parent === dir).map((m) => m.path);
      ctx.navigate(playerPage, { path: p, list: sib.includes(p) ? sib : [p] });
    }
  };
  openArgs(args);
  ctx.on('args', openArgs);

  const onSuspend = () => ctx.root.querySelectorAll('video').forEach((x) => x.pause());
  return { onSuspend, onDestroy() { offFs(); io.disconnect(); } };
}
