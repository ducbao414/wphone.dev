// Cortana — personal assistant + Bing-style search. Voice in (os.device.listen), voice out (os.device.speak).
import './style.css';
import { parseIntent, nextAlarmTime } from './nlp.js';
import { createSkills } from './skills.js';
import { getPlace, greeting, displayName, startScheduler, scheduler } from './shared.js';
import { BookOpen, Mic, X as XIcon, Search as SearchIcon, ArrowRight } from 'lucide';

const TIPS = [
  'What’s the weather like tomorrow?', 'Set an alarm for 7:30 am', 'Remind me to call Mom in 1 hour', 'Tell me a joke',
  'What is 15% of 240?', 'Who is Ada Lovelace?', 'Add lunch with Sam tomorrow at noon', 'Note: pick up dry cleaning',
  'Set a timer for 10 minutes', 'Turn on Bluetooth', 'Convert 100 USD to EUR', 'Translate thank you to Japanese',
  'What’s on my calendar today?', 'Play music', 'Who’s Master Chief?', 'Open Calculator', 'Flip a coin', 'Tech news',
];

export default async function launch(ctx) {
  const { os, storage, root } = ctx;
  const ui = os.ui;
  const { el, I } = ui;
  const U = os.util;
  startScheduler(os, storage);
  const skills = createSkills({ os, storage, ui, el, I });

  let speakMode = await storage.get('speak', 'voice'); // 'voice' | 'always' | 'never'
  let newsCat = await storage.get('newsCat', 'top');

  /* ---------------------------------------------------------------- layout */
  const orb = el('div.cortana-orb.idle', el('i.cortana-ring.outer'), el('i.cortana-ring.inner'), el('i.cortana-ring.pulse'));
  const say = el('div.cortana-say');
  const sub = el('div.cortana-say-sub');
  const band = el('div.cortana-band',
    el('div.cortana-band-top', el('div.cortana-apptitle', 'CORTANA'),
      el('button.cortana-nb.tilt', { 'aria-label': 'notebook', onclick: () => ctx.navigate(notebookPage), html: ui.iconSVG(BookOpen, { size: 22 }) })),
    el('div.cortana-band-main', orb, el('div.cortana-band-text', say, sub)));
  const body = el('div.cortana-body');
  const input = el('input.cortana-input', { type: 'search', placeholder: 'Ask me anything', enterkeyhint: 'search', autocomplete: 'off', spellcheck: false });
  const clearBtn = el('button.cortana-clear', { 'aria-label': 'clear', html: ui.iconSVG(XIcon, { size: 18 }), hidden: true });
  const goBtn = el('button.cortana-go', { 'aria-label': 'search', html: ui.iconSVG(SearchIcon, { size: 20 }) });
  const micBtn = el('button.cortana-mic.tilt', { 'aria-label': 'speak', html: ui.iconSVG(Mic, { size: 22 }) });
  const ask = el('div.cortana-ask', el('div.cortana-inputwrap', input, clearBtn, goBtn), micBtn);
  const view = el('div.cortana', band, body, ask);

  function homePage(page) {
    page.el.append(view);
    return { onShow: () => { if (mode === 'home' && Date.now() - feedAt > 5 * 60e3) renderFeed(); } };
  }

  /* ---------------------------------------------------------------- orb states */
  let state = 'idle';
  const setState = (s) => { state = s; orb.className = 'cortana-orb ' + s; };

  /* ---------------------------------------------------------------- modes */
  let mode = 'home';
  let feedAt = 0;
  let runId = 0;
  const setMode = (m) => { mode = m; view.dataset.mode = m; };

  async function goHome() {
    runId++;
    input.value = '';
    clearBtn.hidden = true;
    try { speechSynthesis?.cancel(); } catch {}
    setState('idle');
    setMode('home');
    await renderGreeting();
    renderFeed();
  }

  async function renderGreeting() {
    const name = await displayName(os, storage);
    say.textContent = `${greeting()}${name ? ', ' + name : ''}.`;
    sub.textContent = 'Here’s what’s happening today.';
    say.classList.remove('long');
  }

  /* ---------------------------------------------------------------- feed */
  async function renderFeed() {
    feedAt = Date.now();
    const myRun = runId;
    const weatherSlot = el('div', el('div.cortana-card.cortana-skeleton', el('div.cortana-card-title', 'weather'), ui.loadingDots()));
    const upcomingSlot = el('div');
    const remindSlot = el('div');
    const newsSlot = el('div', el('div.cortana-card.cortana-skeleton', el('div.cortana-card-title', 'headlines'), ui.loadingDots()));
    const tips = TIPS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    const tipsCard = el('div.cortana-card', el('div.cortana-card-title', 'try asking me'),
      ...tips.map((t) => el('div.cortana-tip.tilt', { onclick: () => submit(t) }, '“' + t + '”')));
    body.replaceChildren(weatherSlot, upcomingSlot, remindSlot, newsSlot, tipsCard);
    body.scrollTop = 0;

    // weather
    (async () => {
      try {
        const place = await getPlace(os, storage);
        const wx = await os.net.weather(place.lat, place.lon, os.settings.get('units') || 'metric');
        if (myRun !== runId) return;
        weatherSlot.replaceChildren(skills.weatherCard(wx, place, 0, false));
      } catch {
        weatherSlot.replaceChildren(el('div.cortana-card', el('div.cortana-card-title', 'weather'), el('div.subtle', navigator.onLine ? 'I couldn’t get the weather for your location.' : 'You’re offline. Weather will be back when you reconnect.')));
      }
    })();

    // upcoming: calendar + next alarm
    (async () => {
      const now = Date.now();
      const evs = (await skills.events().catch(() => [])).filter((e) => e.end > now && e.start < now + 2 * 864e5).sort((a, b) => a.start - b.start).slice(0, 4);
      const alarms = ((await os.storage('alarms').get('alarms', []).catch(() => [])) || []).filter((a) => a.enabled);
      const next = alarms.map((a) => ({ a, t: nextAlarmTime(a) })).filter((x) => x.t).sort((x, y) => x.t - y.t)[0];
      const rows = [];
      for (const e of evs) rows.push(skills.row({ icon: I.calendar, title: e.title, sub: (e.allDay ? 'all day' : skills.fmtTime(new Date(e.start))) + ' · ' + skills.fmtDay(new Date(e.start)) + (e.location ? ' · ' + e.location : ''), onClick: () => os.launch('calendar', { date: e.start, event: e.id }) }));
      if (next) rows.push(skills.row({ icon: I.clock, title: 'Alarm ' + skills.fmtTime(next.t), sub: `${next.a.label || 'Alarm'} · ${skills.fmtDay(next.t)}`, onClick: () => os.launch('alarms') }));
      if (myRun !== runId) return;
      upcomingSlot.replaceChildren(rows.length ? skills.card('coming up', ...rows) : skills.card('coming up', el('div.subtle', 'Nothing on your calendar for the next two days.'), el('div.cortana-tip.tilt', { onclick: () => submit('Add an event tomorrow at 10 am') }, '“Add an event tomorrow at 10 am”')));
    })();

    // reminders
    (async () => {
      const list = ((await storage.get('reminders', [])) || []).filter((r) => !r.done && r.kind !== 'timer').sort((a, b) => (a.when || 9e15) - (b.when || 9e15));
      if (myRun !== runId) return;
      if (!list.length) { remindSlot.replaceChildren(); return; }
      remindSlot.replaceChildren(skills.card('reminders',
        ...list.slice(0, 3).map((r) => skills.row({ icon: I.bell, title: r.text, sub: r.when ? (r.fired ? 'reminded ' : '') + skills.when(r.when) : 'no time set', onClick: () => ctx.navigate(remindersPage) })),
        list.length > 3 ? el('div.cortana-more.tilt', { onclick: () => ctx.navigate(remindersPage) }, `see all ${list.length} reminders`) : null));
    })();

    // news
    (async () => {
      try {
        const n = await os.net.news(newsCat);
        if (myRun !== runId) return;
        const items = (n.items || []).slice(0, 4);
        if (!items.length) throw new Error('none');
        newsSlot.replaceChildren(skills.card(newsCat === 'top' ? 'headlines' : newsCat + ' news', ...items.map(skills.newsRow),
          el('div.cortana-more.tilt', { onclick: () => (os.apps.isInstalled('news') ? os.launch('news') : submit('news')) }, 'more news')));
      } catch {
        newsSlot.replaceChildren();
      }
    })();
  }

  /* ---------------------------------------------------------------- suggestions */
  let sugToken = 0;
  const history = async () => (await storage.get('history', [])) || [];
  const appMatches = (q) => {
    const ql = q.toLowerCase();
    return os.apps.list().filter((m) => !m.hidden && (m.name.toLowerCase().startsWith(ql) || m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(ql)) || (ql.length >= 3 && (m.keywords || []).some((k) => k.startsWith(ql))))).slice(0, 4);
  };
  const sugRow = (text, icon, onClick, extra) => el('div.cortana-sug.tilt', { onclick: onClick },
    el('span.cortana-sug-icon', { html: ui.iconSVG(icon, { size: 18 }) }), el('span.cortana-sug-text', text), extra || null);

  const renderSuggestions = U.debounce(async () => {
    const q = input.value.trim();
    const tok = ++sugToken;
    if (mode !== 'typing') return;
    if (!q) {
      const h = await history();
      body.replaceChildren(
        h.length ? el('div.cortana-sugs', el('div.cortana-sug-head', 'recent'), ...h.slice(0, 6).map((t) => sugRow(t, I.clock, () => submit(t), el('button.cortana-sug-fill', {
          'aria-label': 'edit', html: ui.iconSVG(ArrowRight, { size: 16 }), onclick: (e) => { e.stopPropagation(); input.value = t + ' '; input.focus(); onInput(); },
        })))) : null,
        el('div.cortana-sugs', el('div.cortana-sug-head', 'try'), ...TIPS.slice(0, 4).map((t) => sugRow(t, I.search, () => submit(t)))));
      return;
    }
    const apps = appMatches(q);
    const local = el('div.cortana-sugs',
      ...apps.map((m) => el('div.cortana-sug.cortana-sug-app.tilt', { onclick: () => { addHistory(q); os.launch(m.id); } },
        el('span.cortana-sug-appicon', { style: { background: m.color || 'var(--accent)' }, html: ui.iconSVG(m.icon, { size: 18 }) }), el('span.cortana-sug-text', m.name), el('span.cortana-sug-kind', 'app'))));
    const web = el('div.cortana-sugs', sugRow(q, I.search, () => submit(q)));
    body.replaceChildren(local, web);
    try {
      const s = await os.net.suggest(q);
      if (tok !== sugToken || mode !== 'typing') return;
      web.replaceChildren(sugRow(q, I.search, () => submit(q)), ...(s || []).filter((x) => x.toLowerCase() !== q.toLowerCase()).slice(0, 7).map((t) => sugRow(boldMatch(t, q), I.search, () => submit(t), el('button.cortana-sug-fill', {
        'aria-label': 'use', html: ui.iconSVG(ArrowRight, { size: 16 }), onclick: (e) => { e.stopPropagation(); input.value = t + ' '; input.focus(); onInput(); },
      }))));
    } catch {}
  }, 160);

  function boldMatch(t, q) {
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i !== 0) return t;
    return el('span', el('span.cortana-sug-typed', t.slice(0, q.length)), el('b', t.slice(q.length)));
  }

  async function addHistory(q) {
    await storage.update('history', (h) => [q, ...(h || []).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 12), []);
  }

  const onInput = () => {
    clearBtn.hidden = !input.value;
    if (mode !== 'typing') { setMode('typing'); setState('idle'); }
    renderSuggestions();
  };
  input.addEventListener('input', onInput);
  input.addEventListener('focus', () => { if (mode === 'home' || (mode === 'result' && !input.value)) { setMode('typing'); renderSuggestions(); } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(input.value); } else if (e.key === 'Escape') goHome(); });
  clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; input.focus(); setMode('typing'); renderSuggestions(); });
  goBtn.addEventListener('click', () => (input.value.trim() ? submit(input.value) : input.focus()));
  micBtn.addEventListener('click', () => (state === 'listening' ? null : listen()));

  /* ---------------------------------------------------------------- run a query */
  const appIndex = () => os.apps.list({ all: true }).map(({ id, name, keywords }) => ({ id, name, keywords }));

  async function submit(text, { voice = false } = {}) {
    text = String(text || '').trim();
    if (!text) { input.focus(); return; }
    const myRun = ++runId;
    input.value = text;
    clearBtn.hidden = false;
    input.blur();
    addHistory(text);
    setMode('result');
    setState('thinking');
    say.textContent = '';
    say.classList.remove('long');
    sub.textContent = '';
    body.replaceChildren(el('div.cortana-thinking', ui.loadingDots()));
    const t0 = Date.now();
    let res;
    try {
      const intent = parseIntent(text, { apps: appIndex() });
      res = await skills.run(intent);
    } catch (e) {
      console.warn('cortana', e);
      res = { say: navigator.onLine ? 'Sorry, something went wrong. Please try again.' : 'I can’t do that while you’re offline.' };
    }
    if (myRun !== runId) return;
    // keep the "thinking" animation visible for a beat
    const wait = 450 - (Date.now() - t0);
    if (wait > 0) await U.sleep(wait);
    if (myRun !== runId) return;
    if (res.open === 'reminders') ctx.navigate(remindersPage);
    showResult(res);
    const shouldSpeak = speakMode === 'always' || (speakMode === 'voice' && voice);
    if (res.after) setTimeout(() => { if (myRun === runId) res.after(); }, res.delay || 600);
    if (shouldSpeak) {
      setState('speaking');
      await os.device.speak(cleanSpeech(res.speak || res.say), res.speakLang ? { lang: res.speakLang } : {});
      if (myRun === runId && state === 'speaking') setState('idle');
    } else setState('idle');
  }

  function showResult(res) {
    const text = res.say || '';
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0];
    const long = text.length > 170 || text.includes('\n');
    say.textContent = long ? (firstSentence.length < 170 && !firstSentence.includes('\n') ? firstSentence : text.split('\n')[0]) : text;
    say.classList.toggle('long', !long && text.length > 90);
    sub.textContent = '';
    const parts = [];
    if (long && !res.card) parts.push(el('div.cortana-card.cortana-longtext.selectable', text));
    if (res.card) parts.push(res.card);
    body.replaceChildren(...parts);
    body.scrollTop = 0;
  }
  skills.setExtra((r) => showResult(r));

  const cleanSpeech = (t) => String(t || '').replace(/[•“”"]/g, '').replace(/\n+/g, '. ').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').slice(0, 400);

  /* ---------------------------------------------------------------- voice */
  async function listen() {
    if (!os.device.canListen) {
      setMode('result');
      say.textContent = 'Speech recognition isn’t available in this browser.';
      sub.textContent = 'Type your question below instead. Chrome, Edge and Safari support speaking to me.';
      body.replaceChildren();
      input.focus();
      return;
    }
    const myRun = ++runId;
    try { speechSynthesis?.cancel(); } catch {}
    setMode('result');
    setState('listening');
    say.textContent = 'Listening…';
    say.classList.remove('long');
    sub.textContent = '';
    input.value = '';
    body.replaceChildren(el('div.cortana-listen-hint', 'Try “Remind me to buy milk when I get home” — or just ask a question.'));
    os.sounds.tap();
    try {
      const final = await os.device.listen({ onInterim: (t) => { if (myRun === runId) { input.value = t; say.textContent = t || 'Listening…'; } } });
      if (myRun !== runId) return;
      if (final && final.trim()) submit(final, { voice: true });
      else { setState('idle'); say.textContent = 'I didn’t catch that.'; sub.textContent = 'Tap the microphone and try again.'; body.replaceChildren(); }
    } catch (e) {
      if (myRun !== runId) return;
      setState('idle');
      const msg = String(e.message || e);
      say.textContent = msg === 'not-allowed' || msg === 'service-not-allowed' ? 'I need permission to use your microphone.'
        : msg === 'no-speech' ? 'I didn’t hear anything.' : msg === 'network' ? 'I can’t understand speech while offline.' : msg === 'aborted' ? 'Stopped listening.' : 'Sorry, I had trouble hearing you.';
      sub.textContent = 'You can always type instead.';
      body.replaceChildren();
    }
  }

  /* ---------------------------------------------------------------- notebook */
  function notebookPage(page) {
    const p = ui.page({ app: 'CORTANA', title: 'notebook', cls: 'cortana-page' });
    const draw = async () => {
      const name = (await storage.get('name', '')) || '';
      const place = await storage.get('place', null);
      const pending = ((await storage.get('reminders', [])) || []).filter((r) => !r.done && r.kind !== 'timer').length;
      const h = await history();
      p.content.replaceChildren(
        nbItem('about me', name ? `Cortana calls you ${name}` : `using your phone owner name (${os.settings.get('ownerName')})`, async () => {
          const v = await ui.prompt('What should I call you?', name || (os.settings.get('ownerName') !== 'Lumia owner' ? os.settings.get('ownerName') : ''), 'about me');
          if (v != null) { await storage.set('name', v.trim()); draw(); renderGreeting(); }
        }),
        nbItem('reminders', pending ? `${pending} pending` : 'none yet', () => ctx.navigate(remindersPage)),
        nbItem('news interests', newsCat === 'top' ? 'top stories' : newsCat, async () => {
          const opts = ['top', 'world', 'business', 'technology', 'science', 'entertainment', 'health', 'sports', 'football', 'tennis', 'f1', 'food', 'travel', 'wp'];
          const v = await ui.pickFromList({ title: 'news interests', value: newsCat, options: opts.map((o) => ({ value: o, label: o === 'top' ? 'top stories' : o === 'wp' ? 'windows phone' : o === 'f1' ? 'formula 1' : o })) });
          if (v) { newsCat = v; await storage.set('newsCat', v); feedAt = 0; draw(); }
        }),
        nbItem('speech', { voice: 'speak responses when I talk to Cortana', always: 'always speak responses', never: 'never speak responses' }[speakMode], async () => {
          const v = await ui.pickFromList({ title: 'speak responses', value: speakMode, options: [{ value: 'voice', label: 'when I talk to Cortana' }, { value: 'always', label: 'always' }, { value: 'never', label: 'never' }] });
          if (v) { speakMode = v; await storage.set('speak', v); draw(); }
        }),
        nbItem('places', place ? `${place.name}${place.approximate ? ' (approximate)' : ''} · updated ${U.formatRelative(place.t)}` : 'not located yet', async () => {
          p.content.querySelector('.cortana-nb-places .cortana-nb-sub').textContent = 'locating…';
          await storage.del('place');
          try { await getPlace(os, storage, { prompt: true }); } catch (e) { os.toast(e.message); }
          feedAt = 0; draw();
        }, 'cortana-nb-places'),
        nbItem('search history', h.length ? `${h.length} recent searches · tap to clear` : 'empty', async () => {
          if (!h.length) return;
          if (await ui.confirm('Clear your Cortana search history?', 'search history', 'clear', 'cancel')) { await storage.set('history', []); draw(); }
        }),
        nbItem('location settings', os.settings.get('location') ? 'location is on' : 'location is off — weather uses your approximate location', () => os.launch('settings', { page: 'location' })),
        ui.header('about cortana'),
        ui.desc(`Speech recognition: ${os.device.canListen ? 'available' : 'not supported in this browser'}.\nSpeech output: ${'speechSynthesis' in window ? 'available' : 'not supported'}.\nLong-press the search button to talk to me right away.`));
    };
    draw();
    page.el.append(p.el);
    return { onShow: draw };
  }
  const nbItem = (title, subText, onClick, cls) => el('div.cortana-nb-item.tilt' + (cls ? '.' + cls : ''), { onclick: onClick }, el('div.cortana-nb-title', title), el('div.cortana-nb-sub', subText));

  /* ---------------------------------------------------------------- reminders */
  function remindersPage(page) {
    const containers = new Map();
    const pv = ui.pivot({
      app: 'CORTANA · REMINDERS',
      items: [{ header: 'upcoming', render: (c) => drawList(c, false) }, { header: 'completed', render: (c) => drawList(c, true) }],
    });
    async function drawList(c, done) {
      containers.set(done, c);
      const all = ((await storage.get('reminders', [])) || []).filter((r) => r.kind !== 'timer' || !r.done);
      const list = all.filter((r) => !!r.done === done).sort((a, b) => (done ? (b.when || b.created) - (a.when || a.created) : (a.when || 9e15) - (b.when || 9e15)));
      c.replaceChildren(list.length ? ui.list(list, {
        render: (r) => el('div.cortana-rem',
          el('button.cortana-rem-check' + (r.done ? '.on' : ''), {
            'aria-label': 'complete', html: ui.iconSVG(I.check, { size: 16, stroke: 3 }),
            onclick: async (e) => { e.stopPropagation(); await toggleDone(r.id); },
          }),
          el('div.cortana-rem-text', el('div.cortana-rem-title', r.text || 'Reminder'),
            el('div.cortana-rem-when' + (r.when && r.when < Date.now() && !r.done ? '.overdue' : ''), r.kind === 'timer' ? 'timer · ' + skills.when(r.when) : r.when ? skills.when(r.when) : 'no time'))),
        onClick: (r) => editReminder(r),
        onHold: (r, rowEl) => ui.contextMenu(rowEl, [
          { label: r.done ? 'mark as not done' : 'complete', onClick: () => toggleDone(r.id) },
          { label: 'edit', onClick: () => editReminder(r) },
          { label: 'delete', onClick: async () => { await storage.update('reminders', (l) => (l || []).filter((x) => x.id !== r.id), []); refresh(); } },
        ]),
      }) : ui.empty(done ? 'nothing completed yet' : 'no reminders. Tap + or ask “remind me to…”'));
    }
    const refresh = () => { for (const [done, c] of containers) drawList(c, done); os.tiles.refresh('cortana'); };
    async function toggleDone(id) {
      await storage.update('reminders', (l) => (l || []).map((x) => (x.id === id ? { ...x, done: !x.done } : x)), []);
      refresh();
    }
    async function editReminder(r) {
      const text = await ui.prompt('Reminder', r.text, 'edit reminder');
      if (text == null) return;
      const change = await ui.confirm('Change when I remind you?', 'time', 'change time', 'keep');
      let when = r.when;
      if (change) {
        const d = await ui.pickDate({ date: new Date(r.when || Date.now()) });
        if (d) {
          const t = await ui.pickTime({ hours: r.when ? new Date(r.when).getHours() : 9, minutes: r.when ? new Date(r.when).getMinutes() : 0 });
          if (t) { d.setHours(t.hours, t.minutes, 0, 0); when = d.getTime(); }
        }
      }
      await storage.update('reminders', (l) => (l || []).map((x) => (x.id === r.id ? { ...x, text: text.trim() || x.text, when, fired: when !== r.when ? false : x.fired, done: when !== r.when ? false : x.done } : x)), []);
      scheduler()?.poke();
      refresh();
    }
    const bar = ui.appBar({
      buttons: [{
        icon: I.add, label: 'new', onClick: async () => {
          await skills.run({ type: 'reminder', text: '', hasTime: false });
          refresh();
        },
      }],
      menu: [{
        label: 'delete completed', onClick: async () => {
          await storage.update('reminders', (l) => (l || []).filter((x) => !x.done), []);
          refresh();
        },
      }],
    });
    const off = scheduler()?.on(refresh);
    page.el.append(pv.el, bar.el);
    return { onDestroy: () => off?.() };
  }

  /* ---------------------------------------------------------------- boot */
  await ctx.navigate(homePage);
  setMode('home');
  await renderGreeting();
  renderFeed();

  const handleArgs = (a = {}) => {
    if (a.reminder) { ctx.navigate(remindersPage); return; }
    if (a.notebook) { ctx.navigate(notebookPage); return; }
    if (a.listen) { setTimeout(listen, 250); return; }
    if (a.q) { submit(String(a.q)); return; }
    if (a.focus) setTimeout(() => input.focus(), 300);
  };
  handleArgs(ctx.args);
  ctx.on('args', handleArgs);

  return {
    onBack: () => {
      if (mode !== 'home') { goHome(); return true; }
      return false;
    },
    onResume: () => { if (mode === 'home' && Date.now() - feedAt > 5 * 60e3) { renderGreeting(); renderFeed(); } },
    onSuspend: () => { try { speechSynthesis?.cancel(); } catch {} if (state === 'speaking') setState('idle'); },
    onDestroy: () => { runId++; try { speechSynthesis?.cancel(); } catch {} },
  };
}
