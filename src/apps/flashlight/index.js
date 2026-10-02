// Flashlight: real camera torch on Android Chrome, full-screen white light everywhere else. Steady + SOS modes.
import './style.css';
import { Power } from 'lucide';

const SOS = '... --- ...';
const UNIT = 220; // ms per Morse unit

export default async function launch(ctx) {
  const { root, os } = ctx;
  const { el, iconSVG } = os.ui;

  let mode = await ctx.storage.get('mode', 'steady'); // 'steady' | 'sos'
  let on = false;
  let source = null; // 'torch' | 'screen'
  let stream = null;
  let torchFailed = !/Android/i.test(navigator.userAgent); // only Android Chrome exposes torch
  let sosTimer = null;
  let releaseWake = null;
  let savedBrightness = null;

  const btn = el('button.flashlight-power', { 'aria-label': 'power', onclick: () => (on ? turnOff() : turnOn()) },
    el('span.flashlight-power-icon', { html: iconSVG(Power, { size: 64, stroke: 1.5 }) }));
  const status = el('div.flashlight-status', 'off');
  const hint = el('div.flashlight-hint');
  const modeBtns = ['steady', 'sos'].map((m) => el('button.flashlight-mode.tilt', { dataset: { m }, onclick: () => setMode(m) }, m === 'sos' ? 'SOS' : 'steady'));
  const screen = el('div.flashlight-screen', { hidden: true, onclick: () => turnOff() },
    el('div.flashlight-screen-hint', 'Screen light — tap anywhere to turn off'));
  const view = el('div.flashlight',
    el('div.flashlight-head', el('div.wp-app-title', 'FLASHLIGHT')),
    el('div.flashlight-center', btn, status),
    el('div.flashlight-modes', ...modeBtns),
    hint,
    screen);
  root.append(view);

  const paintMode = () => modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.m === mode));
  paintMode();
  hint.textContent = torchFailed ? 'Uses your screen as a light on this device.' : 'Uses the camera flash. Allow camera access when asked.';

  async function setMode(m) {
    if (m === mode) return;
    mode = m; paintMode();
    ctx.storage.set('mode', m);
    if (on) { stopSOS(); if (mode === 'sos') startSOS(); else await light(true); }
  }

  async function ensureTorch() {
    if (torchFailed) return false;
    if (stream) return true;
    try {
      stream = await os.device.getCamera({ facing: 'environment', width: 640, height: 480 });
      await os.device.torch(true, stream); // throws (and stops the stream) if unsupported
      return true;
    } catch (e) {
      stream = null; torchFailed = true;
      hint.textContent = 'This browser can’t control the flash, so your screen is the light.';
      return false;
    }
  }

  async function light(v) {
    if (source === 'torch') {
      try { await os.device.torch(v, stream); } catch { source = 'screen'; stream = null; }
    }
    if (source === 'screen') screen.classList.toggle('lit', v);
    view.classList.toggle('lit', v);
  }

  function startSOS() {
    // Build a timeline of [on?, units]
    const seq = [];
    const words = SOS.split(' ');
    words.forEach((w, wi) => {
      [...w].forEach((c, ci) => { seq.push([true, c === '.' ? 1 : 3]); if (ci < w.length - 1) seq.push([false, 1]); });
      seq.push([false, wi < words.length - 1 ? 3 : 7]);
    });
    let i = 0;
    const step = async () => {
      if (!on || mode !== 'sos') return;
      const [v, u] = seq[i];
      await light(v);
      i = (i + 1) % seq.length;
      sosTimer = setTimeout(step, u * UNIT);
    };
    step();
  }
  function stopSOS() { clearTimeout(sosTimer); sosTimer = null; }

  async function turnOn() {
    if (on) return;
    on = true;
    os.sounds.tap?.();
    btn.classList.add('on'); status.textContent = 'on';
    source = (await ensureTorch()) ? 'torch' : 'screen';
    if (!on) return; // turned off while waiting
    if (source === 'screen') {
      screen.hidden = false;
      ctx.setFullscreen(true);
      const b = os.settings.get('brightness');
      if (b != null && b < 1) { savedBrightness = b; os.settings.set('brightness', 1); }
    }
    releaseWake = await os.device.wakeLock();
    if (mode === 'sos') startSOS(); else await light(true);
  }

  async function turnOff() {
    if (!on) return;
    on = false;
    stopSOS();
    btn.classList.remove('on'); status.textContent = 'off';
    if (source === 'torch' && stream) { try { await os.device.torch(false, stream); } catch {} }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    screen.classList.remove('lit'); screen.hidden = true; view.classList.remove('lit');
    ctx.setFullscreen(false);
    if (savedBrightness != null) { os.settings.set('brightness', savedBrightness); savedBrightness = null; }
    releaseWake?.(); releaseWake = null;
    source = null;
  }

  ctx.onBack(() => { if (on && source === 'screen') { turnOff(); return true; } return false; });
  if (ctx.args?.on) turnOn();
  ctx.on('args', (a) => { if (a?.on) turnOn(); });

  return { onSuspend: turnOff, onDestroy: turnOff };
}
