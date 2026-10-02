import '@fontsource/open-sans/300.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import './styles/base.css';
import './styles/controls.css';
import './shell/shell.css';
import { install } from './os/install.js'; // first: catch the browser's install event early

import { openDB } from './os/db.js';
import { settings } from './os/settings.js';
import { initTheme } from './os/theme.js';
import { fs } from './os/fs.js';
import { kernel } from './os/kernel.js';
import { notifications } from './os/notifications.js';
import { device } from './os/device.js';
import { tiles } from './os/tiles.js';
import { os } from './os/api.js';
import { initShell } from './shell/shell.js';

// Convenience: let append/prepend/replaceChildren ignore null/undefined/false (common with conditional children).
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const fn of ['append', 'prepend', 'replaceChildren']) {
    const orig = proto[fn];
    proto[fn] = function (...nodes) { return orig.apply(this, nodes.filter((n) => n != null && n !== false)); };
  }
}

async function boot() {
  await openDB();
  await settings.load();
  window.__wp_h24 = settings.get('h24');
  settings.on('change:h24', (v) => (window.__wp_h24 = v));
  initTheme();
  await fs.init();
  await notifications.load();
  await device.init();
  kernel.init();
  await kernel.migrate();
  await initShell(os);
  await tiles.start();
  // Already running from the home screen: no need for the install tile
  if (install.installed) { kernel.get('install') && (kernel.get('install').hidden = true); tiles.unpin('install'); }
  kernel.startBackgrounds();
  device.persistStorage?.();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#fff;padding:20px;white-space:pre-wrap">Boot failed:\n${e?.stack || e}</pre>`;
});
