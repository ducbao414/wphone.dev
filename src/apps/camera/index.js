// Windows Phone 8.1 style Camera: live viewfinder, photo/video, lenses, timer, flash, grid, tap-to-focus.
import './style.css';
import { Zap, ZapOff, Timer, TimerOff, Grid3x3, SwitchCamera, Aperture, Video, Camera as CameraIcon, Image as ImageIcon } from 'lucide';

const ROLL = '/Pictures/Camera Roll';

export const LENSES = [
  { id: 'none', name: 'none', css: 'none' },
  { id: 'mono', name: 'mono', css: 'grayscale(1)' },
  { id: 'sepia', name: 'sepia', css: 'sepia(0.9)' },
  { id: 'vivid', name: 'vivid', css: 'saturate(1.6) contrast(1.1)' },
];

const pad = (n) => String(n).padStart(2, '0');
export function wpName(ext, d = new Date()) {
  return `WP_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}_Pro.${ext}`;
}

/** Apply a lens to a canvas in place. Uses ctx.filter when supported, else per-pixel math. */
function applyLens(canvas, lensId) {
  const lens = LENSES.find((l) => l.id === lensId);
  if (!lens || lens.id === 'none') return;
  const probe = document.createElement('canvas').getContext('2d');
  probe.filter = 'grayscale(1)';
  if (probe.filter === 'grayscale(1)') {
    const c2 = document.createElement('canvas');
    c2.width = canvas.width; c2.height = canvas.height;
    const g2 = c2.getContext('2d');
    g2.filter = lens.css;
    g2.drawImage(canvas, 0, 0);
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(c2, 0, 0);
    return;
  }
  const g = canvas.getContext('2d');
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], gr = d[i + 1], b = d[i + 2];
    if (lens.id === 'mono') { r = gr = b = 0.299 * r + 0.587 * gr + 0.114 * b; }
    else if (lens.id === 'sepia') {
      const nr = 0.393 * r + 0.769 * gr + 0.189 * b, ng = 0.349 * r + 0.686 * gr + 0.168 * b, nb = 0.272 * r + 0.534 * gr + 0.131 * b;
      r = r * 0.1 + nr * 0.9; gr = gr * 0.1 + ng * 0.9; b = b * 0.1 + nb * 0.9;
    } else if (lens.id === 'vivid') {
      const l = 0.299 * r + 0.587 * gr + 0.114 * b;
      r = l + (r - l) * 1.6; gr = l + (gr - l) * 1.6; b = l + (b - l) * 1.6;
      r = (r - 128) * 1.1 + 128; gr = (gr - 128) * 1.1 + 128; b = (b - 128) * 1.1 + 128;
    }
    d[i] = r; d[i + 1] = gr; d[i + 2] = b;
  }
  g.putImageData(img, 0, 0);
}

export default async function launch(ctx) {
  const { root, os, storage } = ctx;
  const { el, iconSVG } = os.ui;
  const prefs = Object.assign({ facing: 'environment', timer: 0, lens: 'none', grid: false, flash: false, mode: 'photo', geotag: true }, await storage.get('prefs', {}));
  const savePrefs = () => storage.set('prefs', prefs);

  let stream = null, track = null, caps = {}, starting = null, destroyed = false, suspended = false;
  let recorder = null, recChunks = [], recStart = 0, recTimer = null, recPoster = null, recMime = '';
  let countdown = null, geo = null, busy = false;

  /* ---------------- DOM ---------------- */
  const video = el('video.camera-video', { muted: true, playsInline: true, autoplay: true });
  video.setAttribute('playsinline', '');
  video.muted = true;
  const grid = el('div.camera-grid', el('i'), el('i'), el('i'), el('i'));
  const focusRing = el('div.camera-focus');
  const flashEl = el('div.camera-flash');
  const countEl = el('div.camera-count');
  const recTime = el('div.camera-rectime', '0:00');
  const viewfinder = el('div.camera-vf', video, grid, focusRing, countEl, recTime);
  const lensStrip = el('div.camera-lenses');

  const iconBtn = (cls, label, onClick) => el('button.camera-ibtn.' + cls, { 'aria-label': label, onclick: (e) => { e.stopPropagation(); onClick(e); } });
  const flashBtn = iconBtn('camera-flashbtn', 'flash', () => setFlash(!prefs.flash));
  const timerBtn = iconBtn('camera-timerbtn', 'timer', cycleTimer);
  const gridBtn = iconBtn('camera-gridbtn', 'grid lines', () => { prefs.grid = !prefs.grid; savePrefs(); syncUI(); });
  const lensBtn = iconBtn('camera-lensbtn', 'lenses', () => lensStrip.classList.toggle('open'));
  const switchBtn = iconBtn('camera-switchbtn', 'switch camera', switchCamera);
  const topBar = el('div.camera-top', flashBtn, timerBtn, gridBtn, lensBtn, switchBtn);

  const thumbBtn = el('button.camera-thumb', { 'aria-label': 'camera roll', onclick: openLast });
  const shutter = el('button.camera-shutter', { 'aria-label': 'shutter', onclick: onShutter }, el('span.camera-shutter-inner'));
  const modeBtn = el('button.camera-mode', { 'aria-label': 'photo / video', onclick: toggleMode },
    el('span.camera-mode-photo', { html: iconSVG(CameraIcon, { size: 18, stroke: 2 }) }),
    el('span.camera-mode-video', { html: iconSVG(Video, { size: 18, stroke: 2 }) }));
  const controls = el('div.camera-controls', thumbBtn, shutter, modeBtn);

  const errorEl = el('div.camera-error', { hidden: true });
  const view = el('div.camera', viewfinder, flashEl, topBar, lensStrip, controls, errorEl);
  root.append(view);

  for (const l of LENSES) {
    lensStrip.append(el('button.camera-lens', { dataset: { id: l.id }, onclick: (e) => { e.stopPropagation(); prefs.lens = l.id; savePrefs(); syncUI(); } },
      el('span.camera-lens-swatch', { style: { filter: l.css } }), el('span.camera-lens-name', l.name)));
  }

  function syncUI() {
    flashBtn.innerHTML = iconSVG(prefs.flash ? Zap : ZapOff, { size: 22, stroke: 2 });
    flashBtn.hidden = !caps.torch;
    flashBtn.classList.toggle('on', prefs.flash);
    timerBtn.innerHTML = iconSVG(prefs.timer ? Timer : TimerOff, { size: 22, stroke: 2 }) + (prefs.timer ? `<b>${prefs.timer}s</b>` : '');
    timerBtn.classList.toggle('on', !!prefs.timer);
    gridBtn.innerHTML = iconSVG(Grid3x3, { size: 22, stroke: 2 });
    gridBtn.classList.toggle('on', prefs.grid);
    lensBtn.innerHTML = iconSVG(Aperture, { size: 22, stroke: 2 });
    lensBtn.classList.toggle('on', prefs.lens !== 'none');
    switchBtn.innerHTML = iconSVG(SwitchCamera, { size: 22, stroke: 2 });
    switchBtn.disabled = !!recorder;
    grid.hidden = !prefs.grid;
    video.style.filter = LENSES.find((l) => l.id === prefs.lens)?.css || 'none';
    video.classList.toggle('mirror', prefs.facing === 'user');
    for (const b of lensStrip.children) b.classList.toggle('active', b.dataset.id === prefs.lens);
    view.classList.toggle('video-mode', prefs.mode === 'video');
    view.classList.toggle('recording', !!recorder);
    modeBtn.disabled = !!recorder;
  }

  /* ---------------- stream lifecycle ---------------- */
  function stopStream() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; track = null;
    video.srcObject = null;
  }

  async function start() {
    if (starting) return starting;
    starting = (async () => {
      stopStream();
      errorEl.replaceChildren(); errorEl.hidden = true;
      const wantAudio = prefs.mode === 'video';
      try {
        let s;
        try { s = await os.device.getCamera({ facing: prefs.facing, audio: wantAudio }); }
        catch (e) {
          if (wantAudio && e.name !== 'NotFoundError') s = await os.device.getCamera({ facing: prefs.facing, audio: false });
          else if (prefs.facing === 'user' && e.name === 'OverconstrainedError') { prefs.facing = 'environment'; s = await os.device.getCamera({ facing: 'environment', audio: wantAudio }); }
          else throw e;
        }
        if (destroyed || suspended) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        track = s.getVideoTracks()[0];
        caps = track.getCapabilities?.() || {};
        video.srcObject = s;
        await video.play().catch(() => {});
        if (prefs.flash && prefs.mode === 'video') setTorch(true);
        syncUI();
      } catch (e) {
        showError(e);
      } finally { starting = null; }
    })();
    return starting;
  }

  function showError(e) {
    errorEl.hidden = false;
    const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
    const msg = denied ? 'Camera access was blocked. Allow camera access for this site in your browser, then try again.'
      : e?.name === 'NotFoundError' ? 'No camera was found on this device.'
      : (e?.message || 'The camera couldn’t be started.');
    const captureInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
    const importInput = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, style: { display: 'none' } });
    captureInput.onchange = () => importFiles(captureInput.files, true);
    importInput.onchange = () => importFiles(importInput.files, false);
    errorEl.replaceChildren(
      el('div.wp-app-title', 'CAMERA'),
      el('div.camera-error-title', denied ? 'camera blocked' : 'no camera'),
      el('p.camera-error-msg', msg),
      os.ui.button('try again', () => start(), { accent: true }),
      os.device.isMobile ? os.ui.button('use device camera', () => captureInput.click()) : null,
      os.ui.button('choose from device', () => importInput.click()),
      os.ui.button('camera roll', () => openLast()),
      captureInput, importInput);
  }

  async function importFiles(files, fromCapture) {
    if (!files?.length) return;
    let last;
    for (const f of files) {
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
      const name = fromCapture ? wpName(ext === 'jpeg' ? 'jpg' : ext) : f.name;
      const p = await os.fs.uniquePath(os.path.join(ROLL, name));
      await os.fs.write(p, f, { mime: f.type || os.path.mimeOf(f.name) });
      last = p;
    }
    os.toast(`Saved ${files.length} item${files.length > 1 ? 's' : ''} to Camera Roll`);
    refreshThumb(last);
  }

  async function setTorch(on) {
    if (!track || !caps.torch) return;
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch {}
  }
  function setFlash(on) {
    prefs.flash = on; savePrefs(); syncUI();
    if (prefs.mode === 'video') setTorch(on);
  }
  function cycleTimer() {
    prefs.timer = prefs.timer === 0 ? 3 : prefs.timer === 3 ? 10 : 0;
    savePrefs(); syncUI();
    os.toast(prefs.timer ? `Self-timer: ${prefs.timer} seconds` : 'Self-timer off');
  }
  async function switchCamera() {
    if (recorder) return;
    prefs.facing = prefs.facing === 'user' ? 'environment' : 'user';
    savePrefs();
    view.classList.add('switching');
    await start();
    setTimeout(() => view.classList.remove('switching'), 300);
  }
  async function toggleMode() {
    if (recorder || countdown) return;
    prefs.mode = prefs.mode === 'photo' ? 'video' : 'photo';
    savePrefs(); syncUI();
    if (prefs.mode === 'photo') setTorch(false);
    // Video mode needs the microphone too: restart the stream.
    await start();
  }

  /* ---------------- geotag ---------------- */
  async function refreshGeo() {
    if (!prefs.geotag || !os.settings.get('location')) { geo = null; return; }
    try { const p = await os.device.getLocation({ timeout: 8000 }); geo = { lat: p.lat, lon: p.lon }; } catch { geo = null; }
  }

  /* ---------------- capture ---------------- */
  async function onShutter() {
    if (countdown) { cancelCountdown(); return; }
    if (!stream) return start();
    if (prefs.mode === 'video') { recorder ? stopRecording() : startWithTimer(startRecording); return; }
    if (busy) return;
    startWithTimer(takePhoto);
  }

  function cancelCountdown() {
    clearInterval(countdown); countdown = null;
    countEl.textContent = ''; countEl.classList.remove('show');
  }
  function startWithTimer(fn) {
    if (!prefs.timer) return fn();
    let n = prefs.timer;
    countEl.textContent = n; countEl.classList.add('show');
    os.sounds.tap();
    countdown = setInterval(() => {
      n--;
      if (n <= 0) { cancelCountdown(); fn(); return; }
      countEl.textContent = n;
      countEl.classList.remove('pulse'); void countEl.offsetWidth; countEl.classList.add('pulse');
      os.sounds.tap();
    }, 1000);
  }

  function grabFrame(maxSide) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const s = maxSide ? Math.min(1, maxSide / Math.max(vw, vh)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(vw * s); c.height = Math.round(vh * s);
    const g = c.getContext('2d');
    if (prefs.facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0, c.width, c.height);
    return c;
  }

  async function takePhoto() {
    busy = true;
    try {
      const flashFire = prefs.flash && caps.torch;
      if (flashFire) { await setTorch(true); await os.util.sleep(350); }
      const c = grabFrame();
      if (flashFire) setTorch(false);
      if (!c) { os.toast('Camera isn’t ready yet'); return; }
      os.sounds.shutter();
      flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go');
      applyLens(c, prefs.lens);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      const path = await os.fs.uniquePath(os.path.join(ROLL, wpName('jpg')));
      const meta = { width: c.width, height: c.height, source: 'camera', lens: prefs.lens };
      if (geo) meta.geo = geo;
      await os.fs.write(path, blob, { mime: 'image/jpeg', meta });
      c.width = c.height = 0;
      refreshThumb(path, true);
    } catch (e) {
      os.toast('Couldn’t save photo: ' + (e.message || e));
    } finally { busy = false; }
  }

  function pickMime() {
    const list = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    if (typeof MediaRecorder === 'undefined') return null;
    return list.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
  }

  function startRecording() {
    const mime = pickMime();
    if (mime == null) { os.toast('Video recording isn’t supported in this browser'); return; }
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) { os.toast('Can’t record video: ' + e.message); recorder = null; return; }
    recMime = recorder.mimeType || mime || 'video/webm';
    recChunks = [];
    const poster = grabFrame(480);
    recPoster = null;
    if (poster) poster.toBlob((b) => (recPoster = b), 'image/jpeg', 0.8);
    recorder.ondataavailable = (e) => { if (e.data?.size) recChunks.push(e.data); };
    recorder.onstop = saveRecording;
    recorder.start(1000);
    recStart = Date.now();
    recTime.textContent = '0:00';
    recTimer = setInterval(() => (recTime.textContent = os.util.formatDuration((Date.now() - recStart) / 1000)), 500);
    os.sounds.tap();
    syncUI();
  }
  function stopRecording() {
    if (!recorder) return;
    try { recorder.state !== 'inactive' && recorder.stop(); } catch {}
    clearInterval(recTimer);
  }
  async function saveRecording() {
    const r = recorder;
    recorder = null;
    syncUI();
    if (!recChunks.length) return;
    const type = (recMime || r?.mimeType || 'video/webm').split(';')[0];
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recChunks, { type });
    recChunks = [];
    try {
      const path = await os.fs.uniquePath(os.path.join(ROLL, wpName(ext, new Date(recStart))));
      const meta = { source: 'camera', duration: (Date.now() - recStart) / 1000 };
      if (geo) meta.geo = geo;
      await os.fs.write(path, blob, { mime: type, meta });
      if (recPoster) await os.fs.setThumb(path, recPoster);
      os.toast('Video saved to Camera Roll');
      refreshThumb(path, true);
    } catch (e) { os.toast('Couldn’t save video: ' + e.message); }
  }

  /* ---------------- tap to focus / pinch zoom ---------------- */
  const pointers = new Map();
  let pinch0 = null;
  viewfinder.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now() });
    if (pointers.size === 2 && caps.zoom) {
      const [a, b] = [...pointers.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: track.getSettings?.().zoom || caps.zoom.min || 1 };
    }
  });
  viewfinder.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { ...pointers.get(e.pointerId), x: e.clientX, y: e.clientY });
    if (pinch0 && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const z = os.util.clamp(pinch0.z * (d / pinch0.d), caps.zoom.min, caps.zoom.max);
      track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {});
    }
  });
  const up = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pinch0) { if (!pointers.size) pinch0 = null; return; }
    if (e.type !== 'pointerup' || !p || Date.now() - p.t > 500 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
    lensStrip.classList.remove('open');
    focusAt(e);
  };
  viewfinder.addEventListener('pointerup', up);
  viewfinder.addEventListener('pointercancel', up);

  function focusAt(e) {
    const r = viewfinder.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    focusRing.style.left = x + 'px'; focusRing.style.top = y + 'px';
    focusRing.classList.remove('go'); void focusRing.offsetWidth; focusRing.classList.add('go');
    if (!track) return;
    const adv = {};
    if (caps.pointsOfInterest || 'pointsOfInterest' in (track.getSettings?.() || {})) adv.pointsOfInterest = [{ x: x / r.width, y: y / r.height }];
    if (caps.focusMode?.includes('single-shot')) adv.focusMode = 'single-shot';
    if (Object.keys(adv).length) track.applyConstraints({ advanced: [adv] }).catch(() => {});
  }

  /* ---------------- last photo thumbnail ---------------- */
  let lastPath = null;
  async function refreshThumb(path, animate) {
    if (!path) {
      const items = (await os.fs.list(ROLL)).filter((m) => m.type === 'file' && /^(image|video)\//.test(m.mime || ''));
      items.sort((a, b) => b.modified - a.modified);
      path = items[0]?.path;
    }
    lastPath = path || null;
    if (!path) { thumbBtn.style.backgroundImage = ''; thumbBtn.innerHTML = iconSVG(ImageIcon, { size: 20 }); return; }
    const u = await os.fs.thumb(path).catch(() => null);
    thumbBtn.innerHTML = '';
    thumbBtn.style.backgroundImage = u ? `url("${u}")` : '';
    if (!u) thumbBtn.innerHTML = iconSVG(Video, { size: 20 });
    if (animate) { thumbBtn.classList.remove('pop'); void thumbBtn.offsetWidth; thumbBtn.classList.add('pop'); }
  }
  async function openLast() {
    if (recorder) return;
    if (lastPath && (await os.fs.exists(lastPath))) os.launch('photos', { file: lastPath });
    else os.launch('photos', { album: ROLL });
  }

  const offFs = os.fs.on('change', ({ type, path }) => {
    if ((type === 'delete' && (path === lastPath || ROLL.startsWith(path))) || (type === 'move')) refreshThumb();
  });

  /* ---------------- keyboard (desktop): space = shutter ---------------- */
  const onKey = (e) => {
    if (root.closest('.app-frame:not(.active)')) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); onShutter(); }
  };
  window.addEventListener('keydown', onKey);

  syncUI();
  refreshThumb();
  refreshGeo();
  await os.fs.mkdir(ROLL);
  start();

  const halt = () => {
    cancelCountdown();
    if (recorder) stopRecording();
    stopStream();
  };

  return {
    onBack() {
      if (lensStrip.classList.contains('open')) { lensStrip.classList.remove('open'); return true; }
      if (countdown) { cancelCountdown(); return true; }
      if (recorder) { stopRecording(); return true; }
      return false;
    },
    onSuspend() { suspended = true; halt(); },
    onResume() { suspended = false; refreshThumb(); refreshGeo(); start(); },
    onDestroy() { destroyed = true; halt(); offFs(); window.removeEventListener('keydown', onKey); },
  };
}
