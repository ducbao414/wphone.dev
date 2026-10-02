// Shared Cortana helpers used by index.js, tile.js and background.js (one module instance in the bundle).

/** WMO weather code -> [text, emoji-free glyph key] */
export const WMO = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'cloudy', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'rain showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail',
};
export const wmoText = (c) => WMO[c] ?? 'unknown';
export const isRainy = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

/** Simple inline SVG weather glyphs (white strokes, used on cards and tiles). */
export function wmoIcon(code, isDay = 1) {
  const sun = '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>';
  const moon = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
  const cloud = '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z"/>';
  const rain = '<path d="M8 20l-1 2M12 20l-1 2M16 20l-1 2"/>';
  const snow = '<path d="M8 21h.01M12 21h.01M16 21h.01"/>';
  const bolt = '<path d="M13 14l-3 5h4l-2 4"/>';
  let inner;
  if (code <= 1) inner = isDay ? sun : moon;
  else if (code === 2) inner = `<g transform="translate(-3 -3) scale(.7)">${isDay ? sun : moon}</g>${cloud}`;
  else if (code <= 48) inner = cloud + '<path d="M5 21h14"/>';
  else if (code >= 95) inner = `<g transform="translate(0 -3)">${cloud}</g>${bolt}`;
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) inner = `<g transform="translate(0 -3)">${cloud}</g>${snow}`;
  else if (code >= 51) inner = `<g transform="translate(0 -3)">${cloud}</g>${rain}`;
  else inner = cloud;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/** The Cortana logo as an icon string (two concentric rings). */
export const CORTANA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8.2" stroke-width="3.2" opacity=".75"/><circle cx="12" cy="12" r="4.4" stroke-width="1.6"/></svg>';

/**
 * Current location with caching. Uses GPS only if already permitted (never prompts from tiles/background),
 * otherwise IP location. Cached in Cortana storage for 30 minutes.
 */
export async function getPlace(os, storage, { prompt = false, maxAge = 30 * 60e3 } = {}) {
  const cached = await storage.get('place', null);
  if (cached && Date.now() - cached.t < maxAge) return cached;
  let loc = null;
  try { loc = await os.device.getLocation(); } catch {}
  if (!loc) { if (cached) return cached; throw new Error('Couldn’t find your location'); }
  let name = loc.city || '';
  if (!name) { try { const r = await os.net.reverse(loc.lat, loc.lon); name = r.name || r.display || ''; } catch {} }
  const place = { lat: loc.lat, lon: loc.lon, name: name || 'your location', approximate: !!loc.approximate, t: Date.now() };
  await storage.set('place', place);
  return place;
}

export const greeting = (d = new Date()) => {
  const h = d.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export async function displayName(os, storage) {
  const n = (await storage.get('name', '')) || os.settings.get('ownerName') || '';
  return n && n !== 'Lumia owner' ? n.split(' ')[0] : '';
}

/* ------------------------------------------------------------------ reminder scheduler */
// Reminders: storage 'reminders' => [{ id, text, when (ms|null), created, done, fired, kind: 'reminder'|'timer' }]

let sched = null;
/** Start the scheduler (called by background.js once). */
export function startScheduler(os, storage) {
  if (sched) return sched;
  const timers = new Map();
  const fire = async (id) => {
    timers.delete(id);
    const list = await storage.get('reminders', []);
    const r = list.find((x) => x.id === id);
    if (!r || r.fired || r.done || !r.when) return;
    r.fired = true;
    if (r.kind === 'timer') r.done = true;
    await storage.set('reminders', list);
    if (r.kind === 'timer') {
      os.notify({ appId: 'cortana', title: 'Time’s up!', body: r.text || 'Your timer is done.', args: { reminder: id } });
      try { if (os.settings.get('sounds') !== false) os.sounds.play('Alarm Classic', { volume: 0.25 }); } catch {}
      os.device.vibrate([300, 150, 300, 150, 300]);
    } else {
      os.notify({ appId: 'cortana', title: 'Reminder', body: r.text || 'You asked me to remind you.', args: { reminder: id } });
    }
    sched.emit();
  };
  const check = async () => {
    const list = await storage.get('reminders', []);
    const now = Date.now();
    for (const r of list) {
      if (r.fired || r.done || !r.when || timers.has(r.id)) continue;
      if (r.when - now <= 25e3) timers.set(r.id, setTimeout(() => fire(r.id), Math.max(0, r.when - now)));
    }
  };
  const listeners = new Set();
  sched = {
    poke: () => check(),
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    emit: () => listeners.forEach((f) => { try { f(); } catch {} }),
  };
  check();
  setInterval(check, 20e3);
  return sched;
}
export const scheduler = () => sched;
