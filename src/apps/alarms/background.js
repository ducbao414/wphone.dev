// Alarm clock service: checks every few seconds whether an alarm, snooze or the countdown timer is due.
// Browsers throttle timers in background tabs (≈1/min, or frozen entirely on mobile); missed alarms
// still ring when the tab wakes up, as long as they are less than GRACE old.
import { loadAlarms, loadSnoozed, store, computeDue, refreshLockDetail, nextAlarm, bus } from './shared.js';
import { fireAlarm, ring, isRinging } from './ring.js';

export default function start(os) {
  let busy = false;
  let lastNextKey = '';

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const st = store(os);
      const now = Date.now();
      const [alarms, snoozed, lastCheck] = await Promise.all([loadAlarms(os), loadSnoozed(os), st.get('lastCheck', 0)]);
      const { due, snoozeDue, remainingSnoozed } = computeDue(alarms, snoozed, lastCheck, now);
      await st.set('lastCheck', now);
      if (snoozeDue.length || remainingSnoozed.length !== snoozed.length) await st.set('snoozed', remainingSnoozed);

      const toRing = [...due.map((d) => ({ alarm: d.alarm, snoozed: false })),
        ...snoozeDue.map((s) => ({ alarm: alarms.find((a) => a.id === s.id), snoozed: true }))].filter((x) => x.alarm);
      for (const { alarm, snoozed: sn } of toRing) await fireAlarm(os, alarm, { snoozed: sn });
      if (toRing.length) {
        bus.emit('alarms');
        // bring the Alarms app forward (unless only the lock screen is up — the ring UI already covers it)
        os.launch('alarms', { ring: toRing[0].alarm.id });
      }

      // countdown timer
      const timer = await st.get('timer', null);
      if (timer?.running && timer.endAt && timer.endAt <= now) {
        await st.set('timer', { ...timer, running: false, endAt: null, remaining: null, done: true });
        bus.emit('timer');
        if (!isRinging('timer')) {
          ring(os, { kind: 'timer', duration: timer.duration });
          os.notify({ appId: 'alarms', silent: true, title: 'Timer', body: 'Time’s up!', args: { pivot: 'timer' } });
        }
      }

      // keep lock screen + tile in sync when the "next alarm" changes (e.g. day rollover, ring, edits by Cortana)
      const n = nextAlarm(alarms, remainingSnoozed, now);
      const key = n ? n.at + ':' + n.alarm.id + ':' + new Date().toDateString() : 'none';
      if (key !== lastNextKey || toRing.length) {
        lastNextKey = key;
        await refreshLockDetail(os);
        os.tiles.refresh('alarms');
      }
    } catch (e) {
      console.warn('alarms tick', e);
    } finally {
      busy = false;
    }
  }

  setInterval(tick, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('focus', tick);
  bus.on((ev) => { if (ev === 'check') tick(); });
  tick();
}
