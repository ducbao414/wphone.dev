// Windows Phone theme: dark/light background + accent color, exposed as CSS variables.
import { settings } from './settings.js';

export const ACCENTS = {
  lime: '#A4C400', green: '#60A917', emerald: '#008A00', teal: '#00ABA9',
  cyan: '#1BA1E2', cobalt: '#0050EF', indigo: '#6A00FF', violet: '#AA00FF',
  pink: '#F472D0', magenta: '#D80073', crimson: '#A20025', red: '#E51400',
  orange: '#FA6800', amber: '#F0A30A', yellow: '#E3C800', brown: '#825A2C',
  olive: '#6D8764', steel: '#647687', mauve: '#76608A', taupe: '#87794E',
};

export function accentColor() { return ACCENTS[settings.get('accent')] || settings.get('accent') || ACCENTS.cyan; }
export function isDark() { return settings.get('theme') !== 'light'; }

/** Lighten (amt>0) or darken (amt<0) a hex color. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(Math.min(255, Math.max(0, amt > 0 ? c + (255 - c) * amt : c * (1 + amt))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export function applyTheme() {
  const root = document.documentElement;
  const a = accentColor();
  root.style.setProperty('--accent', a);
  root.style.setProperty('--accent-dark', shade(a, -0.25));
  root.style.setProperty('--accent-light', shade(a, 0.3));
  root.dataset.theme = isDark() ? 'dark' : 'light';
  root.style.setProperty('--font-scale', settings.get('fontScale') || 1);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', isDark() ? '#000000' : '#ffffff');
}

export function initTheme() {
  applyTheme();
  settings.on('change', (k) => { if (['theme', 'accent', 'fontScale'].includes(k)) applyTheme(); });
}
