// Cortana background agent: fires reminders and timers (checks every 20 s, schedules exact timeouts for due items).
import { startScheduler } from './shared.js';

export default function start(os, { storage }) {
  startScheduler(os, storage);
}
