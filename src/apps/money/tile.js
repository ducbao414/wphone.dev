const NAMES = { '^GSPC': 'S&amp;P 500', '^DJI': 'DOW', '^IXIC': 'NASDAQ' };
const IDX = ['^GSPC', '^DJI', '^IXIC'];
const n = (v) => (v == null ? '--' : v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
const arrow = (c) => (c >= 0 ? '▲' : '▼');

export default {
  interval: 15 * 60e3,
  async update(os, { size }) {
    const st = os.storage('money');
    const cached = await st.get('quotes', {});
    let list = [];
    try {
      const r = await os.net.quotes(IDX);
      list = r.map((q) => (q.error ? cached[q.symbol] : q)).filter(Boolean);
    } catch { list = IDX.map((s) => cached[s]).filter(Boolean); }
    if (!list.length) return null;
    const row = (q) => `<div style="display:flex;justify-content:space-between;gap:6px;white-space:nowrap"><span>${NAMES[q.symbol] || q.symbol}</span>` +
      `<span>${n(q.price)} <span class="t-sub">${arrow(q.change)} ${Math.abs(q.changePercent).toFixed(2)}%</span></span></div>`;
    if (size === 'wide') return { faces: [{ html: `<div class="t-mid" style="display:flex;flex-direction:column;gap:6px">${list.map(row).join('')}</div>` }] };
    return {
      faces: list.map((q) => ({ html: `<div class="t-sub">${NAMES[q.symbol] || q.symbol}</div><div class="t-mid" style="font-size:22px;margin-top:4px">${n(q.price)}</div><div class="t-sub">${arrow(q.change)} ${n(Math.abs(q.change))} (${Math.abs(q.changePercent).toFixed(2)}%)</div>` })),
    };
  },
};
