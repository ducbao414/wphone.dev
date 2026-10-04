// Start screen (live tile grid) + App list, with tile edit mode (move / resize / unpin).
import { $, $$, el, onLongPress, sleep, clamp } from '../os/util.js';
import { kernel } from '../os/kernel.js';
import { tiles } from '../os/tiles.js';
import { settings } from '../os/settings.js';
import { fs } from '../os/fs.js';
import * as ui from '../os/ui.js';
import { iconSVG, I } from '../os/icons.js';

const RESIZE_NEXT = { medium: 'small', small: 'wide', wide: 'medium' };

export function initStart(os, shell) {
  const layer = $('#start-layer');
  const grid = el('div.tile-grid');
  const arrow = el('button.start-arrow.tilt', { 'aria-label': 'All apps', html: iconSVG(I.arrowRight, { size: 20, stroke: 2 }) });
  const startScroll = el('div.start-scroll', grid, el('div.start-footer', arrow));
  const startPage = el('div.start-page', startScroll);
  const appsPage = el('div.applist-page');
  const pan = el('div.start-pan', startPage, appsPage);
  layer.append(pan);

  let page = 0; // 0 = start, 1 = app list
  let editing = null; // selected tile key in edit mode

  /* ---------------- tile grid ---------------- */
  const measure = () => {
    const cols = settings.get('moreTiles') ? 6 : 4;
    const gap = 8;
    const w = grid.clientWidth;
    const cell = (w - gap * (cols - 1)) / cols;
    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--cell', cell + 'px');
    grid.classList.toggle('cols-4', cols === 4);
  };
  new ResizeObserver(measure).observe(grid);

  function renderGrid() {
    $$('.tile', grid).forEach((t) => t._dispose?.());
    grid.replaceChildren();
    for (const t of tiles.layout()) {
      const node = tiles.render(t);
      node.addEventListener('click', (e) => onTileClick(t, node, e));
      onLongPress(node, () => enterEdit(t, node));
      grid.append(node);
    }
    if (editing) {
      const n = grid.querySelector(`[data-key="${CSS.escape(editing)}"]`);
      n ? selectEdit(n) : exitEdit();
    }
    measure();
    requestAnimationFrame(updateParallax);
  }

  function onTileClick(t, node) {
    if (editing) {
      if (node.dataset.key !== editing) selectEdit(node);
      return;
    }
    kernel.launch(t.id, t.args || {}, { from: node });
  }

  /* ---------------- edit mode ---------------- */
  function enterEdit(t, node) {
    if (page !== 0) return;
    grid.classList.add('editing');
    selectEdit(node);
  }
  function selectEdit(node) {
    $$('.tile.selected', grid).forEach((n) => { n.classList.remove('selected'); n.querySelectorAll('.tile-ctl').forEach((c) => c.remove()); });
    editing = node.dataset.key;
    node.classList.add('selected');
    const unpinBtn = el('button.tile-ctl.tile-unpin', { html: iconSVG(I.unpin, { size: 16, stroke: 2 }), 'aria-label': 'unpin' });
    const sizeBtn = el('button.tile-ctl.tile-resize', { html: iconSVG(I.arrowDown, { size: 16, stroke: 2.4 }), 'aria-label': 'resize' });
    unpinBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    sizeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    unpinBtn.addEventListener('click', (e) => { e.stopPropagation(); const k = editing; editing = null; tiles.unpin(k); if (!tiles.layout().length) exitEdit(); });
    sizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = tiles.layout().find((x) => (x.key || x.id) === node.dataset.key);
      const m = kernel.get(t.id);
      const allowed = m.tileSizes || ['small', 'medium', 'wide'];
      let next = RESIZE_NEXT[t.size];
      while (!allowed.includes(next) && next !== t.size) next = RESIZE_NEXT[next];
      tiles.resize(node.dataset.key, next);
    });
    node.append(unpinBtn, sizeBtn);
    sizeBtn.style.transform = { medium: 'rotate(135deg)', small: 'rotate(-45deg)', wide: 'rotate(90deg)' }[node.className.match(/size-(\w+)/)[1]] || '';
  }
  function exitEdit() {
    editing = null;
    grid.classList.remove('editing');
    $$('.tile.selected', grid).forEach((n) => { n.classList.remove('selected'); n.querySelectorAll('.tile-ctl').forEach((c) => c.remove()); });
  }
  startScroll.addEventListener('click', (e) => { if (editing && !e.target.closest('.tile')) exitEdit(); });

  // Drag to reorder in edit mode
  let drag = null;
  grid.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.tile.selected');
    if (!editing || !node || e.target.closest('.tile-ctl')) return;
    drag = { node, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    if (!drag.moved) { drag.moved = true; drag.node.classList.add('dragging'); try { grid.setPointerCapture(e.pointerId); } catch {} }
    drag.node.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
    drag.node.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tile');
    drag.node.style.pointerEvents = '';
    if (under && under !== drag.node && grid.contains(under)) {
      const before = drag.node.getBoundingClientRect();
      const nodes = $$('.tile', grid);
      const iu = nodes.indexOf(under), id = nodes.indexOf(drag.node);
      grid.insertBefore(drag.node, iu > id ? under.nextSibling : under);
      const after = drag.node.getBoundingClientRect();
      drag.sx += after.left - before.left; drag.sy += after.top - before.top;
      drag.node.style.transform = `translate(${e.clientX - drag.sx}px, ${e.clientY - drag.sy}px) scale(1.05)`;
    }
    // auto-scroll near edges
    const r = startScroll.getBoundingClientRect();
    if (e.clientY < r.top + 50) startScroll.scrollTop -= 12; else if (e.clientY > r.bottom - 50) startScroll.scrollTop += 12;
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    d.node.style.transform = '';
    d.node.classList.remove('dragging');
    if (d.moved) {
      const order = $$('.tile', grid).map((n) => n.dataset.key);
      const l = tiles.layout();
      tiles.setLayout(order.map((k) => l.find((t) => (t.key || t.id) === k)).filter(Boolean));
    }
  };
  grid.addEventListener('pointerup', endDrag);
  grid.addEventListener('pointercancel', endDrag);

  /* ---------------- live tile flipping ---------------- */
  setInterval(() => {
    if (kernel.foreground || document.hidden || shell.isLocked?.() || editing) return;
    if (settings.get('batterySaver') && Math.random() < 0.5) return; // Battery Saver: flip tiles half as often
    const cands = $$('.tile', grid).filter((n) => Number(n.dataset.faces) > 1);
    if (!cands.length) return;
    const n = cands[Math.floor(Math.random() * cands.length)];
    if (Date.now() - (n._lastFlip || 0) < 5000) return;
    n._lastFlip = Date.now();
    tiles.flip(n);
  }, 2200);

  /* ---------------- start background (WP 8.1 parallax through tiles) ---------------- */
  let bgUrl = null, bgSize = null;
  async function loadStartBg() {
    const p = settings.get('startBackground');
    layer.classList.toggle('has-bg', !!p);
    bgUrl = null;
    if (p && (await fs.exists(p))) {
      bgUrl = await fs.url(p);
      const img = new Image();
      img.src = bgUrl;
      await img.decode().catch(() => {});
      bgSize = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
    }
    updateParallax();
  }
  function updateParallax() {
    const tilesEls = $$('.tile', grid);
    if (!bgUrl) { tilesEls.forEach((n) => n.style.removeProperty('--tile-bg')); return; }
    const sr = layer.getBoundingClientRect();
    const scale = Math.max(sr.width / bgSize.w, (sr.height * 1.25) / bgSize.h);
    const w = bgSize.w * scale, h = bgSize.h * scale;
    const par = startScroll.scrollTop * 0.25;
    for (const n of tilesEls) {
      const r = n.getBoundingClientRect();
      n.style.setProperty('--tile-bg', `url("${bgUrl}") ${-(r.left - sr.left) - (w - sr.width) / 2}px ${-(r.top - sr.top) - par}px / ${w}px ${h}px no-repeat`);
    }
  }
  startScroll.addEventListener('scroll', () => requestAnimationFrame(updateParallax), { passive: true });
  settings.on('change:startBackground', loadStartBg);
  loadStartBg();

  /* ---------------- app list ---------------- */
  let filter = '';
  function renderApps() {
    const apps = kernel.list();
    const newIds = settings.get('newApps') || [];
    const searchBox = ui.textbox({ placeholder: 'search apps', value: filter, onInput: (v) => { filter = v; drawList(); } });
    searchBox.classList.add('applist-search');
    const searchBtn = el('button.applist-searchbtn.tilt', { html: iconSVG(I.search, { size: 22, stroke: 2 }), onclick: () => { head.classList.toggle('searching'); if (head.classList.contains('searching')) searchBox.focus(); else { filter = ''; searchBox.value = ''; drawList(); } } });
    const head = el('div.applist-head' + (filter ? '.searching' : ''), searchBtn, searchBox);
    const body = el('div.applist-body');
    appsPage.replaceChildren(head, body);
    const row = (m) => el('div.applist-item',
      el('div.applist-icon', { style: { background: m.color || '' }, html: iconSVG(m.icon, { size: 26, stroke: 1.6 }) }),
      el('div.applist-name', m.name, newIds.includes(m.id) ? el('span.applist-new', 'new') : null));
    const hold = (m, r) => ui.contextMenu(r, [
      tiles.isPinned(m.id) ? { label: 'unpin from start', onClick: () => tiles.unpin(m.id) } : { label: 'pin to start', onClick: () => { tiles.pin(m.id); goto(0); setTimeout(() => startScroll.scrollTo({ top: startScroll.scrollHeight, behavior: 'smooth' }), 350); } },
      m.category !== 'system' && m.removable !== false ? { label: 'uninstall', onClick: async () => { if (await ui.confirm(`Uninstall ${m.name}? Its data will stay on the phone.`, 'uninstall', 'yes', 'no')) kernel.uninstall(m.id); } } : null,
      kernel.apps.has('store') ? { label: 'rate and review', onClick: () => kernel.launch('store', { app: m.id }) } : null,
    ]);
    const launch = (m, r) => kernel.launch(m.id, {}, { from: r });
    const drawList = () => {
      const q = filter.trim().toLowerCase();
      body.replaceChildren();
      if (q) {
        const res = apps.filter((m) => m.name.toLowerCase().includes(q) || (m.keywords || []).some((k) => k.includes(q)));
        body.append(ui.list(res, { render: row, onClick: launch, onHold: hold, empty: 'no apps found' }));
        if (kernel.apps.has('store')) body.append(ui.button('search store', () => kernel.launch('store', { q })));
        return;
      }
      const fresh = apps.filter((m) => newIds.includes(m.id));
      if (fresh.length) {
        body.append(el('div.applist-section', 'new'));
        body.append(ui.list(fresh, { render: row, onClick: launch, onHold: hold }));
      }
      body.append(ui.jumpList(apps, { key: (m) => m.name, render: row, onClick: launch, onHold: hold }));
    };
    drawList();
  }

  /* ---------------- panning start <-> app list ---------------- */
  function goto(p, animate = true) {
    page = p;
    if (p === 1) exitEdit();
    pan.style.transition = animate ? 'transform .35s var(--ease-out)' : 'none';
    pan.style.transform = `translateX(${-p * 50}%)`;
    if (p === 0) { filter = ''; }
  }
  arrow.addEventListener('click', () => goto(1));
  let ps = null;
  layer.addEventListener('pointerdown', (e) => {
    if (editing || e.target.closest('input, .wp-jumpgrid')) return;
    ps = { x: e.clientX, y: e.clientY, active: false, w: layer.clientWidth };
  });
  layer.addEventListener('pointermove', (e) => {
    if (!ps) return;
    const dx = e.clientX - ps.x, dy = e.clientY - ps.y;
    if (!ps.active) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) { ps.active = true; pan.style.transition = 'none'; }
      else if (Math.abs(dy) > 12) { ps = null; return; }
      else return;
    }
    const off = clamp(-page * ps.w + dx, -ps.w, 0);
    pan.style.transform = `translateX(${(off / (ps.w * 2)) * 100}%)`;
  });
  const panEnd = (e) => {
    if (!ps) return;
    const s = ps; ps = null;
    if (!s.active) return;
    const dx = e.clientX - s.x;
    goto(Math.abs(dx) > s.w * 0.2 ? (dx < 0 ? 1 : 0) : page);
  };
  layer.addEventListener('pointerup', panEnd);
  layer.addEventListener('pointercancel', panEnd);

  /* ---------------- shell hooks ---------------- */
  shell.atStartRoot = () => page === 0 && !editing;
  const prevBack = shell.handleBack;
  shell.handleBack = () => {
    if (prevBack?.()) return true;
    if (kernel.foreground) return false;
    if (editing) { exitEdit(); return true; }
    if (page === 1) { goto(0); return true; }
    return false;
  };
  shell.startHome = () => { if (page === 1) goto(0); else startScroll.scrollTo({ top: 0, behavior: 'smooth' }); exitEdit(); };

  shell.beforeLaunch = async (fromTile) => {
    exitEdit();
    if (kernel.foreground) return; // app-to-app launch: no start animation
    const all = $$('.tile, .applist-item', page === 0 ? grid : appsPage).filter((n) => {
      const r = n.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight;
    });
    all.forEach((n, i) => {
      n.style.animationDelay = (n === fromTile ? 160 : Math.min(140, (n.getBoundingClientRect().left / 4 + i * 6))) + 'ms';
      n.classList.add('tile-out');
    });
    await sleep(260);
    layer.classList.add('hidden');
    all.forEach((n) => { n.classList.remove('tile-out'); n.style.animationDelay = ''; });
  };
  shell.onForeground = () => layer.classList.add('hidden');
  shell.showStart = (fromBack) => {
    layer.classList.remove('hidden');
    const all = $$('.tile, .applist-item', page === 0 ? grid : appsPage).filter((n) => {
      const r = n.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight;
    });
    all.forEach((n, i) => { n.style.animationDelay = Math.min(160, n.getBoundingClientRect().left / 5 + i * 8) + 'ms'; n.classList.add('tile-in'); });
    setTimeout(() => all.forEach((n) => { n.classList.remove('tile-in'); n.style.animationDelay = ''; }), 600);
    if (!fromBack) goto(0, false);
  };

  tiles.on('layout', () => { renderGrid(); renderApps(); });
  kernel.on('installed', renderApps);
  kernel.on('uninstalled', renderApps);
  settings.on('change', (k) => {
    if (k === 'moreTiles') { measure(); requestAnimationFrame(updateParallax); }
    if (k === 'newApps') renderApps();
  });
  renderGrid();
  renderApps();
}
