// Calendar live tile: date + next event (WP 8.1 style).
import { eventsFor, nextEvent, startOfDay, addDays, fmtTime, weekday, dayLabel } from './lib.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default {
  interval: 5 * 60e3,
  async update(os, { size }) {
    const now = Date.now();
    const storage = os.storage('calendar');
    const evs = await eventsFor(os, storage, startOfDay(now), addDays(startOfDay(now), 7));
    const next = nextEvent(evs, now, { days: 7 });
    const d = new Date(now);
    const label = `${weekday(now)} ${d.getDate()}`;
    if (size === 'small') return { faces: [], iconFirst: true, title: label };
    if (!next) {
      return {
        iconFirst: false, noLabel: true,
        faces: [{ html: `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:8px 10px 6px"><div class="t-big" style="font-size:${size === 'wide' ? 64 : 56}px">${d.getDate()}</div><div class="t-mid" style="font-size:15px">${esc(weekday(now))}</div></div>` }],
      };
    }
    const when = next.allDay ? 'all day' : (next.start <= now ? 'now · until ' + fmtTime(next.end) : fmtTime(next.start) + (size === 'wide' ? ' – ' + fmtTime(next.end) : ''));
    const dayPrefix = startOfDay(next.start) > startOfDay(now) ? dayLabel(next.start, now) + ' ' : '';
    const title = esc(next.title || '(no subject)');
    const html = size === 'wide'
      ? `<div class="t-mid" style="font-size:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
         ${next.location ? `<div class="t-mid" style="font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(next.location)}</div>` : ''}
         <div class="t-mid" style="font-size:17px">${esc(dayPrefix + when)}</div>`
      : `<div class="t-mid" style="font-weight:600;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1">${title}</div>
         ${next.location ? `<div class="t-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(next.location)}</div>` : ''}
         <div class="t-sub">${esc(dayPrefix + when)}</div>`;
    return {
      iconFirst: false,
      title: label,
      faces: [{ html }],
    };
  },
};
