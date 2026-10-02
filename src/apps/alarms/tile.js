// Live tile: next alarm (medium/wide). Small tile stays iconic.
import { loadAlarms, loadSnoozed, nextAlarm, fmtTime, dayPrefix } from './shared.js';

export default {
  interval: 60e3,
  async update(os, { size }) {
    const [alarms, snoozed] = await Promise.all([loadAlarms(os), loadSnoozed(os)]);
    const n = nextAlarm(alarms, snoozed);
    if (!n || size === 'small') return { faces: [] };
    const d = new Date(n.at);
    const t = fmtTime(d.getHours(), d.getMinutes(), os.settings.get('h24'));
    const day = dayPrefix(n.at) || 'today';
    const esc = os.util.esc;
    const label = esc(n.alarm.label || (n.snoozed ? 'Snoozed alarm' : 'Alarm'));
    return {
      iconFirst: false,
      faces: [{
        html: `<div class="t-big">${t.time}<span style="font-size:16px;margin-left:4px">${t.ampm}</span></div>`
          + `<div class="t-mid" style="margin-top:6px">${esc(day)}</div><div class="t-sub">${n.snoozed ? 'snoozed · ' : ''}${label}</div>`,
      }],
    };
  },
};
