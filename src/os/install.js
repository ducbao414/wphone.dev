// "Add to Home Screen" support.
// - Chrome / Edge / Samsung Internet fire `beforeinstallprompt`; we keep it and show the native dialog on a user tap.
// - iOS Safari has no API: we explain Share → Add to Home Screen.
// - Other browsers: point at the browser menu.
import { Emitter } from './util.js';

let deferred = null;
const ua = navigator.userAgent;

export const install = new (class Install extends Emitter {
  constructor() {
    super();
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // keep our own UI instead of the browser's mini-infobar
      deferred = e;
      this.emit('change');
    });
    window.addEventListener('appinstalled', () => { deferred = null; this.justInstalled = true; this.emit('change'); });
  }

  /** Running from the home screen (standalone / fullscreen display mode, or iOS standalone). */
  get installed() {
    return this.justInstalled || navigator.standalone === true ||
      ['standalone', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches);
  }
  get isIOS() { return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  /** The native install dialog can be shown right now. */
  get canPrompt() { return !!deferred; }
  /** Worth offering an install entry point at all. */
  get available() { return !this.installed; }

  /**
   * Call directly from a tap. Shows the native dialog when the browser allows it,
   * otherwise WP-style instructions. Resolves 'accepted' | 'dismissed' | 'instructions'.
   */
  async prompt(os) {
    if (deferred) {
      const e = deferred;
      deferred = null;
      e.prompt();
      const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
      this.emit('change');
      return outcome;
    }
    const msg = this.isIOS
      ? 'In Safari, tap the Share button (the square with an arrow — in the toolbar, or inside the ⋯ menu on newer iPhones), then choose “Add to Home Screen”.\n\nYour phone will then open full screen, like a real Windows Phone.'
      : 'Open your browser’s menu (⋮ or ⋯) and choose “Install app” or “Add to Home screen”.\n\nYour phone will then open full screen, like a real Windows Phone.';
    await os.ui.messageBox({ title: 'add to home screen', message: msg, buttons: ['got it'] });
    return 'instructions';
  }
})();
