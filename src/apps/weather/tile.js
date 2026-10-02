import { cond, deg, dayShort, placeKey } from './wx.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default {
  interval: 30 * 60e3,
  async update(os, { size, args }) {
    const st = os.storage('weather');
    const units = os.settings.get('units') || 'metric';
    let place = args?.place;
    if (!place) {
      place = await st.get('here', null);
      if (!place) {
        try {
          const loc = await os.device.locate();
          let name = loc.city;
          try { name = (await os.net.reverse(loc.lat, loc.lon)).name || name; } catch {}
          place = { lat: loc.lat, lon: loc.lon, name: name || 'Current location' };
          st.set('here', place);
        } catch { return null; }
      }
    }
    let d;
    try { d = await os.net.weather(place.lat, place.lon, units); } catch {
      d = await st.get('wx:' + (args?.place ? placeKey(place) : 'here') + ':' + units, null);
    }
    if (!d?.current) return null;
    const x = d.current, day = d.daily;
    const c = cond(x.weather_code, x.is_day);
    const hi = deg(day.temperature_2m_max[0]), lo = deg(day.temperature_2m_min[0]);
    const name = esc(place.name);
    const faces = [];
    if (size === 'wide') {
      const next = [1, 2, 3].map((i) => {
        const cc = cond(day.weather_code[i], 1);
        return `<div style="flex:1;min-width:0"><div class="t-sub">${esc(dayShort(day.time[i]))}</div>` +
          `<div>${os.ui.iconSVG(cc.icon, { size: 22, stroke: 1.6 })}</div>` +
          `<div class="t-sub">${deg(day.temperature_2m_max[i])} / ${deg(day.temperature_2m_min[i])}</div></div>`;
      }).join('');
      faces.push({
        html: `<div style="display:flex;gap:10px;align-items:flex-start;height:100%">` +
          `<div style="flex:1.2;min-width:0"><div class="t-big">${deg(x.temperature_2m)}</div>` +
          `<div class="t-mid" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.label)}</div>` +
          `<div class="t-sub">${hi} / ${lo}</div><div class="t-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div></div>` +
          `<div style="flex:2;display:flex;gap:6px;padding-top:4px">${next}</div></div>`,
      });
      faces.push({
        html: `<div style="display:flex;align-items:center;gap:12px;height:100%">${os.ui.iconSVG(c.icon, { size: 64, stroke: 1.2 })}` +
          `<div><div class="t-big">${deg(x.temperature_2m)}</div><div class="t-mid">${name}</div><div class="t-sub">Feels like ${deg(x.apparent_temperature)}</div></div></div>`,
      });
    } else {
      faces.push({
        html: `<div style="display:flex;flex-direction:column;height:100%">` +
          `<div style="display:flex;align-items:center;gap:6px">${os.ui.iconSVG(c.icon, { size: 30, stroke: 1.5 })}<span class="t-big">${deg(x.temperature_2m)}</span></div>` +
          `<div class="t-sub" style="margin-top:6px">${esc(c.label)}</div><div class="t-sub">${hi} / ${lo}</div></div>`,
      });
    }
    return { faces, iconFirst: false, title: place.name };
  },
};
