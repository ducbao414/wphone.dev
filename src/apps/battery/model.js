// Shared battery helpers (used by the app, background service and live tile).
export const DEFAULTS = { auto: true, threshold: 0.2 };
const NORMAL_FULL_HOURS = 16;   // plausible full-charge life of a Lumia under mixed use
const SAVER_FACTOR = 1.35;

/**
 * Estimate time left from recorded level history.
 * history: [{ t, l, c }] oldest first. battery: { level, charging, supported }.
 * Returns { charging, minutes, measured }.
 */
export function estimate(history = [], battery = {}, saver = false) {
  const level = battery.level ?? 1;
  const charging = !!battery.charging;
  // samples of the current (dis)charging stretch
  const stretch = [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (!!history[i].c !== charging) break;
    stretch.unshift(history[i]);
  }
  const first = stretch[0], last = stretch[stretch.length - 1];
  const dt = first && last ? last.t - first.t : 0;
  const dl = first && last ? (charging ? last.l - first.l : first.l - last.l) : 0;
  if (charging) {
    if (level >= 0.999) return { charging, minutes: 0, measured: false };
    if (dt >= 5 * 60e3 && dl >= 0.01) return { charging, minutes: Math.round(((1 - level) / (dl / dt)) / 60e3), measured: true };
    return { charging, minutes: Math.round((1 - level) * 120), measured: false };
  }
  if (dt >= 10 * 60e3 && dl >= 0.01) {
    let m = (level / (dl / dt)) / 60e3;
    if (saver) m *= 1.1;
    return { charging, minutes: Math.round(Math.min(m, 7 * 24 * 60)), measured: true };
  }
  return { charging, minutes: Math.round(level * NORMAL_FULL_HOURS * 60 * (saver ? SAVER_FACTOR : 1)), measured: false };
}

export function formatMinutes(min) {
  min = Math.max(0, Math.round(min));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  const p = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d) return h ? `${p(d, 'day')} ${p(h, 'hour')}` : p(d, 'day');
  if (h) return m ? `${p(h, 'hour')} ${p(m, 'minute')}` : p(h, 'hour');
  return p(m, 'minute');
}
export function shortMinutes(min) {
  min = Math.max(0, Math.round(min));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Turn raw usage counters into weighted shares. usage: { appId: { launches, fg, bg } } */
export function usageShares(usage = {}) {
  const rows = Object.entries(usage).map(([id, u]) => ({ id, ...u, w: (u.fg || 0) + (u.bg || 0) * 0.2 + (u.launches || 0) * 15000 }));
  const total = rows.reduce((a, r) => a + r.w, 0) || 1;
  return rows.filter((r) => r.w > 0).map((r) => ({ ...r, pct: (r.w / total) * 100 })).sort((a, b) => b.w - a.w);
}
