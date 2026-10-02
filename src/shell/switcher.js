// Task switcher (long-press Back): running apps shown as zoomed-out cards. Tap to switch, X to close.
import { $, el } from '../os/util.js';
import { kernel } from '../os/kernel.js';
import { iconSVG, I } from '../os/icons.js';

export function initSwitcher(os, shell) {
  const layer = $('#switcher-layer');
  const appLayer = $('#app-layer');
  let open = false;

  function show() {
    if (shell.isLocked?.() || !kernel.running.length) return;
    shell.closeActionCenter?.();
    open = true;
    const insts = [...kernel.running];
    const strip = el('div.sw-strip');
    layer.replaceChildren(strip);
    // Cards: placeholder slots in the strip; actual app frames are positioned over them using transforms.
    const slots = insts.map((inst) => {
      const slot = el('div.sw-slot',
        el('div.sw-title', el('span', { html: iconSVG(inst.manifest.icon, { size: 16 }) }), inst.manifest.name),
        el('div.sw-card'),
        el('button.sw-close', { 'aria-label': 'close', html: iconSVG(I.close, { size: 18, stroke: 2.5 }) }));
      slot.querySelector('.sw-card').addEventListener('click', () => pick(inst));
      slot.querySelector('.sw-close').addEventListener('click', (e) => {
        e.stopPropagation();
        slot.classList.add('closing');
        setTimeout(() => { kernel.close(inst.appId); slot.remove(); placeFrames(); if (!kernel.running.length) hide(); }, 200);
      });
      let sy = null;
      slot.addEventListener('pointerdown', (e) => (sy = e.clientY));
      slot.addEventListener('pointerup', (e) => { if (sy != null && e.clientY - sy > 80) slot.querySelector('.sw-close').click(); sy = null; });
      slot._inst = inst;
      strip.append(slot);
      return slot;
    });
    layer.classList.add('open');
    appLayer.classList.add('switching');
    const ar = appLayer.getBoundingClientRect();
    strip.style.setProperty('--sw-aspect', ar.width / ar.height);
    strip.style.setProperty('--sw-w', ar.width * 0.6 + 'px');
    const placeFrames = () => {
      const lr = appLayer.getBoundingClientRect();
      for (const slot of strip.children) {
        const card = slot.querySelector('.sw-card');
        const r = card.getBoundingClientRect();
        const f = slot._inst.frame;
        const scale = r.width / lr.width;
        f.classList.add('in-switcher');
        f.style.transform = `translate(${r.left - lr.left}px, ${r.top - lr.top}px) scale(${scale})`;
      }
    };
    strip.addEventListener('scroll', () => requestAnimationFrame(placeFrames), { passive: true });
    requestAnimationFrame(() => {
      const cur = slots.find((s) => s._inst === kernel.foreground) || slots[slots.length - 1];
      cur?.scrollIntoView({ inline: 'center', block: 'nearest' });
      placeFrames();
    });
    shell._placeFrames = placeFrames;
  }

  function hide(keepForeground = true) {
    if (!open) return;
    open = false;
    layer.classList.remove('open');
    appLayer.classList.remove('switching');
    for (const inst of kernel.running) { inst.frame.classList.remove('in-switcher'); inst.frame.style.transform = ''; }
    layer.replaceChildren();
  }

  function pick(inst) {
    hide();
    kernel.switchTo(inst);
  }

  shell.openSwitcher = show;
  shell.closeSwitcher = hide;
  const prevBack = shell.handleBack;
  shell.handleBack = () => {
    if (open) { hide(); return true; }
    return prevBack?.();
  };
}
