const CORTANA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8.2" stroke-width="3.2" opacity=".75"/><circle cx="12" cy="12" r="4.4" stroke-width="1.6"/></svg>';

export default {
  id: 'cortana',
  name: 'Cortana',
  icon: CORTANA_ICON,
  category: 'system',
  preinstalled: true,
  pin: { size: 'medium', order: 12 },
  tileSizes: ['small', 'medium', 'wide'],
  publisher: 'Microsoft Corporation',
  description: 'Your personal assistant. Ask Cortana to set alarms and reminders, check the weather, call or text people, add events, take notes, do math, or search the web — by typing or with your voice.',
  rating: 4.5,
  size: '9.8 MB',
  keywords: ['assistant', 'search', 'bing', 'voice', 'reminders', 'speech', 'ask'],
};
