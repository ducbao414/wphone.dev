// Calendar background service: fires event reminders and keeps the lock screen detail + tile current.
import { loadEvents, syncLock, fmtTime, dayLabel, startOfDay } from './lib.js';

export default function start(os, { storage }) {
  let lastTileKey = '';
  const tick = async () => {
    try {
      const now = Date.now();
      const events = await loadEvents(storage);
      const fired = await storage.get('fired', {});
      let changed = false;
      for (const e of events) {
        if (e.reminder == null) continue;
        const key = `${e.id}@${e.start}@${e.reminder}`;
        const at = e.start - e.reminder * 60e3;
        if (now < at || now > e.end || fired[key]) continue;
        // don't spam stale reminders after the phone was "off" for a long time
        if (now - at < 12 * 36e5) {
          const when = e.allDay ? `${dayLabel(e.start, now)} · all day` : `${startOfDay(e.start) === startOfDay(now) ? '' : dayLabel(e.start, now) + ' '}${fmtTime(e.start)}`;
          os.notify({ appId: 'calendar', title: e.title || '(no subject)', body: [when, e.location].filter(Boolean).join(' · '), args: { event: e.id } });
        }
        fired[key] = e.end;
        changed = true;
      }
      for (const [k, end] of Object.entries(fired)) if (end < now - 2 * 864e5) { delete fired[k]; changed = true; }
      if (changed) await storage.set('fired', fired);
      const text = await syncLock(os, storage, now);
      // refresh the tile when the day or the next event changes
      const tk = new Date(now).toDateString() + '|' + text + '|' + events.length + '|' + Math.floor(now / 6e5);
      if (tk !== lastTileKey) { lastTileKey = tk; os.tiles.refresh('calendar'); }
    } catch (e) { console.warn('calendar background', e); }
  };
  setTimeout(tick, 3000);
  setInterval(tick, 30e3);
}
