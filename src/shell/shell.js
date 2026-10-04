// The phone shell: status bar, navigation bar, hardware keys, back-button integration, auto-lock.
import { $, el, onLongPress, formatTime } from '../os/util.js';
import { kernel } from '../os/kernel.js';
import { settings } from '../os/settings.js';
import { installTilt } from '../os/ui.js';
import { iconSVG, I } from '../os/icons.js';
import { device } from '../os/device.js';
import { media } from '../os/media.js';
import { sounds } from '../os/sounds.js';
import { initStart } from './start.js';
import { initLock } from './lockscreen.js';
import { initActionCenter } from './actioncenter.js';
import { initSwitcher } from './switcher.js';
import { initVolume } from './volume.js';
import { runOOBE } from './oobe.js';

export const WIN_LOGO = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 4.7 9.8 3.6v7.6H2zM10.8 3.5 22 2v9.2H10.8zM2 12.2h7.8v7.6L2 18.7zM10.8 12.2H22V22l-11.2-1.5z"/></svg>';

const signalSVG = (bars = 4) => `<svg viewBox="0 0 20 14" width="20" height="14">${[0, 1, 2, 3, 4].map((i) => `<rect x="${i * 4}" y="${12 - i * 3}" width="3" height="${2 + i * 3}" fill="currentColor" opacity="${i < bars ? 1 : 0.3}"/>`).join('')}</svg>`;
const batterySVG = (level, charging) => `<svg viewBox="0 0 26 13" width="24" height="12"><rect x="0.5" y="0.5" width="22" height="12" fill="none" stroke="currentColor"/><rect x="23" y="4" width="2.5" height="5" fill="currentColor"/><rect x="2" y="2" width="${Math.max(1, 19 * level)}" height="9" fill="currentColor"/>${charging ? '<path d="M12 1 7 7h4l-1 5 5-6h-4z" fill="var(--bg)" stroke="currentColor" stroke-width=".6"/>' : ''}</svg>`;

export async function initShell(os) {
  const screen = $('#screen');
  const shell = {
    screen,
    onForeground: () => {},
    handleBack: () => false,
  };
  kernel.host = $('#app-layer');
  kernel.shell = shell;
  window.__shell = shell; // debugging aid
  installTilt(screen);

  // Track screen size for apps/switcher
  new ResizeObserver(() => {
    const r = screen.getBoundingClientRect();
    screen.style.setProperty('--screen-w', r.width + 'px');
    screen.style.setProperty('--screen-h', r.height + 'px');
  }).observe(screen);

  /* -------- status bar -------- */
  const sb = $('#statusbar');
  const renderStatus = () => {
    const b = device.battery;
    const air = settings.get('airplane');
    const net = air ? iconSVG(I.airplane, { size: 13, stroke: 2.2 }) : `${signalSVG(device.online ? 4 : 0)}${settings.get('wifi') && device.online ? iconSVG(I.wifi, { size: 14, stroke: 2.4 }) : device.online ? '<span class="sb-net">4G</span>' : ''}`;
    sb.innerHTML = `<div class="sb-left">${net}${settings.get('bluetooth') ? iconSVG(I.bluetooth, { size: 13, stroke: 2.2 }) : ''}${settings.get('batterySaver') ? '<span class="sb-net">♥</span>' : ''}</div>
      <div class="sb-right">${media.playing ? iconSVG(I.music, { size: 13, stroke: 2.2 }) : ''}${batterySVG(b.level, b.charging)}<span class="sb-time">${formatTime()}</span></div>`;
  };
  renderStatus();
  setInterval(renderStatus, 10000);
  device.on('battery', renderStatus); device.on('network', renderStatus); media.on('change', renderStatus);
  settings.on('change', renderStatus);
  shell.renderStatus = renderStatus;

  /* -------- nav bar -------- */
  const nav = $('#navbar');
  const backBtn = el('button.nav-btn', { 'aria-label': 'Back', html: iconSVG(I.back, { size: 22, stroke: 2 }) });
  const homeBtn = el('button.nav-btn', { 'aria-label': 'Start', html: WIN_LOGO });
  const searchBtn = el('button.nav-btn', { 'aria-label': 'Search', html: iconSVG(I.search, { size: 22, stroke: 2 }) });
  nav.append(backBtn, homeBtn, searchBtn);
  const press = () => { device.vibrate(12); };
  backBtn.addEventListener('click', () => { press(); kernel.back(); });
  homeBtn.addEventListener('click', () => { press(); shell.goHome(); });
  searchBtn.addEventListener('click', () => { press(); openSearch(); });
  onLongPress(backBtn, () => shell.openSwitcher?.());
  onLongPress(searchBtn, () => openSearch(true));
  onLongPress(homeBtn, () => openSearch(true));

  function openSearch(voice = false) {
    if (shell.isLocked?.()) return;
    if (kernel.apps.has('cortana')) kernel.launch('cortana', voice ? { listen: true } : {});
    else if (kernel.apps.has('ie')) kernel.launch('ie', { url: 'https://www.bing.com' });
  }

  shell.goHome = () => {
    if (shell.isLocked?.()) return;
    shell.closeSwitcher?.();
    shell.closeActionCenter?.();
    if (kernel.foreground) kernel.home();
    else shell.startHome?.();
  };

  /* -------- hardware buttons (desktop frame) & keyboard -------- */
  $('.hw-power').addEventListener('click', () => (shell.isLocked() ? shell.wake() : shell.lock()));
  $('.hw-camera').addEventListener('click', () => kernel.apps.has('camera') && kernel.launch('camera'));
  $('.hw-vol-up').addEventListener('click', () => shell.volume?.(+1));
  $('.hw-vol-down').addEventListener('click', () => shell.volume?.(-1));
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return; // apps may claim keys by calling preventDefault()
    const inInput = e.target.closest?.('input, textarea, [contenteditable]');
    if (e.key === 'Escape' || (e.key === 'Backspace' && !inInput)) { e.preventDefault(); kernel.back(); }
    else if (e.key === 'Home' && !inInput) { e.preventDefault(); shell.goHome(); }
    else if (e.key === 'F2') { e.preventDefault(); shell.openSwitcher?.(); }
    else if (e.key === 'F3') { e.preventDefault(); openSearch(); }
    else if (e.key === 'F4') { e.preventDefault(); shell.isLocked() ? shell.wake() : shell.lock(); }
  });

  /* -------- browser/Android back button -> OS back -------- */
  history.replaceState({ wp: 'base' }, '');
  history.pushState({ wp: 'top' }, '');
  window.addEventListener('popstate', async () => {
    const handled = await kernel.back();
    if (handled || kernel.foreground || !shell.atStartRoot?.()) history.pushState({ wp: 'top' }, '');
    else history.pushState({ wp: 'top' }, ''); // WP: Back on Start does nothing; keep trapping
  });

  /* -------- brightness -------- */
  // Brightness setting, plus a slight extra dim while Battery Saver is on
  const applyDim = () => ($('#dim-layer').style.opacity = String(Math.min(0.85, 1 - Math.max(0.15, settings.get('brightness') || 1) + (settings.get('batterySaver') ? 0.12 : 0))));
  settings.watch('brightness', applyDim);
  settings.on('change:batterySaver', applyDim);
  settings.watch('batterySaver', (v) => screen.classList.toggle('battery-saver', !!v));

  /* -------- sub-systems -------- */
  initStart(os, shell);
  initSwitcher(os, shell);
  initActionCenter(os, shell);
  initVolume(os, shell);
  await initLock(os, shell);

  /* -------- auto lock -------- */
  let last = Date.now();
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, () => (last = Date.now()), { passive: true, capture: true }));
  setInterval(() => {
    const ms = settings.get('autoLock');
    if (!ms || shell.isLocked()) return;
    if (document.querySelector('video:not([paused])') && [...document.querySelectorAll('video')].some((v) => !v.paused)) return;
    if (kernel.foreground?.manifest.keepAwake) return;
    if (Date.now() - last > ms) shell.lock();
  }, 5000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (settings.get('autoLock') && hiddenAt && Date.now() - hiddenAt > settings.get('autoLock')) shell.lock(true);
  });

  if (settings.get('firstRun')) await runOOBE(os, shell);
  return shell;
}
