// Thin, promise-based wrappers around real device Web APIs, respecting simulator settings.
import { settings } from './settings.js';
import { Emitter } from './util.js';

export const device = new (class Device extends Emitter {
  battery = { level: 1, charging: true, supported: false };
  online = navigator.onLine;

  async init() {
    try {
      const b = await navigator.getBattery?.();
      if (b) {
        const upd = () => { this.battery = { level: b.level, charging: b.charging, supported: true }; this.emit('battery', this.battery); };
        b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); upd();
      }
    } catch {}
    window.addEventListener('online', () => { this.online = true; this.emit('network', true); });
    window.addEventListener('offline', () => { this.online = false; this.emit('network', false); });
  }

  get isMobile() { return matchMedia('(pointer: coarse)').matches; }
  get connection() { return navigator.connection || null; }

  /*
   * Location. This is an entertainment simulator, so it never asks for the real GPS position.
   * It uses, in order: the city chosen in Settings (settings.customLocation), an approximate city from the
   * visitor's IP address (via our backend), or a fixed default (Redmond, WA — home of Windows Phone).
   * All results look like { lat, lon, accuracy, city, country, countryCode, approximate: true }.
   */
  DEFAULT_LOCATION = { lat: 47.674, lon: -122.1215, city: 'Redmond', country: 'United States', countryCode: 'US' };
  #approx = null;
  async getLocation() {
    if (!settings.get('location')) throw new Error('Location is turned off in Settings.');
    const custom = settings.get('customLocation');
    if (custom?.lat != null) return { accuracy: 1000, ...custom, approximate: true, source: 'custom' };
    try { return { accuracy: 5000, ...(await this.getApproxLocation()), approximate: true, source: 'network' }; }
    catch { return { accuracy: 5000, ...this.DEFAULT_LOCATION, approximate: true, source: 'default' }; }
  }
  /** Approximate city from the IP address (cached for the session). */
  async getApproxLocation() {
    if (this.#approx) return this.#approx;
    const r = await fetch('/api/ip-location');
    if (!r.ok) throw new Error('No location');
    const d = await r.json(); // { lat, lon, city, country, countryCode }
    if (d?.lat == null) throw new Error('No location');
    return (this.#approx = d);
  }
  /** Same as getLocation (kept for API compatibility). */
  locate() { return this.getLocation(); }
  /** "Watch" location: reports the (static) simulated location once. Returns an unsubscribe fn. */
  watchLocation(cb) {
    let live = true;
    this.getLocation().then((p) => live && cb(p)).catch(() => {});
    return () => { live = false; };
  }

  /** Camera stream. facing: 'environment' | 'user'. */
  getCamera({ facing = 'environment', audio = false, width = 1920, height = 1080 } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Camera not available (needs HTTPS).'));
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: width }, height: { ideal: height } }, audio });
  }
  getMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Microphone not available (needs HTTPS).'));
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
  /** Turn the camera flash on/off as a flashlight (Android Chrome only). Returns stop function or throws. */
  async torch(on = true, stream) {
    stream ??= await this.getCamera({ facing: 'environment' });
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    if (!caps.torch) { stream.getTracks().forEach((t) => t.stop()); throw new Error('Flashlight not supported on this device/browser.'); }
    await track.applyConstraints({ advanced: [{ torch: on }] });
    return () => stream.getTracks().forEach((t) => t.stop());
  }

  vibrate(pattern = 50) { if (settings.get('vibrate')) navigator.vibrate?.(pattern); }

  /** Device orientation (compass/tilt). cb({ alpha, beta, gamma, heading }). Returns unsubscribe. iOS needs requestPermission from a click. */
  async watchOrientation(cb) {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p !== 'granted') throw new Error('Permission denied');
    }
    const h = (e) => cb({ alpha: e.alpha, beta: e.beta, gamma: e.gamma, heading: e.webkitCompassHeading ?? (e.absolute || e.alpha != null ? (360 - e.alpha) % 360 : null) });
    const ev = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(ev, h);
    return () => window.removeEventListener(ev, h);
  }
  async watchMotion(cb) {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
      const p = await DeviceMotionEvent.requestPermission();
      if (p !== 'granted') throw new Error('Permission denied');
    }
    const h = (e) => cb(e.accelerationIncludingGravity || {});
    window.addEventListener('devicemotion', h);
    return () => window.removeEventListener('devicemotion', h);
  }

  /** Native share sheet of the real device. */
  async shareNative({ title, text, url, files } = {}) {
    if (!navigator.share) throw new Error('Sharing not supported');
    const data = { title, text, url };
    if (files && navigator.canShare?.({ files })) data.files = files;
    return navigator.share(data);
  }
  async copy(text) { await navigator.clipboard.writeText(text); }
  async paste() { return navigator.clipboard.readText(); }

  /** Text-to-speech. */
  speak(text, { lang, rate = 1, pitch = 1 } = {}) {
    return new Promise((res) => {
      if (!('speechSynthesis' in window)) return res();
      const u = new SpeechSynthesisUtterance(text);
      if (lang) u.lang = lang;
      u.rate = rate; u.pitch = pitch;
      u.onend = res; u.onerror = res;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }
  get canListen() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  /** Speech-to-text, single utterance. onInterim(text) for live results. Resolves final transcript. */
  listen({ lang = navigator.language, onInterim } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return Promise.reject(new Error('Speech recognition not supported in this browser.'));
    return new Promise((res, rej) => {
      const r = new SR();
      r.lang = lang; r.interimResults = true; r.maxAlternatives = 1;
      let final = '';
      r.onresult = (e) => {
        let interim = '';
        for (const x of e.results) (x.isFinal ? (final = x[0].transcript) : (interim += x[0].transcript));
        onInterim?.(final || interim);
      };
      r.onerror = (e) => rej(new Error(e.error));
      r.onend = () => res(final);
      r.start();
    });
  }

  /** Request permission for real system notifications (used when the tab is in background). */
  async requestNotifications() { if ('Notification' in window) return Notification.requestPermission(); return 'denied'; }

  /** Keep the screen awake (e.g. flashlight, maps navigation). Returns release fn. */
  async wakeLock() {
    try { const l = await navigator.wakeLock?.request('screen'); return () => l?.release(); } catch { return () => {}; }
  }

  async storageEstimate() { return (await navigator.storage?.estimate?.()) || { usage: 0, quota: 0 }; }
  async persistStorage() { return navigator.storage?.persist?.(); }

  /** Make a real phone call / SMS / email via the device. */
  call(number) { location.href = 'tel:' + String(number).replace(/[^\d+*#]/g, ''); }
  sms(number, body = '') { location.href = `sms:${number}${body ? (/iPhone|iPad/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(body) : ''}`; }
  email(to, subject = '', body = '') { location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; }
  openUrl(url) { window.open(url, '_blank', 'noopener'); }
})();
