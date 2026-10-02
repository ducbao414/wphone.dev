const big = (u) => (u ? u.replace(/\/standard\/\d+\//, '/standard/480/') : u);

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

export default {
  interval: 20 * 60e3,
  async update(os, { size }) {
    let feed;
    try { feed = await os.net.news('top'); } catch { feed = await os.storage('news').get('feed:top', null); }
    const items = (feed?.items || []).filter((x) => x.image && x.title).slice(0, size === 'small' ? 0 : 5);
    if (!items.length) return null;
    return { faces: items.map((it) => ({ image: big(it.image), title: clip(it.title, size === 'wide' ? 110 : 60) })), iconFirst: false };
  },
};
