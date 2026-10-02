// Phone live tile: missed call count + latest missed caller.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function phoneTileData(os) {
  const st = os.storage('phone');
  const missed = await st.get('missedUnseen', 0);
  if (!missed) return { faces: [] };
  const hist = await st.get('history', []);
  const last = hist.find((h) => h.type === 'missed');
  const who = last ? last.name || last.number : '';
  return {
    badge: missed,
    faces: last ? [{ html: `<div class="t-mid">${esc(who)}</div><div class="t-sub">missed call${missed > 1 ? ` · ${missed} missed` : ''}</div>` }] : [],
  };
}

export default {
  interval: 10 * 60e3,
  update: (os) => phoneTileData(os),
};
