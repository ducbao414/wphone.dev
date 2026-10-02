// System settings (cached in memory, persisted to IndexedDB) and per-app key/value storage.
import { idb } from './db.js';
import { Emitter } from './util.js';

const usesImperial = ['en-US', 'en-LR', 'my-MM'].includes(navigator.language);

export const DEFAULT_SETTINGS = {
  theme: 'dark',              // 'dark' | 'light'
  accent: 'cyan',             // key of ACCENTS
  moreTiles: true,            // 6 small-tile columns instead of 4
  h24: !new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12,
  units: usesImperial ? 'imperial' : 'metric',
  lockWallpaper: 'bing',      // 'bing' | 'accent' | file path
  startBackground: null,      // file path of an image shown through transparent tiles (WP 8.1 style) or null
  lockShowArtist: true,
  ringtone: 'Nokia Tune',
  notificationSound: 'Xylophone',
  sounds: true,               // UI + notification sounds
  vibrate: true,
  location: true,
  customLocation: null,       // { lat, lon, city, country, countryCode } chosen in Settings, or null = approximate from network
  batterySaver: false,
  airplane: false,
  wifi: true,
  bluetooth: false,
  cellular: true,
  rotationLock: true,
  brightness: 1,              // 0.3..1 (applied as dim overlay)
  fontScale: 1,
  lockPin: null,              // e.g. "1234"
  autoLock: 120000,           // ms of inactivity; 0 = never
  ownerName: 'Lumia owner',
  deviceName: 'My Lumia',
  installed: null,            // array of app ids (null => defaults from manifests)
  tiles: null,                // [{ id, size: 'small'|'medium'|'wide', key? }] (null => defaults)
  firstRun: true,
  simActivity: true,          // simulated friends text/email/call you now and then
  quickActions: ['wifi', 'bluetooth', 'airplane', 'rotation'],
};

class Settings extends Emitter {
  #data = { ...DEFAULT_SETTINGS };
  async load() {
    const saved = await idb.get('kv', 'sys:settings');
    if (saved) Object.assign(this.#data, saved);
  }
  get(key) { return this.#data[key]; }
  all() { return { ...this.#data }; }
  async set(key, value) {
    if (typeof key === 'object') { for (const [k, v] of Object.entries(key)) await this.set(k, v); return; }
    const old = this.#data[key];
    this.#data[key] = value;
    await idb.set('kv', 'sys:settings', this.#data);
    if (old !== value || typeof value === 'object') { this.emit('change', key, value, old); this.emit('change:' + key, value, old); }
  }
  /** Subscribe to a key; callback fires immediately and on every change. Returns an unsubscribe fn. */
  watch(key, fn) { fn(this.#data[key]); return this.on('change:' + key, fn); }
}

export const settings = new Settings();

/**
 * Namespaced async key/value storage for apps, backed by IndexedDB.
 *   const st = os.storage('notes'); await st.set('list', [...]); await st.get('list', []);
 */
export function storage(ns) {
  const k = (key) => `app:${ns}:${key}`;
  return {
    async get(key, fallback = null) { const v = await idb.get('kv', k(key)); return v === undefined ? fallback : v; },
    set: (key, value) => idb.set('kv', k(key), value),
    del: (key) => idb.del('kv', k(key)),
    async keys() {
      const all = await idb.keys('kv', IDBKeyRange.bound(`app:${ns}:`, `app:${ns}:￿`));
      return all.map((x) => x.slice(`app:${ns}:`.length));
    },
    /** Read-modify-write helper: await st.update('list', l => [...l, x], []) */
    async update(key, fn, fallback = null) { const v = await fn(await this.get(key, fallback)); await this.set(key, v); return v; },
  };
}
