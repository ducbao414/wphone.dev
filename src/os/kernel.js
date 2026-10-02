// App registry + lifecycle: launching, suspending, back stack, in-app page navigation.
// Apps are discovered automatically from src/apps/<id>/manifest.js (+ index.js, tile.js, background.js).
import { el, Emitter, uid, sleep } from './util.js';
import { settings, storage } from './settings.js';
import { handleOverlayBack } from './ui.js';
import { iconSVG } from './icons.js';

const manifestMods = import.meta.glob('../apps/*/manifest.js', { eager: true });
const entryMods = import.meta.glob('../apps/*/index.js');
const tileMods = import.meta.glob('../apps/*/tile.js');
const bgMods = import.meta.glob('../apps/*/background.js');

const dirOf = (p) => p.split('/')[2];

class Kernel extends Emitter {
  apps = new Map();        // id -> { manifest, load, loadTile, loadBackground }
  running = [];            // instances, most-recently-used last
  foreground = null;       // instance or null (start screen)
  host = null;             // element hosting app frames
  os = null;               // public api object (set by api.js)
  shell = null;            // shell hooks (set by shell.js): { showStart, beforeLaunch, statusBar }

  init() {
    for (const [path, mod] of Object.entries(manifestMods)) {
      const m = mod.default;
      if (!m || !m.id) { console.warn('Bad manifest', path); continue; }
      const dir = dirOf(path);
      const base = `../apps/${dir}/`;
      this.apps.set(m.id, {
        manifest: { category: 'app', preinstalled: true, ...m },
        load: entryMods[base + 'index.js'],
        loadTile: tileMods[base + 'tile.js'],
        loadBackground: bgMods[base + 'background.js'],
      });
    }
  }

  /* ---------------- installation */
  installedIds() {
    const saved = settings.get('installed');
    const all = [...this.apps.values()].map((a) => a.manifest);
    const base = saved || all.filter((m) => m.preinstalled !== false).map((m) => m.id);
    // System apps are always installed
    const sys = all.filter((m) => m.category === 'system').map((m) => m.id);
    return [...new Set([...base, ...sys])].filter((id) => this.apps.has(id));
  }
  isInstalled(id) { return this.installedIds().includes(id); }
  /** Visible, installed manifests sorted by name. */
  list({ includeHidden = false, all = false } = {}) {
    const ids = all ? [...this.apps.keys()] : this.installedIds();
    return ids.map((id) => this.apps.get(id).manifest).filter((m) => includeHidden || !m.hidden).sort((a, b) => a.name.localeCompare(b.name));
  }
  get(id) { return this.apps.get(id)?.manifest; }
  async install(id) {
    if (!this.apps.has(id)) throw new Error('Unknown app ' + id);
    const ids = this.installedIds();
    if (!ids.includes(id)) {
      await settings.set('installed', [...ids, id]);
      const newIds = settings.get('newApps') || [];
      await settings.set('newApps', [...newIds, id]);
      this.emit('installed', id);
      this.startBackground(id);
    }
  }
  async uninstall(id) {
    const m = this.get(id);
    if (!m || m.category === 'system' || m.removable === false) throw new Error('This app can’t be uninstalled');
    this.close(id);
    await settings.set('installed', this.installedIds().filter((x) => x !== id));
    this.os.tiles.unpin(id);
    this.emit('uninstalled', id);
  }

  /* ---------------- background services */
  async startBackgrounds() {
    for (const id of this.installedIds()) this.startBackground(id);
  }
  async startBackground(id) {
    const a = this.apps.get(id);
    if (!a?.loadBackground || a.bgStarted) return;
    a.bgStarted = true;
    try { (await a.loadBackground()).default?.(this.os, { storage: storage(id), app: a.manifest }); } catch (e) { console.error('background ' + id, e); }
  }

  /* ---------------- launching */
  /**
   * Launch (or bring to front) an app.
   *   os.launch('photos', { file: '/Pictures/x.jpg' })
   */
  async launch(id, args = {}, { from } = {}) {
    const a = this.apps.get(id);
    if (!a) { this.os.ui.alert(`App "${id}" isn't available.`); return; }
    const m = a.manifest;
    if (m.external && !a.load) { window.open(m.external, '_blank', 'noopener'); return; }
    if (!this.isInstalled(id) && !m.hidden) {
      if (await this.os.ui.confirm(`${m.name} isn't installed. Get it from the Store?`, 'Store', 'get', 'cancel')) this.launch('store', { app: id });
      return;
    }
    const newApps = settings.get('newApps') || [];
    if (newApps.includes(id)) settings.set('newApps', newApps.filter((x) => x !== id));

    let inst = this.running.find((i) => i.appId === id);
    if (inst) {
      this.#bringToFront(inst, 'resume');
      if (args && Object.keys(args).length) inst.emit('args', args);
      return inst;
    }
    const opener = this.foreground;
    await this.shell?.beforeLaunch?.(from);
    inst = await this.#create(a, args);
    if (!inst) return;
    inst.opener = opener; // Back from this app's first page returns here (WP back-stack behavior)
    // Cap memory: kill oldest background apps
    while (this.running.length > 7) this.#destroy(this.running[0]);
    return inst;
  }

  async #create(a, args) {
    const m = a.manifest;
    const frame = el('div.app-frame', { dataset: { app: m.id } });
    const root = el('div.app-root');
    frame.append(root);
    if (m.fullscreen) frame.classList.add('fullscreen');
    this.host.append(frame);
    const inst = new AppInstance(this, m, frame, root, args);
    this.running.push(inst);
    // splash while loading the module
    let splash;
    const splashT = setTimeout(() => {
      splash = el('div.app-splash', { style: { background: m.color || 'var(--accent)' }, html: iconSVG(m.icon, { size: 96, stroke: 1.25 }) });
      frame.append(splash);
    }, 120);
    this.#show(inst);
    try {
      const mod = await a.load();
      const launchFn = mod.default;
      const ret = await launchFn(inst.ctx);
      if (ret && typeof ret === 'object') inst.handlers = ret;
    } catch (e) {
      console.error(e);
      root.replaceChildren(el('div.wp-page', el('div.wp-page-header', el('div.wp-app-title', m.name.toUpperCase()), el('div.wp-page-title', 'oops')),
        el('div.wp-page-content', el('p', 'This app crashed while starting.'), el('pre.wp-desc', String(e?.stack || e)))));
    } finally {
      clearTimeout(splashT);
      if (splash) { splash.classList.add('fade-out'); setTimeout(() => splash.remove(), 300); }
    }
    this.emit('launch', m.id);
    return inst;
  }

  #show(inst, anim = 'anim-app-in') {
    const prev = this.foreground;
    if (prev && prev !== inst) { prev.frame.classList.remove('active'); prev.suspend(); }
    this.foreground = inst;
    this.running.splice(this.running.indexOf(inst), 1);
    this.running.push(inst);
    inst.frame.classList.add('active');
    inst.frame.classList.remove('anim-app-in', 'anim-app-resume');
    void inst.frame.offsetWidth;
    inst.frame.classList.add(anim);
    clearTimeout(inst._animT);
    inst._animT = setTimeout(() => inst.frame.classList.remove(anim), 450);
    this.shell?.onForeground?.(inst);
    this.emit('foreground', inst.appId);
  }

  #bringToFront(inst, how) {
    this.#show(inst, 'anim-app-resume');
    inst.resume();
    return inst;
  }

  /** Switch to a running instance (used by task switcher). */
  switchTo(instOrId) {
    const inst = typeof instOrId === 'string' ? this.running.find((i) => i.appId === instOrId) : instOrId;
    if (inst) this.#bringToFront(inst);
  }

  /** Go to start screen, leaving the current app suspended. */
  home() {
    const cur = this.foreground;
    if (cur) {
      cur.frame.classList.remove('active');
      cur.suspend();
    }
    this.foreground = null;
    this.shell?.showStart?.();
    this.emit('foreground', null);
  }

  /** Hardware back button. */
  async back() {
    if (handleOverlayBack()) return true;
    if (this.shell?.handleBack?.()) return true;
    const cur = this.foreground;
    if (!cur) return false;
    if (await cur.handleBack()) return true;
    // Close app and return to the app that opened it, or Start
    const opener = cur.opener && this.running.includes(cur.opener) ? cur.opener : null;
    if (opener) {
      this.foreground = null;
      this.running.splice(this.running.indexOf(cur), 1);
      cur.destroy();
      cur.frame.remove();
      this.emit('close', cur.appId);
      this.#bringToFront(opener);
      return true;
    }
    this.#destroy(cur, true);
    return true;
  }

  close(id) {
    const inst = this.running.find((i) => i.appId === id);
    if (inst) this.#destroy(inst, this.foreground === inst);
  }

  #destroy(inst, wasForeground) {
    const i = this.running.indexOf(inst);
    if (i >= 0) this.running.splice(i, 1);
    inst.destroy();
    if (wasForeground || this.foreground === inst) {
      this.foreground = null;
      inst.frame.classList.add('anim-app-out');
      setTimeout(() => inst.frame.remove(), 260);
      this.shell?.showStart?.(true);
      this.emit('foreground', null);
    } else inst.frame.remove();
    this.emit('close', inst.appId);
  }
}

class AppInstance extends Emitter {
  constructor(kernel, manifest, frame, root, args) {
    super();
    this.id = uid();
    this.kernel = kernel;
    this.appId = manifest.id;
    this.manifest = manifest;
    this.frame = frame;
    this.root = root;
    this.handlers = {};
    this.pages = [];   // in-app page stack: { el, onBack, onShow, onHide, onDestroy }
    this.backHandlers = [];
    const self = this;
    const os = kernel.os;
    this.ctx = {
      root, args, os, app: manifest,
      storage: storage(manifest.id),
      /** Push a page. builder(page) returns an Element or { el, onBack, onShow, onHide, onDestroy }. */
      navigate: (builder, params) => self.navigate(builder, params),
      /** Go back one page (or close the app if on the first page). */
      back: () => self.kernel.back(),
      close: () => kernel.close(self.appId),
      /** Register a back handler; return true from it to consume Back. Returns unregister fn. */
      onBack: (fn) => { self.backHandlers.push(fn); return () => (self.backHandlers = self.backHandlers.filter((f) => f !== fn)); },
      on: (ev, fn) => self.on(ev, fn),
      get pageCount() { return self.pages.length; },
      setFullscreen: (v) => frame.classList.toggle('fullscreen', !!v),
      /** Pin a secondary tile, e.g. ctx.pinTile({ key: 'city:paris', title: 'Paris', args: { city: 'paris' } }) */
      pinTile: (opts) => os.tiles.pin(manifest.id, opts),
    };
  }

  async navigate(builder, params = {}) {
    const holder = el('div.app-page');
    const prev = this.pages[this.pages.length - 1];
    const page = { el: holder, params, close: () => this.removePage(page) };
    let r = await builder({ ...page, os: this.kernel.os, ctx: this.ctx, el: holder });
    if (r instanceof Node) r = { el: r };
    r = r || {};
    if (r.el && r.el !== holder) holder.append(r.el);
    Object.assign(page, r, { el: holder });
    if (prev) { prev.onHide?.(); prev.el.classList.add('anim-page-out'); await sleep(140); prev.el.classList.remove('anim-page-out'); prev.el.hidden = true; }
    this.pages.push(page);
    this.root.append(holder);
    holder.classList.add('anim-page-in');
    setTimeout(() => holder.classList.remove('anim-page-in'), 400);
    page.onShow?.();
    return page;
  }

  async popPage() {
    const top = this.pages.pop();
    if (!top) return false;
    top.onHide?.(); top.onDestroy?.();
    top.el.classList.add('anim-page-back-out');
    await sleep(140);
    top.el.remove();
    const prev = this.pages[this.pages.length - 1];
    if (prev) {
      prev.el.hidden = false;
      prev.el.classList.add('anim-page-back-in');
      setTimeout(() => prev.el.classList.remove('anim-page-back-in'), 400);
      prev.onShow?.();
    }
    return true;
  }

  /** Close a specific page (animated if it's on top). */
  async removePage(page) {
    const i = this.pages.indexOf(page);
    if (i < 0) return false;
    if (i === this.pages.length - 1) return this.popPage();
    this.pages.splice(i, 1);
    page.onDestroy?.();
    page.el.remove();
    return true;
  }

  async handleBack() {
    for (const fn of [...this.backHandlers].reverse()) if (await fn()) return true;
    const top = this.pages[this.pages.length - 1];
    if (top?.onBack && (await top.onBack())) return true;
    const rootHasOwnView = [...this.root.children].some((c) => !c.classList.contains('app-page') && !c.classList.contains('wp-appbar'));
    if (this.pages.length > 1 || (this.pages.length === 1 && rootHasOwnView)) { await this.popPage(); return true; }
    if (this.handlers.onBack && (await this.handlers.onBack())) return true;
    return false;
  }

  suspend() { this.handlers.onSuspend?.(); this.emit('suspend'); }
  resume() { this.handlers.onResume?.(); this.emit('resume'); }
  destroy() {
    for (const p of this.pages) p.onDestroy?.();
    this.handlers.onDestroy?.();
    this.emit('destroy');
  }
}

export const kernel = new Kernel();
