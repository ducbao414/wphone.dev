// Photos live tile: flips through the most recent pictures (WP 8.1 style); iconic when there are none.
export default {
  interval: 10 * 60e3,
  async update(os, { size, args }) {
    const dir = args?.album || '/Pictures';
    const all = (await os.fs.find('image/', dir)).sort((a, b) => (b.taken || b.created || 0) - (a.taken || a.created || 0));
    if (!all.length) return { faces: [] };
    if (size === 'small') return { faces: [] };
    const faces = [];
    for (const m of all.slice(0, 6)) {
      const u = await os.fs.thumb(m.path).catch(() => null);
      if (u) faces.push({ image: u });
    }
    return { faces, iconFirst: false };
  },
};
