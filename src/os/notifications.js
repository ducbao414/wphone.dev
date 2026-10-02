// Toast notifications (top banner) + Action Center history.
import { el, Emitter, uid } from './util.js';
import { iconSVG } from './icons.js';
import { idb } from './db.js';
import { sounds } from './sounds.js';
import { settings } from './settings.js';
import { kernel } from './kernel.js';

class Notifications extends Emitter {
  items = [];   // newest first: { id, appId, title, body, time, args, read }
  #queue = [];
  #showing = false;

  async load() { this.items = (await idb.get('kv', 'sys:notifications')) || []; }
  #save() { idb.set('kv', 'sys:notifications', this.items.slice(0, 50)); this.emit('change'); }

  /**
   * Show a toast + add to Action Center.
   *   os.notify({ appId: 'messaging', title: 'Mom', body: 'call me', args: { thread: 'x' } })
   * Tapping it launches the app with `args`. Options: silent, persist=false (toast only), vibrate.
   */
  notify({ appId, title = '', body = '', args, silent = false, persist = true, icon } = {}) {
    const n = { id: uid(), appId, title, body, time: Date.now(), args, icon };
    if (persist) { this.items.unshift(n); this.#save(); }
    this.#queue.push(n);
    if (!silent) { sounds.notify(); if (settings.get('vibrate')) navigator.vibrate?.([60, 40, 60]); }
    this.#next();
    // Also mirror to the real OS notification center if the page is hidden and permission granted
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: n.id }); } catch {}
    }
    return n.id;
  }

  /** Short in-app toast without Action Center entry. */
  toast(text, appId) { return this.notify({ appId, title: text, persist: false, silent: true }); }

  dismiss(id) { this.items = this.items.filter((n) => n.id !== id); this.#save(); }
  clear(appId) { this.items = appId ? this.items.filter((n) => n.appId !== appId) : []; this.#save(); }
  unreadCount(appId) { return this.items.filter((n) => !n.read && (!appId || n.appId === appId)).length; }
  markRead() { this.items.forEach((n) => (n.read = true)); this.#save(); }

  open(n) {
    this.dismiss(n.id);
    if (n.appId) kernel.launch(n.appId, n.args || {});
  }

  #next() {
    if (this.#showing || !this.#queue.length) return;
    const n = this.#queue.shift();
    const host = document.getElementById('toast-layer');
    if (!host) return;
    this.#showing = true;
    const m = kernel.get(n.appId);
    const t = el('div.wp-toast', { onclick: () => { hide(); this.open(n); } },
      m || n.icon ? el('span.wp-toast-icon', { html: iconSVG(n.icon || m.icon, { size: 18 }) }) : null,
      el('b', n.title), n.body ? el('span.wp-toast-body', ' ' + n.body) : null);
    host.append(t);
    let sx = null;
    t.addEventListener('pointerdown', (e) => (sx = e.clientX));
    t.addEventListener('pointerup', (e) => { if (sx != null && e.clientX - sx > 60) { hide(); } sx = null; });
    const hide = () => {
      if (t._gone) return; t._gone = true;
      t.classList.add('out');
      setTimeout(() => { t.remove(); this.#showing = false; this.#next(); }, 250);
    };
    setTimeout(hide, 4500);
  }
}

export const notifications = new Notifications();
