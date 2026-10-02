// Alarm data model + scheduling logic shared by the app, background service and tile.
// Storage schema (shared with Cortana — keep exactly):
//   os.storage('alarms').get('alarms') => [{ id, hours, minutes, days:[0-6] (empty = one-time), label, enabled, sound, snooze }]
// Private keys: 'snoozed' [{ id, at }], 'lastCheck' ms, 'timer' {...}, 'stopwatch' {...}

export const GRACE = 15 * 60e3;          // ring alarms missed by up to 15 min (throttled/sleeping tabs)
export const LOCK_PREFIX = '⏰';
export const DAY = 864e5;

/** Tiny in-process event bus so the open app hears about background changes. */
const listeners = new Set();
export const bus = {
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(ev, data) { for (const fn of [...listeners]) { try { fn(ev, data); } catch (e) { console.error(e); } } },
};

export function normalizeAlarm(a = {}, defaultSound = 'Alarm Classic') {
  const days = Array.isArray(a.days) ? [...new Set(a.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [];
  return {
    id: a.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    hours: Math.min(23, Math.max(0, Number(a.hours) || 0)),
    minutes: Math.min(59, Math.max(0, Number(a.minutes) || 0)),
    days,
    label: typeof a.label === 'string' ? a.label : '',
    enabled: a.enabled !== false,
    sound: a.sound || defaultSound,
    snooze: Number(a.snooze) > 0 ? Number(a.snooze) : 10,
  };
}

/** The occurrence of `alarm` on the calendar day of `day` (Date) or null if it doesn't repeat that day. */
function onDay(alarm, day) {
  if (alarm.days.length && !alarm.days.includes(day.getDay())) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), alarm.hours, alarm.minutes, 0, 0);
}

/** Next time the alarm rings strictly after `from` (ms or Date). Ignores enabled. */
export function nextOccurrence(alarm, from = Date.now()) {
  const f = new Date(+from);
  const base = new Date(f.getFullYear(), f.getMonth(), f.getDate());
  for (let i = 0; i < 8; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const t = onDay(alarm, d);
    if (t && +t > +f) return t;
  }
  return null;
}

/** Latest occurrence t with a < t <= b, or null. */
export function occurrenceIn(alarm, a, b) {
  a = +a; b = +b;
  if (b <= a) return null;
  const end = new Date(b);
  for (let i = 0; i < 3; i++) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const t = onDay(alarm, d);
    if (t && +t > a && +t <= b) return t;
    if (+d + DAY < a) break;
  }
  return null;
}

/** Decide what should ring now. Returns { due: [{alarm, at}], snoozeDue: [{id, at}], remainingSnoozed }. */
export function computeDue(alarms, snoozed, lastCheck, now) {
  const from = Math.max(lastCheck || now - 5e3, now - GRACE);
  const due = [];
  for (const al of alarms) {
    if (!al.enabled) continue;
    const at = occurrenceIn(al, from, now);
    if (at) due.push({ alarm: al, at: +at });
  }
  const snoozeDue = [], remainingSnoozed = [];
  for (const s of snoozed || []) {
    if (s.at <= now) { if (now - s.at < GRACE * 4 && alarms.some((a) => a.id === s.id)) snoozeDue.push(s); }
    else remainingSnoozed.push(s);
  }
  return { due, snoozeDue, remainingSnoozed };
}

/** Soonest upcoming ring time across enabled alarms and snoozes: { at, alarm, snoozed } | null */
export function nextAlarm(alarms, snoozed = [], now = Date.now()) {
  let best = null;
  for (const a of alarms) {
    if (!a.enabled) continue;
    const t = nextOccurrence(a, now);
    if (t && (!best || +t < best.at)) best = { at: +t, alarm: a, snoozed: false };
  }
  for (const s of snoozed) {
    const a = alarms.find((x) => x.id === s.id);
    if (a && s.at > now && (!best || s.at < best.at)) best = { at: s.at, alarm: a, snoozed: true };
  }
  return best;
}

const DAY_NAMES = (len) => [...Array(7).keys()].map((d) => new Date(2023, 0, 1 + d).toLocaleDateString([], { weekday: len }));
export const dayShort = () => DAY_NAMES('short');
export const dayLong = () => DAY_NAMES('long');
/** Locale-aware week order (Monday first unless the locale is US-like). */
export function weekOrder() {
  let first = 1;
  try { first = (new Intl.Locale(navigator.language).weekInfo?.firstDay ?? new Intl.Locale(navigator.language).getWeekInfo?.().firstDay ?? 1) % 7; } catch {}
  return [...Array(7).keys()].map((i) => (first + i) % 7);
}

export function daysLabel(days) {
  if (!days.length) return 'only once';
  const s = [...days].sort().join(',');
  if (s === '0,1,2,3,4,5,6') return 'every day';
  if (s === '1,2,3,4,5') return 'weekdays';
  if (s === '0,6') return 'weekends';
  const names = dayShort();
  return weekOrder().filter((d) => days.includes(d)).map((d) => names[d]).join(', ');
}

export function fmtTime(h, m, h24) {
  if (h24) return { time: `${h}:${String(m).padStart(2, '0')}`, ampm: '' };
  return { time: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, ampm: h < 12 ? 'AM' : 'PM' };
}
export function fmtTimeStr(h, m, h24) { const t = fmtTime(h, m, h24); return t.ampm ? `${t.time} ${t.ampm}` : t.time; }

/** "in 7 hours 12 minutes" style text for the next ring. */
export function untilText(at, now = Date.now()) {
  let mins = Math.max(1, Math.round((at - now) / 60e3));
  const d = Math.floor(mins / 1440); mins -= d * 1440;
  const h = Math.floor(mins / 60); const m = mins % 60;
  const parts = [];
  if (d) parts.push(`${d} day${d > 1 ? 's' : ''}`);
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m && !d) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  return parts.join(' ') || 'less than a minute';
}

/** Short day prefix for a ring time: '' today, 'tomorrow' / weekday otherwise. */
export function dayPrefix(at, now = Date.now()) {
  const a = new Date(at), n = new Date(now);
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()), dn = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const diff = Math.round((da - dn) / DAY);
  if (diff <= 0) return '';
  return a.toLocaleDateString([], { weekday: 'short' });
}

export function fmtDuration(ms, { cs = false } = {}) {
  ms = Math.max(0, ms);
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600), m = Math.floor((totalS % 3600) / 60), s = totalS % 60;
  const p = (n) => String(n).padStart(2, '0');
  let out = (h ? h + ':' + p(m) : p(m)) + ':' + p(s);
  if (cs) out += '.' + p(Math.floor((ms % 1000) / 10));
  return out;
}

/* ------------------------------------------------------------ storage helpers (need os) */

export const store = (os) => os.storage('alarms');
export async function loadAlarms(os) {
  const def = defaultSound(os);
  const raw = await store(os).get('alarms', []);
  return (Array.isArray(raw) ? raw : []).map((a) => normalizeAlarm(a, def));
}
export async function saveAlarms(os, list) {
  await store(os).set('alarms', list.map((a) => normalizeAlarm(a)));
  bus.emit('alarms');
  os.tiles.refresh('alarms');
  await refreshLockDetail(os);
}
/** Read-modify-write by id (safe against concurrent edits by Cortana / background). */
export async function updateAlarm(os, id, patch) {
  const list = await loadAlarms(os);
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return null;
  list[i] = normalizeAlarm({ ...list[i], ...(typeof patch === 'function' ? patch(list[i]) : patch) });
  await saveAlarms(os, list);
  return list[i];
}
export async function upsertAlarm(os, alarm) {
  const list = await loadAlarms(os);
  const a = normalizeAlarm(alarm, defaultSound(os));
  const i = list.findIndex((x) => x.id === a.id);
  if (i >= 0) list[i] = a; else list.push(a);
  await saveAlarms(os, list);
  // re-enabling/editing an alarm cancels its pending snooze
  await clearSnooze(os, a.id);
  return a;
}
export async function deleteAlarm(os, id) {
  await saveAlarms(os, (await loadAlarms(os)).filter((a) => a.id !== id));
  await clearSnooze(os, id);
}
export async function loadSnoozed(os) { const s = await store(os).get('snoozed', []); return Array.isArray(s) ? s : []; }
export async function setSnooze(os, id, at) {
  const s = (await loadSnoozed(os)).filter((x) => x.id !== id);
  s.push({ id, at });
  await store(os).set('snoozed', s);
  bus.emit('alarms');
  os.tiles.refresh('alarms');
  await refreshLockDetail(os);
}
export async function clearSnooze(os, id) {
  const s = await loadSnoozed(os);
  if (!s.some((x) => x.id === id)) return false;
  await store(os).set('snoozed', s.filter((x) => x.id !== id));
  bus.emit('alarms');
  os.tiles.refresh('alarms');
  await refreshLockDetail(os);
  return true;
}

export function defaultSound(os) {
  const names = os.sounds.ringtones || [];
  return names.includes('Alarm Classic') ? 'Alarm Classic' : names[0] || 'Nokia Tune';
}

/** Publish "⏰ 7:30 AM" on the lock screen, but never clobber text another app (calendar) put there. */
export async function refreshLockDetail(os) {
  const [alarms, snoozed] = await Promise.all([loadAlarms(os), loadSnoozed(os)]);
  const cur = os.settings.get('lockDetail') || '';
  const mine = !cur || cur.startsWith(LOCK_PREFIX);
  if (!mine) return;
  const n = nextAlarm(alarms, snoozed);
  let text = '';
  if (n) {
    const d = new Date(n.at);
    const pre = dayPrefix(n.at);
    // only advertise alarms within the next ~24h, like WP's lock screen
    if (n.at - Date.now() < DAY) text = `${LOCK_PREFIX} ${pre ? pre + ' ' : ''}${fmtTimeStr(d.getHours(), d.getMinutes(), os.settings.get('h24'))}`;
  }
  if (text !== cur) await os.settings.set('lockDetail', text || null);
}
