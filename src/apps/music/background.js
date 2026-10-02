// Music live tile: shows the album art + title of what the Music app is playing.
export default function start(os, { storage }) {
  const esc = os.util.esc;
  const show = (t) => {
    if (!t) return;
    const text = { html: `<div class="t-mid t-clip">${esc(t.title || '')}</div><div class="t-sub t-clip">${esc(t.artist || '')}</div>` };
    os.tiles.set('music', { faces: t.art ? [{ image: t.art }, text] : [text], iconFirst: !t.art, title: 'Music' });
  };
  os.media.on('track', (t) => {
    if (t?.appId !== 'music') return;
    show(t);
    storage.set('lastTrack', { title: t.title, artist: t.artist });
  });
  // after a reload the art URL is gone: show the last title only
  storage.get('lastTrack', null).then((t) => { if (t && !os.media.current) show({ ...t, art: null }); });
}
