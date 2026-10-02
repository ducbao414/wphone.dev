// Shared weather helpers (used by index.js and tile.js).
import {
  Sun, Moon, CloudSun, CloudMoon, Cloud, Cloudy, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudHail,
  CloudLightning, Snowflake,
} from 'lucide';

// WMO weather interpretation codes -> [label, dayIcon, nightIcon, kind]
const CODES = {
  0: ['Clear', Sun, Moon, 'clear'],
  1: ['Mostly clear', CloudSun, CloudMoon, 'clear'],
  2: ['Partly cloudy', CloudSun, CloudMoon, 'partly'],
  3: ['Cloudy', Cloudy, Cloudy, 'cloudy'],
  45: ['Fog', CloudFog, CloudFog, 'fog'],
  48: ['Freezing fog', CloudFog, CloudFog, 'fog'],
  51: ['Light drizzle', CloudDrizzle, CloudDrizzle, 'rain'],
  53: ['Drizzle', CloudDrizzle, CloudDrizzle, 'rain'],
  55: ['Heavy drizzle', CloudDrizzle, CloudDrizzle, 'rain'],
  56: ['Freezing drizzle', CloudDrizzle, CloudDrizzle, 'snow'],
  57: ['Freezing drizzle', CloudDrizzle, CloudDrizzle, 'snow'],
  61: ['Light rain', CloudRain, CloudRain, 'rain'],
  63: ['Rain', CloudRain, CloudRain, 'rain'],
  65: ['Heavy rain', CloudRain, CloudRain, 'rain'],
  66: ['Freezing rain', CloudHail, CloudHail, 'snow'],
  67: ['Freezing rain', CloudHail, CloudHail, 'snow'],
  71: ['Light snow', CloudSnow, CloudSnow, 'snow'],
  73: ['Snow', CloudSnow, CloudSnow, 'snow'],
  75: ['Heavy snow', Snowflake, Snowflake, 'snow'],
  77: ['Snow grains', CloudSnow, CloudSnow, 'snow'],
  80: ['Light showers', CloudRain, CloudRain, 'rain'],
  81: ['Showers', CloudRain, CloudRain, 'rain'],
  82: ['Heavy showers', CloudRain, CloudRain, 'rain'],
  85: ['Snow showers', CloudSnow, CloudSnow, 'snow'],
  86: ['Snow showers', CloudSnow, CloudSnow, 'snow'],
  95: ['Thunderstorms', CloudLightning, CloudLightning, 'storm'],
  96: ['Thunderstorms', CloudLightning, CloudLightning, 'storm'],
  99: ['Thunderstorms', CloudLightning, CloudLightning, 'storm'],
};

export function cond(code, isDay = 1) {
  const c = CODES[code] || CODES[Math.floor(code / 10) * 10] || ['Unknown', Cloud, Cloud, 'cloudy'];
  return { label: c[0], icon: isDay ? c[1] : c[2], kind: c[3] };
}

// Background colors by condition kind (day / night), MSN Weather-ish.
const BG = {
  clear: ['#1e88d6', '#0b2347'],
  partly: ['#3a8fc9', '#16294a'],
  cloudy: ['#5f7383', '#252d36'],
  fog: ['#7d8a93', '#2c3237'],
  rain: ['#3c5a78', '#18232f'],
  snow: ['#7f9db8', '#2a3a4c'],
  storm: ['#3b3f5c', '#15151f'],
};
export const bgFor = (kind, isDay) => (BG[kind] || BG.cloudy)[isDay ? 0 : 1];

export const deg = (v) => (v == null || !isFinite(v) ? '--' : Math.round(v) + '°');

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (d) => DIRS[Math.round(((d % 360) / 22.5)) % 16];

/** Parse an Open-Meteo local time string ("2026-10-02T16:30") without timezone conversion. */
export function parts(s) {
  const [d, t = '00:00'] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return { y, m, day, h, min, date: new Date(y, m - 1, day, h, min) };
}

export function fmtHour(s, h24) {
  const { h, min } = parts(s);
  if (h24) return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  const hh = h % 12 || 12;
  return min ? `${hh}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : `${hh} ${h < 12 ? 'AM' : 'PM'}`;
}

export const dayName = (s, i) => (i === 0 ? 'Today' : parts(s).date.toLocaleDateString('en-US', { weekday: 'long' }));
export const dayShort = (s) => parts(s).date.toLocaleDateString('en-US', { weekday: 'short' });
export const dateShort = (s) => parts(s).date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Index into hourly arrays matching the current hour of the location. */
export function hourIndex(d) {
  const cur = d.current?.time?.slice(0, 13);
  const i = d.hourly?.time?.findIndex((t) => t.slice(0, 13) === cur);
  return i >= 0 ? i : 0;
}

export const placeKey = (p) => (p ? `${(+p.lat).toFixed(2)},${(+p.lon).toFixed(2)}` : 'here');
export const placeLabel = (p) => [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : null, p.country].filter(Boolean).join(', ');
