// Outlook background: friends and (2014-flavored) services email you every so often.
import { loadMail, tileData, newId } from './store.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameOf = (c) => c.name || [c.first, c.last].filter(Boolean).join(' ');

const FRIEND = [
  ['Photos from the weekend', (f) => `Hey!\n\nFinally got around to sorting the photos from the weekend. Some of them are hilarious — I’ll upload them to OneDrive tonight.\n\nTalk soon,\n${f}`],
  ['Dinner next week?', (f) => `Hi,\n\nIt’s been ages! Are you free for dinner next week? There’s a new place downtown I’ve been wanting to try.\n\nLet me know what works,\n${f}`],
  ['Re: that article', (f) => `Haha, I can’t believe you sent me that. Totally agree though.\n\nDid you see the follow-up? Apparently there’s going to be a sequel 😄\n\n${f}`],
  ['Quick question', (f) => `Hey, quick question — do you still have that charger I lent you? No rush, just checking.\n\nThanks!\n${f}`],
  ['Trip planning ✈', (f) => `So I was thinking about the trip... what do you think about going in spring instead? Flights are way cheaper.\n\nI made a little budget in Excel, will share it later.\n\n— ${f}`],
  ['Happy Friday!', (f) => `Just wanted to say have an awesome weekend! Any plans?\n\nCheers,\n${f}`],
];
const SERVICES = [
  { name: 'Xbox', address: 'xbox@microsoft.com', subject: 'Your weekly Xbox highlights', body: 'Here’s what your friends played this week, plus new deals with Gold.\n\nTip: earn achievements in Minesweeper and Solitaire on your phone — they count toward your gamerscore!' },
  { name: 'Nokia', address: 'news@nokia.com', subject: 'Get the most out of your Lumia camera', body: 'Five tips for better low-light photos with your Lumia:\n\n1. Hold steady and let the camera do the work\n2. Try the Rich Capture mode\n3. Turn off the flash for natural shots\n4. Use the grid lines to frame\n5. Shoot in RAW (DNG) if your phone supports it' },
  { name: 'OneDrive', address: 'onedrive@microsoft.com', subject: 'Your memories from this day', body: 'You took some photos on this day in previous years. Take a look back!\n\nThe OneDrive team' },
  { name: 'Windows Phone Store', address: 'store@windowsphone.com', subject: 'New and rising apps this week', body: 'Check out this week’s picks: Wordament, 2048, Blocks and more. Open the Store on your phone to see what’s new.' },
  { name: 'Bing', address: 'bing@microsoft.com', subject: 'Bing Rewards: you’ve earned 10 credits', body: 'Thanks for searching with Bing! You’ve earned 10 credits this week. Keep it up to redeem gift cards.' },
  { name: 'Skype', address: 'skype@microsoft.com', subject: 'You have 60 free world minutes', body: 'Call landlines in over 60 countries free this month with your Office 365 subscription.' },
];

export async function deliver(os, storage) {
  const mail = await loadMail(storage);
  const people = ((await os.storage('people').get('contacts', [])) || []).filter((c) => c.emails?.length);
  let m;
  if (people.length && Math.random() < 0.65) {
    const c = pick(people);
    const [subject, body] = pick(FRIEND);
    m = { from: { name: nameOf(c), address: c.emails[0].address }, subject, body: body(c.first || nameOf(c)) };
  } else {
    const s = pick(SERVICES);
    m = { from: { name: s.name, address: s.address }, subject: s.subject, body: s.body };
  }
  mail.unshift({ id: newId(), folder: 'inbox', to: [], cc: [], date: Date.now(), read: false, flagged: false, attachments: [], ...m });
  await storage.set('mail', mail);
  window.dispatchEvent(new Event('wp:mail'));
  os.tiles.set('outlook', tileData(mail, esc));
  os.notify({ appId: 'outlook', title: m.from.name, body: m.subject, args: { message: mail[0].id } });
}

export default function start(os, { storage }) {
  const tick = async () => {
    try {
      if (os.settings.get('simActivity') !== false && !os.settings.get('batterySaver') && !document.hidden && !os.settings.get('airplane')) await deliver(os, storage);
    } catch (e) { console.warn('outlook sim', e); }
    setTimeout(tick, (12 + Math.random() * 20) * 60e3); // every 12–32 minutes
  };
  setTimeout(tick, (4 + Math.random() * 5) * 60e3);
}
