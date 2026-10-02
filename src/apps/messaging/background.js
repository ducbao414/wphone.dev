// Simulated social life: seed some past conversations, then friends text you every so often.
import { seedConversations, simulateIncoming } from './index.js';

export default function start(os, { storage }) {
  const seed = async (tries = 0) => {
    await seedConversations(os, storage).catch(() => {});
    if (!(await storage.get('seededConvos', false)) && tries < 10) setTimeout(() => seed(tries + 1), 3000);
  };
  setTimeout(seed, 1500);
  const next = () => setTimeout(tick, (5 + Math.random() * 9) * 60e3); // every 5–14 minutes
  const tick = async () => {
    try {
      if (os.settings.get('simActivity') !== false && !document.hidden && !os.settings.get('airplane')) await simulateIncoming(os, storage);
    } catch (e) { console.warn('messaging sim', e); }
    next();
  };
  // first surprise text a few minutes after boot
  setTimeout(tick, (2 + Math.random() * 2) * 60e3);
}
