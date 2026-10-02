// Compass: device orientation → rotating WP-style compass rose, heading + cardinal, bubble level.
import './style.css';
import { Navigation, MapPin, Compass as CompassIcon } from 'lucide';

const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const NAMES = { N: 'north', E: 'east', S: 'south', W: 'west' };
const cardinal = (h) => CARD[Math.round(h / 22.5) % 16];

function roseSVG() {
  const c = 150, R = 140;
  let ticks = '', labels = '';
  for (let d = 0; d < 360; d += 5) {
    const major = d % 30 === 0, mid = d % 15 === 0;
    const len = major ? 16 : mid ? 10 : 6;
    const a = (d - 90) * Math.PI / 180;
    const x1 = c + Math.cos(a) * R, y1 = c + Math.sin(a) * R;
    const x2 = c + Math.cos(a) * (R - len), y2 = c + Math.sin(a) * (R - len);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="compass-tick${major ? ' major' : ''}${d === 0 ? ' north' : ''}"/>`;
    if (major && d % 90 !== 0) {
      const lx = c + Math.cos(a) * (R - 30), ly = c + Math.sin(a) * (R - 30);
      labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="compass-num" transform="rotate(${d} ${lx.toFixed(1)} ${ly.toFixed(1)})">${d}</text>`;
    }
  }
  const card = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([t, d]) => {
    const a = (d - 90) * Math.PI / 180, r = R - 56;
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="compass-card${t === 'N' ? ' north' : ''}" transform="rotate(${d} ${x.toFixed(1)} ${y.toFixed(1)})">${t}</text>`;
  }).join('');
  // Four-point star in the middle (WP flat style: two-tone triangles)
  const star = [0, 90, 180, 270].map((d) => {
    const isN = d === 0;
    return `<g transform="rotate(${d} ${c} ${c})"><polygon points="${c},${c - 62} ${c - 11},${c} ${c},${c}" class="compass-star a${isN ? ' north' : ''}"/><polygon points="${c},${c - 62} ${c + 11},${c} ${c},${c}" class="compass-star b${isN ? ' north' : ''}"/></g>`;
  }).join('');
  return `<svg viewBox="0 0 300 300" class="compass-rose-svg"><circle cx="${c}" cy="${c}" r="${R + 6}" class="compass-ring"/>${ticks}${labels}${card}${star}<circle cx="${c}" cy="${c}" r="5" class="compass-hub"/></svg>`;
}

export default async function launch(ctx) {
  const { root, os } = ctx;
  const { el, iconSVG, appBar } = os.ui;

  const degEl = el('div.compass-deg', '—');
  const cardEl = el('div.compass-cardinal', '');
  const rose = el('div.compass-rose', { html: roseSVG() });
  const bubble = el('div.compass-bubble');
  const dial = el('div.compass-dial', el('div.compass-lubber'), rose, el('div.compass-level', bubble));
  const msg = el('div.compass-msg');
  const coords = el('div.compass-coords');
  const startBtn = os.ui.button('start compass', () => start(true), { accent: true, icon: Navigation });
  startBtn.hidden = true;

  const view = el('div.compass',
    el('div.compass-head', el('div.wp-app-title', 'COMPASS')),
    el('div.compass-readout', degEl, cardEl),
    dial,
    el('div.compass-foot', msg, startBtn, coords));
  root.append(view);

  let shown = 0;       // continuous rotation value (avoids 359→0 spins)
  let target = null;
  let raf = 0;
  let stop = null;
  let gotData = false;
  let manual = false;
  let lastTick = -1;

  const render = (h) => {
    const hd = ((Math.round(h) % 360) + 360) % 360;
    degEl.textContent = hd + '°';
    const c = cardinal(hd);
    cardEl.textContent = NAMES[c] || c;
    rose.style.transform = `rotate(${-shown}deg)`;
    const quad = Math.round(hd / 90) % 4; // buzz when passing N / E / S / W
    if (gotData && lastTick !== -1 && quad !== lastTick && Math.abs(((hd + 45) % 90) - 45) < 3) os.device.vibrate(8);
    if (Math.abs(((hd + 45) % 90) - 45) < 3) lastTick = quad;
  };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (target == null) return;
    let d = ((target - shown) % 360 + 540) % 360 - 180;
    if (Math.abs(d) < 0.05) d = 0;
    shown += d * 0.18;
    render(shown);
  };

  const onData = ({ heading, beta, gamma }) => {
    if (manual) return;
    if (heading == null || isNaN(heading)) {
      if (beta != null && !gotData) msg.textContent = 'Your device isn’t reporting a magnetic heading. Try moving it in a figure 8 to calibrate.';
      return;
    }
    if (!gotData) { gotData = true; msg.textContent = ''; view.classList.add('live'); }
    const screenAngle = screen.orientation?.angle || window.orientation || 0;
    target = (heading + screenAngle + 360) % 360;
    if (beta != null && gamma != null) {
      const x = Math.max(-1, Math.min(1, gamma / 30)), y = Math.max(-1, Math.min(1, beta / 30));
      bubble.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
      bubble.classList.toggle('level', Math.abs(beta) < 2 && Math.abs(gamma) < 2);
    }
  };

  const needsPermission = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';

  async function start(fromClick) {
    if (needsPermission && !fromClick) {
      startBtn.hidden = false;
      msg.textContent = 'Tap below to allow access to the compass sensor.';
      return;
    }
    startBtn.hidden = true;
    try {
      stop?.();
      stop = await os.device.watchOrientation(onData);
      msg.textContent = 'Waiting for the compass sensor…';
      setTimeout(() => { if (!gotData && root.isConnected) desktopFallback(); }, 2500);
    } catch (e) {
      msg.textContent = 'Compass access was denied. ' + (e.message || '');
      startBtn.hidden = !needsPermission;
    }
  }

  function desktopFallback() {
    manual = true;
    view.classList.add('manual');
    msg.textContent = os.device.isMobile
      ? 'No compass sensor found on this device. Drag the dial to explore.'
      : 'Compass needs a phone with a magnetometer. On desktop you can drag the dial to try it out.';
    if (target == null) { target = 0; render(0); }
  }

  // Drag-to-rotate (desktop/manual mode)
  let dragA = null, dragStart = 0;
  const angleAt = (e) => { const r = dial.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
  dial.addEventListener('pointerdown', (e) => { if (!manual) return; dragA = angleAt(e); dragStart = target; dial.setPointerCapture(e.pointerId); });
  dial.addEventListener('pointermove', (e) => { if (dragA == null) return; target = ((dragStart - (angleAt(e) - dragA)) % 360 + 360) % 360; });
  const endDrag = () => { dragA = null; };
  dial.addEventListener('pointerup', endDrag); dial.addEventListener('pointercancel', endDrag);

  async function showLocation() {
    coords.textContent = 'locating…';
    try {
      const p = await os.device.locate({ highAccuracy: true });
      const f = (v, pos, neg) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
      coords.textContent = `${f(p.lat, 'N', 'S')}   ${f(p.lon, 'E', 'W')}${p.approximate ? ' (approx.)' : ''}`;
    } catch (e) { coords.textContent = 'Location unavailable: ' + e.message; }
  }

  const bar = appBar({
    buttons: [
      { icon: MapPin, label: 'location', onClick: showLocation },
      { icon: CompassIcon, label: 'calibrate', onClick: () => os.ui.alert('Hold your phone away from metal and magnets, then slowly move it in a figure 8 a few times. The heading will become steadier as the sensor calibrates.', 'calibrate compass') },
    ],
  });
  view.append(bar.el);

  raf = requestAnimationFrame(loop);
  start(false);

  const cleanup = () => { cancelAnimationFrame(raf); stop?.(); stop = null; };
  return {
    onSuspend: () => { cancelAnimationFrame(raf); stop?.(); stop = null; },
    onResume: () => { raf = requestAnimationFrame(loop); if (!manual && !needsPermission) start(false); else if (!manual && gotData) start(true); },
    onDestroy: cleanup,
  };
}
