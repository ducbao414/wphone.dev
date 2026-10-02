import { AlarmClock } from 'lucide';

export default {
  id: 'alarms',
  name: 'Alarms',
  icon: AlarmClock,
  category: 'system',
  preinstalled: true,
  pin: { size: 'small', order: 18 },
  tileSizes: ['small', 'medium', 'wide'],
  publisher: 'Microsoft Corporation',
  description: 'Alarms, timer and stopwatch. Wake up on time with repeating alarms, snooze and your favourite ringtone.',
  keywords: ['alarm', 'clock', 'timer', 'stopwatch', 'wake'],
};
