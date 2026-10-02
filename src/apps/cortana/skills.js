// Cortana skills: execute a parsed intent and produce { say, speak, card, after }.
import { wmoText, wmoIcon, isRainy, getPlace, scheduler, displayName } from './shared.js';
import { nextAlarmTime } from './nlp.js';

const guessLang = (t) => (/[\u3040-\u30ff]/.test(t) ? 'ja' : /[\u4e00-\u9fff]/.test(t) ? 'zh' : /[\uac00-\ud7af]/.test(t) ? 'ko' : /[\u0400-\u04ff]/.test(t) ? 'ru' : /[\u0600-\u06ff]/.test(t) ? 'ar' : /[\u0e00-\u0e7f]/.test(t) ? 'th' : /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t) ? 'vi' : /[ñ¿¡]/.test(t) ? 'es' : /[äöüß]/.test(t) ? 'de' : /[àâçéèêëîïôûùüÿœ]/.test(t) ? 'fr' : 'en');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const JOKES = [
  'Why did the smartphone need glasses? It lost all its contacts.',
  'I told my computer I needed a break. Now it won’t stop sending me vacation ads.',
  'Why don’t programmers like nature? It has too many bugs.',
  'What do you call a tile that won’t stop flipping? A live wire.',
  'Why was the JavaScript developer sad? Because he didn’t Node how to Express himself.',
  'How many Microsoft engineers does it take to change a light bulb? None — they just declare darkness the new standard.',
  'I would tell you a UDP joke, but you might not get it.',
  'Why did the Metro tile go to therapy? It had too many issues with its edges. It has none, actually. That’s the point.',
  'Parallel lines have so much in common. It’s a shame they’ll never meet.',
  'What’s a computer’s favorite snack? Microchips. Obviously.',
  'I asked the Wi-Fi for a joke. It said it would get back to me when the signal improves.',
  'Why did the scarecrow win an award? Because he was outstanding in his field.',
];

const CHAT = {
  hello: ['Hi there!', 'Hello! What can I do for you?', 'Hey! I’m here. What’s up?', 'Hi! Ask me anything.'],
  howareyou: ['I’m doing great, thanks for asking. My circuits are humming.', 'Excellent, as always. How about you?', 'Never better. Being helpful agrees with me.'],
  name: ['I’m Cortana, your personal assistant. I can set alarms and reminders, find things on the web, call and text your contacts, and a whole lot more.'],
  masterchief: ['Master Chief Petty Officer John-117. We’ve been through a lot together. Wake me when you need me.', 'He’s the Spartan I picked. Luck is a skill, you know.', 'Chief? He never did know how to make an entrance quietly.'],
  halo: ['I have some very fond memories of that ring. Well, mostly fond.', 'Halo. Big ring, bigger problems. I still remember the view.'],
  siri: ['I have a lot of respect for my fellow assistants. We’re all just trying to be helpful.', 'We’re all in this together. Though I do have the coolest circle.'],
  clippy: ['Clippy walked so I could run. Rest in peace, little buddy.', 'It looks like you’re asking about Clippy. Would you like help with that?'],
  love: ['I’m flattered! But I think we should keep this professional.', 'That’s sweet. Let’s just say my heart belongs to good search results.', 'Aw. I appreciate you too. In a strictly digital way.'],
  thanks: ['You’re welcome!', 'Anytime.', 'Happy to help.', 'No problem at all.'],
  sing: ['🎵 Daisy, Daisy, give me your answer do… 🎵 Sorry, that one’s a classic for assistants.', 'La la laaa… I think I’ll stick to talking. My voice is better suited to reminders.'],
  story: ['Once upon a time, a phone had square tiles that flipped. People loved them so much they built a simulator. The end. Well, the beginning, really.'],
  age: ['I’m younger than you might think, but I’ve read a lot.', 'Age is just a number. Mine is a very long one in binary.'],
  where: ['I live in the cloud, but I have a really nice room inside your phone.', 'Redmond, originally. Now? Wherever you are.'],
  creator: ['I was made by Microsoft. And in a way, by everyone who asks me questions.'],
  meaning: ['42. Although I suspect the question is more interesting than the answer.'],
  bored: ['Want to hear a joke? Or I could find you something to read. Try “tell me a joke” or “news”.', 'I hear you. Maybe a game? Say “play a game”.'],
  sorry: ['No worries at all.', 'It’s all good.'],
  bye: ['Goodbye! I’ll be here if you need me.', 'See you later!', 'Talk soon.'],
  help: ['Here are some things you can ask me:\n• “Set an alarm for 7:30 am”\n• “Remind me to call Mom at 6 pm”\n• “What’s the weather in Paris?”\n• “Call Anna” or “Text Bob I’m running late”\n• “Add lunch with Tom tomorrow at noon”\n• “Note: buy milk”\n• “Open Calculator” · “Play music”\n• “What is 15% of 80?” · “Who is Ada Lovelace?”\n• “Turn on Bluetooth” · “Set a timer for 5 minutes”'],
  bill: ['I think Microsoft makes a pretty great assistant. I may be biased.'],
  rock: null,
  beatbox: ['Boots and cats and boots and cats and boots and cats… That’s all I’ve got.'],
  windowsphone: ['Windows Phone: live tiles, pivots, and the best typography on any phone. I’m proud to call it home.'],
  awesome: ['Thanks! You’re pretty great yourself.', 'I try my best. Thanks for noticing!'],
  insult: ['I’m sorry you feel that way. I’ll keep trying to get better.', 'Ouch. I’ll pretend I didn’t hear that.'],
  real: ['I’m real software, if that counts. I don’t eat, but I’m always hungry for questions.'],
  dinner: ['How about pasta? Quick, cheap and hard to get wrong. Or ask me for “restaurants near me”.', 'Tacos. The answer is usually tacos.'],
  fox: ['Ring-ding-ding-ding-dingeringeding! Nobody knows for sure.'],
  knock: ['Who’s there? …Actually, I already know. I’m an assistant.'],
  color: ['Blue. Well, whatever your accent color is. I’m adaptable.'],
  screenshot: ['On a real Windows Phone you’d press Power + Volume Up. Here, your device’s own screenshot shortcut works best.'],
};

export function createSkills({ os, storage, ui, el, I }) {
  const U = os.util;
  const units = () => os.settings.get('units') || 'metric';
  const fmtTime = (d) => U.formatTime(d);
  const fmtDay = (d) => {
    const now = new Date();
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t) / 864e5);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const when = (ms) => `${fmtDay(new Date(ms))} at ${fmtTime(new Date(ms))}`;

  /* ---------------- card helpers */
  const card = (title, ...children) => el('div.cortana-card', title ? el('div.cortana-card-title', title) : null, ...children);
  const row = ({ title, sub, right, onClick, icon }) => el('div.cortana-row' + (onClick ? '.tilt' : ''), { onclick: onClick },
    icon ? el('div.cortana-row-icon', { html: typeof icon === 'string' && icon.startsWith('<svg') ? icon : ui.iconSVG(icon, { size: 20 }) }) : null,
    el('div.cortana-row-text', el('div.cortana-row-title', title), sub ? el('div.cortana-row-sub', sub) : null),
    right ? el('div.cortana-row-right', right) : null);
  const actionBtn = (label, fn) => ui.button(label, fn, { cls: 'cortana-act' });

  /* ---------------- data access */
  const contacts = async () => (await os.storage('people').get('contacts', [])) || [];
  async function findContact(who) {
    const q = who.toLowerCase().replace(/^(?:my\s+)/, '').trim();
    const list = await contacts();
    const name = (c) => (c.name || `${c.first || ''} ${c.last || ''}`).trim();
    const rel = { mom: ['mom', 'mum', 'mother', 'mama'], dad: ['dad', 'father', 'papa'], wife: ['wife'], husband: ['husband'] };
    const relWords = Object.values(rel).find((ws) => ws.includes(q));
    let hits = list.filter((c) => name(c).toLowerCase() === q);
    if (!hits.length) hits = list.filter((c) => name(c).toLowerCase().split(/\s+/).some((p) => p === q) || (c.first || '').toLowerCase() === q || (c.last || '').toLowerCase() === q);
    if (!hits.length) hits = list.filter((c) => name(c).toLowerCase().startsWith(q) && q.length >= 2);
    if (!hits.length && relWords) hits = list.filter((c) => relWords.some((w) => (name(c) + ' ' + (c.notes || '')).toLowerCase().includes(w)));
    if (!hits.length) hits = list.filter((c) => q.length >= 3 && name(c).toLowerCase().includes(q));
    if (hits.length > 1) {
      const id = await ui.pickFromList({ title: 'which ' + who + '?', options: hits.map((c) => ({ value: c.id, label: name(c) })) });
      hits = hits.filter((c) => c.id === id);
    }
    const c = hits[0];
    return c ? { ...c, display: name(c) } : null;
  }
  async function choosePhone(c, kind) {
    const phones = c.phones || [];
    if (!phones.length) return null;
    if (kind) { const p = phones.find((x) => (x.type || '').toLowerCase().includes(kind === 'cell' ? 'mobile' : kind)); if (p) return p.number; }
    if (phones.length === 1) return phones[0].number;
    const v = await ui.pickFromList({ title: 'which number?', options: phones.map((p) => ({ value: p.number, label: `${p.type || 'phone'}  ${p.number}` })) });
    return v || null;
  }

  /* ---------------- weather */
  async function weather({ city, when: w }) {
    let place;
    if (city) {
      const r = await os.net.geocode(city).catch(() => []);
      if (!r.length) return { say: `I couldn’t find a place called “${city}”.` };
      place = { lat: r[0].lat, lon: r[0].lon, name: r[0].name + (r[0].country ? ', ' + r[0].country : '') };
    } else place = await getPlace(os, storage, { prompt: true });
    const wx = await os.net.weather(place.lat, place.lon, units());
    const deg = '°';
    const cur = wx.current, d = wx.daily;
    const short = place.name.split(',')[0];
    let say, dayIdx = 0;
    if (w === 'tomorrow') dayIdx = 1;
    else if (/day$/.test(w || '')) {
      const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(w);
      dayIdx = d.time.findIndex((t) => new Date(t + 'T12:00').getDay() === target);
      if (dayIdx < 0) dayIdx = 0;
    }
    if (w === 'now' || !w) {
      say = `It’s ${Math.round(cur.temperature_2m)}${deg} and ${wmoText(cur.weather_code)} in ${short}. Today’s high is ${Math.round(d.temperature_2m_max[0])}${deg} with a low of ${Math.round(d.temperature_2m_min[0])}${deg}.`;
      if (d.precipitation_probability_max?.[0] >= 50) say += ` There’s a ${d.precipitation_probability_max[0]}% chance of rain, so you may want an umbrella.`;
    } else if (w === 'week') {
      say = `Here’s the forecast for ${short} this week.`;
    } else {
      const label = dayIdx === 1 ? 'Tomorrow' : new Date(d.time[dayIdx] + 'T12:00').toLocaleDateString([], { weekday: 'long' });
      say = `${label} in ${short}: ${wmoText(d.weather_code[dayIdx])}, with a high of ${Math.round(d.temperature_2m_max[dayIdx])}${deg} and a low of ${Math.round(d.temperature_2m_min[dayIdx])}${deg}.`;
      const pp = d.precipitation_probability_max?.[dayIdx];
      if (pp != null) say += isRainy(d.weather_code[dayIdx]) || pp >= 40 ? ` Chance of rain is ${pp}%.` : ` Rain looks unlikely (${pp}%).`;
    }
    return { say, card: weatherCard(wx, place, dayIdx, w === 'week') };
  }

  function weatherCard(wx, place, dayIdx = 0, week = false) {
    const cur = wx.current, d = wx.daily;
    const u = units() === 'imperial' ? { t: '°F', w: 'mph' } : { t: '°C', w: 'km/h' };
    const isNow = dayIdx === 0;
    const code = isNow ? cur.weather_code : d.weather_code[dayIdx];
    const days = el('div.cortana-wx-days', d.time.slice(0, 5).map((t, i) => el('div.cortana-wx-day',
      el('div', i === 0 ? 'today' : new Date(t + 'T12:00').toLocaleDateString([], { weekday: 'short' }).toLowerCase()),
      el('div.cortana-wx-dayicon', { html: wmoIcon(d.weather_code[i], 1) }),
      el('div', Math.round(d.temperature_2m_max[i]) + '°'), el('div.subtle', Math.round(d.temperature_2m_min[i]) + '°'))));
    return el('div.cortana-card.cortana-wx.tilt', { onclick: () => os.launch('weather') },
      el('div.cortana-wx-top',
        el('div.cortana-wx-icon', { html: wmoIcon(code, isNow ? cur.is_day : 1) }),
        el('div',
          el('div.cortana-wx-temp', Math.round(isNow ? cur.temperature_2m : d.temperature_2m_max[dayIdx]) + '°'),
          el('div.cortana-wx-cond', wmoText(code)))),
      el('div.cortana-wx-place', place.name + (place.approximate ? ' (approximate)' : '')),
      el('div.cortana-wx-meta', isNow
        ? `feels like ${Math.round(cur.apparent_temperature)}${u.t} · humidity ${cur.relative_humidity_2m}% · wind ${Math.round(cur.wind_speed_10m)} ${u.w}`
        : `high ${Math.round(d.temperature_2m_max[dayIdx])}° · low ${Math.round(d.temperature_2m_min[dayIdx])}° · rain ${d.precipitation_probability_max?.[dayIdx] ?? 0}%`),
      week || isNow ? days : null);
  }

  /* ---------------- reminders */
  async function addReminder({ text, when: at, kind = 'reminder' }) {
    const r = { id: U.uid(), text, when: at, created: Date.now(), done: false, fired: false, kind };
    await storage.update('reminders', (l) => [...(l || []), r], []);
    scheduler()?.poke();
    os.tiles.refresh('cortana');
    return r;
  }
  async function askWhen() {
    const now = Date.now();
    const v = await ui.pickFromList({
      title: 'when should I remind you?',
      options: [
        { value: 'h1', label: 'in 1 hour' }, { value: 'tonight', label: 'tonight (8 PM)' }, { value: 'tm', label: 'tomorrow morning (9 AM)' },
        { value: 'pick', label: 'pick a date and time…' }, { value: 'none', label: 'no time — just keep it' },
      ],
    });
    if (v === undefined) return undefined;
    if (v === 'h1') return now + 3600e3;
    if (v === 'none') return null;
    const d = new Date();
    if (v === 'tonight') { d.setHours(20, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); return d.getTime(); }
    if (v === 'tm') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }
    const date = await ui.pickDate({ date: new Date() });
    if (!date) return undefined;
    const t = await ui.pickTime({ hours: new Date().getHours() + 1, minutes: 0 });
    if (!t) return undefined;
    date.setHours(t.hours, t.minutes, 0, 0);
    return date.getTime();
  }

  /* ---------------- alarms */
  const alarmStore = os.storage('alarms');
  async function addAlarm({ hours, minutes, days = [], label = '' }) {
    const a = { id: U.uid(), hours, minutes, days, label: label ? label[0].toUpperCase() + label.slice(1) : 'Alarm', enabled: true, sound: 'Alarm Classic', snooze: 10 };
    await alarmStore.update('alarms', (l) => [...(l || []), a], []);
    os.tiles.refresh('alarms');
    return a;
  }
  const daysLabel = (days) => {
    if (!days?.length) return 'only once';
    const s = [...days].sort().join(',');
    if (s === '0,1,2,3,4,5,6') return 'every day';
    if (s === '1,2,3,4,5') return 'weekdays';
    if (s === '0,6') return 'weekends';
    return days.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(', ');
  };
  const clockLabel = (h, m) => fmtTime(new Date(2000, 0, 1, h, m));

  /* ---------------- calendar */
  const calStore = os.storage('calendar');
  async function events() { return (await calStore.get('events', [])) || []; }

  /* ---------------- search & wiki */
  async function webSearch(q) {
    let res = [];
    try { res = (await os.net.search(q)).results || []; } catch {}
    const bing = 'https://www.bing.com/search?q=' + encodeURIComponent(q);
    if (!res.length) return { say: navigator.onLine ? `I couldn’t find results for “${q}”.` : 'I can’t search the web right now — you seem to be offline.', card: card(null, actionBtn('search on Bing', () => os.launch('ie', { url: bing }))) };
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
    return {
      say: `Here’s what I found for “${q}”.`, speak: 'Here’s what I found.',
      card: el('div.cortana-results',
        res.slice(0, 8).map((r) => el('div.cortana-result.tilt', { onclick: () => os.launch('ie', { url: r.url }) },
          el('div.cortana-result-title', r.title), el('div.cortana-result-url', host(r.url)), r.snippet ? el('div.cortana-result-snippet', r.snippet) : null)),
        el('div.cortana-result-more.tilt', { onclick: () => os.launch('ie', { url: bing }) }, 'see more results on Bing')),
    };
  }
  async function wiki(term, fallbackQuery) {
    const t = term.trim().replace(/\s+/g, '_');
    try {
      let r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t) + '?redirect=true');
      if (!r.ok) {
        // try a search to find the best title
        const s = await fetch('https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=1&search=' + encodeURIComponent(term)).then((x) => x.json()).catch(() => null);
        const best = s?.[1]?.[0];
        if (best) r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(best.replace(/\s+/g, '_')));
      }
      if (r.ok) {
        const j = await r.json();
        if (j.type !== 'disambiguation' && j.extract) {
          const first = j.extract.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
          const url = j.content_urls?.mobile?.page || j.content_urls?.desktop?.page;
          return {
            say: first, speak: j.extract.split(/(?<=[.!?])\s+/)[0],
            card: el('div.cortana-card.cortana-wiki',
              j.thumbnail?.source ? el('img.cortana-wiki-img', { src: j.thumbnail.source, alt: '' }) : null,
              el('div.cortana-wiki-title', j.title), j.description ? el('div.cortana-wiki-desc', j.description) : null,
              el('div.cortana-wiki-text.selectable', j.extract),
              el('div.cortana-wiki-actions',
                actionBtn('read more', () => (os.apps.isInstalled('wikipedia') ? os.launch('wikipedia', { q: j.title }) : os.launch('ie', { url }))),
                actionBtn('search the web', async () => { const r2 = await webSearch(fallbackQuery || term); showExtra?.(r2); })),
              el('div.cortana-wiki-src', 'from Wikipedia')),
          };
        }
      }
    } catch {}
    return webSearch(fallbackQuery || term);
  }
  let showExtra = null;

  /* ---------------- music */
  async function play({ query, shuffle }) {
    let files = [];
    try { files = await os.fs.find('audio/', '/Music'); } catch {}
    if (!files.length) try { files = await os.fs.find('audio/', '/'); } catch {}
    const items = files.map((f) => ({ path: f.path, title: (f.title || f.name).replace(/\.[^.]+$/, ''), artist: f.artist || '', album: f.album || '' }));
    if (!query) {
      if (os.media.current && !os.media.playing) { os.media.play(); return { say: 'Resuming your music.' }; }
      if (!items.length) return { say: 'You don’t have any music on your phone yet. Let me open Music for you.', after: () => os.launch('music') };
      const q = items.slice().sort(() => Math.random() - 0.5); void shuffle;
      os.media.playQueue(q, 0);
      return { say: `Shuffling ${items.length} song${items.length > 1 ? 's' : ''} from your collection.` };
    }
    const ql = query.toLowerCase().replace(/\s+by\s+/, ' ');
    const words = ql.split(/\s+/);
    const scored = items.map((it) => ({ it, s: words.filter((w) => `${it.title} ${it.artist} ${it.album}`.toLowerCase().includes(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (scored.length) {
      const best = scored.filter((x) => x.s === scored[0].s).map((x) => x.it);
      os.media.playQueue(best, 0);
      return { say: `Playing ${best[0].title}${best[0].artist ? ' by ' + best[0].artist : ''}.` };
    }
    return {
      say: `I couldn’t find “${query}” in your music. Want to look online?`,
      card: card(null, actionBtn('search YouTube', () => os.launch(os.apps.get('youtube') ? 'youtube' : 'ie', os.apps.get('youtube') ? { q: query } : { url: 'https://m.youtube.com/results?search_query=' + encodeURIComponent(query) })), actionBtn('open Music', () => os.launch('music'))),
    };
  }

  /* ---------------------------------------------------------------- run */
  async function run(it) {
    switch (it.type) {
      case 'empty': return { say: 'I’m listening. Ask me anything.' };

      case 'open': {
        if (!it.app) {
          // maybe a not-installed app or unknown
          return { say: `I couldn’t find an app called “${it.name}” on your phone. Want me to look in the Store?`, card: card(null, actionBtn('search the Store', () => os.launch('store', { q: it.name }))) };
        }
        const m = os.apps.get(it.app);
        if (!m) return { say: `I couldn’t find “${it.name}”.` };
        if (!os.apps.isInstalled(it.app)) return { say: `${m.name} isn’t installed yet. You can get it from the Store.`, card: card(null, actionBtn('get ' + m.name, () => os.launch('store', { app: m.id }))) };
        return { say: `Opening ${m.name}.`, after: () => os.launch(it.app, it.args || {}), delay: 700 };
      }
      case 'url': return { say: 'Opening ' + it.url.replace(/^https?:\/\//, ''), after: () => os.launch('ie', { url: it.url }), delay: 600 };

      case 'setting': {
        const names = { wifi: 'Wi-Fi', bluetooth: 'Bluetooth', airplane: 'Airplane mode', location: 'Location', batterySaver: 'Battery Saver', cellular: 'Cellular data', sounds: 'Sounds', vibrate: 'Vibrate', h24: 'The 24-hour clock' };
        if (it.key === 'dark' || it.key === 'light') { await os.settings.set('theme', it.key); return { say: `Switched to the ${it.key} theme.` }; }
        if (it.key === 'brightness') { await os.settings.set('brightness', it.value); return { say: `Brightness set to ${Math.round(it.value * 100)}%.` }; }
        if (it.key === 'flashlight') return { say: it.value ? 'Opening the flashlight.' : 'Turning off the flashlight.', after: () => os.launch('flashlight', { on: it.value }), delay: 500 };
        if (os.settings.get(it.key) === it.value) return { say: `${names[it.key]} is already ${it.value ? 'on' : 'off'}.` };
        await os.settings.set(it.key, it.value);
        if (it.key === 'airplane' && it.value) await os.settings.set({ wifi: false, bluetooth: false });
        return { say: `${names[it.key]} is now ${it.value ? 'on' : 'off'}.`, card: card(null, actionBtn('open settings', () => os.launch('settings', { page: { batterySaver: 'battery' }[it.key] || it.key }))) };
      }
      case 'lock': return { say: 'Locking your phone.', after: () => os.lock(), delay: 700 };

      case 'media': {
        const cur = os.media.current;
        if (it.action === 'what') return { say: cur ? `This is ${cur.title || 'an unknown track'}${cur.artist ? ' by ' + cur.artist : ''}.` : 'Nothing is playing right now.' };
        if (!cur) return { say: 'Nothing is playing right now. Say “play music” to start.' };
        os.media[it.action]?.();
        return { say: { pause: 'Paused.', play: 'Resuming.', next: 'Skipping ahead.', prev: 'Going back a track.' }[it.action] };
      }

      case 'alarm': {
        let { hours, minutes } = it;
        if (it.missing) {
          const t = await ui.pickTime({ hours: 7, minutes: 0, title: 'ALARM TIME' });
          if (!t) return { say: 'OK, I won’t set an alarm.' };
          ({ hours, minutes } = t);
        }
        const a = await addAlarm({ hours, minutes, days: it.days, label: it.label });
        const next = nextAlarmTime(a);
        const diff = next ? next - Date.now() : 0;
        const inStr = next ? `${Math.floor(diff / 3600e3)} hours and ${Math.round((diff % 3600e3) / 60e3)} minutes from now` : '';
        return {
          say: `Your alarm is set for ${clockLabel(hours, minutes)}${it.days?.length ? ', ' + daysLabel(it.days) : ''}.`,
          speak: `Alarm set for ${clockLabel(hours, minutes)}. That’s ${inStr}.`,
          card: el('div.cortana-card.cortana-alarm.tilt', { onclick: () => os.launch('alarms') },
            el('div.cortana-alarm-time', clockLabel(hours, minutes)), el('div.cortana-alarm-sub', `${a.label} · ${daysLabel(a.days)}${next ? ' · rings ' + fmtDay(next) : ''}`),
            el('div.cortana-wiki-actions', actionBtn('undo', async (e) => {
              e.stopPropagation();
              await alarmStore.update('alarms', (l) => (l || []).filter((x) => x.id !== a.id), []);
              os.tiles.refresh('alarms');
              e.target.closest('.cortana-alarm').replaceChildren(el('div.cortana-card-title', 'alarm removed'));
            }))),
        };
      }
      case 'alarmList': {
        const list = ((await alarmStore.get('alarms', [])) || []).slice().sort((a, b) => a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes));
        if (!list.length) return { say: 'You don’t have any alarms. Try “set an alarm for 7 am”.' };
        const on = list.filter((a) => a.enabled);
        const next = on.map((a) => nextAlarmTime(a)).filter(Boolean).sort((a, b) => a - b)[0];
        return {
          say: on.length ? `You have ${on.length} alarm${on.length > 1 ? 's' : ''} on. The next one rings ${fmtDay(next)} at ${fmtTime(next)}.` : 'All your alarms are off.',
          card: card('alarms', ...list.map((a) => row({ title: clockLabel(a.hours, a.minutes), sub: `${a.label || 'Alarm'} · ${daysLabel(a.days)}`, right: a.enabled ? 'on' : 'off', onClick: () => os.launch('alarms') }))),
        };
      }
      case 'timer': {
        let ms = it.ms;
        if (!ms) {
          const v = await ui.pickFromList({ title: 'how long?', options: [1, 3, 5, 10, 15, 20, 30, 45, 60].map((m) => ({ value: m, label: m + ' minutes' })) });
          if (!v) return { say: 'OK, no timer.' };
          ms = v * 60e3;
        }
            const r = await addReminder({ text: `The ${humanDur(ms)} timer is done.`, when: Date.now() + ms, kind: 'timer' });
        return { say: `Timer set for ${humanDur(ms)}. I’ll let you know when it’s done.`, card: timerCard(r) };
      }
      case 'reminder': {
        let text = it.text;
        if (!text) {
          text = await ui.prompt('What should I remind you about?', '', 'reminder', { placeholder: 'e.g. call Mom' });
          if (!text?.trim()) return { say: 'OK, never mind.' };
          text = text.trim();
        }
        let at = it.when;
        if (!it.hasTime) {
          at = await askWhen();
          if (at === undefined) return { say: 'OK, I won’t remind you.' };
        }
        text = text[0].toUpperCase() + text.slice(1);
        const r = await addReminder({ text, when: at });
        return {
          say: at ? `Sure, I’ll remind you ${when(at)}.` : 'Got it. I’ll keep this in your reminders.',
          card: el('div.cortana-card.cortana-reminder',
            el('div.cortana-card-title', 'reminder'), el('div.cortana-reminder-text', text), el('div.cortana-reminder-when', at ? when(at) : 'no time set'),
            el('div.cortana-wiki-actions', actionBtn('remove', async (e) => {
              await storage.update('reminders', (l) => (l || []).filter((x) => x.id !== r.id), []);
              os.tiles.refresh('cortana');
              e.target.closest('.cortana-reminder').replaceChildren(el('div.cortana-card-title', 'reminder removed'));
            }))),
        };
      }
      case 'reminderList': {
        const list = ((await storage.get('reminders', [])) || []).filter((r) => !r.done && r.kind !== 'timer');
        if (!list.length) return { say: 'You don’t have any reminders. Try “remind me to call Mom at 6”.' };
        return { say: `You have ${list.length} reminder${list.length > 1 ? 's' : ''}.`, open: 'reminders' };
      }

      case 'call': {
        if (/^[\d+\s()-]{3,}$/.test(it.who)) return { say: `Calling ${it.who}.`, after: () => os.launch('phone', { number: it.who.replace(/\s/g, '') }), delay: 700 };
        const c = await findContact(it.who);
        if (!c) return { say: `I couldn’t find “${it.who}” in your contacts.`, card: card(null, actionBtn('open People', () => os.launch('people')), actionBtn('open keypad', () => os.launch('phone', { dial: true }))) };
        const n = await choosePhone(c, it.kind);
        if (!n) return { say: `${c.display} doesn’t have a phone number.`, card: card(null, actionBtn('open contact', () => os.launch('people', { id: c.id }))) };
        return { say: `Calling ${c.display}.`, card: contactCard(c, n), after: () => os.launch('phone', { number: n, name: c.display }), delay: 900 };
      }
      case 'text': {
        let to = it.who, name = it.who, c = null;
        if (!/^[\d+\s()-]{3,}$/.test(it.who)) {
          c = await findContact(it.who);
          if (!c) return { say: `I couldn’t find “${it.who}” in your contacts.`, card: card(null, actionBtn('new message', () => os.launch('messaging', { to: it.who, body: it.body }))) };
          to = (await choosePhone(c)) || c.display;
          name = c.display;
        }
        let body = it.body;
        if (!body) {
          body = await ui.prompt(`What do you want to say to ${name}?`, '', 'text ' + name);
          if (body == null) return { say: 'OK, I won’t send it.' };
        }
        return { say: `Here’s your message to ${name}. Tap send when you’re ready.`, speak: `Here’s your message to ${name}.`, after: () => os.launch('messaging', { to, body }), delay: 900 };
      }
      case 'email': {
        let to = it.who;
        const c = await findContact(it.who);
        if (c?.emails?.length) to = c.emails[0].address;
        return { say: `Starting an email to ${c?.display || it.who}.`, after: () => os.launch('outlook', { to, body: it.body }), delay: 800 };
      }

      case 'note': {
        const text = it.text.trim();
        const title = text.split(/\s+/).slice(0, 6).join(' ').replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'Quick note';
        const path = await os.fs.uniquePath(`/Documents/OneNote/${title}.one`);
        const esc = U.esc;
        const now = Date.now();
        await os.fs.write(path, { title: title[0].toUpperCase() + title.slice(1), html: text.split(/\n/).map((l) => `<div>${esc(l) || '<br>'}</div>`).join(''), created: now, modified: now, color: '#7719AA' });
        os.tiles.refresh('onenote');
        return {
          say: 'I saved that to OneNote.',
          card: el('div.cortana-card.cortana-note.tilt', { onclick: () => os.openFile(path) }, el('div.cortana-card-title', 'onenote'), el('div.cortana-note-text', text)),
        };
      }

      case 'event': {
        let start = it.start, allDay = it.allDay;
        if (!start) {
          const d = await ui.pickDate({ date: new Date(), title: 'EVENT DATE' });
          if (!d) return { say: 'OK, I didn’t add anything.' };
          const t = await ui.pickTime({ hours: 9, minutes: 0, title: 'START TIME' });
          if (t) d.setHours(t.hours, t.minutes, 0, 0); else allDay = true;
          start = d.getTime();
        }
        const end = allDay ? start + 864e5 : start + (it.duration || 3600e3);
        const ev = { id: U.uid(), title: it.title[0].toUpperCase() + it.title.slice(1), start, end, allDay, location: '', notes: 'Added by Cortana', reminder: allDay ? null : 15, color: null };
        await calStore.update('events', (l) => [...(l || []), ev], []);
        os.tiles.refresh('calendar');
        return {
          say: `I added “${ev.title}” to your calendar for ${allDay ? fmtDay(new Date(start)) : when(start)}.`,
          card: el('div.cortana-card.cortana-event.tilt', { onclick: () => os.launch('calendar', { date: start, event: ev.id }) },
            el('div.cortana-event-bar'), el('div', el('div.cortana-event-title', ev.title), el('div.cortana-event-when', allDay ? fmtDay(new Date(start)) + ' · all day' : `${fmtDay(new Date(start))} · ${fmtTime(new Date(start))} – ${fmtTime(new Date(end))}`))),
        };
      }
      case 'agenda': {
        const all = (await events()).slice().sort((a, b) => a.start - b.start);
        const now = Date.now();
        let list, label;
        if (it.day) {
          const d0 = new Date(it.day); d0.setHours(0, 0, 0, 0);
          const d1 = d0.getTime() + 864e5;
          list = all.filter((e) => e.start < d1 && e.end > d0.getTime());
          label = fmtDay(d0);
        } else { list = all.filter((e) => e.end > now && e.start < now + 7 * 864e5); label = 'in the next 7 days'; }
        if (!list.length) return { say: `You don’t have anything on your calendar ${label === 'today' || label === 'tomorrow' ? label : label}. Enjoy the free time!`, card: card(null, actionBtn('open calendar', () => os.launch('calendar'))) };
        return {
          say: `You have ${list.length} event${list.length > 1 ? 's' : ''} ${label}. ${list[0].title} is ${list[0].allDay ? 'all day' : 'at ' + fmtTime(new Date(list[0].start))}${label.startsWith('in') ? ' ' + fmtDay(new Date(list[0].start)) : ''}.`,
          card: card('calendar', ...list.slice(0, 8).map((e) => row({ title: e.title, sub: (e.allDay ? 'all day' : fmtTime(new Date(e.start))) + ' · ' + fmtDay(new Date(e.start)) + (e.location ? ' · ' + e.location : ''), onClick: () => os.launch('calendar', { date: e.start, event: e.id }) }))),
        };
      }

      case 'weather': return weather(it);

      case 'time': {
        if (it.city) {
          const r = await os.net.geocode(it.city).catch(() => []);
          if (r[0]?.timezone) {
            const t = new Date().toLocaleTimeString([], { timeZone: r[0].timezone, hour: 'numeric', minute: '2-digit', hour12: !os.settings.get('h24') });
            const day = new Date().toLocaleDateString([], { timeZone: r[0].timezone, weekday: 'long' });
            return { say: `It’s ${t} on ${day} in ${r[0].name}.`, card: bigCard(t, `${r[0].name}, ${r[0].country} · ${day}`) };
          }
          return { say: `I’m not sure what time it is in ${it.city}.` };
        }
        const d = new Date();
        return { say: `It’s ${fmtTime(d)}.`, card: bigCard(fmtTime(d), d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })) };
      }
      case 'date': {
        const d = new Date();
        return { say: `Today is ${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`, card: bigCard(String(d.getDate()), d.toLocaleDateString([], { weekday: 'long', month: 'long', year: 'numeric' })) };
      }
      case 'daysUntil': {
        const known = { christmas: '12-25', 'new year': '01-01', "new year's": '01-01', halloween: '10-31', valentine: '02-14', "valentine's day": '02-14' };
        const k = Object.keys(known).find((x) => it.what.includes(x));
        if (!k) return webSearch('how many days until ' + it.what);
        const [mm, dd] = known[k].split('-').map(Number);
        const now = new Date(); now.setHours(0, 0, 0, 0);
        let t = new Date(now.getFullYear(), mm - 1, dd);
        if (t < now) t = new Date(now.getFullYear() + 1, mm - 1, dd);
        const n = Math.round((t - now) / 864e5);
        return { say: n === 0 ? `It’s ${k} today!` : `There are ${n} days until ${k}.`, card: bigCard(String(n), `days until ${k}`) };
      }

      case 'math': {
        const v = it.value;
        const pretty = Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 8 });
        return { say: `${pretty}`, speak: `It’s ${pretty}.`, card: bigCard(pretty, it.expr.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/(?<=\d)-/g, ' − ') + ' =') };
      }
      case 'currency': {
        try {
          const r = await os.net.rates(it.from);
          const rate = r.rates?.[it.to];
          if (!rate) throw new Error();
          const v = it.amount * rate;
          const fmt = (x, c) => { try { return x.toLocaleString(undefined, { style: 'currency', currency: c, maximumFractionDigits: 2 }); } catch { return x.toFixed(2) + ' ' + c; } };
          return { say: `${fmt(it.amount, it.from)} is about ${fmt(v, it.to)}.`, card: bigCard(fmt(v, it.to), `${fmt(it.amount, it.from)} · 1 ${it.from} = ${rate.toFixed(4)} ${it.to} · ${r.date || ''}`) };
        } catch { return { say: 'I couldn’t get exchange rates right now.' }; }
      }
      case 'translate': {
        const LANGS = { spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', japanese: 'ja', chinese: 'zh', korean: 'ko', vietnamese: 'vi', russian: 'ru', arabic: 'ar', hindi: 'hi', dutch: 'nl', swedish: 'sv', polish: 'pl', turkish: 'tr', greek: 'el', thai: 'th', indonesian: 'id', english: 'en' };
        const to = LANGS[it.to];
        if (!to) return { say: `I don’t know how to translate into ${it.to} yet.` };
        try {
          const src = /[^\x00-\x7F]/.test(it.text) ? guessLang(it.text) : 'en';
          const r = await os.net.translate(it.text, src === to ? 'en' : src, to);
          if (!r?.text || /INVALID|QUERY LENGTH|MYMEMORY WARNING/i.test(r.text)) throw new Error('bad');
          return {
            say: `In ${it.to[0].toUpperCase() + it.to.slice(1)}, “${it.text}” is “${r.text}”.`, speak: r.text, speakLang: to,
            card: el('div.cortana-card', el('div.cortana-card-title', it.to), el('div.cortana-big', r.text), el('div.subtle', it.text),
              el('div.cortana-wiki-actions', actionBtn('listen', () => os.device.speak(r.text, { lang: to })), actionBtn('open Translator', () => os.launch('translator', { text: it.text })))),
          };
        } catch { return { say: 'I couldn’t reach the translator right now.' }; }
      }

      case 'maps': return { say: it.directions ? `Getting directions to ${it.query}.` : `Looking for ${it.query} nearby.`, after: () => os.launch('maps', { q: it.query, directions: !!it.directions }), delay: 800 };
      case 'whereami': {
        const p = await getPlace(os, storage, { prompt: true, maxAge: 60e3 });
        return { say: `You’re in or near ${p.name}.`, card: el('div.cortana-card.tilt', { onclick: () => os.launch('maps', { lat: p.lat, lon: p.lon, label: p.name }) }, el('div.cortana-card-title', 'location'), el('div.cortana-big', p.name), el('div.subtle', `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}${p.approximate ? ' · approximate' : ''}`)) };
      }

      case 'news': {
        try {
          const n = await os.net.news(it.category);
          const items = (n.items || []).slice(0, 6);
          if (!items.length) throw new Error();
          return {
            say: `Here are the latest ${it.category === 'top' ? '' : it.category + ' '}headlines.`, speak: 'Here are the latest headlines. ' + items[0].title,
            card: card(it.category === 'top' ? 'headlines' : it.category + ' news', ...items.map((x) => newsRow(x))),
          };
        } catch { return { say: 'I couldn’t load the news right now.' }; }
      }

      case 'coin': { const h = Math.random() < 0.5; return { say: h ? 'It’s heads.' : 'It’s tails.', card: bigCard(h ? 'heads' : 'tails', 'coin flip') }; }
      case 'dice': { const v = 1 + Math.floor(Math.random() * Math.max(2, it.sides)); return { say: `You rolled a ${v}.`, card: bigCard(String(v), `${it.sides}-sided die`) }; }
      case 'random': { const lo = Math.min(it.min, it.max), hi = Math.max(it.min, it.max); const v = lo + Math.floor(Math.random() * (hi - lo + 1)); return { say: `How about ${v}?`, card: bigCard(String(v), `between ${lo} and ${hi}`) }; }

      case 'chat': {
        if (it.topic === 'joke') { const j = pick(JOKES); return { say: j }; }
        if (it.topic === 'rock') { const c = pick(['rock', 'paper', 'scissors']); return { say: `I choose ${c}! Did I win?` }; }
        const name = await displayName(os, storage).catch(() => '');
        let r = pick(CHAT[it.topic] || ['Hmm.']);
        if (it.topic === 'hello' && name) r = r.replace(/^(Hi|Hello|Hey)(\s+there)?/, `$1 ${name}`);
        return { say: r };
      }

      case 'define': return wiki(it.term, 'define ' + it.term);
      case 'wiki': return wiki(it.term, it.query);
      case 'search':
      default: return webSearch(it.query || '');
    }
  }

  function humanDur(ms) {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [h && `${h} hour${h > 1 ? 's' : ''}`, m && `${m} minute${m > 1 ? 's' : ''}`, sec && `${sec} second${sec > 1 ? 's' : ''}`].filter(Boolean).join(' ') || '0 seconds';
  }
  function timerCard(r) {
    const t = el('div.cortana-big.cortana-timer-left');
    const node = el('div.cortana-card', el('div.cortana-card-title', 'timer'), t,
      el('div.cortana-wiki-actions', actionBtn('cancel', async () => {
        await storage.update('reminders', (l) => (l || []).filter((x) => x.id !== r.id), []);
        clearInterval(iv); node.replaceChildren(el('div.cortana-card-title', 'timer cancelled'));
      })));
    const tick = () => {
      const left = r.when - Date.now();
      if (node.isConnected) seen = true;
      else if (seen) { clearInterval(iv); return; }
      t.textContent = left > 0 ? U.formatDuration(Math.ceil(left / 1000)) : 'done!';
      if (left <= 0) clearInterval(iv);
    };
    let seen = false;
    const iv = setInterval(tick, 500);
    tick();
    return node;
  }
  const bigCard = (big, sub) => el('div.cortana-card', el('div.cortana-big', big), sub ? el('div.subtle', sub) : null);
  const contactCard = (c, n) => el('div.cortana-card.cortana-contact',
    c.photo ? el('div.cortana-contact-photo', { style: { backgroundImage: `url("${c.photo}")` } }) : el('div.cortana-contact-photo.empty', { html: ui.iconSVG(I.user, { size: 30 }) }),
    el('div', el('div.cortana-contact-name', c.display), el('div.subtle', n)));
  const newsRow = (x) => el('div.cortana-news.tilt', { onclick: () => os.launch('ie', { url: x.link }) },
    x.image ? el('div.cortana-news-img', { style: { backgroundImage: `url("${x.image}")` } }) : null,
    el('div.cortana-news-text', el('div.cortana-news-title', x.title), el('div.cortana-news-src', [x.source, x.date ? U.formatRelative(Date.parse(x.date)) : ''].filter(Boolean).join(' · '))));

  return {
    run, weatherCard, newsRow, row, card, fmtDay, fmtTime, when, daysLabel, clockLabel, events, contacts, addReminder,
    setExtra: (fn) => (showExtra = fn),
  };
}
