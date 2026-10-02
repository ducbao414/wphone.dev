// Messaging — WP 8.1 style SMS/MMS conversations stored locally, with simulated replies from demo contacts.
import './style.css';
import { Paperclip } from 'lucide';

/* ------------------------------------------------------------------ module-level store
   Lives as long as the page, so simulated replies still arrive after the app is closed. */
let S = null;            // storage handle (os.storage('messaging'))
let OS = null;
let threads = [];        // [{ key, name, messages: [{ id, from: 'me'|'them', text, image, path, time }], unread, draft, updated }]
let contacts = [];
let settings = { autoReply: true };
let loaded = null;
let viewing = null;      // thread key currently on screen (null when not foreground)
const typing = new Set();
const subs = new Set();
const emit = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

const WELCOME = 'windows-phone';
const norm = (n) => String(n || '').trim().replace(/[^\d+]/g, '');
const isNumberKey = (k) => /^\+?\d{2,}$/.test(k || '');
const sameNumber = (a, b) => {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  return a === b || (a.length >= 9 && b.length >= 9 && a.slice(-9) === b.slice(-9));
};
const contactName = (c) => c.name || [c.first, c.last].filter(Boolean).join(' ') || 'Unknown';
const contactFor = (key) => (isNumberKey(key) ? contacts.find((c) => (c.phones || []).some((p) => sameNumber(p.number, key))) : null);
const threadName = (t) => { const c = contactFor(t.key); return c ? contactName(c) : t.name || t.key; };
const snippet = (m) => (m ? (m.text || (m.image ? '📷 photo' : '')) : '');

async function loadContacts() { contacts = (await OS.storage('people').get('contacts', [])) || []; }

async function load(os, storage, force) {
  OS = os; S = storage;
  if (loaded && !force) return loaded;
  loaded = (async () => {
    threads = (await S.get('threads', null)) || [];
    settings = { ...settings, ...((await S.get('settings', null)) || {}) };
    await loadContacts();
    if (!(await S.get('seeded', false))) {
      const now = Date.now();
      if (!threads.some((t) => t.key === WELCOME)) {
        threads.push({
          key: WELCOME, name: 'Windows Phone', unread: 1, updated: now - 60e3, draft: '',
          messages: [
            { id: 'w1', from: 'them', time: now - 120e3, text: 'Welcome to Messaging! 👋 Your conversations live here — tap ⊕ to start a new one.' },
            { id: 'w2', from: 'them', time: now - 60e3, text: 'Tip: tap the smiley to add emoji, the paperclip to attach a photo, and tap-and-hold a thread to delete or pin it to Start. Friends marked as demo contacts in People will even text you back. 😉' },
          ],
        });
      }
      await S.set('seeded', true);
      await save();
    }
  })();
  return loaded;
}

async function save() {
  if (!S) return;
  await S.set('threads', threads);
  OS?.tiles.refresh('messaging');
  emit();
}

function getThread(key, name) {
  let t = threads.find((x) => x.key === key);
  if (!t) { t = { key, name: name || key, messages: [], unread: 0, draft: '', updated: Date.now() }; threads.push(t); }
  return t;
}

async function addMessage(key, msg, { name } = {}) {
  const t = getThread(key, name);
  const m = { id: OS.util.uid(), time: Date.now(), text: '', image: null, path: null, ...msg };
  t.messages.push(m);
  t.updated = m.time;
  if (m.from === 'them' && viewing !== key) t.unread = (t.unread || 0) + 1;
  await save();
  return m;
}

/* ------------------------------------------------------------------ simulated replies */
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function replyFor(contact, text, hasImage) {
  const s = (text || '').toLowerCase();
  const mom = /^mom|mum|mother/i.test(contact.first || contact.name || '');
  if (hasImage && !s) return pick(['Nice picture! 😍', 'Haha where was this taken?', 'Love it! Send me more 📸', 'Wow, great shot!']);
  if (/\b(hi|hey|hello|yo|sup|morning|evening)\b/.test(s)) return mom ? pick(['Hi sweetie! ❤ Did you eat yet?', 'Hello dear! How was your day?']) : pick(['Hey! 😊 What\'s up?', 'Hi! Long time no see', 'Hey you! How are things?']);
  if (/how are (you|u)|how's it going|how r u/.test(s)) return pick(['Doing great, thanks! You?', 'Pretty good! Busy week though 😅', 'All good here 👍']);
  if (/love/.test(s)) return mom ? 'Love you too, honey ❤❤' : pick(['❤', 'Aww 😊', 'Love you too!']);
  if (/(dinner|lunch|breakfast|eat|food|pizza|coffee)/.test(s)) return pick(['I\'m in! Where should we meet? 🍕', 'Yes please, I\'m starving', 'Sounds good! 7 pm?', 'Only if you\'re buying ☕']);
  if (/(call|phone|ring)/.test(s)) return pick(['Sure, call me in 10 minutes 📞', 'Can\'t talk right now, text me?', 'Call me tonight!']);
  if (/(thank|thx|ty)/.test(s)) return pick(['You\'re welcome! 😊', 'Anytime!', 'No problem 👍']);
  if (/(bye|good night|gn|later|cya)/.test(s)) return pick(['Bye! Talk soon 👋', 'Good night! 🌙', 'See ya!']);
  if (/(sorry)/.test(s)) return pick(['No worries!', 'It\'s ok 😊', 'Don\'t worry about it']);
  if (/(lol|haha|😂|🤣)/.test(s)) return pick(['😂😂', 'Haha right?!', 'lol']);
  if (/(when|what time)/.test(s)) return pick(['How about tomorrow at 6?', 'Anytime after lunch works', 'Let me check my calendar 📅']);
  if (/(where)/.test(s)) return pick(['At the usual place?', 'Downtown, near the station', 'I\'ll send you the address']);
  if (s.includes('?')) return pick(['Hmm, good question 🤔', 'Yes, definitely!', 'Not sure, let me think about it', 'Maybe? 😄']);
  if (mom) return pick(['Don\'t forget to call your grandma 😊', 'Are you dressing warm enough?', 'Ok dear. Come visit soon! ❤', 'Did you get my email?']);
  return pick(['Cool! 😎', 'Sounds good', 'Haha nice', 'Ok 👍', 'Really? Tell me more!', 'Totally agree', 'Got it!']);
}

function scheduleReply(key, text, hasImage) {
  if (!settings.autoReply) return;
  const c = contactFor(key);
  if (!c || !c.demo) return;
  const delay = 3000 + Math.random() * 7000;
  setTimeout(() => { typing.add(key); emit(); }, Math.min(1500, delay - 1000));
  setTimeout(async () => {
    typing.delete(key);
    const body = replyFor(c, text, hasImage);
    await addMessage(key, { from: 'them', text: body });
    if (viewing !== key) OS.notify({ appId: 'messaging', title: contactName(c), body, args: { thread: key } });
    else OS.sounds.key?.();
  }, delay);
}

/* ------------------------------------------------------------------ simulated social life */
// Fake friends text you now and then (see background.js). Uses this module's state so an open app stays in sync.
const keyOf = (c) => norm(c.phones[0].number);
const OPENERS = {
  mom: ['Hi honey, are you eating well? ❤', 'Call me when you get a chance 📞', 'Did you see the photos I sent your dad? 😂', 'Dinner on Sunday? I’m making your favorite 🍝', 'Don’t forget to wear a jacket, it’s cold out!', 'Your grandma says hi 👵'],
  grandma: ['Hello dear, this is Grandma. Is this how texting works?', 'I finished the crossword today! 🧩', 'When are you coming to visit? 🍪', 'Grandpa learned how to use the tablet 😄'],
  boss: ['Hey, do you have a minute to sync about the deck?', 'Great job in the meeting today 👏', 'Can you send me the latest numbers before 5?', 'Reminder: team lunch tomorrow at noon 🍕'],
  generic: ['Hey! What are you up to tonight?', 'Did you watch the game last night?! ⚽', 'Coffee tomorrow? ☕', 'Just got the new Lumia, the camera is insane 📸', 'Look who finally learned how to text 😎', 'Are we still on for Saturday?', 'lol I just saw the funniest video', 'Happy Friday!! 🎉', 'Can you send me that photo from yesterday?', 'I’m outside 🚗', 'Guess who I just ran into 👀', 'Movie night this weekend? 🍿', 'How was your day?', 'Running 10 min late, sorry!!', 'Have you tried Cortana yet? She just told me a joke 😂', 'Thinking of getting a dog 🐶 thoughts?'],
};
function openerFor(c) {
  const n = (c.first || c.name || '').toLowerCase(), co = (c.company || '').toLowerCase();
  if (/^(mom|mum|mother)/.test(n)) return pick(OPENERS.mom);
  if (/^grand/.test(n)) return pick(OPENERS.grandma);
  if (/boss/.test(co)) return pick(OPENERS.boss);
  return pick(OPENERS.generic);
}
const CONVOS = [
  [['them', 'Are you coming to the party on Saturday? 🎉'], ['me', 'Wouldn’t miss it! Should I bring anything?'], ['them', 'Just yourself. And maybe chips 😄'], ['me', 'Deal 👍']],
  [['me', 'Thanks for dinner last night!'], ['them', 'Anytime! We should do it again soon ❤'], ['them', 'Next time it’s your turn to cook though 😜']],
  [['them', 'Did you finish the report?'], ['me', 'Almost, sending it in an hour'], ['them', 'Perfect, thanks!']],
  [['them', 'Look what I found in my old phone 😂'], ['me', 'Omg is that us at the Lumia launch?!'], ['them', '2013 was a different time haha']],
];

/** Seed a few past conversations with sample contacts (once). */
export async function seedConversations(os, storage) {
  await load(os, storage);
  if (await S.get('seededConvos', false)) return;
  await loadContacts();
  const people = contacts.filter((c) => c.demo && c.phones?.length);
  if (people.length < 3) return; // People hasn't seeded yet; try again later
  const now = Date.now();
  people.slice(0, CONVOS.length).forEach((c, i) => {
    const key = keyOf(c);
    if (threads.some((t) => t.key === key)) return;
    const start = now - (i + 1) * 864e5 * (1 + i * 0.6);
    const messages = CONVOS[i].map(([from, text], j) => ({ id: OS.util.uid(), from, text, image: null, path: null, time: start + j * 4 * 60e3 }));
    threads.push({ key, name: contactName(c), messages, unread: 0, draft: '', updated: messages[messages.length - 1].time });
  });
  await S.set('seededConvos', true);
  await save();
}

/** A random friend texts you. Returns true if a message was delivered. */
export async function simulateIncoming(os, storage) {
  await load(os, storage);
  await loadContacts();
  const people = contacts.filter((c) => c.demo && c.phones?.length);
  if (!people.length) return false;
  const c = pick(people);
  const key = keyOf(c);
  const text = openerFor(c);
  await addMessage(key, { from: 'them', text }, { name: contactName(c) });
  if (viewing !== key) OS.notify({ appId: 'messaging', title: contactName(c), body: text, args: { thread: key } });
  else OS.sounds.key?.();
  return true;
}

/* ------------------------------------------------------------------ emoji */
const EMOJI = {
  '😊': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😝 🤗 🤭 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😴 😷 🤒 🤕 🤢 🥵 🥶 😎 🤓 😕 😟 🙁 😮 😲 😳 🥺 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖',
  '👍': '👍 👎 👌 ✌ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝ ✋ 🤚 🖐 🖖 👋 👏 🙌 👐 🤲 🙏 💪 👀 👂 👃 👅 👄 💋 👶 👦 👧 🧑 👨 👩 👴 👵 👮 👷 💂 🕵 👩‍⚕️ 👨‍🍳 🎅 🤶 👸 🤴 👰 🤵 🚶 🏃 💃 🕺 👯',
  '❤': '❤ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣ 💕 💞 💓 💗 💖 💘 💝 💟 ⭐ 🌟 ✨ ⚡ 🔥 💥 💯 ✅ ❌ ❗ ❓ ⁉ 💤 💬 💭 🎵 🎶 ➕ ➖ ✖ ➗ ♻ ⚠ 🚫 🔴 🟢 🔵',
  '🐶': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦉 🐺 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🐠 🐬 🐳 🦈 🌵 🌲 🌴 🌱 🍀 🍁 🌷 🌹 🌻 🌼 🌸 🌙 ☀ ⛅ ☁ 🌧 ⛄ 🌈 🌊',
  '🍕': '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🌽 🥕 🥐 🍞 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍝 🍜 🍣 🍱 🍤 🍙 🍦 🍩 🍪 🎂 🍰 🍫 🍬 🍭 ☕ 🍵 🥤 🍺 🍻 🥂 🍷 🍸 🍹',
  '⚽': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥅 🏒 ⛳ 🏹 🎣 🥊 🎿 🏂 🏋 🚴 🏆 🥇 🎮 🕹 🎲 🎯 🎳 🎸 🎹 🎺 🎻 🥁 🎤 🎧 🎬 🎨 🚗 🚕 🚌 🚓 🚑 🚒 🚲 🛵 ✈ 🚀 🚁 ⛵ 🚢 🏠 🏢 🏰 🗽 🗼 ⛪ 🏖 🏝 🎡 🎢',
  '💡': '⌚ 📱 💻 ⌨ 🖥 🖨 🖱 💾 💿 📷 📸 📹 🎥 📞 ☎ 📺 📻 ⏰ ⌛ 🔋 🔌 💡 🔦 🕯 💸 💵 💰 💳 💎 🔧 🔨 🛠 🔑 🔒 🔓 🚪 🛏 🛁 🎁 🎈 🎉 🎊 ✉ 📩 📦 📝 📅 📌 📎 ✂ 📚 📖 🔍 🔔',
};

/* ------------------------------------------------------------------ app */
export default async function launch(ctx) {
  const { root, os, storage } = ctx;
  const { el, appBar, I, esc } = os.ui;
  const { formatTime, formatRelative, onLongPress } = os.util;
  await load(os, storage);

  const COLORS = ['#a4c400', '#60a917', '#008a00', '#00aba9', '#1ba1e2', '#0050ef', '#6a00ff', '#aa00ff', '#d80073', '#a20025', '#e51400', '#fa6800', '#f0a30a', '#825a2c', '#6d8764', '#647687', '#76608a'];
  const colorFor = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; };
  const initials = (name) => {
    const parts = String(name || '').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '#';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };
  function avatar(key, cls = '') {
    const c = contactFor(key);
    const n = el('div.messaging-avatar' + (cls ? '.' + cls : ''));
    if (key === WELCOME) { n.style.background = 'var(--accent)'; n.innerHTML = os.ui.iconSVG(ctx.app?.icon || I.message, { size: 26 }); return n; }
    if (c?.photo) { n.style.backgroundImage = `url("${c.photo}")`; n.classList.add('photo'); return n; }
    n.style.background = colorFor(c?.id || key);
    if (c) n.textContent = initials(contactName(c));
    else n.innerHTML = os.ui.iconSVG(I.user, { size: 26 });
    return n;
  }
  const fmtPhone = (n) => n;

  let listPageApi = null;   // { refresh }
  let convPage = null;      // current conversation page object
  let rootClose = null;     // pops the top page (any page's close() pops the top)

  /* ---------- threads list (pivot) */
  ctx.navigate((page) => {
    rootClose = page.close;
    let selecting = false;
    const selected = new Set();
    const listHost = el('div.messaging-threads');
    const onlineHost = el('div');
    const pv = os.ui.pivot({
      app: 'MESSAGING',
      items: [
        { header: 'threads', render: (c) => c.append(listHost) },
        { header: 'online', render: (c) => { c.append(onlineHost); renderOnline(); } },
      ],
    });

    const renderThreads = () => {
      const arr = [...threads].sort((a, b) => (b.updated || 0) - (a.updated || 0));
      listHost.replaceChildren();
      if (!arr.length) {
        listHost.append(os.ui.empty('no conversations yet. tap ⊕ to start one.'));
        return;
      }
      for (const t of arr) {
        const last = t.messages[t.messages.length - 1];
        const row = el('div.messaging-thread.tilt' + (t.unread ? '.unread' : '') + (selected.has(t.key) ? '.selected' : ''),
          selecting ? el('div.messaging-check', { html: selected.has(t.key) ? os.ui.iconSVG(I.check, { size: 20, stroke: 3 }) : '' }) : null,
          avatar(t.key),
          el('div.messaging-thread-text',
            el('div.messaging-thread-name', threadName(t)),
            el('div.messaging-thread-snip', typing.has(t.key) ? 'typing…' : (t.draft ? '[draft] ' + t.draft : snippet(last)))),
          el('div.messaging-thread-time', last ? formatRelative(last.time) : ''));
        row.addEventListener('click', () => {
          if (selecting) { selected.has(t.key) ? selected.delete(t.key) : selected.add(t.key); renderThreads(); updateBar(); return; }
          openThread(t.key);
        });
        onLongPress(row, () => {
          if (selecting) return;
          const pinKey = 'messaging:' + t.key;
          os.ui.contextMenu(row, [
            { label: 'delete', onClick: () => deleteThreads([t.key]) },
            { label: os.tiles.isPinned('messaging', pinKey) ? 'unpin from start' : 'pin to start', onClick: () => togglePin(t) },
            t.unread ? { label: 'mark as read', onClick: () => { t.unread = 0; save(); } } : null,
            contactFor(t.key) ? { label: 'view contact', onClick: () => os.launch('people', { contact: contactFor(t.key).id }) } : null,
            isNumberKey(t.key) ? { label: 'call', onClick: () => os.launch('phone', { number: t.key }) } : null,
          ]);
        });
        listHost.append(row);
      }
    };

    const renderOnline = () => {
      const demo = contacts.filter((c) => c.demo && (c.phones || []).length);
      const others = contacts.filter((c) => !c.demo && (c.phones || []).length);
      onlineHost.replaceChildren(
        el('div.messaging-online-note', 'friends who are around to chat right now'),
        ...(!demo.length ? [os.ui.empty('nobody is online right now')] : []),
        ...demo.map((c) => onlineRow(c, true)),
        ...(others.length ? [os.ui.header('offline'), ...others.map((c) => onlineRow(c, false))] : []),
      );
    };
    const onlineRow = (c, on) => {
      const key = norm(c.phones[0].number);
      const row = el('div.messaging-thread.tilt' + (on ? '' : '.offline'), avatar(key),
        el('div.messaging-thread-text', el('div.messaging-thread-name', contactName(c)), el('div.messaging-thread-snip' + (on ? '.on' : ''), on ? 'available' : 'offline')));
      row.addEventListener('click', () => openThread(key, contactName(c)));
      return row;
    };

    const deleteThreads = async (keys) => {
      const ok = await os.ui.confirm(keys.length === 1 ? `Delete this conversation with ${threadName(threads.find((t) => t.key === keys[0]) || { key: keys[0] })}?` : `Delete ${keys.length} conversations?`, 'delete', 'delete', 'cancel');
      if (!ok) return;
      threads = threads.filter((t) => !keys.includes(t.key));
      for (const k of keys) if (os.tiles.isPinned('messaging', 'messaging:' + k)) os.tiles.unpin('messaging:' + k);
      exitSelect();
      await save();
    };
    const togglePin = async (t) => {
      const k = 'messaging:' + t.key;
      if (os.tiles.isPinned('messaging', k)) { await os.tiles.unpin(k); os.toast('Unpinned from Start'); }
      else { await ctx.pinTile({ key: k, title: threadName(t), args: { thread: t.key }, size: 'medium' }); os.toast('Pinned to Start'); }
    };

    const bar = appBar({});
    const updateBar = () => {
      if (selecting) {
        bar.setButtons([
          { icon: I.delete, label: 'delete', disabled: !selected.size, onClick: () => deleteThreads([...selected]) },
          { icon: I.check, label: 'select all', onClick: () => { threads.forEach((t) => selected.add(t.key)); renderThreads(); updateBar(); } },
        ]);
        bar.setMenu([]);
      } else {
        bar.setButtons([
          { icon: I.add, label: 'new', onClick: () => openCompose({}) },
          { icon: I.check, label: 'select', onClick: () => { selecting = true; selected.clear(); renderThreads(); updateBar(); } },
        ]);
        bar.setMenu([
          { label: 'mark all as read', onClick: () => { threads.forEach((t) => (t.unread = 0)); save(); } },
          { label: 'settings', onClick: () => ctx.navigate(settingsPage) },
        ]);
      }
    };
    const exitSelect = () => { selecting = false; selected.clear(); renderThreads(); updateBar(); };
    updateBar();

    const unBack = ctx.onBack(() => { if (selecting && ctx.pageCount === 1) { exitSelect(); return true; } return false; });
    const sub = () => { renderThreads(); if (pv.items[1].rendered) renderOnline(); };
    subs.add(sub);
    renderThreads();
    listPageApi = { refresh: sub };
    page.el.append(pv.el, bar.el);
    return { onDestroy: () => { subs.delete(sub); unBack(); } };
  });

  /* ---------- open helpers */
  async function closeConv() { convPage = null; let guard = 10; while (ctx.pageCount > 1 && guard--) await rootClose(); }
  async function openThread(key, name, extra = {}) {
    await closeConv();
    ctx.navigate(conversationPage, { key, name, ...extra });
  }
  async function openCompose(params) {
    await closeConv();
    ctx.navigate(conversationPage, { compose: true, ...params });
  }

  function resolveRecipient(to) {
    if (!to) return null;
    const s = String(to).trim();
    if (norm(s).replace('+', '').length >= 2 && /^[\d\s+().-]+$/.test(s)) {
      const c = contactFor(norm(s));
      return { key: norm(s), name: c ? contactName(c) : s };
    }
    const c = contacts.find((c) => contactName(c).toLowerCase() === s.toLowerCase()) || contacts.find((c) => contactName(c).toLowerCase().includes(s.toLowerCase()));
    if (c && c.phones?.length) return { key: norm(c.phones[0].number), name: contactName(c) };
    return null;
  }

  /* ---------- conversation page */
  async function conversationPage(page) {
    const P = page.params;
    let key = P.key || null;
    let recipient = key ? { key, name: P.name || key } : null;
    let attachment = null; // { image (dataURL), path }

    const title = el('div.wp-app-title.messaging-conv-title');
    const sub = el('div.messaging-conv-sub');
    const head = el('div.messaging-conv-head', title, sub);

    // recipient field (compose mode)
    const toInput = el('input.messaging-to-input', { type: 'text', placeholder: 'name or number', autocomplete: 'off' });
    const toChip = el('div.messaging-chip');
    const sugg = el('div.messaging-sugg');
    const toRow = el('div.messaging-to', el('span.messaging-to-label', 'To:'), toChip, toInput,
      el('button.messaging-to-add', { 'aria-label': 'choose contact', html: os.ui.iconSVG(I.add, { size: 20, stroke: 2 }), onclick: () => chooseContact() }));

    const msgs = el('div.messaging-msgs');
    const attachEl = el('div.messaging-attach');
    const box = el('textarea.messaging-input', { rows: 1, placeholder: 'type a message' });
    const counter = el('div.messaging-counter');
    const emojiBtn = el('button.messaging-emoji-btn', { 'aria-label': 'emoji', html: os.ui.iconSVG(I.smile, { size: 24 }), onclick: () => toggleEmoji() });
    const compose = el('div.messaging-compose', attachEl, el('div.messaging-compose-row', box, emojiBtn), counter);
    const emojiPanel = buildEmojiPanel((e) => { insertText(e); });
    const view = el('div.messaging-conv', head, toRow, sugg, msgs, compose, emojiPanel);

    const thread = () => (key ? threads.find((t) => t.key === key) : null);

    const setRecipient = (r) => {
      recipient = r;
      if (r) {
        key = r.key;
        if (!page.el.hidden) viewing = key;
        toChip.textContent = r.name;
        toChip.hidden = false;
        toInput.hidden = true;
        toInput.value = '';
        sugg.replaceChildren();
        const t = thread();
        if (t?.draft && !box.value) box.value = t.draft;
        P.compose = false;
      } else {
        key = null;
        toChip.hidden = true;
        toInput.hidden = false;
      }
      renderHead(); renderMsgs(); updateBar();
    };
    toChip.addEventListener('click', () => { setRecipient(null); toRow.hidden = false; toInput.focus(); });

    const renderSugg = () => {
      const q = toInput.value.trim().toLowerCase();
      sugg.replaceChildren();
      if (!q) return;
      const items = [];
      for (const c of contacts) {
        const nm = contactName(c);
        for (const p of c.phones || []) {
          if (nm.toLowerCase().includes(q) || norm(p.number).includes(norm(q) || '\u0000')) items.push({ c, p, nm });
        }
      }
      for (const it of items.slice(0, 6)) {
        sugg.append(el('div.messaging-sugg-item.tilt', { onclick: () => setRecipient({ key: norm(it.p.number), name: it.nm }) },
          el('div.messaging-sugg-name', it.nm), el('div.messaging-sugg-num', `${it.p.type || 'mobile'}: ${it.p.number}`)));
      }
    };
    toInput.addEventListener('input', renderSugg);
    toInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const r = resolveRecipient(toInput.value); if (r) { setRecipient(r); box.focus(); } }
    });

    async function chooseContact() {
      const opts = [];
      for (const c of [...contacts].sort((a, b) => contactName(a).localeCompare(contactName(b)))) {
        for (const p of c.phones || []) opts.push({ value: norm(p.number) + '|' + contactName(c), label: `${contactName(c)} (${p.type || 'mobile'})` });
      }
      if (!opts.length) { os.ui.alert('You don\'t have any contacts with phone numbers yet. Add some in People, or type a number.', 'no contacts'); return; }
      const v = await os.ui.pickFromList({ title: 'choose a contact', options: opts });
      if (!v) return;
      const [k, ...n] = v.split('|');
      setRecipient({ key: k, name: n.join('|') });
      box.focus();
    }

    const renderHead = () => {
      if (!key) { title.textContent = 'NEW MESSAGE'; sub.textContent = ''; toRow.hidden = false; return; }
      toRow.hidden = true;
      const t = thread() || { key, name: recipient?.name };
      title.textContent = threadName(t).toUpperCase();
      const c = contactFor(key);
      const phone = c?.phones?.find((p) => sameNumber(p.number, key));
      sub.textContent = key === WELCOME ? '' : phone ? `${phone.type || 'mobile'} ${fmtPhone(phone.number)}` : key;
    };

    const dayLabel = (ts) => {
      const d = new Date(ts), now = new Date();
      const yd = new Date(now); yd.setDate(now.getDate() - 1);
      if (d.toDateString() === now.toDateString()) return 'today';
      if (d.toDateString() === yd.toDateString()) return 'yesterday';
      return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).toLowerCase();
    };

    const renderMsgs = () => {
      const t = thread();
      msgs.replaceChildren();
      if (!t || !t.messages.length) {
        if (key) msgs.append(el('div.messaging-conv-empty', key === WELCOME ? '' : 'say hello 👋'));
      } else {
        let lastDay = '';
        for (const m of t.messages) {
          const dl = dayLabel(m.time);
          if (dl !== lastDay) { msgs.append(el('div.messaging-day', dl)); lastDay = dl; }
          msgs.append(bubble(m, t));
        }
      }
      if (key && typing.has(key)) msgs.append(el('div.messaging-msg.them.messaging-typing', el('i'), el('i'), el('i')));
      requestAnimationFrame(() => (msgs.scrollTop = msgs.scrollHeight));
    };

    const bubble = (m, t) => {
      const b = el('div.messaging-msg.' + (m.from === 'me' ? 'me' : 'them'),
        m.image ? el('img.messaging-img', { src: m.image, alt: 'photo', onclick: (e) => { e.stopPropagation(); ctx.navigate(imagePage, { m }); } }) : null,
        m.text ? el('div.messaging-msg-text', { html: linkify(m.text) }) : null,
        el('div.messaging-msg-time', formatTime(new Date(m.time)) + (m.from === 'me' && m.device ? ' · sent via device' : '')));
      onLongPress(b, () => {
        os.ui.contextMenu(b, [
          m.text ? { label: 'copy', onClick: () => { os.device.copy(m.text).then(() => os.toast('Copied'), () => os.toast('Couldn\'t copy')); } } : null,
          { label: 'forward', onClick: () => openCompose({ body: m.text, attach: m.image ? { image: m.image, path: m.path } : null }) },
          m.image ? { label: 'save photo', onClick: () => savePhoto(m) } : null,
          { label: 'delete', onClick: () => { t.messages = t.messages.filter((x) => x !== m); t.updated = t.messages.at(-1)?.time || t.updated; save(); } },
        ]);
      });
      return b;
    };

    function linkify(s) {
      return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a class="messaging-link" data-url="$1">$1</a>').replace(/\n/g, '<br>');
    }
    msgs.addEventListener('click', (e) => {
      const a = e.target.closest('.messaging-link');
      if (a) { e.preventDefault(); os.apps.get('ie') ? os.launch('ie', { url: a.dataset.url }) : os.device.openUrl(a.dataset.url); }
    });

    // compose box
    const autoGrow = () => { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 120) + 'px'; };
    const updateCounter = () => { const n = box.value.length; counter.textContent = n > 120 ? `${n}/160${n > 160 ? ` (${Math.ceil(n / 153)})` : ''}` : ''; };
    const saveDraft = os.util.debounce(() => { const t = thread(); if (t && t.draft !== box.value) { t.draft = box.value; S.set('threads', threads); } }, 500);
    box.addEventListener('input', () => { autoGrow(); updateCounter(); updateBar(); saveDraft(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !os.device.isMobile) { e.preventDefault(); send(); } });
    box.addEventListener('focus', () => { emojiPanel.classList.remove('open'); });

    function insertText(s) {
      const st = box.selectionStart ?? box.value.length, en = box.selectionEnd ?? box.value.length;
      box.value = box.value.slice(0, st) + s + box.value.slice(en);
      const p = st + s.length;
      box.setSelectionRange?.(p, p);
      autoGrow(); updateCounter(); updateBar(); saveDraft();
    }
    function toggleEmoji(force) {
      const open = force ?? !emojiPanel.classList.contains('open');
      emojiPanel.classList.toggle('open', open);
      if (open) box.blur();
      requestAnimationFrame(() => (msgs.scrollTop = msgs.scrollHeight));
    }

    const renderAttach = () => {
      attachEl.replaceChildren();
      if (!attachment) return;
      attachEl.append(el('div.messaging-attach-item', el('img', { src: attachment.image, alt: '' }),
        el('button.messaging-attach-x', { 'aria-label': 'remove', html: os.ui.iconSVG(I.close, { size: 16, stroke: 2.5 }), onclick: () => { attachment = null; renderAttach(); updateBar(); } })));
    };
    async function attachPhoto() {
      const [path] = await os.pick.file({ accept: 'image/*', start: '/Pictures', title: 'choose a photo' });
      if (!path) return;
      await attachPath(path);
    }
    async function attachPath(path) {
      try {
        const blob = await os.fs.read(path, 'blob');
        let small = blob;
        try { small = await os.util.makeThumbnail(blob, 900, 0.82); } catch {}
        attachment = { image: await os.util.blobToDataURL(small), path };
        renderAttach(); updateBar();
      } catch (e) { os.ui.alert('Couldn\'t attach that photo.', 'attach'); }
    }
    async function savePhoto(m) {
      try {
        const blob = await (await fetch(m.image)).blob();
        await os.fs.mkdir('/Pictures/Saved Pictures').catch(() => {});
        const p = await os.fs.uniquePath('/Pictures/Saved Pictures/MMS_' + new Date(m.time).toISOString().slice(0, 19).replace(/\D/g, '') + '.jpg');
        await os.fs.write(p, blob, { mime: 'image/jpeg' });
        os.toast('Saved to Saved Pictures');
      } catch { os.toast('Couldn\'t save photo'); }
    }

    async function send() {
      if (!key) {
        const r = resolveRecipient(toInput.value);
        if (!r) { os.ui.alert('Add a recipient — type a phone number or choose a contact.', 'who to?'); return; }
        setRecipient(r);
      }
      if (key === WELCOME) { os.toast('You can\'t reply to this thread'); return; }
      const text = box.value.trim();
      if (!text && !attachment) return;
      const name = recipient?.name;
      const msg = { from: 'me', text, image: attachment?.image || null, path: attachment?.path || null };
      box.value = ''; attachment = null; renderAttach(); autoGrow(); updateCounter();
      const t = getThread(key, name); t.draft = ''; t.unread = 0;
      os.sounds.tap?.();
      await addMessage(key, msg, { name });
      scheduleReply(key, text, !!msg.image);
      updateBar();
    }

    const bar = appBar({});
    const updateBar = () => {
      const canSend = key !== WELCOME && (box.value.trim() || attachment);
      bar.setButtons([
        { icon: I.send, label: 'send', disabled: !canSend, onClick: send },
        { icon: Paperclip, label: 'attach', disabled: key === WELCOME, onClick: attachPhoto },
        { icon: I.smile, label: 'emoji', disabled: key === WELCOME, onClick: () => toggleEmoji() },
        ...(isNumberKey(key) ? [{ icon: I.phone, label: 'call', onClick: () => os.launch('phone', { number: key }) }] : []),
      ]);
      const c = key ? contactFor(key) : null;
      bar.setMenu([
        ...(c ? [{ label: 'view contact', onClick: () => os.launch('people', { contact: c.id }) }] : []),
        ...(key && !c && isNumberKey(key) ? [{ label: 'save to people', onClick: () => os.launch('people', { add: { phone: key } }) }] : []),
        ...(key && thread() ? [{ label: os.tiles.isPinned('messaging', 'messaging:' + key) ? 'unpin from start' : 'pin to start', onClick: async () => {
          const k = 'messaging:' + key;
          if (os.tiles.isPinned('messaging', k)) { await os.tiles.unpin(k); os.toast('Unpinned from Start'); }
          else { await ctx.pinTile({ key: k, title: threadName(thread()), args: { thread: key }, size: 'medium' }); os.toast('Pinned to Start'); }
          updateBar();
        } }] : []),
        ...(key && thread() ? [{ label: 'delete conversation', onClick: async () => {
          if (!(await os.ui.confirm('Delete this conversation?', 'delete', 'delete', 'cancel'))) return;
          threads = threads.filter((x) => x.key !== key); await save(); page.close();
        } }] : []),
      ]);
    };

    // initial state
    if (P.to && !key) { const r = resolveRecipient(P.to); if (r) setRecipient(r); else toInput.value = P.to; }
    else if (key) setRecipient(recipient);
    else setRecipient(null);
    if (P.body) box.value = P.body;
    else if (thread()?.draft) box.value = thread().draft;
    if (P.attach) { attachment = P.attach; renderAttach(); }
    if (P.attachPath) attachPath(P.attachPath);
    autoGrow(); updateCounter(); renderHead(); renderMsgs(); updateBar();

    const markRead = () => { const t = thread(); if (t && t.unread) { t.unread = 0; save(); } };
    const onChange = () => { if (key) markRead(); renderHead(); renderMsgs(); };
    subs.add(onChange);
    page.el.append(view, bar.el);
    const pageObj = {
      onShow: () => { viewing = key; markRead(); },
      onHide: () => { if (viewing === key) viewing = null; },
      onDestroy: () => { subs.delete(onChange); if (viewing === key) viewing = null; saveDraftNow(); if (convPage === pageObj) convPage = null; },
      onBack: () => { if (emojiPanel.classList.contains('open')) { toggleEmoji(false); return true; } return false; },
      close: page.close,
      getKey: () => key,
      isVisible: () => !page.el.hidden,
    };
    const saveDraftNow = () => { const t = thread(); if (t && t.draft !== box.value) { t.draft = box.value; save(); } };
    convPage = pageObj;
    if (P.send && key && (box.value.trim() || attachment)) setTimeout(send, 300);
    else setTimeout(() => (key ? box : toInput).focus?.(), 380);
    return pageObj;
  }

  function buildEmojiPanel(onPick) {
    const tabs = el('div.messaging-emoji-tabs');
    const grid = el('div.messaging-emoji-grid');
    const cats = Object.keys(EMOJI);
    let recent = [];
    storage.get('recentEmoji', []).then((r) => (recent = r || []));
    const show = (cat) => {
      [...tabs.children].forEach((t) => t.classList.toggle('active', t.dataset.cat === cat));
      const list = cat === 'recent' ? recent : EMOJI[cat].split(' ');
      grid.replaceChildren(...(list.length ? list.map((e) => el('button.messaging-emoji', { onclick: () => {
        onPick(e);
        recent = [e, ...recent.filter((x) => x !== e)].slice(0, 28);
        storage.set('recentEmoji', recent);
      } }, e)) : [el('div.messaging-emoji-none', 'emoji you use will show up here')]));
      grid.scrollTop = 0;
    };
    tabs.append(el('button.messaging-emoji-tab', { dataset: { cat: 'recent' }, onclick: () => show('recent'), html: os.ui.iconSVG(I.clock, { size: 20 }) }),
      ...cats.map((c) => el('button.messaging-emoji-tab', { dataset: { cat: c }, onclick: () => show(c) }, c)),
      el('button.messaging-emoji-tab', { 'aria-label': 'backspace', onclick: (e) => { e.stopPropagation(); onBackspace(); }, html: os.ui.iconSVG(os.ui.I.left, { size: 20 }) }));
    const panel = el('div.messaging-emoji-panel', tabs, grid);
    function onBackspace() {
      const ta = panel.parentElement?.querySelector('.messaging-input');
      if (!ta || !ta.value) return;
      const chars = [...ta.value];
      chars.pop();
      ta.value = chars.join('');
      ta.dispatchEvent(new Event('input'));
    }
    show(cats[0]);
    return panel;
  }

  /* ---------- image viewer */
  function imagePage(page) {
    const { m } = page.params;
    const v = el('div.messaging-imgview', el('img', { src: m.image, alt: '' }));
    const bar = appBar({ buttons: [
      { icon: I.save, label: 'save', onClick: async () => {
        try {
          const blob = await (await fetch(m.image)).blob();
          await os.fs.mkdir('/Pictures/Saved Pictures').catch(() => {});
          const p = await os.fs.uniquePath('/Pictures/Saved Pictures/MMS_' + Date.now() + '.jpg');
          await os.fs.write(p, blob, { mime: 'image/jpeg' });
          os.toast('Saved to Saved Pictures');
        } catch { os.toast('Couldn\'t save photo'); }
      } },
      ...(m.path ? [{ icon: I.share, label: 'share', onClick: () => os.share({ path: m.path, title: 'photo' }) }] : []),
    ], opacity: 0.7 });
    page.el.append(v, bar.el);
  }

  /* ---------- settings */
  function settingsPage(page) {
    const p = os.ui.page({ app: 'MESSAGING', title: 'settings' });
    const t1 = os.ui.toggle({ label: 'Replies from demo contacts', value: settings.autoReply, description: 'Contacts marked as demo in People text you back automatically, so you can try out messaging without a cellular network.', onChange: (v) => { settings.autoReply = v; S.set('settings', settings); } });
    p.content.append(t1.el,
      os.ui.header('storage'),
      os.ui.desc(`${threads.length} conversation${threads.length === 1 ? '' : 's'}, ${threads.reduce((s, t) => s + t.messages.length, 0)} messages`),
      os.ui.button('delete all conversations', async () => {
        if (!(await os.ui.confirm('Delete all conversations? This can’t be undone.', 'delete all', 'delete', 'cancel'))) return;
        threads = []; await save(); os.toast('All conversations deleted'); page.close();
      }));
    page.el.append(p.el);
  }

  /* ---------- args */
  async function handleArgs(a) {
    if (!a || !Object.keys(a).length) return;
    await loadContacts();
    if (a.thread) return openThread(a.thread);
    if (a.share) {
      const s = a.share;
      const body = [s.title && !s.text?.includes(s.title) && s.url ? s.title : null, s.text, s.url].filter(Boolean).join(' ');
      const isImg = s.path && /^image\//.test(os.path.mimeOf(s.path) || '');
      return openCompose({ body, attachPath: isImg ? s.path : null });
    }
    if (a.to || a.body) {
      const r = a.to ? resolveRecipient(a.to) : null;
      if (r) return openThread(r.key, r.name, { body: a.body, send: !!a.send });
      return openCompose({ to: a.to, body: a.body });
    }
  }
  ctx.on('args', handleArgs);
  ctx.on('resume', async () => {
    await load(os, storage, true);
    if (convPage?.isVisible()) viewing = convPage.getKey();
    emit();
  });
  ctx.on('suspend', () => { viewing = null; });
  // let the first page mount, then handle launch args
  setTimeout(() => handleArgs(ctx.args), 160);

  return {};
}
