// Battery Saver — battery level, time left, battery saver switch and per-app usage.
import './style.css';
import { DEFAULTS, estimate, formatMinutes, usageShares } from './model.js';

export default async function launch(ctx) {
  const { root, os, storage } = ctx;
  const { el, I } = os.ui;
  const offs = [];

  const piv = os.ui.pivot({
    app: 'BATTERY SAVER',
    items: [
      { header: 'overview', render: renderOverview },
      { header: 'usage', render: renderUsage },
    ],
    index: ctx.args?.tab === 'usage' ? 1 : 0,
  });
  root.append(piv.el);
  const bar = os.ui.appBar({ minimized: true });
  root.append(bar.el);
  const setMenu = (i) => bar.setMenu(i === 1
    ? [{ label: 'reset usage stats', onClick: resetUsage }, { label: 'refresh', onClick: () => usageRefresh?.() }]
    : [{ label: 'battery settings help', onClick: help }]);
  piv.onChange((i) => { setMenu(i); if (i === 1) usageRefresh?.(); });
  setMenu(piv.index);

  /* ---------------- overview */
  var overviewRefresh; // var: referenced by pivot render before this line runs
  function renderOverview(c) {
    const pctEl = el('div.battery-pct');
    const gauge = el('div.battery-gauge', el('div.battery-gauge-fill'), el('div.battery-gauge-tip'));
    const status = el('div.battery-status');
    const est = el('div.battery-est');
    const note = el('div.wp-desc');
    const saverToggle = os.ui.toggle({
      label: 'Battery Saver', value: !!os.settings.get('batterySaver'),
      description: 'Pauses simulated texts, emails and calls, refreshes live tiles less often and dims the screen a little. Apps, alarms, music and notifications keep working.',
      onChange: (v) => os.settings.set('batterySaver', v),
    });
    const thresholdPicker = os.ui.listPicker({
      label: 'when battery falls below',
      options: [5, 10, 15, 20, 25, 30, 40, 50].map((n) => ({ value: n / 100, label: n + '%' })),
      value: DEFAULTS.threshold,
      onChange: async (v) => { await storage.set('threshold', v); },
    });
    const autoToggle = os.ui.toggle({
      label: 'Turn Battery Saver on automatically if my battery is low', value: DEFAULTS.auto,
      onChange: async (v) => { await storage.set('auto', v); thresholdPicker.hidden = !v; },
    });
    (async () => {
      const auto = await storage.get('auto', DEFAULTS.auto);
      autoToggle.set(auto);
      thresholdPicker.hidden = !auto;
      thresholdPicker.value = await storage.get('threshold', DEFAULTS.threshold);
    })();

    c.append(
      el('div.battery-hero', gauge, el('div', pctEl, status)),
      est, note,
      os.ui.header('battery saver'),
      saverToggle.el,
      autoToggle.el,
      thresholdPicker,
      os.ui.desc('Battery Saver turns off automatically when you plug in your phone, if it was turned on automatically.'));

    overviewRefresh = async () => {
      const b = os.device.battery;
      const level = b.level ?? 1;
      const pct = Math.round(level * 100);
      const saver = !!os.settings.get('batterySaver');
      pctEl.textContent = pct + '%';
      const fill = gauge.querySelector('.battery-gauge-fill');
      fill.style.width = pct + '%';
      gauge.classList.toggle('low', level <= 0.2 && !b.charging);
      gauge.classList.toggle('charging', !!b.charging);
      status.textContent = !b.supported ? 'battery info unavailable' : b.charging ? (level >= 0.999 ? 'fully charged' : 'charging') : saver ? 'battery saver is on' : 'on battery';
      const e = estimate(await storage.get('history', []), b, saver);
      if (!b.supported) {
        est.replaceChildren(el('div.battery-est-label', 'estimated time left'), el('div.battery-est-value', formatMinutes(e.minutes)));
        note.textContent = 'This browser doesn’t share battery details, so the level and estimate shown are approximate. Open the phone in Chrome or Edge on a laptop or Android phone to see your real battery.';
      } else if (b.charging) {
        est.replaceChildren(el('div.battery-est-label', level >= 0.999 ? 'fully charged' : 'time until fully charged'), level >= 0.999 ? null : el('div.battery-est-value', formatMinutes(e.minutes)));
        note.textContent = e.measured || level >= 0.999 ? '' : 'Estimate improves as your phone charges.';
      } else {
        est.replaceChildren(el('div.battery-est-label', 'estimated time left'), el('div.battery-est-value', formatMinutes(e.minutes)));
        note.textContent = e.measured ? 'Based on how fast your battery has been draining.' : 'Based on typical use. Keep using your phone for a better estimate.';
      }
      saverToggle.set(saver);
    };
    overviewRefresh();
  }

  /* ---------------- usage */
  var usageRefresh;
  function renderUsage(c) {
    const head = el('div');
    const listHost = el('div');
    c.append(head, listHost);
    usageRefresh = async () => {
      const usage = await storage.get('usage', {});
      const since = await storage.get('since', null);
      const rows = usageShares(usage).filter((r) => os.apps.get(r.id));
      head.replaceChildren(os.ui.desc(since ? `Battery use by apps since ${new Date(since).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${os.util.formatTime(new Date(since))}` : 'Battery use by apps'));
      if (!rows.length) { listHost.replaceChildren(os.ui.empty('Use your phone for a while and apps that use the most battery will show up here.')); return; }
      listHost.replaceChildren(os.ui.list(rows, {
        render: (r) => {
          const m = os.apps.get(r.id);
          const mins = Math.round((r.fg || 0) / 60e3), bgm = Math.round((r.bg || 0) / 60e3);
          const fill = el('div.battery-use-fill', { style: { width: Math.max(1, r.pct) + '%' } });
          return el('div.battery-use',
            el('div.battery-use-icon', { style: { background: m.color || 'var(--accent)' }, html: os.ui.iconSVG(m.icon, { size: 26, stroke: 1.5 }) }),
            el('div.wp-grow',
              el('div.battery-use-top', el('div.battery-use-name', m.name), el('div.battery-use-pct', r.pct < 1 ? '<1%' : Math.round(r.pct) + '%')),
              el('div.battery-use-bar', fill),
              el('div.wp-row-sub', `${mins} min in use · ${bgm} min in background · opened ${r.launches || 0}×`)));
        },
        onClick: (r) => os.launch(r.id),
        onHold: (r, row) => os.ui.contextMenu(row, [
          { label: 'open', onClick: () => os.launch(r.id) },
          { label: 'forget usage', onClick: async () => { await storage.update('usage', (u) => { delete u[r.id]; return u; }, {}); usageRefresh(); } },
        ]),
      }));
    };
    usageRefresh();
  }

  async function resetUsage() {
    if (!(await os.ui.confirm('Reset battery usage statistics for all apps?', 'usage', 'reset', 'cancel'))) return;
    await storage.set('usage', {});
    await storage.set('since', Date.now());
    usageRefresh?.();
  }
  function help() {
    os.ui.alert('Battery level and charging state come from your real device (where the browser supports it). Battery Saver pauses simulated texts, emails and calls, refreshes live tiles less often and dims the screen a little. Time left is estimated from how quickly your battery level drops.', 'battery saver');
  }

  offs.push(os.device.on('battery', () => overviewRefresh?.()));
  offs.push(os.settings.on('change:batterySaver', () => overviewRefresh?.()));
  const timer = setInterval(() => overviewRefresh?.(), 60e3);
  ctx.on('resume', () => { overviewRefresh?.(); usageRefresh?.(); });
  ctx.on('args', (a) => { if (a?.tab === 'usage') piv.select(1); });

  return { onDestroy: () => { offs.forEach((f) => f()); clearInterval(timer); } };
}
