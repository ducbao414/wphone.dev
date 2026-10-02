// Remembers podcast playback positions even after the Podcasts app is closed.
import { epKey } from './shared.js';

export default function start(os, { storage }) {
  let last = 0;
  const save = (c) => {
    const a = os.media.audio;
    const t = a.currentTime || 0;
    const d = isFinite(a.duration) ? a.duration : 0;
    if (t < 1) return;
    storage.update(epKey(c.src), (v) => {
      v = v || {};
      return {
        ...v,
        url: c.src, title: c.title, podcast: c.artist, art: c.art, ep: c.ep || v.ep, pod: c.pod || v.pod,
        t, d: d || v.d || 0,
        played: v.played || (d > 0 && t > d - 30),
        updated: Date.now(),
      };
    }, null).catch(() => {});
  };
  os.media.on('time', () => {
    const c = os.media.current;
    if (!c || c.appId !== 'podcasts' || !c.src) return;
    const now = Date.now();
    if (now - last < 5000) return;
    last = now;
    save(c);
  });
  os.media.on('change', () => {
    const c = os.media.current;
    if (c && c.appId === 'podcasts' && c.src && !os.media.playing) save(c);
  });
}
