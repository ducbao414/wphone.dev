// Small DOM + misc helpers shared by the OS and apps.

/**
 * Create an element.
 *   el('div.card.big', { onclick, style: {...}, dataset: {...}, html: '<b>x</b>' }, child, 'text', [more])
 * Tag string supports `tag#id.class1.class2`. Props starting with `on` become listeners.
 */
export function el(tag, props, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    if (props != null) children.unshift(props);
    props = {};
  }
  const m = /^([a-z0-9-]*)(#[\w-]+)?((?:\.[\w-]+)*)$/i.exec(tag) || [];
  const node = document.createElement(m[1] || 'div');
  if (m[2]) node.id = m[2].slice(1);
  if (m[3]) node.className = m[3].slice(1).replace(/\./g, ' ');
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (v === false) { if (k in node && typeof node[k] === 'boolean') node[k] = false; else if (k === 'spellcheck' || k.startsWith('aria-')) node.setAttribute(k, 'false'); continue; }
    if (k === 'class' || k === 'className') node.className = (node.className ? node.className + ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? node.style.setProperty(sk, sv) : (node.style[sk] = sv); }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Parse an HTML string into a single element (or fragment if multiple roots). */
export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function formatDuration(sec) {
  if (!isFinite(sec)) return '0:00';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

/** "2:05 PM" or "14:05" depending on the 24h setting. */
export function formatTime(d = new Date(), h24 = window.__wp_h24) {
  return d.toLocaleTimeString([], { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !h24 });
}

/** Relative-ish date like WP lists: time today, weekday this week, else short date. */
export function formatRelative(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(d);
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
}

/** Simple event emitter. */
export class Emitter {
  #m = new Map();
  on(ev, fn) {
    if (!this.#m.has(ev)) this.#m.set(ev, new Set());
    this.#m.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  once(ev, fn) {
    const off = this.on(ev, (...a) => { off(); fn(...a); });
    return off;
  }
  off(ev, fn) { this.#m.get(ev)?.delete(fn); }
  emit(ev, ...a) {
    for (const fn of [...(this.#m.get(ev) || [])]) {
      try { fn(...a); } catch (e) { console.error(e); }
    }
  }
}

/**
 * Long-press detection (WP "tap and hold"). Calls cb(event) after `ms` without moving.
 * Returns a disposer. Also suppresses the following click and the native context menu.
 */
export function onLongPress(node, cb, ms = 550) {
  let t, sx, sy, fired = false;
  const start = (e) => {
    fired = false;
    const p = e.touches ? e.touches[0] : e;
    sx = p.clientX; sy = p.clientY;
    clearTimeout(t);
    t = setTimeout(() => { fired = true; navigator.vibrate?.(15); cb(e); }, ms);
  };
  const move = (e) => {
    const p = e.touches ? e.touches[0] : e;
    if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) clearTimeout(t);
  };
  // only swallow the click that immediately follows the long-press release (touch often sends none)
  const end = () => { clearTimeout(t); if (fired) setTimeout(() => (fired = false), 350); };
  const click = (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } };
  const ctx = (e) => e.preventDefault();
  node.addEventListener('pointerdown', start);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('pointerleave', end);
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', ctx);
  return () => {
    clearTimeout(t);
    node.removeEventListener('pointerdown', start);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', end);
    node.removeEventListener('pointercancel', end);
    node.removeEventListener('pointerleave', end);
    node.removeEventListener('click', click, true);
    node.removeEventListener('contextmenu', ctx);
  };
}

/** Horizontal/vertical swipe detection. cb(dir) where dir is 'left'|'right'|'up'|'down'. */
export function onSwipe(node, cb, { threshold = 50 } = {}) {
  let sx, sy, st;
  const down = (e) => { sx = e.clientX; sy = e.clientY; st = Date.now(); };
  const up = (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if (Date.now() - st > 800) return;
    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) cb(dx < 0 ? 'left' : 'right');
    else if (Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx) * 1.5) cb(dy < 0 ? 'up' : 'down');
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  return () => { node.removeEventListener('pointerdown', down); node.removeEventListener('pointerup', up); };
}

/** Read a Blob as text / dataURL / ArrayBuffer. */
export const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

/** Downscale an image blob into a thumbnail blob (JPEG). */
export async function makeThumbnail(blob, max = 256, quality = 0.8) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.convertToBlob({ type: 'image/jpeg', quality });
}
