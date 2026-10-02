// Action Center (WP 8.1): pull down from the status bar. Quick actions + notification list.
import { $, el, formatRelative } from '../os/util.js';
import { settings } from '../os/settings.js';
import { kernel } from '../os/kernel.js';
import { notifications } from '../os/notifications.js';
import { device } from '../os/device.js';
import { iconSVG, I } from '../os/icons.js';
import { WIN_LOGO } from './shell.js';
import { Flashlight, Sun, RotateCcw, Fullscreen, BatteryCharging } from 'lucide';

export function initActionCenter(os, shell) {
  const ac = $('#actioncenter');
  const sb = $('#statusbar');
  const panel = el('div.ac-panel');
  ac.append(panel);
  let open = false;
  let torchStop = null;

  const QUICK = {
    wifi: { label: 'Wi-Fi', icon: I.wifi, key: 'wifi' },
    bluetooth: { label: 'Bluetooth', icon: I.bluetooth, key: 'bluetooth' },
    airplane: { label: 'airplane mode', icon: I.airplane, key: 'airplane' },
    rotation: { label: 'rotation lock', icon: RotateCcw, key: 'rotationLock' },
    location: { label: 'location', icon: I.location, key: 'location' },
    saver: { label: 'battery saver', icon: BatteryCharging, key: 'batterySaver' },
    brightness: { label: 'brightness', icon: Sun, cycle: true },
    flashlight: { label: 'flashlight', icon: Flashlight, torch: true },
    fullscreen: { label: 'full screen', icon: Fullscreen, fullscreen: true },
  };

  function render() {
    const now = new Date();
    const b = device.battery;
    const quick = [...(settings.get('quickActions') || []).slice(0, 4), 'fullscreen'].filter((k, i, a) => QUICK[k] && a.indexOf(k) === i).slice(0, 5);
    const qa = el('div.ac-quick', quick.map((k) => {
      const q = QUICK[k];
      const on = q.key ? !!settings.get(q.key) : q.torch ? !!torchStop : q.fullscreen ? !!document.fullscreenElement : true;
      const label = q.cycle ? `${Math.round((settings.get('brightness') || 1) * 100)}%` : q.label;
      return el('button.ac-q.tilt' + (on ? '.on' : ''), {
        onclick: async () => {
          if (q.key) {
            await settings.set(q.key, !settings.get(q.key));
            if (q.key === 'airplane') {
              if (settings.get('airplane')) {
                await settings.set('airplaneRestore', { wifi: settings.get('wifi'), bluetooth: settings.get('bluetooth'), cellular: settings.get('cellular') });
                await settings.set({ wifi: false, bluetooth: false, cellular: false });
              } else await settings.set(settings.get('airplaneRestore') || { wifi: true, cellular: true });
            }
          } else if (q.cycle) {
            const levels = [1, 0.7, 0.45];
            const cur = settings.get('brightness') || 1;
            await settings.set('brightness', levels[(levels.indexOf(cur) + 1) % levels.length] ?? 1);
          } else if (q.torch) {
            if (torchStop) { torchStop(); torchStop = null; }
            else try { torchStop = await device.torch(true); } catch (e) { os.toast(e.message); }
          } else if (q.fullscreen) {
            try { document.fullscreenElement ? await document.exitFullscreen() : await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { os.toast('Full screen isn’t supported here — try “Add to Home Screen”.'); }
          }
          render();
        },
      }, el('span', { html: iconSVG(q.icon, { size: 22, stroke: 1.8 }) }), el('span.ac-q-label', label));
    }));
    const groups = new Map();
    for (const n of notifications.items) { const k = n.appId || 'system'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
    const list = el('div.ac-list');
    for (const [appId, items] of groups) {
      const m = kernel.get(appId);
      list.append(el('div.ac-group', el('span', { html: iconSVG(m?.icon || I.bell, { size: 16 }) }), (m?.name || 'System').toUpperCase()));
      for (const n of items) {
        const row = el('div.ac-item.tilt', { onclick: () => { close(); notifications.open(n); } },
          el('div.ac-item-title', n.title), n.body ? el('div.ac-item-body', n.body) : null, el('div.ac-item-time', formatRelative(n.time)));
        let sx = null;
        row.addEventListener('pointerdown', (e) => (sx = e.clientX));
        row.addEventListener('pointermove', (e) => { if (sx != null && e.clientX - sx > 10) row.style.transform = `translateX(${e.clientX - sx}px)`; });
        row.addEventListener('pointerup', (e) => {
          if (sx != null && e.clientX - sx > 90) { e.stopPropagation(); row.style.transform = 'translateX(110%)'; setTimeout(() => notifications.dismiss(n.id), 150); }
          else row.style.transform = '';
          sx = null;
        });
        list.append(row);
      }
    }
    if (!notifications.items.length) list.append(el('div.ac-empty', 'No new notifications'));
    panel.replaceChildren(
      el('div.ac-top',
        el('div.ac-date', el('div.ac-time', now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !settings.get('h24') })), el('div', now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))),
        el('div.ac-batt', `${Math.round(b.level * 100)}%${b.charging ? ' ⚡' : ''}`)),
      qa,
      el('div.ac-links',
        el('button.ac-allsettings', { onclick: () => { close(); kernel.launch('settings'); } }, 'ALL SETTINGS'),
        notifications.items.length ? el('button.ac-clear', { onclick: () => { notifications.clear(); } }, 'CLEAR ALL') : null),
      list,
      el('div.ac-handle'));
  }

  function show() {
    if (shell.isLocked?.()) return;
    open = true; render();
    ac.classList.add('open');
    panel.style.transform = '';
  }
  function close() {
    if (!open) return;
    open = false;
    ac.classList.remove('open');
  }
  shell.openActionCenter = show;
  shell.closeActionCenter = close;
  notifications.on('change', () => open && render());
  settings.on('change', () => open && render());

  // Pull-down gesture from status bar; tap on status bar also opens.
  let sy = null;
  sb.addEventListener('pointerdown', (e) => { sy = e.clientY; });
  window.addEventListener('pointerup', (e) => {
    if (sy == null) return;
    const d = e.clientY - sy; sy = null;
    if (d > 30 || Math.abs(d) < 6) show();
  });
  ac.addEventListener('click', (e) => { if (e.target === ac) close(); });
  // swipe up on panel to close
  let py = null;
  panel.addEventListener('pointerdown', (e) => (py = e.clientY));
  panel.addEventListener('pointerup', (e) => { if (py != null && py - e.clientY > 60) close(); py = null; });

  const prevBack = shell.handleBack;
  shell.handleBack = () => { if (open) { close(); return true; } return prevBack?.(); };
}
