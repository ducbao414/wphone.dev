// Volume flyout (top band) shown by hardware volume keys or programmatically.
import { $, el } from '../os/util.js';
import { media } from '../os/media.js';
import { settings } from '../os/settings.js';
import { iconSVG, I } from '../os/icons.js';

export function initVolume(os, shell) {
  const host = $('#toast-layer');
  let node = null, hideT;
  const render = () => {
    const t = media.current;
    const vol = Math.round(media.volume * 30);
    node.replaceChildren(
      el('div.vol-row',
        el('button.vol-mode', { html: iconSVG(settings.get('vibrate') ? I.bell : I.mute, { size: 20 }), onclick: () => { settings.set('vibrate', !settings.get('vibrate')); render(); } }),
        el('div.vol-label', 'ringer + notifications'),
        el('div.vol-num', String(vol))),
      el('div.vol-bar', el('div.vol-fill', { style: { width: (vol / 30) * 100 + '%' } })),
      t ? el('div.vol-media',
        el('div.vol-media-text', el('b', t.title || ''), ' ', el('span.subtle', t.artist || '')),
        el('button', { html: iconSVG(I.prev, { size: 20 }), onclick: () => media.prev() }),
        el('button', { html: iconSVG(media.playing ? I.pause : I.play, { size: 20 }), onclick: () => { media.toggle(); setTimeout(render, 50); } }),
        el('button', { html: iconSVG(I.next, { size: 20 }), onclick: () => media.next() })) : null);
  };
  shell.volume = (dir = 0) => {
    if (dir) media.setVolume(Math.round(media.volume * 30 + dir * 2) / 30);
    if (!node) { node = el('div.vol-flyout'); host.append(node); node.addEventListener('pointerdown', () => { clearTimeout(hideT); hideT = setTimeout(hide, 4000); }); }
    render();
    clearTimeout(hideT);
    hideT = setTimeout(hide, 3000);
  };
  const hide = () => { if (node) { node.classList.add('out'); const n = node; node = null; setTimeout(() => n.remove(), 250); } };
}
