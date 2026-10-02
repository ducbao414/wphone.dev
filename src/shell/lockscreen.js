// Lock screen: Bing daily wallpaper (or user photo), big clock, notification counts, now playing, swipe-up unlock + PIN.
import { $, el, formatTime } from '../os/util.js';
import { settings } from '../os/settings.js';
import { kernel } from '../os/kernel.js';
import { notifications } from '../os/notifications.js';
import { media } from '../os/media.js';
import { fs } from '../os/fs.js';
import { api } from '../os/net.js';
import { iconSVG, I } from '../os/icons.js';
import { sounds } from '../os/sounds.js';

export async function initLock(os, shell) {
  const layer = $('#lock-layer');
  const bg = el('div.lock-bg');
  const time = el('div.lock-time');
  const date = el('div.lock-date');
  const badges = el('div.lock-badges');
  const detail = el('div.lock-detail');
  const music = el('div.lock-music');
  const credit = el('div.lock-credit');
  const panel = el('div.lock-panel', bg, el('div.lock-shade'), credit, music, el('div.lock-clock', time, date, detail, badges));
  const pin = el('div.lock-pin');
  layer.append(pin, panel);
  let locked = false;

  const tick = () => {
    const now = new Date();
    time.textContent = formatTime(now).replace(/\s?[AP]M$/i, '');
    date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  };
  setInterval(tick, 5000);

  function renderBadges() {
    const counts = new Map();
    for (const n of notifications.items) if (!n.read && n.appId) counts.set(n.appId, (counts.get(n.appId) || 0) + 1);
    badges.replaceChildren(...[...counts].slice(0, 5).map(([id, c]) => { const m = kernel.get(id); return m ? el('div.lock-badge', { html: iconSVG(m.icon, { size: 22 }) + `<span>${c}</span>` }) : null; }));
    const latest = notifications.items.find((n) => !n.read);
    detail.textContent = latest ? `${latest.title}${latest.body ? ' — ' + latest.body : ''}` : '';
    // Upcoming calendar event or alarm can be published by apps through settings key 'lockDetail'
    if (!latest && settings.get('lockDetail')) detail.textContent = settings.get('lockDetail');
  }
  notifications.on('change', renderBadges);
  settings.on('change:lockDetail', renderBadges);

  function renderMusic() {
    const t = media.current;
    music.hidden = !t || !settings.get('lockShowArtist');
    if (!t) return;
    music.replaceChildren(
      el('div.lock-music-text', el('div', t.title || ''), el('div.subtle', t.artist || '')),
      el('div.lock-music-btns',
        el('button', { html: iconSVG(I.prev, { size: 22 }), onclick: (e) => { e.stopPropagation(); media.prev(); } }),
        el('button', { html: iconSVG(media.playing ? I.pause : I.play, { size: 22 }), onclick: (e) => { e.stopPropagation(); media.toggle(); } }),
        el('button', { html: iconSVG(I.next, { size: 22 }), onclick: (e) => { e.stopPropagation(); media.next(); } })));
    if (t.art) bg.style.backgroundImage = `url("${t.art}")`;
  }
  media.on('change', renderMusic);

  async function loadWallpaper() {
    const w = settings.get('lockWallpaper');
    credit.textContent = '';
    if (w === 'accent') { bg.style.backgroundImage = ''; bg.style.background = 'var(--accent)'; return; }
    bg.style.background = '';
    if (w && w !== 'bing' && (await fs.exists(w))) { bg.style.backgroundImage = `url("${await fs.url(w)}")`; return; }
    try {
      const b = await api.bing();
      const img = new Image();
      img.src = b.url;
      await img.decode();
      bg.style.backgroundImage = `url("${b.url}")`;
      credit.textContent = b.copyright || b.title || '';
    } catch {
      bg.style.backgroundImage = 'linear-gradient(160deg, var(--accent-dark), #000)';
    }
  }
  settings.on('change:lockWallpaper', loadWallpaper);

  /* -------- swipe up to unlock -------- */
  let sy = null, dy = 0, st = 0;
  panel.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; sy = e.clientY; dy = 0; st = Date.now(); panel.style.transition = 'none'; panel.setPointerCapture?.(e.pointerId); });
  panel.addEventListener('pointermove', (e) => {
    if (sy == null) return;
    dy = Math.min(0, e.clientY - sy);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (sy == null) return;
    sy = null;
    panel.style.transition = '';
    const h = panel.clientHeight;
    const fast = Date.now() - st < 300 && dy < -40;
    if (dy < -h * 0.3 || fast) slideAway();
    else if (dy > -8) { panel.style.transform = 'translateY(-60px)'; setTimeout(() => (panel.style.transform = ''), 180); } // tap: hint bounce
    else panel.style.transform = '';
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') slideAway(); });
  layer.addEventListener('wheel', (e) => { if (e.deltaY > 30 && locked && !pin.classList.contains('show')) slideAway(); }, { passive: true });

  function slideAway() {
    panel.style.transform = 'translateY(-110%)';
    if (settings.get('lockPin')) showPin();
    else setTimeout(unlock, 250);
  }

  /* -------- PIN -------- */
  function showPin() {
    let entered = '';
    const dots = el('div.pin-dots');
    const msg = el('div.pin-msg', 'enter PIN');
    const upd = () => (dots.textContent = '•'.repeat(entered.length) || ' ');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => el('button.pin-key' + (k ? '.tilt' : '.blank'), {
      onclick: () => {
        if (!k) return;
        sounds.key();
        if (k === '⌫') entered = entered.slice(0, -1);
        else entered += k;
        upd();
        if (entered.length >= settings.get('lockPin').length) {
          if (entered === settings.get('lockPin')) unlock();
          else { msg.textContent = 'wrong PIN, try again'; entered = ''; upd(); navigator.vibrate?.(200); }
        }
      },
    }, k));
    pin.replaceChildren(el('div.pin-time', formatTime()), msg, dots, el('div.pin-pad', keys));
    upd();
    pin.classList.add('show');
  }

  function unlock() {
    locked = false;
    sounds.unlock();
    layer.classList.add('unlocking');
    setTimeout(() => { layer.classList.remove('active', 'unlocking'); pin.classList.remove('show'); panel.style.transform = ''; }, 250);
    notifications.markRead();
    shell.renderStatus?.();
  }

  shell.isLocked = () => locked;
  shell.unlock = () => locked && unlock();
  shell.lock = (silent) => {
    if (locked) return;
    locked = true;
    if (!silent) sounds.lock();
    tick(); renderBadges(); renderMusic();
    panel.style.transform = '';
    pin.classList.remove('show');
    layer.classList.add('active');
    shell.closeActionCenter?.();
    shell.closeSwitcher?.();
    loadWallpaper();
  };
  shell.wake = () => { if (locked) { panel.style.transform = 'translateY(-60px)'; setTimeout(() => (panel.style.transform = ''), 180); } };
  const prevBack = shell.handleBack;
  shell.handleBack = () => (locked ? true : prevBack?.());

  tick();
  loadWallpaper().catch(() => {});
  // In dev, HMR reloads constantly; only lock on boot in production (or when a PIN is set).
  if (!settings.get('firstRun') && (import.meta.env.PROD || settings.get('lockPin'))) shell.lock(true);
}
