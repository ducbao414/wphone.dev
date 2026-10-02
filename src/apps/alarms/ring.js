// Full-screen ringing UI. Rendered into the OS overlay layer so it also shows above the lock screen.
// Shared singleton between background.js and the app (same module instance).
import { fmtTime, fmtTimeStr, setSnooze, clearSnooze, updateAlarm, bus } from './shared.js';
import './ring.css';

const active = new Map(); // key -> { close(reason) }
const AUTO_SNOOZE_MS = 5 * 60e3;
const SNOOZE_OPTS = [5, 10, 15, 20, 30];

export const isRinging = (key) => active.has(key);
export const ringingCount = () => active.size;

/**
 * Ring an alarm (kind 'alarm') or the timer (kind 'timer').
 *   ring(os, { kind: 'alarm', alarm }) | ring(os, { kind: 'timer', duration })
 */
export function ring(os, { kind = 'alarm', alarm, duration } = {}) {
  const key = kind === 'timer' ? 'timer' : 'alarm:' + alarm.id;
  if (active.has(key)) return;
  const { el } = os.util;
  const h24 = os.settings.get('h24');
  const host = document.getElementById('overlay-layer');
  if (!host) return;

  const now = new Date();
  const t = kind === 'alarm' ? fmtTime(alarm.hours, alarm.minutes, h24) : null;
  let snoozeMin = alarm?.snooze || 10;

  const sound = os.sounds.play(kind === 'alarm' ? alarm.sound : (os.settings.get('ringtone') || 'Xylophone'), { loop: true, volume: 0.35 });
  const vib = setInterval(() => os.device.vibrate([500, 300, 500]), 2200);
  os.device.vibrate([500, 300, 500]);
  let releaseWake = null;
  os.device.wakeLock().then((r) => { releaseWake = r; });

  const snoozeBtn = el('div.alarms-ring-snoozepick.tilt', { onclick: pickSnooze });
  const setSnoozeLabel = () => (snoozeBtn.textContent = `snooze for ${snoozeMin} minutes`);
  setSnoozeLabel();
  async function pickSnooze() {
    const v = await os.ui.pickFromList({ title: 'snooze for', options: [...new Set([...SNOOZE_OPTS, snoozeMin])].sort((a, b) => a - b).map((m) => ({ value: m, label: `${m} minutes` })), value: snoozeMin });
    if (v) { snoozeMin = v; setSnoozeLabel(); }
  }

  const layer = el('div.alarms-ring',
    el('div.alarms-ring-top',
      el('div.alarms-ring-kind', kind === 'alarm' ? 'ALARM' : 'TIMER'),
      kind === 'alarm'
        ? el('div.alarms-ring-time', t.time, t.ampm ? el('span.alarms-ring-ampm', t.ampm) : null)
        : el('div.alarms-ring-time', 'time’s up'),
      el('div.alarms-ring-label', kind === 'alarm' ? (alarm.label || 'Alarm') : `${Math.round((duration || 0) / 60000) || '<1'} minute timer finished`),
      el('div.alarms-ring-date', now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))),
    el('div.alarms-ring-pulse', { html: os.ui.iconSVG(kind === 'alarm' ? os.apps.get('alarms').icon : os.ui.I.clock, { size: 84, stroke: 1.2 }) }),
    el('div.alarms-ring-actions',
      kind === 'alarm' ? snoozeBtn : null,
      el('div.alarms-ring-btns',
        kind === 'alarm' ? el('button.alarms-ring-btn.tilt', { onclick: () => close('snooze') }, 'snooze') : el('button.alarms-ring-btn.tilt', { onclick: () => close('restart') }, 'restart'),
        el('button.alarms-ring-btn.primary.tilt', { onclick: () => close('dismiss') }, 'dismiss'))));
  host.append(layer);
  const popBack = os.ui.pushOverlayBack(() => close(kind === 'alarm' ? 'snooze' : 'dismiss'));
  const auto = setTimeout(() => close(kind === 'alarm' ? 'snooze' : 'dismiss', true), AUTO_SNOOZE_MS);

  async function close(reason, automatic) {
    if (!active.has(key)) return;
    active.delete(key);
    sound.stop?.();
    clearInterval(vib); clearTimeout(auto);
    navigator.vibrate?.(0);
    releaseWake?.();
    popBack();
    layer.classList.add('alarms-ring-out');
    setTimeout(() => layer.remove(), 260);
    if (kind === 'alarm') {
      if (reason === 'snooze') {
        const at = Date.now() + snoozeMin * 60e3;
        await setSnooze(os, alarm.id, at);
        const d = new Date(at);
        os.notify({
          appId: 'alarms', silent: true,
          title: automatic ? 'Missed alarm — snoozed' : 'Snoozed',
          body: `${alarm.label || 'Alarm'} until ${fmtTimeStr(d.getHours(), d.getMinutes(), h24)}. Tap to dismiss.`,
          args: { dismiss: alarm.id },
        });
      } else {
        await clearSnooze(os, alarm.id);
      }
    } else if (reason === 'restart') {
      bus.emit('timer-restart');
      os.storage('alarms').update('timer', (tm) => ({ ...(tm || {}), running: true, endAt: Date.now() + (tm?.duration || duration), remaining: null, done: false }), {})
        .then(() => bus.emit('timer'));
    }
  }

  active.set(key, { close });
}

/** Dismiss a ringing alarm programmatically (e.g. from a notification). */
export function stopRing(key, reason = 'dismiss') { active.get(key)?.close(reason); }

/** Fire an alarm: ring UI + action center entry. One-time alarms switch themselves off. */
export async function fireAlarm(os, alarm, { snoozed = false } = {}) {
  if (isRinging('alarm:' + alarm.id)) return;
  ring(os, { kind: 'alarm', alarm });
  const h24 = os.settings.get('h24');
  os.notify({ appId: 'alarms', silent: true, persist: false, title: alarm.label || 'Alarm', body: fmtTimeStr(alarm.hours, alarm.minutes, h24) + (snoozed ? ' (snoozed)' : ''), args: { ring: alarm.id } });
  if (!alarm.days.length && !snoozed) await updateAlarm(os, alarm.id, { enabled: false });
}
