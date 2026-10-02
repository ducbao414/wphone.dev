// Cortana live tile: greeting + weather at your location, next reminder.
import { getPlace, greeting, displayName, wmoText } from './shared.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default {
  interval: 20 * 60e3,
  async update(os, { size }) {
    const storage = os.storage('cortana');
    const name = await displayName(os, storage).catch(() => '');
    const faces = [];
    faces.push({ html: `<div class="t-mid">${esc(greeting())}${name ? ',<br>' + esc(name) : ''}</div><div class="t-sub">Ask me anything</div>` });
    try {
      const place = await getPlace(os, storage);
      const wx = await os.net.weather(place.lat, place.lon, os.settings.get('units') || 'metric');
      faces.push({ html: `<div class="t-big">${Math.round(wx.current.temperature_2m)}°</div><div class="t-sub">${esc(wmoText(wx.current.weather_code))}</div><div class="t-sub">${esc(place.name.split(',')[0])}</div>` });
    } catch {}
    const rem = ((await storage.get('reminders', [])) || []).filter((r) => !r.done && r.kind !== 'timer' && r.when && !r.fired).sort((a, b) => a.when - b.when)[0];
    if (rem) {
      const d = new Date(rem.when);
      const today = d.toDateString() === new Date().toDateString();
      const t = os.util.formatTime(d);
      faces.push({ html: `<div class="t-sub">reminder · ${today ? t : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t}</div><div class="t-mid t-clip">${esc(rem.text)}</div>` });
    }
    const pending = ((await storage.get('reminders', [])) || []).filter((r) => !r.done && r.kind !== 'timer' && r.fired).length;
    return { faces: size === 'small' ? [] : faces, badge: pending || null };
  },
};
