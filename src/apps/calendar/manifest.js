import { CalendarDays } from 'lucide';

export default {
  id: 'calendar',
  name: 'Calendar',
  icon: CalendarDays,
  category: 'system',
  preinstalled: true,
  pin: { size: 'medium', order: 5 },
  tileSizes: ['small', 'medium', 'wide'],
  handles: ['.ics', 'text/calendar'],
  publisher: 'Microsoft Corporation',
  description: 'Keep track of appointments, birthdays and reminders with day, week, month and agenda views.',
  rating: 4.3,
  size: '6 MB',
  keywords: ['calendar', 'events', 'appointments', 'agenda', 'reminders', 'ics'],
};
