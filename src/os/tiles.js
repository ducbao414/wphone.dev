// Live Tiles: pinned layout, data providers (src/apps/<id>/tile.js) and tile rendering.
import { el, Emitter, esc } from './util.js';
import { settings } from './settings.js';
import { idb } from './db.js';
import { iconSVG } from './icons.js';
import { kernel } from './kernel.js';

export const SIZES = ['small', 'medium', 'wide'];
const tileKey = (t) => t.key || t.id;

class Tiles extends Emitter {
  data = new Map();       // tileKey -> TileData
  #timers = new Map();
  #providers = new Map(); // appId -> provider module (default export)

  /** Current pinned layout: [{ id, size, key?, title?, args? }] */
  layout() {
    let l = settings.get('tiles');
    if (!l) {
      l = kernel.list().filter((m) => m.pin).sort((a, b) => (a.pin.order ?? 99) - (b.pin.order ?? 99))
        .map((m) => ({ id: m.id, size: typeof m.pin === 'string' ? m.pin : m.pin.size || 'medium' }));
    }
    return l.filter((t) => kernel.apps.has(t.id) && kernel.isInstalled(t.id));
  }
  async setLayout(l) { await settings.set('tiles', l); this.emit('layout'); }

  isPinned(id, key) { return this.layout().some((t) => (key ? t.key === key : t.id === id && !t.key)); }

  /**
   * Pin an app (or a secondary tile with a unique key) to Start.
   *   os.tiles.pin('weather', { key: 'weather:paris', title: 'Paris', args: { city: 'Paris' }, size: 'wide' })
   */
  async pin(id, { size = 'medium', key, title, args, icon, color } = {}) {
    if (this.isPinned(id, key)) return;
    await this.setLayout([...this.layout(), { id, size, ...(key ? { key } : {}), ...(title ? { title } : {}), ...(args ? { args } : {}), ...(icon ? { icon } : {}), ...(color ? { color } : {}) }]);
    this.#schedule({ id, key, args, size });
    this.emit('pinned', id, key);
  }
  async unpin(idOrKey) {
    await this.setLayout(this.layout().filter((t) => tileKey(t) !== idOrKey && !(t.id === idOrKey && !t.key)));
  }
  async resize(k, size) {
    await this.setLayout(this.layout().map((t) => (tileKey(t) === k ? { ...t, size } : t)));
    const t = this.layout().find((x) => tileKey(x) === k);
    if (t) this.refresh(t.id);
  }

  /** Push live data to a tile directly (e.g. from a running app or background service). */
  async set(id, data, key) {
    const k = key || id;
    this.data.set(k, data);
    idb.set('kv', 'tile:' + k, data).catch(() => {});
    this.emit('data', k, data);
  }
  get(k) { return this.data.get(k); }

  /** Re-run the app's tile provider now. */
  async refresh(id) {
    for (const t of this.layout().filter((x) => x.id === id)) await this.#run(t);
  }

  async #provider(id) {
    if (this.#providers.has(id)) return this.#providers.get(id);
    const a = kernel.apps.get(id);
    let p = null;
    if (a?.loadTile) { try { p = (await a.loadTile()).default; } catch (e) { console.error('tile ' + id, e); } }
    this.#providers.set(id, p);
    return p;
  }

  async #run(t) {
    const p = await this.#provider(t.id);
    if (!p?.update) return;
    try {
      const d = await p.update(kernel.os, { size: t.size, key: t.key, args: t.args });
      if (d) this.set(t.id, d, t.key);
    } catch (e) { console.warn('tile update failed', t.id, e); }
  }

  async #schedule(t) {
    const k = tileKey(t);
    clearInterval(this.#timers.get(k));
    const p = await this.#provider(t.id);
    if (!p?.update) return;
    this.#run(t);
    let tick = 0;
    this.#timers.set(k, setInterval(() => {
      if (settings.get('batterySaver') && tick++ % 2) return; // Battery Saver: refresh half as often
      const cur = this.layout().find((x) => tileKey(x) === k);
      if (cur) this.#run(cur); else { clearInterval(this.#timers.get(k)); this.#timers.delete(k); }
    }, p.interval || 30 * 60e3));
  }

  /** Load cached tile data and start providers for all pinned tiles. */
  async start() {
    for (const t of this.layout()) {
      const cached = await idb.get('kv', 'tile:' + tileKey(t));
      if (cached) {
        // object URLs don't survive a reload; drop faces that depend on them until the provider refreshes
        if (cached.faces) cached.faces = cached.faces.filter((f) => !String(f.image || '').startsWith('blob:'));
        this.data.set(tileKey(t), cached);
      }
    }
    for (const t of this.layout()) this.#schedule(t);
    kernel.on('installed', () => this.emit('layout'));
  }

  /**
   * Render a tile element for a layout entry. The start screen calls this; apps can too.
   * TileData shape (returned by tile.js update() or passed to os.tiles.set):
   *   {
   *     faces: [ { html, image, icon, title, bg, cls } ],  // rotated with a flip animation; omit for a static iconic tile
   *     badge: 3 | 'new',                                   // count next to the icon / on small tiles
   *     title: 'Override label', noLabel: true,
   *     color: '#hex'                                        // background override
   *   }
   */
  render(t) {
    const m = kernel.get(t.id);
    const k = tileKey(t);
    const node = el('div.tile.tilt.size-' + t.size, { dataset: { key: k, id: t.id } });
    const draw = () => {
      const d = this.data.get(k) || {};
      const bg = d.color || t.color || m.tileColor || m.color;
      node.style.background = bg || '';
      node.classList.toggle('accent-bg', !bg);
      const label = d.noLabel ? '' : d.title || t.title || m.name;
      const faces = (d.faces || []).filter((f) => !(t.size === 'small' && f.wideOnly));
      const iconFace = el('div.tile-face.tile-iconic',
        el('div.tile-icon', { html: iconSVG(t.icon || m.icon, { size: t.size === 'small' ? 30 : 46, stroke: 1.4 }) }),
        d.badge != null && d.badge !== 0 && d.badge !== '' ? el('div.tile-badge', String(d.badge)) : null);
      const faceEls = [];
      if (!faces.length || d.iconFirst !== false || t.size === 'small') faceEls.push(iconFace);
      if (t.size !== 'small') for (const f of faces) {
        const fe = el('div.tile-face' + (f.cls ? '.' + f.cls : ''));
        if (f.bg) fe.style.background = f.bg;
        if (f.image) fe.append(el('div.tile-image', { style: { backgroundImage: `url("${f.image}")` } }));
        if (f.icon) fe.append(el('div.tile-icon', { html: iconSVG(f.icon, { size: 46, stroke: 1.4 }) }));
        if (f.html) fe.append(el('div.tile-html', { html: f.html }));
        if (f.title) fe.append(el('div.tile-face-title', f.title));
        faceEls.push(fe);
      }
      faceEls.forEach((f, i) => f.classList.toggle('current', i === 0));
      // keep edit-mode controls (unpin/resize) if a live update arrives while the tile is selected
      const ctls = [...node.querySelectorAll(':scope > .tile-ctl')];
      node.replaceChildren(...faceEls, ...(label && t.size !== 'small' ? [el('div.tile-label', label)] : []), ...ctls);
      node.dataset.faces = faceEls.length;
      node._face = 0;
    };
    draw();
    const off1 = this.on('data', (key) => { if (key === k) draw(); });
    node._dispose = () => off1();
    node._redraw = draw;
    return node;
  }

  /** Advance one tile's face (called by the start screen's flip scheduler). */
  flip(node) {
    const faces = node.querySelectorAll('.tile-face');
    if (faces.length < 2) return;
    const cur = node._face || 0, next = (cur + 1) % faces.length;
    faces[cur].classList.remove('current'); faces[cur].classList.add('leaving');
    faces[next].classList.add('current');
    setTimeout(() => {
      // snap back to the "waiting" position without animating through the visible state
      faces[cur].style.transition = 'none';
      faces[cur].classList.remove('leaving');
      void faces[cur].offsetWidth;
      faces[cur].style.transition = '';
    }, 700);
    node._face = next;
  }
}

export const tiles = new Tiles();
