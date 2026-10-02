// Calendar shared logic: event normalization, date helpers, birthdays, .ics import/export,
// next-event lookup and lock-screen detail sync. Pure JS (no DOM) so it can be used by
// index.js, tile.js and background.js (and tested in node).

export const DAY = 864e5;
export const HOUR = 36e5;
export const MIN = 6e4;

export const COLORS = [
  null, '#a4c400', '#60a917', '#008a00', '#00aba9', '#1ba1e2', '#0050ef', '#6a00ff',
  '#aa00ff', '#f472d0', '#d80073', '#a20025', '#e51400', '#fa6800', '#f0a30a', '#825a2c',
];

export const REMINDERS = [
  { value: null, label: 'none' },
  { value: 0, label: 'at start time' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 18 * 60, label: '18 hours' },
  { value: 24 * 60, label: '1 day' },
  { value: 7 * 24 * 60, label: '1 week' },
];

export const reminderLabel = (m) => {
  if (m == null) return 'none';
  const r = REMINDERS.find((x) => x.value === m);
  if (r) return r.label;
  if (m % 1440 === 0) return m / 1440 + ' days';
  if (m % 60 === 0) return m / 60 + ' hours';
  return m + ' minutes';
};

/* ------------------------------------------------------------------ dates */

export const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Add n calendar days (DST safe). */
export const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
export const sameDay = (a, b) => startOfDay(a) === startOfDay(b);
export const startOfMonth = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
export const addMonths = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
export const weekStartDay = () => (typeof navigator !== 'undefined' && /^en-(US|CA)|^ja|^ko|^zh|^he|^pt-BR/.test(navigator.language || '') ? 0 : 1);
export const startOfWeek = (t, first = weekStartDay()) => {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - first + 7) % 7;
  return addDays(d.getTime(), -diff);
};

export function fmtTime(t, h24 = globalThis.__wp_h24) {
  const d = new Date(t);
  if (h24) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const h = d.getHours() % 12 || 12;
  return h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM');
}
export const fmtHour = (h, h24 = globalThis.__wp_h24) => (h24 ? String(h).padStart(2, '0') + ':00' : (h % 12 || 12) + (h < 12 ? 'am' : 'pm'));
export const weekday = (t, style = 'long') => new Date(t).toLocaleDateString([], { weekday: style }).toLowerCase();
export const monthName = (t, style = 'long') => new Date(t).toLocaleDateString([], { month: style }).toLowerCase();
export const fmtDate = (t, opts = { weekday: 'long', month: 'long', day: 'numeric' }) => new Date(t).toLocaleDateString([], opts).toLowerCase();

/** "today", "tomorrow", "yesterday" or "thursday, october 2". */
export function dayLabel(t, now = Date.now()) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  const y = new Date(t).getFullYear() !== new Date(now).getFullYear();
  return fmtDate(t, { weekday: 'long', month: 'long', day: 'numeric', ...(y ? { year: 'numeric' } : {}) });
}

/* ------------------------------------------------------------------ events */

/** Make any stored/foreign event object safe to use. All-day events: start = local midnight, end = exclusive midnight. */
export function normalize(e) {
  const allDay = !!e.allDay;
  let start = Number(e.start);
  if (!isFinite(start)) start = Date.now();
  let end = Number(e.end);
  if (allDay) {
    start = startOfDay(start);
    // tolerate missing end, end == start, or end inside the last day (e.g. 23:59) -> exclusive midnight
    if (!isFinite(end) || end <= start) end = addDays(start, 1);
    else if (startOfDay(end) !== end) end = addDays(startOfDay(end), 1);
    end = Math.max(end, addDays(start, 1));
  } else if (!isFinite(end) || end < start) end = start + HOUR;
  return {
    id: String(e.id ?? uid()),
    title: (e.title ?? '').toString(),
    start, end, allDay,
    location: e.location || '',
    notes: e.notes || '',
    reminder: e.reminder == null || e.reminder === '' || !isFinite(Number(e.reminder)) ? null : Number(e.reminder),
    color: e.color || null,
  };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Contacts' birthdays as read-only all-day pseudo events within [from, to). */
export function birthdayEvents(contacts, from, to) {
  const out = [];
  if (!Array.isArray(contacts)) return out;
  const y0 = new Date(from).getFullYear(), y1 = new Date(to).getFullYear();
  for (const c of contacts) {
    const m = /^(\d{4}|-{1,2})-?(\d{2})-(\d{2})/.exec(c?.birthday || '');
    if (!m) continue;
    const month = +m[2] - 1, day = +m[3];
    const by = /^\d{4}$/.test(m[1]) ? +m[1] : null;
    const name = c.name || [c.first, c.last].filter(Boolean).join(' ') || 'Someone';
    for (let y = y0; y <= y1; y++) {
      const s = new Date(y, month, day).getTime();
      if (s >= to || addDays(s, 1) <= from) continue;
      const age = by && y > by && by > 1900 ? y - by : null;
      out.push({
        id: `bday:${c.id}:${y}`, title: `${name}'s birthday`, start: s, end: addDays(s, 1), allDay: true,
        location: '', notes: age ? `turns ${age}` : '', reminder: null, color: '#d80073',
        birthday: true, contactId: c.id, age,
      });
    }
  }
  return out;
}

/** Events overlapping [from, to), sorted (all-day first, then by start). */
export function inRange(events, from, to) {
  return events.filter((e) => e.start < to && e.end > from).sort(sortEvents);
}
export const sortEvents = (a, b) => (b.allDay - a.allDay) || a.start - b.start || a.end - b.end || a.title.localeCompare(b.title);

/** Assign overlap columns for timed events of a day: returns [{ ev, col, cols }]. */
export function layoutDay(timed) {
  const items = [...timed].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [], colsEnd = [], clusterEnd = -Infinity;
  const flush = () => { const n = colsEnd.length; cluster.forEach((x) => (x.cols = n)); out.push(...cluster); cluster = []; colsEnd = []; };
  for (const ev of items) {
    const end = Math.max(ev.end, ev.start + 30 * MIN); // visual minimum height
    if (ev.start >= clusterEnd && cluster.length) flush();
    let col = colsEnd.findIndex((e) => e <= ev.start);
    if (col < 0) { col = colsEnd.length; colsEnd.push(end); } else colsEnd[col] = end;
    cluster.push({ ev, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();
  return out;
}

/** Next event that hasn't ended (ongoing or upcoming) within `days` days. */
export function nextEvent(events, now = Date.now(), { days = 7, includeAllDay = true } = {}) {
  const lim = addDays(startOfDay(now), days);
  return events
    .filter((e) => e.end > now && e.start < lim && (includeAllDay || !e.allDay))
    .sort((a, b) => {
      // prefer timed upcoming/ongoing events today over all-day ones
      const ka = a.allDay ? startOfDay(a.start) + DAY - 1 : a.start, kb = b.allDay ? startOfDay(b.start) + DAY - 1 : b.start;
      return ka - kb;
    })[0] || null;
}

export function whenText(e, now = Date.now()) {
  if (e.allDay) {
    const days = Math.round((e.end - e.start) / DAY);
    const d = dayLabel(e.start, now);
    return days > 1 ? `${d} – ${dayLabel(addDays(e.end, -1), now)} · all day` : `${d} · all day`;
  }
  const s = fmtTime(e.start), en = fmtTime(e.end);
  if (sameDay(e.start, e.end) || e.end - e.start <= 0) return `${dayLabel(e.start, now)} · ${s} – ${en}`;
  return `${dayLabel(e.start, now)} ${s} – ${dayLabel(e.end, now)} ${en}`;
}

/* ------------------------------------------------------------------ storage */

export async function loadEvents(storage) {
  const raw = await storage.get('events', []);
  return (Array.isArray(raw) ? raw : []).filter((e) => e && typeof e === 'object').map(normalize);
}
export async function saveEvents(storage, events) {
  await storage.set('events', events.map(({ id, title, start, end, allDay, location, notes, reminder, color }) => ({ id, title, start, end, allDay, location, notes, reminder, color })));
}
export async function loadPrefs(storage) {
  return { birthdays: true, defaultReminder: 15, ...(await storage.get('prefs', {})) };
}
export async function loadBirthdayContacts(os) {
  try { const c = await os.storage('people').get('contacts', []); return Array.isArray(c) ? c : []; } catch { return []; }
}

/** All events + birthdays (if enabled) within [from, to). */
export async function eventsFor(os, storage, from, to) {
  const [ev, prefs] = await Promise.all([loadEvents(storage), loadPrefs(storage)]);
  const b = prefs.birthdays ? birthdayEvents(await loadBirthdayContacts(os), from, to) : [];
  return inRange([...ev, ...b], from, to);
}

/**
 * Update the lock screen detail text with today's next event, and refresh our tile.
 * Only overwrites lockDetail if it's empty or was set by us; only clears what we set.
 */
export async function syncLock(os, storage, now = Date.now()) {
  const evs = await eventsFor(os, storage, startOfDay(now), addDays(startOfDay(now), 1));
  const next = nextEvent(evs.filter((e) => !e.allDay), now, { days: 1 }) || nextEvent(evs, now, { days: 1 });
  const text = next ? (next.allDay ? `${next.title || 'event'} · all day` : `${next.title || 'event'} ${fmtTime(next.start)}`) : null;
  const mine = await storage.get('lockSet', null);
  const cur = os.settings.get('lockDetail');
  if (text) {
    if ((!cur || cur === mine) && cur !== text) { await storage.set('lockSet', text); await os.settings.set('lockDetail', text); }
    else if (cur === text && mine !== text) await storage.set('lockSet', text);
  } else if (mine && cur === mine) {
    await os.settings.set('lockDetail', null);
    await storage.set('lockSet', null);
  }
  return text;
}

/* ------------------------------------------------------------------ iCalendar */

const pad = (n, l = 2) => String(n).padStart(l, '0');
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsUnesc = (s) => String(s || '').replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
const utcStamp = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
const dateStamp = (t) => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };

function fold(line) {
  if (line.length <= 74) return line;
  const parts = [];
  for (let i = 0; i < line.length; i += i ? 73 : 74) parts.push(line.slice(i, i + (i ? 73 : 74)));
  return parts.join('\r\n ');
}

export function toICS(events) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//wphone.dev//Windows Phone Calendar//EN', 'CALSCALE:GREGORIAN'];
  const now = utcStamp(Date.now());
  for (const raw of events) {
    const e = normalize(raw);
    L.push('BEGIN:VEVENT', `UID:${e.id}@wphone.dev`, `DTSTAMP:${now}`);
    if (e.allDay) L.push(`DTSTART;VALUE=DATE:${dateStamp(e.start)}`, `DTEND;VALUE=DATE:${dateStamp(e.end)}`);
    else L.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`);
    L.push(`SUMMARY:${icsEsc(e.title)}`);
    if (e.location) L.push(`LOCATION:${icsEsc(e.location)}`);
    if (e.notes) L.push(`DESCRIPTION:${icsEsc(e.notes)}`);
    if (e.color) L.push(`X-WP-COLOR:${e.color}`);
    if (e.reminder != null) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.title)}`, `TRIGGER:-PT${e.reminder}M`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/** Parse an iCalendar date value. Returns { t, allDay }. TZID'd times are treated as local time. */
export function parseICSDate(value, params = {}) {
  const v = String(value).trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || params.VALUE === 'DATE') {
    m = m || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { t: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', z] = m;
  const t = z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
  return { t, allDay: false };
}

/** ISO-8601 duration (P1DT2H30M, -PT15M, P1W) -> ms (signed). */
export function parseDuration(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s).trim());
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * DAY) + ((+m[3] || 0) * DAY) + ((+m[4] || 0) * HOUR) + ((+m[5] || 0) * MIN) + ((+m[6] || 0) * 1000);
  return m[1] === '-' ? -ms : ms;
}

export function parseICS(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null, inAlarm = false, alarm = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const head = line.slice(0, ci), value = line.slice(ci + 1);
    const [nameRaw, ...pp] = head.split(';');
    const name = nameRaw.toUpperCase();
    const params = Object.fromEntries(pp.map((p) => { const i = p.indexOf('='); return [p.slice(0, i).toUpperCase(), p.slice(i + 1).replace(/^"|"$/g, '')]; }));
    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') { cur = {}; continue; }
    if (!cur) continue;
    if (name === 'BEGIN' && value.toUpperCase() === 'VALARM') { inAlarm = true; alarm = {}; continue; }
    if (name === 'END' && value.toUpperCase() === 'VALARM') {
      inAlarm = false;
      if (alarm.trigger != null && (cur.reminder == null || alarm.trigger < cur.reminder)) cur.reminder = alarm.trigger;
      continue;
    }
    if (inAlarm) {
      if (name === 'TRIGGER' && params.VALUE !== 'DATE-TIME') { const d = parseDuration(value); if (d != null) alarm.trigger = Math.max(0, Math.round(-d / MIN)); }
      continue;
    }
    if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      if (cur.start != null) {
        let end = cur.end;
        if (end == null && cur.duration != null) end = cur.start + cur.duration;
        if (end == null) end = cur.allDay ? addDays(cur.start, 1) : cur.start + HOUR;
        if (cur.allDay && cur.duration != null && cur.end == null) end = addDays(cur.start, Math.max(1, Math.round(cur.duration / DAY)));
        events.push(normalize({
          id: (cur.uid || uid()).replace(/@wphone\.dev$/, ''), title: cur.title || '', start: cur.start, end, allDay: cur.allDay,
          location: cur.location, notes: cur.notes, reminder: cur.reminder ?? null, color: cur.color || null,
        }));
      }
      cur = null;
      continue;
    }
    switch (name) {
      case 'UID': cur.uid = value.trim(); break;
      case 'SUMMARY': cur.title = icsUnesc(value); break;
      case 'LOCATION': cur.location = icsUnesc(value); break;
      case 'DESCRIPTION': cur.notes = icsUnesc(value); break;
      case 'X-WP-COLOR': if (/^#[0-9a-f]{3,8}$/i.test(value.trim())) cur.color = value.trim(); break;
      case 'DTSTART': { const d = parseICSDate(value, params); if (d) { cur.start = d.t; cur.allDay = d.allDay; } break; }
      case 'DTEND': { const d = parseICSDate(value, params); if (d) cur.end = d.t; break; }
      case 'DURATION': cur.duration = parseDuration(value); break;
    }
  }
  return events;
}
