export default {
  interval: 60 * 60e3,
  async update(os) {
    const s = await os.storage('wordament').get('stats', null);
    if (!s || !s.played) return { faces: [{ html: '<div class="t-mid">swipe words</div><div class="t-sub">2 minute rounds</div>' }] };
    return {
      faces: [{ html: `<div class="t-sub">best score</div><div class="t-big">${s.best || 0}</div><div class="t-sub">${s.played} rounds played</div>` }],
    };
  },
};
