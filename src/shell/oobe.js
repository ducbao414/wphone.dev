// First-run experience ("hi there"): name, accent color, permissions.
import { $, el, sleep } from '../os/util.js';
import { settings } from '../os/settings.js';
import { ACCENTS } from '../os/theme.js';
import * as ui from '../os/ui.js';
import { device } from '../os/device.js';
import { WIN_LOGO } from './shell.js';
import { install } from '../os/install.js';

export function runOOBE(os, shell) {
  return new Promise((resolve) => {
    const layer = el('div.oobe');
    $('#overlay-layer').append(layer);
    const step = (content, next) => {
      const page = el('div.oobe-page.anim-turnstile-in', ...content);
      layer.replaceChildren(page);
    };

    const s1 = () => step([
      el('div.oobe-logo', { html: WIN_LOGO }),
      el('div.oobe-big', 'hi there'),
      el('p', 'Welcome to your Windows Phone. Everything you do here — photos, notes, music, settings — stays private in this browser on this device.'),
      el('div.oobe-actions', ui.button('next', s2, { accent: true })),
    ]);

    const s2 = () => {
      const name = ui.textbox({ label: 'Your name', value: '', placeholder: 'e.g. Bao' });
      step([
        el('div.oobe-title', 'ABOUT YOU'),
        el('div.oobe-big', 'who are you?'),
        name,
        el('p.subtle', 'Used on your Me tile, in Cortana and in Messaging.'),
        el('div.oobe-actions', ui.button('next', async () => { await settings.set('ownerName', name.value.trim() || 'Lumia owner'); s3(); }, { accent: true })),
      ]);
    };

    const s3 = () => {
      const grid = el('div.oobe-accents', Object.entries(ACCENTS).map(([k, c]) => el('button.oobe-accent.tilt' + (settings.get('accent') === k ? '.sel' : ''), {
        style: { background: c }, 'aria-label': k,
        onclick: async (e) => { await settings.set('accent', k); grid.querySelectorAll('.sel').forEach((n) => n.classList.remove('sel')); e.currentTarget.classList.add('sel'); lbl.textContent = k; },
      })));
      const lbl = el('div.oobe-accent-name', settings.get('accent'));
      const theme = ui.toggle({ label: 'Light background', value: settings.get('theme') === 'light', onChange: (v) => settings.set('theme', v ? 'light' : 'dark') });
      step([el('div.oobe-title', 'MAKE IT YOURS'), el('div.oobe-big', 'pick a color'), grid, lbl, theme.el,
        el('div.oobe-actions', ui.button('next', s4, { accent: true }))]);
    };

    const s4 = () => {
      const loc = ui.toggle({ label: 'Location', description: 'Lets Weather, Maps and Cortana use your approximate city. Your phone never asks for your precise position.', value: true, onChange: (v) => settings.set('location', v) });
      step([el('div.oobe-title', 'PRIVACY'), el('div.oobe-big', 'a few settings'), loc.el,
        install.available ? el('div.oobe-install',
          el('p.subtle', 'Add it to your home screen to open it full screen, like a real Windows Phone.'),
          ui.button('add to home screen', () => install.prompt(os))) : null,
        el('div.oobe-actions', ui.button('finish', async () => {
          await settings.set('firstRun', false);
          layer.classList.add('oobe-out');
          await sleep(300);
          layer.remove();
          resolve();
        }, { accent: true }))]);
    };
    s1();
  });
}
