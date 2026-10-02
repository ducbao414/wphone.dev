// Battery Saver background service: level history, auto battery saver, per-app usage tracking.
import { DEFAULTS } from './model.js';

export default function start(os, { storage }) {
  const dev = os.device;

  /* ---------- level history */
  async function record() {
    const b = dev.battery;
    if (!b?.supported) return;
    const now = Date.now();
    await storage.update('history', (h) => {
      h = Array.isArray(h) ? h : [];
      const last = h[h.length - 1];
      if (!last || Math.abs(last.l - b.level) >= 0.005 || last.c !== b.charging || now - last.t > 5 * 60e3) h.push({ t: now, l: b.level, c: b.charging });
      return h.slice(-300);
    }, []);
  }

  /* ---------- auto battery saver */
  let busy = false;
  async function checkAuto() {
    if (busy) return;
    busy = true;
    try {
      const b = dev.battery;
      if (!b?.supported) return;
      const auto = await storage.get('auto', DEFAULTS.auto);
      const threshold = await storage.get('threshold', DEFAULTS.threshold);
      const autoOn = await storage.get('autoOn', false);
      const saver = !!os.settings.get('batterySaver');
      if (b.charging) {
        await storage.set('suppressed', false);
        if (autoOn && saver) {
          await storage.set('autoOn', false);
          await os.settings.set('batterySaver', false);
          os.notify({ appId: 'battery', title: 'Battery Saver', body: 'Turned off because your phone is charging.', silent: true });
        }
        return;
      }
      if (auto && !saver && b.level <= threshold && !(await storage.get('suppressed', false))) {
        await storage.set('autoOn', true);
        await os.settings.set('batterySaver', true);
        os.notify({ appId: 'battery', title: 'Battery Saver is on', body: `Battery is at ${Math.round(b.level * 100)}%. Some background activity is limited.` });
      }
    } finally { busy = false; }
  }
  // If the user turns saver off while the battery is still low, don't force it back on until next charge.
  os.settings.on('change:batterySaver', async (v) => {
    if (!v && (await storage.get('autoOn', false))) {
      await storage.set('autoOn', false);
      if (!dev.battery.charging) await storage.set('suppressed', true);
    }
    os.tiles.refresh('battery');
  });

  const onBattery = () => { record(); checkAuto(); os.tiles.refresh('battery'); };
  dev.on('battery', onBattery);
  onBattery();
  setInterval(record, 5 * 60e3);

  /* ---------- per-app usage */
  const pending = {};   // appId -> { launches, fg, bg } deltas
  const add = (id, k, v) => { if (!id) return; (pending[id] ??= { launches: 0, fg: 0, bg: 0 })[k] += v; };
  let fgApp = null, fgSince = Date.now(), lastTick = Date.now();

  async function flush() {
    const ids = Object.keys(pending);
    if (!ids.length) return;
    const snap = {};
    for (const id of ids) { snap[id] = pending[id]; delete pending[id]; }
    if (!(await storage.get('since', null))) await storage.set('since', Date.now());
    await storage.update('usage', (u) => {
      u = u && typeof u === 'object' ? u : {};
      for (const [id, d] of Object.entries(snap)) {
        const cur = u[id] || { launches: 0, fg: 0, bg: 0 };
        u[id] = { launches: cur.launches + d.launches, fg: cur.fg + d.fg, bg: cur.bg + d.bg, last: Date.now() };
      }
      return u;
    }, {});
  }
  const creditFg = () => {
    const now = Date.now();
    if (fgApp && !document.hidden) add(fgApp, 'fg', now - fgSince);
    fgSince = now;
  };
  os.apps.on('launch', (id) => { add(id, 'launches', 1); flush(); });
  os.apps.on('foreground', (id) => { creditFg(); fgApp = id || null; });
  document.addEventListener('visibilitychange', () => { creditFg(); if (document.hidden) flush(); });
  setInterval(() => {
    const now = Date.now(), dt = Math.min(now - lastTick, 5 * 60e3);
    lastTick = now;
    creditFg();
    if (!document.hidden) {
      for (const id of os.apps.running()) if (id !== fgApp) add(id, 'bg', dt);
      if (os.media?.playing && os.apps.get('music')) add('music', 'bg', dt * 2);
    }
    flush();
  }, 60e3);
}
