// Mirror: full-screen mirrored front camera with a ring light, freeze frame and save to Saved Pictures.
import './style.css';
import { SunMedium, Snowflake, Play, Save } from 'lucide';

const RINGS = [0, 22, 48];          // ring light thickness levels (px)
const RING_NAMES = ['light off', 'soft light', 'bright light'];

export default async function launch(ctx) {
  const { root, os } = ctx;
  const { el, appBar } = os.ui;

  let ring = await ctx.storage.get('ring', 1);
  let stream = null, frozen = false, frozenBlob = null, suspended = false, savedBrightness = null;

  const video = el('video.mirror-video', { autoplay: true, muted: true, playsInline: true });
  video.setAttribute('playsinline', '');
  const still = el('canvas.mirror-still', { hidden: true });
  const msg = el('div.mirror-msg', { hidden: true });
  const badge = el('div.mirror-badge', { hidden: true }, 'frozen');
  const stage = el('div.mirror-stage', video, still, badge, msg);
  const view = el('div.mirror', stage);
  root.append(view);

  const applyRing = () => {
    view.style.setProperty('--ring', RINGS[ring] + 'px');
    view.classList.toggle('lit', RINGS[ring] > 0);
    if (RINGS[ring] > 0) {
      const b = os.settings.get('brightness');
      if (savedBrightness == null && b != null && b < 1) { savedBrightness = b; os.settings.set('brightness', 1); }
    } else restoreBrightness();
  };
  const restoreBrightness = () => { if (savedBrightness != null) { os.settings.set('brightness', savedBrightness); savedBrightness = null; } };

  async function start() {
    if (stream || suspended) return;
    msg.hidden = true;
    try {
      stream = await os.device.getCamera({ facing: 'user', width: 1280, height: 720 });
      if (suspended) return stop();
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (e) {
      stream = null;
      msg.hidden = false;
      msg.replaceChildren(el('div.mirror-msg-title', 'no camera'), el('div', 'Mirror needs access to your front camera. ' + (e.message || e.name || '')), os.ui.button('try again', start));
    }
  }
  function stop() { stream?.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; }

  function freeze() {
    if (frozen) return unfreeze();
    if (!video.videoWidth) return os.toast('Camera isn’t ready yet');
    const w = video.videoWidth, h = video.videoHeight;
    still.width = w; still.height = h;
    const g = still.getContext('2d');
    g.translate(w, 0); g.scale(-1, 1);       // save exactly what the user sees (mirrored)
    g.drawImage(video, 0, 0, w, h);
    frozen = true; frozenBlob = null;
    still.hidden = false; badge.hidden = false;
    video.pause();
    os.sounds.shutter?.();
    view.classList.add('flash'); setTimeout(() => view.classList.remove('flash'), 180);
    setButtons();
  }
  function unfreeze() {
    frozen = false; frozenBlob = null;
    still.hidden = true; badge.hidden = true;
    video.play().catch(() => {});
    setButtons();
  }
  async function saveStill() {
    if (!frozen) freeze();
    if (!frozen) return;
    try {
      frozenBlob ??= await new Promise((res) => still.toBlob(res, 'image/jpeg', 0.92));
      const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
      const name = `mirror_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.jpg`;
      const dir = '/Pictures/Saved Pictures';
      if (!(await os.fs.exists(dir))) await os.fs.mkdir(dir);
      const path = await os.fs.uniquePath(dir + '/' + name);
      await os.fs.write(path, frozenBlob, { mime: 'image/jpeg' });
      os.toast('Saved to Saved Pictures');
    } catch (e) { os.ui.alert('Couldn’t save the picture. ' + (e.message || ''), 'mirror'); }
  }

  const bar = appBar({ opacity: 0.75, buttons: [] , menu: [{ label: 'open saved pictures', onClick: () => os.launch('photos', { folder: '/Pictures/Saved Pictures' }) }] });
  const setButtons = () => bar.setButtons([
    { icon: SunMedium, label: RING_NAMES[(ring + 1) % RINGS.length], onClick: () => { ring = (ring + 1) % RINGS.length; ctx.storage.set('ring', ring); applyRing(); setButtons(); os.toast(RING_NAMES[ring]); } },
    { icon: frozen ? Play : Snowflake, label: frozen ? 'live' : 'freeze', onClick: freeze },
    { icon: Save, label: 'save', onClick: saveStill },
  ]);
  setButtons();
  view.append(bar.el);

  // Tap the picture to hide/show the controls.
  stage.addEventListener('click', (e) => { if (!e.target.closest('button')) view.classList.toggle('chrome-hidden'); });

  ctx.onBack(() => { if (frozen) { unfreeze(); return true; } return false; });
  applyRing();
  start();

  return {
    onSuspend: () => { suspended = true; stop(); restoreBrightness(); },
    onResume: () => { suspended = false; applyRing(); start(); if (frozen) video.pause(); },
    onDestroy: () => { suspended = true; stop(); restoreBrightness(); },
  };
}
