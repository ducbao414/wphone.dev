// Full-screen photo viewer with swipe, pinch/double-tap zoom, app bar actions; and slideshow.
import { Star, Lock, LayoutGrid, Info, Download, Presentation, Pencil } from 'lucide';
import { isVideo, takenOf } from './lib.js';
import { editorPage } from './editor.js';

/** Manages object URLs for full-size images in a small window around the current index. */
function urlCache(os) {
  const m = new Map();
  return {
    async get(path) {
      if (m.has(path)) return m.get(path);
      const p = os.fs.read(path).then((b) => URL.createObjectURL(b)).catch(() => null);
      m.set(path, p);
      return p;
    },
    keep(paths) {
      for (const [k, v] of m) if (!paths.includes(k)) { v.then((u) => u && URL.revokeObjectURL(u)); m.delete(k); }
    },
    drop(path) { const v = m.get(path); if (v) { v.then((u) => u && URL.revokeObjectURL(u)); m.delete(path); } },
    clear() { this.keep([]); },
  };
}

export function viewerPage(page) {
  const { os, ctx } = page;
  const { shared } = page.params;
  const { el, I } = os.ui;
  let list = page.params.list.slice();
  let index = page.params.index || 0;
  const urls = urlCache(os);

  const track = el('div.photos-track');
  const caption = el('div.photos-caption');
  const root = el('div.photos-viewer', track, caption);
  let chrome = true;
  const slides = [-1, 0, 1].map((off) => {
    const s = el('div.photos-slide', { style: { transform: `translateX(${off * 100}%)` } });
    track.append(s);
    return { el: s, off, path: null, img: null };
  });

  /* zoom state of the current slide */
  let z = { s: 1, x: 0, y: 0 };
  const cur = () => slides.find((s) => s.off === 0);
  const applyZoom = (anim) => {
    const img = cur().img;
    if (!img) return;
    img.style.transition = anim ? 'transform .25s var(--ease-out)' : 'none';
    img.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    root.classList.toggle('zoomed', z.s > 1.01);
  };
  const clampZoom = () => {
    const img = cur().img, r = root.getBoundingClientRect();
    if (!img || !img.naturalWidth) { z = { s: 1, x: 0, y: 0 }; return; }
    z.s = os.util.clamp(z.s, 1, 6);
    const fit = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * fit * z.s, h = img.naturalHeight * fit * z.s;
    const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
    z.x = os.util.clamp(z.x, -mx, mx); z.y = os.util.clamp(z.y, -my, my);
  };

  async function fill(slide, i) {
    const m = list[i];
    slide.path = m?.path || null;
    slide.img = null;
    slide.el.replaceChildren();
    if (!m) return;
    if (isVideo(m)) {
      const v = el('video.photos-video', { controls: true, playsInline: true, preload: 'metadata' });
      v.setAttribute('playsinline', '');
      slide.el.append(v);
      const u = await urls.get(m.path);
      if (slide.path === m.path && u) v.src = u;
      return;
    }
    const img = el('img.photos-img', { alt: m.name, draggable: false });
    slide.img = img;
    slide.el.append(img);
    // show thumbnail instantly, then swap in the full image
    const t = await os.fs.thumb(m.path).catch(() => null);
    if (slide.path === m.path && t && !img.src) img.src = t;
    const u = await urls.get(m.path);
    if (slide.path === m.path && u) {
      const full = new Image();
      full.src = u;
      full.decode().catch(() => {}).finally(() => { if (slide.path === m.path) img.src = u; });
    }
  }

  function render() {
    if (!list.length) { ctx.back(); return; }
    index = os.util.clamp(index, 0, list.length - 1);
    for (const s of slides) {
      s.el.style.transition = 'none';
      s.el.style.transform = `translateX(${s.off * 100}%)`;
      s.el.querySelectorAll('video').forEach((v) => v.pause());
      const i = index + s.off;
      if (s.path !== (list[i]?.path || null)) fill(s, i);
    }
    urls.keep([index - 1, index, index + 1].map((i) => list[i]?.path).filter(Boolean));
    z = { s: 1, x: 0, y: 0 };
    slides.forEach((s) => s.img && (s.img.style.transform = ''));
    root.classList.remove('zoomed');
    const m = list[index];
    const d = new Date(takenOf(m));
    caption.replaceChildren(el('div.photos-caption-date', d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase()),
      el('div.photos-caption-sub', `${os.util.formatTime(d)} · ${index + 1} of ${list.length}`));
    setBar();
  }

  let animating = false;
  function go(dir) {
    if (animating) return;
    const ni = index + dir;
    if (ni < 0 || ni >= list.length) { track.style.transition = 'transform .2s'; track.style.transform = ''; return; }
    track.style.transition = 'transform .22s var(--ease-out)';
    track.style.transform = `translateX(${-dir * 100}%)`;
    animating = true;
    setTimeout(() => {
      animating = false;
      track.style.transition = 'none';
      track.style.transform = '';
      for (const s of slides) { s.off -= dir; if (s.off < -1) s.off = 1; if (s.off > 1) s.off = -1; }
      // the slide that wrapped around needs new content
      index = ni;
      for (const s of slides) if (Math.abs(s.off) === 1) s.path = s.path === list[index + s.off]?.path ? s.path : '__stale';
      render();
    }, 220);
  }

  /* ---------------- gestures ---------------- */
  const pts = new Map();
  let g = null, lastTap = 0, tapTimer = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('video, .wp-appbar')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.setPointerCapture?.(e.pointerId);
    if (pts.size === 1) g = { type: 'pending', x0: e.clientX, y0: e.clientY, zx: z.x, zy: z.y, t: Date.now() };
    else if (pts.size === 2 && cur().img) {
      const [a, b] = [...pts.values()];
      const r = root.getBoundingClientRect();
      g = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: z.s, x0: z.x, y0: z.y, cx: (a.x + b.x) / 2 - r.left - r.width / 2, cy: (a.y + b.y) / 2 - r.top - r.height / 2 };
      track.style.transform = '';
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.type === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const ns = os.util.clamp(g.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0), 0.8, 6);
      const k = ns / g.s0;
      z.s = ns; z.x = g.cx - (g.cx - g.x0) * k; z.y = g.cy - (g.cy - g.y0) * k;
      applyZoom(false);
      return;
    }
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (g.type === 'pending' && Math.hypot(dx, dy) > 8) g.type = z.s > 1.01 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'vswipe';
    if (g.type === 'pan') { z.x = g.zx + dx; z.y = g.zy + dy; clampZoom(); applyZoom(false); }
    else if (g.type === 'swipe') { track.style.transition = 'none'; track.style.transform = `translateX(${dx}px)`; }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!g) return;
    if (g.type === 'pinch') {
      if (pts.size === 0) { if (z.s < 1.05) z = { s: 1, x: 0, y: 0 }; clampZoom(); applyZoom(true); g = null; }
      else { const [p] = [...pts.values()]; g = { type: 'pan', x0: p.x, y0: p.y, zx: z.x, zy: z.y }; }
      return;
    }
    const dx = e.clientX - g.x0;
    if (g.type === 'swipe') {
      const w = root.clientWidth;
      if (Math.abs(dx) > w * 0.18 || (Math.abs(dx) > 40 && Date.now() - g.t < 250)) go(dx < 0 ? 1 : -1);
      else { track.style.transition = 'transform .2s var(--ease-out)'; track.style.transform = ''; }
    } else if (g.type === 'vswipe') {
      if (e.clientY - g.y0 > 120 && Date.now() - g.t < 600) ctx.back();
    } else if (g.type === 'pending' && e.type === 'pointerup') {
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapTimer); lastTap = 0;
        if (z.s > 1.01) z = { s: 1, x: 0, y: 0 };
        else if (cur().img) {
          const r = root.getBoundingClientRect();
          const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
          z = { s: 2.5, x: -cx * 1.5, y: -cy * 1.5 };
          clampZoom();
        }
        applyZoom(true);
      } else {
        lastTap = now;
        tapTimer = setTimeout(() => { chrome = !chrome; root.classList.toggle('no-chrome', !chrome); }, 300);
      }
    }
    g = null;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (e) => {
    if (!cur().img) return;
    e.preventDefault();
    z.s = os.util.clamp(z.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 6);
    if (z.s <= 1.01) z = { s: 1, x: 0, y: 0 };
    clampZoom(); applyZoom(true);
  }, { passive: false });
  const onKey = (e) => {
    if (!root.isConnected || root.closest('[hidden]') || root.closest('.app-frame:not(.active)')) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };
  window.addEventListener('keydown', onKey);

  /* ---------------- app bar ---------------- */
  const bar = os.ui.appBar({ opacity: 0.85 });
  root.append(bar.el);
  const onSaved = (meta, replaced, oldPath) => {
    urls.drop(oldPath);
    if (replaced) list[index] = meta; else list.splice(index, 0, meta);
    slides.forEach((s) => (s.path = '__stale'));
    render();
  };
  function setBar() {
    const m = list[index];
    if (!m) return;
    const isFav = shared.fav.has(m.path);
    const video = isVideo(m);
    bar.setButtons([
      { icon: I.share, label: 'share', onClick: () => os.share({ path: m.path, title: m.name }) },
      { icon: Star, label: isFav ? 'unfavorite' : 'favorite', onClick: async () => { const v = await shared.fav.toggle(m.path); os.toast(v ? 'Added to favorites' : 'Removed from favorites'); setBar(); } },
      { icon: I.delete, label: 'delete', onClick: async () => {
        if (await shared.deleteItems([m.path])) { urls.drop(m.path); list.splice(index, 1); slides.forEach((s) => (s.path = '__stale')); render(); }
      } },
      ...(video ? [] : [{ icon: Pencil, label: 'edit', onClick: () => ctx.navigate(editorPage, { meta: m, shared, onSaved }) }]),
    ]);
    const favBtn = bar.el.querySelectorAll('.wp-appbar-btn')[1];
    favBtn?.classList.toggle('photos-fav-on', isFav);
    bar.setMenu([
      ...(video ? [{ label: 'open in video', onClick: () => os.launch('video', { file: m.path }) }] : [
        { label: 'set as lock screen', onClick: () => { os.settings.set('lockWallpaper', m.path); os.toast('Lock screen background set'); } },
        { label: 'set as start background', onClick: () => { os.settings.set('startBackground', m.path); os.toast('Start background set'); } },
        { label: 'slideshow', onClick: () => ctx.navigate(slideshowPage, { list, start: index, shared }) },
        { label: 'rotate', onClick: () => ctx.navigate(editorPage, { meta: m, shared, rotate: 90, onSaved }) },
      ]),
      { label: 'info', onClick: () => showInfo(m) },
      { label: 'save to device', onClick: () => os.fs.download(m.path) },
    ]);
  }

  async function showInfo(m) {
    const st = (await os.fs.stat(m.path)) || m;
    let dims = st.width ? `${st.width} × ${st.height}` : '';
    const img = cur().img;
    if (!dims && img?.naturalWidth && img.src && !img.src.includes('thumb')) dims = `${img.naturalWidth} × ${img.naturalHeight}`;
    if (!dims && !isVideo(st)) {
      try { const b = await createImageBitmap(await os.fs.read(st.path)); dims = `${b.width} × ${b.height}`; b.close?.(); } catch {}
    }
    const row = (k, v) => v ? el('div.photos-info-row', el('div.photos-info-k', k), el('div.photos-info-v', v)) : null;
    const d = new Date(takenOf(st));
    const content = el('div.photos-info',
      row('name', st.name), row('folder', st.parent), row('date', d.toLocaleString()), row('size', os.util.formatBytes(st.size)),
      row('dimensions', dims), row('type', st.mime), row('duration', st.duration ? os.util.formatDuration(st.duration) : ''),
      row('location', st.geo ? `${st.geo.lat.toFixed(5)}, ${st.geo.lon.toFixed(5)}` : ''));
    const btns = st.geo ? ['close', 'map'] : ['close'];
    const r = await os.ui.messageBox({ title: 'info', content, buttons: btns });
    if (r === 1) os.launch('maps', { lat: st.geo.lat, lon: st.geo.lon, label: st.name });
  }

  const off = shared.onData(async () => {
    // drop items that were deleted elsewhere
    const keep = [];
    for (const m of list) if (await os.fs.exists(m.path)) keep.push(m);
    if (keep.length !== list.length) {
      const curPath = list[index]?.path;
      list = keep;
      const ni = list.findIndex((m) => m.path === curPath);
      index = ni >= 0 ? ni : Math.min(index, list.length - 1);
      slides.forEach((s) => (s.path = '__stale'));
      render();
    } else setBar();
  });

  render();
  return {
    el: root,
    onHide() { root.querySelectorAll('video').forEach((v) => v.pause()); },
    onBack() { if (z.s > 1.01) { z = { s: 1, x: 0, y: 0 }; applyZoom(true); return true; } },
    onDestroy() { off(); urls.clear(); window.removeEventListener('keydown', onKey); clearTimeout(tapTimer); },
  };
}

export function slideshowPage(page) {
  const { os, ctx } = page;
  const { el } = os.ui;
  const list = page.params.list.filter((m) => !isVideo(m));
  let i = Math.max(0, list.findIndex((m) => m.path === page.params.list[page.params.start || 0]?.path));
  const urls = urlCache(os);
  const a = el('div.photos-ss-img'), b = el('div.photos-ss-img');
  const root = el('div.photos-slideshow', a, b, el('div.photos-ss-hint', 'tap to exit'));
  let front = a, timer = null, alive = true;
  const show = async () => {
    if (!alive || !list.length) return;
    const m = list[i % list.length];
    const u = await urls.get(m.path);
    if (!alive) return;
    if (u) { const im = new Image(); im.src = u; await im.decode().catch(() => {}); }
    const back = front === a ? b : a;
    back.style.backgroundImage = u ? `url("${u}")` : '';
    back.classList.remove('kb'); void back.offsetWidth; back.classList.add('kb');
    back.classList.add('show'); front.classList.remove('show');
    front = back;
    const n = list[(i + 1) % list.length];
    urls.keep([m.path, n.path]);
    urls.get(n.path);
    i++;
    timer = setTimeout(show, 4000);
  };
  root.addEventListener('click', () => ctx.back());
  let release = () => {};
  os.device.wakeLock().then((r) => (release = r));
  show();
  return { el: root, onDestroy() { alive = false; clearTimeout(timer); urls.clear(); release(); } };
}

export { Lock, LayoutGrid, Info, Download, Presentation };
