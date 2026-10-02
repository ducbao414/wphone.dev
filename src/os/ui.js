// Windows Phone style control kit. All controls return plain DOM elements (or small objects with .el).
// Styling lives in src/styles/controls.css. Everything uses CSS variables from theme.js.
import { el, esc, onLongPress, clamp, sleep } from './util.js';
import { iconSVG, icon, I } from './icons.js';
import { sounds } from './sounds.js';

const overlayHost = () => document.getElementById('overlay-layer');

/* ------------------------------------------------------------------ pages */

/**
 * Standard WP page: small uppercase app title + big lowercase page title + scrolling content.
 *   const p = ui.page({ app: 'SETTINGS', title: 'start+theme' }); p.content.append(...)
 * Returns { el, header, content, setTitle }
 */
export function page({ app = '', title = '', cls = '', noScroll = false } = {}) {
  const header = el('div.wp-page-header', el('div.wp-app-title', app), title ? el('div.wp-page-title', title) : null);
  const content = el('div.wp-page-content' + (noScroll ? '.no-scroll' : ''));
  const root = el('div.wp-page' + (cls ? '.' + cls : ''), header, content);
  return {
    el: root, header, content,
    setTitle(t) { const n = header.querySelector('.wp-page-title'); if (n) n.textContent = t; else header.append(el('div.wp-page-title', t)); },
  };
}

/**
 * Pivot control (swipeable sections with big lowercase headers).
 *   ui.pivot({ app: 'MSN WEATHER', items: [{ header: 'now', render: (c) => c.append(...) }, ...] })
 * render(container) is called lazily the first time an item is shown.
 * Returns { el, select(i), get index(), items: [{container}], onChange(fn) }
 */
export function pivot({ app = '', items = [], index = 0, onChange } = {}) {
  const headers = el('div.wp-pivot-headers');
  const track = el('div.wp-pivot-track');
  const root = el('div.wp-pivot', el('div.wp-app-title', app), headers, track);
  const listeners = onChange ? [onChange] : [];
  const state = items.map((it, i) => {
    const h = el('div.wp-pivot-header', { onclick: () => api.select(i) }, it.header);
    const c = el('div.wp-pivot-item');
    headers.append(h);
    track.append(c);
    return { ...it, h, container: c, rendered: false };
  });
  let cur = -1;
  const api = {
    el: root,
    items: state,
    get index() { return cur; },
    onChange(fn) { listeners.push(fn); },
    select(i, dir) {
      i = (i + state.length) % state.length;
      if (i === cur) return;
      const prev = cur;
      cur = i;
      state.forEach((s, j) => { s.h.classList.toggle('active', j === i); s.container.classList.toggle('active', j === i); });
      const s = state[i];
      if (!s.rendered) {
        s.rendered = true;
        // First render is deferred a microtask so render callbacks may reference the pivot object itself
        if (prev < 0) queueMicrotask(() => s.render?.(s.container, s));
        else s.render?.(s.container, s);
      }
      if (prev >= 0) {
        const d = dir || (i > prev ? 'left' : 'right');
        s.container.classList.remove('slide-left', 'slide-right');
        void s.container.offsetWidth;
        s.container.classList.add('slide-' + d);
      }
      // Rotate headers so the active one is first (WP behavior)
      const order = state.map((_, k) => (k - i + state.length) % state.length);
      state.forEach((x, k) => (x.h.style.order = order[k]));
      listeners.forEach((fn) => fn(i, s));
    },
  };
  // Swipe between items
  let sx = null, sy = 0;
  track.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  track.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && !e.target.closest('.no-swipe, input[type=range], .leaflet-container')) api.select(cur + (dx < 0 ? 1 : -1), dx < 0 ? 'left' : 'right');
  });
  api.select(index);
  return api;
}

/**
 * Panorama: wide horizontally-scrolling hub with a huge title and optional background image.
 *   ui.panorama({ title: 'music+videos', background: url, sections: [{ header: 'collection', render: c => ... , wide: false }] })
 */
export function panorama({ title = '', background, sections = [] } = {}) {
  const t = el('div.wp-pano-title', title);
  const strip = el('div.wp-pano-strip');
  const root = el('div.wp-panorama', el('div.wp-pano-bg', { style: background ? { backgroundImage: `url("${background}")` } : {} }), t, strip);
  for (const s of sections) {
    const c = el('div.wp-pano-content');
    strip.append(el('section.wp-pano-section' + (s.wide ? '.wide' : ''), el('div.wp-pano-header', s.header), c));
    s.render?.(c);
  }
  strip.addEventListener('scroll', () => {
    const p = strip.scrollLeft;
    t.style.transform = `translateX(${-p * 0.35}px)`;
    root.querySelector('.wp-pano-bg').style.transform = `translateX(${-p * 0.15}px)`;
  }, { passive: true });
  return { el: root, strip, setBackground(u) { root.querySelector('.wp-pano-bg').style.backgroundImage = u ? `url("${u}")` : ''; } };
}

/* ------------------------------------------------------------------ app bar */

/**
 * Application bar (bottom). Up to 4 round icon buttons + "..." which expands labels and a text menu.
 *   const bar = ui.appBar({ buttons: [{ icon: I.add, label: 'new', onClick }], menu: [{ label: 'settings', onClick }] })
 *   page.el.append(bar.el)   // or ctx.root.append(bar.el)
 * opts.minimized: show only the "..." strip.
 */
export function appBar({ buttons = [], menu = [], minimized = false, opacity } = {}) {
  const root = el('div.wp-appbar' + (minimized ? '.minimized' : ''));
  if (opacity != null) root.style.setProperty('--appbar-opacity', opacity);
  const btnRow = el('div.wp-appbar-buttons');
  const menuEl = el('div.wp-appbar-menu');
  const dots = el('button.wp-appbar-dots', { 'aria-label': 'more', onclick: (e) => { e.stopPropagation(); toggle(); } }, el('span'), el('span'), el('span'));
  root.append(el('div.wp-appbar-row', btnRow, dots), menuEl);
  const toggle = (force) => {
    const open = force ?? !root.classList.contains('open');
    root.classList.toggle('open', open);
  };
  const outside = (e) => {
    if (!root.isConnected) { if (root._seen) document.removeEventListener('pointerdown', outside, true); return; }
    root._seen = true;
    if (!root.contains(e.target)) toggle(false);
  };
  document.addEventListener('pointerdown', outside, true);
  const api = {
    el: root,
    setButtons(list) {
      btnRow.replaceChildren(...list.map((b) => {
        const n = el('button.wp-appbar-btn' + (b.disabled ? '.disabled' : ''), {
          onclick: (e) => { e.stopPropagation(); if (b.disabled) return; toggle(false); b.onClick?.(e); }, 'aria-label': b.label,
        }, el('span.wp-appbar-circle', { html: iconSVG(b.icon, { size: 20, stroke: 2 }) }), el('span.wp-appbar-label', b.label));
        return n;
      }));
    },
    setMenu(list) {
      menuEl.replaceChildren(...list.map((m) => el('div.wp-appbar-menuitem.tilt' + (m.disabled ? '.disabled' : ''), {
        onclick: (e) => { e.stopPropagation(); toggle(false); if (!m.disabled) m.onClick?.(e); },
      }, m.label)));
      dots.style.visibility = list.length || buttons.length ? '' : 'hidden';
    },
    open: () => toggle(true), close: () => toggle(false),
    show() { root.hidden = false; }, hide() { root.hidden = true; },
  };
  api.setButtons(buttons); api.setMenu(menu);
  return api;
}

/* ------------------------------------------------------------------ basic controls */

/** WP rectangular outlined button. */
export function button(label, onClick, { accent = false, icon: ic, disabled = false, cls = '' } = {}) {
  return el('button.wp-button' + (accent ? '.accent' : '') + (cls ? '.' + cls : ''), { onclick: onClick, disabled },
    ic ? el('span', { html: iconSVG(ic, { size: 18 }) }) : null, label);
}

/** Toggle switch with label + optional description. Returns { el, get value, set(v) }. */
export function toggle({ label = '', value = false, description = '', onChange, disabled = false } = {}) {
  const sw = el('div.wp-toggle-switch' + (value ? '.on' : ''), el('div.wp-toggle-track', el('div.wp-toggle-thumb')));
  const state = el('div.wp-toggle-state', value ? 'On' : 'Off');
  const root = el('div.wp-toggle' + (disabled ? '.disabled' : ''), el('div.wp-toggle-label', label), el('div.wp-toggle-row', state, sw), description ? el('div.wp-desc', description) : null);
  let v = !!value;
  const set = (nv, fire) => { v = !!nv; sw.classList.toggle('on', v); state.textContent = v ? 'On' : 'Off'; if (fire) onChange?.(v); };
  root.querySelector('.wp-toggle-row').addEventListener('click', () => { if (!root.classList.contains('disabled')) { sounds.tap(); set(!v, true); } });
  return { el: root, get value() { return v; }, set: (nv) => set(nv, false), setDisabled(d) { root.classList.toggle('disabled', d); } };
}

/** Text input. multiline => textarea. Returns the element (read .value). */
export function textbox({ value = '', placeholder = '', type = 'text', multiline = false, label, onInput, onEnter, rows = 4, cls = '' } = {}) {
  const inp = multiline ? el('textarea.wp-textbox' + (cls ? '.' + cls : ''), { placeholder, rows }) : el('input.wp-textbox' + (cls ? '.' + cls : ''), { type, placeholder });
  inp.value = value;
  if (onInput) inp.addEventListener('input', () => onInput(inp.value));
  if (onEnter) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(inp.value); } });
  if (!label) return inp;
  const wrap = el('label.wp-field', el('div.wp-field-label', label), inp);
  wrap.input = inp;
  Object.defineProperty(wrap, 'value', { get: () => inp.value, set: (v) => (inp.value = v) });
  return wrap;
}

export function checkbox({ label = '', checked = false, onChange } = {}) {
  const inp = el('input', { type: 'checkbox' }); inp.checked = checked;
  inp.addEventListener('change', () => onChange?.(inp.checked));
  const n = el('label.wp-check', inp, el('span.wp-check-box', { html: iconSVG(I.check, { size: 18, stroke: 3 }) }), el('span', label));
  Object.defineProperty(n, 'checked', { get: () => inp.checked, set: (v) => (inp.checked = v) });
  return n;
}

export function radioGroup({ options = [], value, onChange, name = 'r' + Math.random() } = {}) {
  const root = el('div.wp-radio-group');
  for (const o of options) {
    const opt = typeof o === 'object' ? o : { value: o, label: o };
    const inp = el('input', { type: 'radio', name }); inp.checked = opt.value === value;
    inp.addEventListener('change', () => inp.checked && onChange?.(opt.value));
    root.append(el('label.wp-radio', inp, el('span.wp-radio-dot'), el('span', opt.label)));
  }
  return root;
}

export function slider({ min = 0, max = 100, step = 1, value = 50, label, onInput, onChange } = {}) {
  const inp = el('input.wp-slider', { type: 'range', min, max, step });
  inp.value = value;
  const upd = () => inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%');
  upd();
  inp.addEventListener('input', () => { upd(); onInput?.(Number(inp.value)); });
  inp.addEventListener('change', () => onChange?.(Number(inp.value)));
  if (!label) return inp;
  const w = el('div.wp-field', el('div.wp-field-label', label), inp);
  w.input = inp;
  return w;
}

/**
 * List picker (WP style). Tapping opens a full-screen list to choose from.
 *   ui.listPicker({ label: 'Ringtone', options: ['a','b'] | [{value,label}], value, onChange })
 */
export function listPicker({ label, options = [], value, onChange, title } = {}) {
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  const box = el('div.wp-listpicker.tilt');
  const setLabel = () => (box.textContent = (opts.find((o) => o.value === value) || {}).label ?? '');
  setLabel();
  box.addEventListener('click', async () => {
    const r = await pickFromList({ title: title || label || 'choose', options: opts, value });
    if (r !== undefined && r !== value) { value = r; setLabel(); onChange?.(r); }
  });
  const w = el('div.wp-field', label ? el('div.wp-field-label', label) : null, box);
  Object.defineProperty(w, 'value', { get: () => value, set: (v) => { value = v; setLabel(); } });
  return w;
}

/** Full-screen single-choice list. Resolves to the chosen value, or undefined if dismissed. */
export function pickFromList({ title = 'choose', options = [], value } = {}) {
  return new Promise((resolve) => {
    const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
    const close = (v) => { layer.remove(); popBack(); resolve(v); };
    const layer = el('div.wp-fullpicker.anim-turnstile-in',
      el('div.wp-app-title', title.toUpperCase()),
      el('div.wp-fullpicker-list', opts.map((o) => el('div.wp-fullpicker-item.tilt' + (o.value === value ? '.selected' : ''), { onclick: () => close(o.value) }, o.label))));
    overlayHost().append(layer);
    const popBack = pushOverlayBack(() => close(undefined));
  });
}

/* ------------------------------------------------------------------ lists */

/**
 * Simple list with tilt. items: array; render(item) -> Element|string (HTML). Options onClick(item, el), onHold(item, el, event).
 * Returns the container element; call .update(items) to rerender.
 */
export function list(items = [], { render, onClick, onHold, empty = 'nothing here', cls = '' } = {}) {
  const root = el('div.wp-list' + (cls ? '.' + cls : ''));
  root.update = (arr) => {
    root.replaceChildren();
    if (!arr.length) { root.append(el('div.wp-empty', empty)); return; }
    for (const [i, it] of arr.entries()) {
      const r = render ? render(it, i) : String(it);
      const row = r instanceof Node ? r : el('div', { html: r });
      row.classList.add('wp-list-item', 'tilt');
      if (onClick) row.addEventListener('click', (e) => onClick(it, row, e));
      if (onHold) onLongPress(row, (e) => onHold(it, row, e));
      root.append(row);
    }
  };
  root.update(items);
  return root;
}

/** Standard two-line list row: big title + subtle subtitle, optional leading icon/image. */
export function listItem({ title, subtitle, icon: ic, image, accent = false, right } = {}) {
  return el('div.wp-row',
    image ? el('div.wp-row-image', { style: { backgroundImage: `url("${image}")` } }) : ic ? el('div.wp-row-icon' + (accent ? '.accent' : ''), { html: iconSVG(ic, { size: 28 }) }) : null,
    el('div.wp-row-text', el('div.wp-row-title', title), subtitle ? el('div.wp-row-sub', subtitle) : null),
    right ? (right instanceof Node ? right : el('div.wp-row-right', right)) : null);
}

/**
 * Alphabetical jump list (like People / app list): letter tiles; tapping a letter opens the jump grid.
 *   ui.jumpList(items, { key: it => it.name, render: it => Element, onClick, onHold })
 */
export function jumpList(items, { key = (x) => x.name, render, onClick, onHold } = {}) {
  const root = el('div.wp-jumplist');
  const groups = new Map();
  const letterOf = (s) => { const c = (s || '#')[0].toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
  for (const it of [...items].sort((a, b) => key(a).localeCompare(key(b)))) {
    const L = letterOf(key(it));
    if (!groups.has(L)) groups.set(L, []);
    groups.get(L).push(it);
  }
  const showGrid = () => {
    const letters = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const grid = el('div.wp-jumpgrid.anim-zoom-in', letters.map((L) => el('div.wp-jumpgrid-cell' + (groups.has(L) ? '.has' : ''), {
      onclick: () => { if (!groups.has(L)) return; close(); root.querySelector(`[data-letter="${L}"]`)?.scrollIntoView({ block: 'start' }); },
    }, L)));
    const close = () => { grid.remove(); pop(); };
    grid.addEventListener('click', (e) => { if (e.target === grid) close(); });
    overlayHost().append(grid);
    const pop = pushOverlayBack(close);
  };
  for (const [L, arr] of groups) {
    root.append(el('div.wp-jump-letter.tilt', { dataset: { letter: L }, onclick: showGrid }, L));
    for (const it of arr) {
      const r = render(it);
      r.classList.add('tilt', 'wp-list-item');
      if (onClick) r.addEventListener('click', () => onClick(it, r));
      if (onHold) onLongPress(r, (e) => onHold(it, r, e));
      root.append(r);
    }
  }
  if (!items.length) root.append(el('div.wp-empty', 'nothing here'));
  return root;
}

export const header = (text) => el('div.wp-section-header', text);
export const empty = (text) => el('div.wp-empty', text);
export const desc = (text) => el('div.wp-desc', text);

/** Indeterminate WP progress dots. */
export function loadingDots({ inline = false } = {}) {
  return el('div.wp-dots' + (inline ? '.inline' : ''), el('i'), el('i'), el('i'), el('i'), el('i'));
}
export function progressBar(value = 0) {
  const fill = el('div.wp-progress-fill');
  const n = el('div.wp-progress', fill);
  n.set = (v) => (fill.style.width = clamp(v, 0, 1) * 100 + '%');
  n.set(value);
  return n;
}

/* ------------------------------------------------------------------ dialogs */

/**
 * WP message box (drops from top, dims the rest).
 *   const i = await ui.messageBox({ title, message, buttons: ['delete', 'cancel'] })  // -> index or -1
 * content: optional extra Element placed under the message.
 */
export function messageBox({ title = '', message = '', buttons = ['ok'], content } = {}) {
  return new Promise((resolve) => {
    const done = (i) => { layer.classList.add('closing'); pop(); setTimeout(() => layer.remove(), 180); resolve(i); };
    const box = el('div.wp-msgbox',
      title ? el('div.wp-msgbox-title', title) : null,
      message ? el('div.wp-msgbox-text', message) : null,
      content || null,
      el('div.wp-msgbox-buttons', buttons.map((b, i) => button(b, () => done(i)))));
    const layer = el('div.wp-dim', box);
    overlayHost().append(layer);
    const pop = pushOverlayBack(() => done(-1));
    setTimeout(() => box.querySelector('input,textarea')?.focus(), 250);
  });
}
export const alert = (message, title = '') => messageBox({ title, message, buttons: ['ok'] });
export const confirm = async (message, title = '', ok = 'ok', cancel = 'cancel') => (await messageBox({ title, message, buttons: [ok, cancel] })) === 0;
export async function prompt(message, value = '', title = '', { placeholder = '', type = 'text' } = {}) {
  const inp = textbox({ value, placeholder, type });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.closest('.wp-msgbox').querySelector('.wp-button').click(); });
  const r = await messageBox({ title, message, content: inp, buttons: ['ok', 'cancel'] });
  return r === 0 ? inp.value : null;
}

/**
 * Tap-and-hold context menu. The page zooms out slightly, menu appears next to anchor.
 *   ui.contextMenu(anchorEl, [{ label: 'delete', onClick }, { label: 'pin to start', onClick }])
 */
export function contextMenu(anchor, items) {
  const host = overlayHost();
  const r = anchor.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  const menu = el('div.wp-context', items.filter(Boolean).map((it) => el('div.wp-context-item.tilt' + (it.disabled ? '.disabled' : ''), {
    onclick: () => { close(); if (!it.disabled) it.onClick?.(); },
  }, it.label)));
  const layer = el('div.wp-context-layer', menu);
  const clone = anchor.cloneNode(true);
  clone.classList.add('wp-context-anchor');
  Object.assign(clone.style, { top: r.top - hr.top + 'px', left: r.left - hr.left + 'px', width: r.width + 'px', height: r.height + 'px' });
  layer.prepend(clone);
  host.append(layer);
  host.parentElement.classList.add('context-open');
  // Position below or above anchor
  const mh = menu.offsetHeight;
  const below = r.bottom - hr.top + mh < hr.height;
  menu.style.top = (below ? r.bottom - hr.top : Math.max(0, r.top - hr.top - mh)) + 'px';
  layer.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  const close = () => { layer.remove(); host.parentElement.classList.remove('context-open'); pop(); };
  const pop = pushOverlayBack(close);
  return close;
}

/* ------------------------------------------------------------------ date/time pickers */

function loopColumn(values, selected, fmt = (v) => v) {
  const col = el('div.wp-loop-col');
  const inner = el('div.wp-loop-inner');
  col.append(inner);
  const REP = 3;
  for (let r = 0; r < REP; r++) for (const v of values) inner.append(el('div.wp-loop-cell', { dataset: { v } }, fmt(v)));
  const H = 92;
  let idx = Math.max(0, values.indexOf(selected));
  const center = () => { col.scrollTop = (values.length + idx) * H - (col.clientHeight - H) / 2; };
  requestAnimationFrame(center);
  let t;
  col.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const mid = col.scrollTop + col.clientHeight / 2;
      const i = Math.floor(mid / H);
      idx = ((i % values.length) + values.length) % values.length;
      if (i < values.length * 0.5 || i > values.length * 2.5) center();
      [...inner.children].forEach((c, k) => c.classList.toggle('sel', k % values.length === idx));
    }, 90);
  }, { passive: true });
  setTimeout(() => [...inner.children].forEach((c, k) => c.classList.toggle('sel', k % values.length === idx)), 50);
  return { el: col, get value() { return values[idx]; } };
}

/** WP looping time picker. Resolves {hours, minutes} (24h) or null. */
export function pickTime({ hours = new Date().getHours(), minutes = 0, title = 'CHOOSE TIME', h24 = window.__wp_h24 } = {}) {
  return new Promise((resolve) => {
    const hrs = h24 ? [...Array(24).keys()] : [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const H = loopColumn(hrs, h24 ? hours : hours % 12 || 12, (v) => (h24 ? String(v).padStart(2, '0') : v));
    const M = loopColumn([...Array(60).keys()], minutes, (v) => String(v).padStart(2, '0'));
    const ampm = h24 ? null : loopColumn(['AM', 'PM'], hours >= 12 ? 'PM' : 'AM');
    const finish = (ok) => {
      layer.remove(); pop();
      if (!ok) return resolve(null);
      let h = H.value;
      if (!h24) h = (h % 12) + (ampm.value === 'PM' ? 12 : 0);
      resolve({ hours: h, minutes: M.value });
    };
    const layer = el('div.wp-fullpicker.wp-looppicker.anim-turnstile-in', el('div.wp-app-title', title),
      el('div.wp-loop-cols', H.el, M.el, ampm?.el),
      appBar({ buttons: [{ icon: I.check, label: 'done', onClick: () => finish(true) }, { icon: I.close, label: 'cancel', onClick: () => finish(false) }] }).el);
    overlayHost().append(layer);
    const pop = pushOverlayBack(() => finish(false));
  });
}

/** WP looping date picker. Resolves a Date (local midnight) or null. */
export function pickDate({ date = new Date(), title = 'CHOOSE DATE' } = {}) {
  return new Promise((resolve) => {
    const months = [...Array(12).keys()];
    const M = loopColumn(months, date.getMonth(), (m) => new Date(2000, m, 1).toLocaleDateString([], { month: 'short' }).toLowerCase());
    const D = loopColumn([...Array(31).keys()].map((d) => d + 1), date.getDate(), (d) => String(d).padStart(2, '0'));
    const yrs = [...Array(80).keys()].map((y) => 1970 + y);
    const Y = loopColumn(yrs, date.getFullYear());
    const finish = (ok) => {
      layer.remove(); pop();
      if (!ok) return resolve(null);
      const last = new Date(Y.value, M.value + 1, 0).getDate();
      resolve(new Date(Y.value, M.value, Math.min(D.value, last)));
    };
    const layer = el('div.wp-fullpicker.wp-looppicker.anim-turnstile-in', el('div.wp-app-title', title),
      el('div.wp-loop-cols', M.el, D.el, Y.el),
      appBar({ buttons: [{ icon: I.check, label: 'done', onClick: () => finish(true) }, { icon: I.close, label: 'cancel', onClick: () => finish(false) }] }).el);
    overlayHost().append(layer);
    const pop = pushOverlayBack(() => finish(false));
  });
}

/* ------------------------------------------------------------------ overlay back handling */
// Overlays (dialogs, pickers, menus) register here so the hardware Back button closes them first.
const overlayStack = [];
export function pushOverlayBack(fn) {
  const entry = { fn };
  overlayStack.push(entry);
  return () => { const i = overlayStack.indexOf(entry); if (i >= 0) overlayStack.splice(i, 1); };
}
/** Called by the kernel on Back. Returns true if an overlay consumed it. */
export function handleOverlayBack() {
  const e = overlayStack[overlayStack.length - 1];
  if (!e) return false;
  e.fn();
  return true;
}

/* ------------------------------------------------------------------ effects */

/** WP tilt effect: elements with class "tilt" tilt toward the touch point while pressed. Installed once by the shell. */
export function installTilt(root) {
  let cur = null;
  const reset = () => { if (cur) { cur.style.transform = ''; cur.classList.remove('pressed'); cur = null; } };
  root.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.tilt, .wp-button, .wp-appbar-btn');
    if (!t || t.classList.contains('no-tilt')) return;
    cur = t;
    const r = t.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    const big = r.width > 200;
    const deg = big ? 4 : 10;
    t.classList.add('pressed');
    t.style.transform = `perspective(600px) rotateX(${-y * deg}deg) rotateY(${x * deg}deg) scale(${big ? 0.985 : 0.96})`;
  }, { passive: true });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => root.addEventListener(ev, reset, { passive: true }));
  root.addEventListener('pointermove', (e) => { if (cur && !cur.contains(document.elementFromPoint(e.clientX, e.clientY))) reset(); }, { passive: true });
}

/** Animate an element with one of the CSS animation classes; resolves on end. */
export function animate(node, cls, ms = 350) {
  return new Promise((res) => {
    node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
    setTimeout(() => { node.classList.remove(cls); res(); }, ms);
  });
}

export { icon, iconSVG, I, el, esc, sleep };
