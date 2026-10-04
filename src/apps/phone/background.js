// Phone background: seed a believable call history once, then simulate an occasional missed call from a friend.
import { phoneTileData } from './tile.js';

const nameOf = (c) => c.name || [c.first, c.last].filter(Boolean).join(' ');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function contactsWithPhones(os) {
  return ((await os.storage('people').get('contacts', [])) || []).filter((c) => c.phones?.length);
}

async function seedHistory(os, storage) {
  if (await storage.get('historySeeded', false)) return true;
  const people = await contactsWithPhones(os);
  if (people.length < 3) return false; // People hasn't seeded yet
  const now = Date.now();
  const hist = await storage.get('history', []);
  const types = ['outgoing', 'incoming', 'incoming', 'outgoing', 'missed'];
  for (let i = 0; i < 14; i++) {
    const c = i % 4 === 0 ? people[0] : pick(people);
    const type = pick(types);
    hist.push({ id: (now - i).toString(36) + i, number: c.phones[0].number, name: nameOf(c), contact: c.id, type,
      time: now - (i * 11 + Math.random() * 10 + 2) * 3600e3, duration: type === 'missed' ? 0 : Math.round(20 + Math.random() * 900) });
  }
  hist.sort((a, b) => b.time - a.time);
  await storage.set('history', hist.slice(0, 300));
  await storage.set('historySeeded', true);
  window.dispatchEvent(new Event('wp:calls'));
  return true;
}

export async function missedCall(os, storage) {
  const people = await contactsWithPhones(os);
  if (!people.length) return;
  const c = pick(people);
  const name = nameOf(c);
  const hist = await storage.get('history', []);
  hist.unshift({ id: Date.now().toString(36), number: c.phones[0].number, name, contact: c.id, type: 'missed', time: Date.now(), duration: 0 });
  await storage.set('history', hist.slice(0, 300));
  await storage.set('missedUnseen', (await storage.get('missedUnseen', 0)) + 1);
  window.dispatchEvent(new Event('wp:calls'));
  os.notify({ appId: 'phone', title: 'Missed call', body: name, args: { history: true } });
  os.tiles.set('phone', await phoneTileData(os));
}

export default function start(os, { storage }) {
  const seed = async (tries = 0) => { if (!(await seedHistory(os, storage).catch(() => false)) && tries < 10) setTimeout(() => seed(tries + 1), 3000); };
  setTimeout(seed, 2000);
  const tick = async () => {
    try {
      // don't "ring" while someone is using the phone app or in airplane mode
      if (os.settings.get('simActivity') !== false && !os.settings.get('batterySaver') && !document.hidden && !os.settings.get('airplane') && !os.apps.running().includes('phone')) await missedCall(os, storage);
    } catch (e) { console.warn('phone sim', e); }
    setTimeout(tick, (18 + Math.random() * 25) * 60e3); // every 18–43 minutes
  };
  setTimeout(tick, (6 + Math.random() * 6) * 60e3);
}
