import { estimate, shortMinutes } from './model.js';

export default {
  interval: 10 * 60e3,
  async update(os, { size }) {
    const b = os.device.battery;
    const pct = Math.round((b.level ?? 1) * 100);
    if (size === 'small') return { badge: pct + '%' };
    const history = await os.storage('battery').get('history', []);
    const saver = !!os.settings.get('batterySaver');
    const e = estimate(history, b, saver);
    const sub = !b.supported ? 'battery info unavailable' : b.charging ? (e.minutes ? `charging · full in ${shortMinutes(e.minutes)}` : 'fully charged') : `${shortMinutes(e.minutes)} left`;
    return {
      iconFirst: false,
      faces: [{ html: `<div class="t-big">${pct}%</div><div class="t-sub">${sub}</div>${saver ? '<div class="t-sub">battery saver on</div>' : ''}` }],
    };
  },
};
