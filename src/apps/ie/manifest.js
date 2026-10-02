// Internet Explorer Mobile 11 (Windows Phone 8.1). Custom "e" glyph (no brand icon available in simple-icons).
const IE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7.2 12.4h9.6a4.9 4.9 0 1 0-1.3 3.6"/><path d="M5.3 16.9C2.4 20 1.3 21.3 3.3 21.6c2 .3 6.3-1.6 10.5-4.9 4.9-3.8 8.4-8.6 7.8-10.7-.3-1.1-1.6-1.4-3.6-1"/></svg>';

export default {
  id: 'ie',
  name: 'Internet Explorer',
  icon: IE_ICON,
  category: 'system',
  preinstalled: true,
  pin: { size: 'small', order: 9 },
  handles: ['text/html', '.html', '.htm'],
  shareTarget: true,
  publisher: 'Microsoft Corporation',
  description: 'Browse the web with Internet Explorer: tabs, favorites, reading view, and Bing search.',
  keywords: ['browser', 'web', 'internet', 'explorer', 'ie', 'bing'],
};
