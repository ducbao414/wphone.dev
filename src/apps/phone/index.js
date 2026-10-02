// Phone: history / speed dial / keypad pivots, DTMF keypad, in-call & incoming call screens, real device calls on mobile.
import './style.css';
import { Phone, PhoneOff, PhoneMissed, PhoneIncoming, PhoneOutgoing, Grid3x3, Delete, MicOff, Volume2, Pause, UserPlus, Users, ListChecks, MessageSquare } from 'lucide';
import { phoneTileData } from './tile.js';

const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], '*': [941, 1209], 0: [941, 1336], '#': [941, 1477] };
const LETTERS = { 1: 'ₒₒ', 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '+', '*': '', '#': '' };
const T9 = { a: 2, b: 2, c: 2, d: 3, e: 3, f: 3, g: 4, h: 4, i: 4, j: 5, k: 5, l: 5, m: 6, n: 6, o: 6, p: 7, q: 7, r: 7, s: 7, t: 8, u: 8, v: 8, w: 9, x: 9, y: 9, z: 9 };
const PALETTE = ['#1BA1E2', '#A200FF', '#E51400', '#F09609', '#339933', '#00ABA9', '#D80073', '#0050EF', '#8CBF26', '#A05000', '#6A00FF', '#647687'];

const normNum = (n) => String(n || '').replace(/[^\d+*#]/g, '');
function sameNumber(a, b) {
  const x = normNum(a).replace(/^\+/, ''), y = normNum(b).replace(/^\+/, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const k = Math.min(9, x.length, y.length);
  return k >= 6 && x.slice(-k) === y.slice(-k);
}
const nameOf = (c) => (c ? [c.first, c.last].filter(Boolean).join(' ') || c.name || c.company || '' : '');
function hashColor(s = '') { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
function initials(n) { const p = String(n || '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean); return p.length ? ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '#'; }
const t9of = (s) => String(s).toLowerCase().split('').map((ch) => T9[ch] || (/\d/.test(ch) ? ch : '')).join('');

/* ------------------------------------------------------------------ audio */
let actx;
const ac = () => (actx ??= new (window.AudioContext || window.webkitAudioContext)());
function tone(freqs, dur = 0.16, vol = 0.12) {
  try {
    const a = ac(); a.resume?.();
    const g = a.createGain();
    const t = a.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(a.destination);
    for (const f of freqs) { const o = a.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + dur + 0.02); }
  } catch {}
}
/** Repeating call-progress tone (ringback: 440+480 Hz, 2s on / 4s off; busy: 480+620 0.5/0.5). Returns stop fn. */
function cadence(freqs, on, off, vol = 0.08) {
  let stopped = false, timer;
  const step = () => { if (stopped) return; tone(freqs, on, vol); timer = setTimeout(step, (on + off) * 1000); };
  step();
  return () => { stopped = true; clearTimeout(timer); };
}

export default async function launch(ctx) {
  const { os, storage, root } = ctx;
  const { el, I } = os.ui;
  const ui = os.ui;
  const people = os.storage('people');

  let contacts = await people.get('contacts', []);
  let history = await storage.get('history', []);
  let deviceCalls = await storage.get('deviceCalls', true);
  let missedUnseen = await storage.get('missedUnseen', 0);
  let call = null;          // active call state
  const refreshers = new Set();
  const refreshAll = () => refreshers.forEach((f) => f());

  const contactFor = (number) => contacts.find((c) => (c.phones || []).some((p) => sameNumber(p.number, number)));
  const typeFor = (c, number) => (c?.phones || []).find((p) => sameNumber(p.number, number))?.type || '';
  const pushTile = async () => os.tiles.set('phone', await phoneTileData(os));
  const isForeground = () => !root.closest('.app-frame:not(.active)');

  async function reload() {
    contacts = await people.get('contacts', []);
    history = await storage.get('history', []);
    missedUnseen = await storage.get('missedUnseen', 0);
    refreshAll();
  }
  // background.js (simulated calls) announces history changes
  const onExternal = () => reload();
  window.addEventListener('wp:calls', onExternal);
  ctx.on('destroy', () => window.removeEventListener('wp:calls', onExternal));
  async function saveHistory() { await storage.set('history', history.slice(0, 300)); refreshAll(); }
  async function addHistory(entry) {
    history.unshift({ id: os.util.uid(), duration: 0, time: Date.now(), ...entry });
    await saveHistory();
  }
  async function clearMissed() {
    if (!missedUnseen) return;
    missedUnseen = 0;
    await storage.set('missedUnseen', 0);
    pushTile();
  }

  function avatar(c, size, label) {
    const a = el('div.phone-av', { style: { width: size + 'px', height: size + 'px' } });
    if (c?.photo) a.style.backgroundImage = `url("${c.photo}")`;
    else { a.style.background = c ? hashColor(c.id) : 'var(--chrome2)'; a.append(el('span', { style: { fontSize: Math.round(size * 0.36) + 'px' } }, c ? initials(nameOf(c)) : label || '')); }
    return a;
  }
  const fmtNum = (n) => String(n || '');

  /* ---------------------------------------------------------------- calling */
  async function chooseNumber(c) {
    const phones = c.phones || [];
    if (!phones.length) { ui.alert(`${nameOf(c)} doesn’t have a phone number.`, 'phone'); return null; }
    if (phones.length === 1) return phones[0].number;
    return (await ui.pickFromList({ title: 'call ' + nameOf(c), options: phones.map((p) => ({ value: p.number, label: `${p.type} ${p.number}` })) })) || null;
  }

  function startCall(number, { incoming = false, contactId } = {}) {
    number = String(number || '').trim();
    if (!normNum(number)) { os.sounds.error(); return; }
    if (call) { showCall(); return; }
    if (os.settings.get('airplane')) { ui.alert('Turn off airplane mode to make a call.', 'airplane mode'); return; }
    const c = (contactId && contacts.find((x) => x.id === contactId)) || contactFor(number);
    call = { number, contact: c || null, name: nameOf(c) || number, incoming, state: incoming ? 'connected' : 'calling', start: 0, muted: false, speaker: false, hold: false, digits: '', stopTone: null, timers: [] };
    const realDevice = !incoming && deviceCalls && os.device.isMobile;
    renderCallScreen();
    if (realDevice) {
      call.viaDevice = true;
      call.state = 'connected';
      call.start = Date.now();
      setTimeout(() => os.device.call(number), 250);
    } else if (!incoming) {
      // simulated network: ringback, then answer (or no answer)
      call.stopTone = cadence([440, 480], 2, 4);
      const known = !!c;
      const answers = known ? Math.random() < 0.9 : Math.random() < 0.6;
      const wait = answers ? 3500 + Math.random() * 5000 : 22000;
      call.timers.push(setTimeout(() => {
        if (!call) return;
        call.stopTone?.();
        if (answers) {
          call.state = 'connected'; call.start = Date.now();
          tone([1400], 0.06, 0.05);
          if (!call.muted && os.settings.get('sounds')) os.device.speak(c ? `Hi! It's ${c.first || nameOf(c)}.` : 'Hello?', { rate: 1.05 });
        } else {
          call.state = 'no answer';
          call.stopTone = cadence([480, 620], 0.5, 0.5);
          call.timers.push(setTimeout(() => endCall(), 3000));
        }
        updateCall();
      }, wait));
    } else { call.start = Date.now(); }
    call.timers.push(setInterval(updateCall, 1000));
    updateCall();
  }

  async function endCall() {
    if (!call) return;
    const c = call;
    call = null;
    c.stopTone?.();
    c.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    speechSynthesis?.cancel?.();
    tone([480, 620], 0.25, 0.06);
    const duration = c.start ? Math.round((Date.now() - c.start) / 1000) : 0;
    await addHistory({ number: c.number, name: nameOf(c.contact) || '', contact: c.contact?.id || null, type: c.incoming ? 'incoming' : 'outgoing', duration });
    callScreen?.classList.add('phone-call-out');
    const s = callScreen;
    callScreen = null;
    setTimeout(() => s?.remove(), 250);
    offCallBack?.(); offCallBack = null;
    returnBar.hidden = true;
  }

  let callScreen = null, offCallBack = null, callRefs = {};
  const returnBar = el('div.phone-returnbar.tilt', { onclick: () => showCall() });
  returnBar.hidden = true;

  function renderCallScreen() {
    const c = call;
    const bg = el('div.phone-call-bg');
    if (c.contact?.photo) bg.style.backgroundImage = `url("${c.contact.photo}")`;
    else if (c.contact) { bg.classList.add('initials'); bg.style.background = hashColor(c.contact.id); bg.append(el('span', initials(c.name))); }
    const status = el('div.phone-call-status');
    const nameEl = el('div.phone-call-name', c.name);
    const sub = el('div.phone-call-sub', c.contact ? `${typeFor(c.contact, c.number) || 'phone'} ${fmtNum(c.number)}` : 'unknown number');
    const digits = el('div.phone-call-digits');
    const btn = (icon, label, onClick, cls = '') => {
      const b = el('button.phone-call-btn.tilt' + (cls ? '.' + cls : ''), { onclick: onClick }, el('span.phone-call-btn-ic', { html: ui.iconSVG(icon, { size: 26 }) }), el('span.phone-call-btn-label', label));
      return b;
    };
    const keypad = el('div.phone-call-keypad');
    keypad.hidden = true;
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']) keypad.append(el('button.phone-ckey.tilt', { onclick: () => { tone(DTMF[k]); call.digits += k; digits.textContent = call.digits; } }, k));
    const speakerB = btn(Volume2, 'speaker', () => { call.speaker = !call.speaker; speakerB.classList.toggle('on', call.speaker); });
    const muteB = btn(MicOff, 'mute', () => { call.muted = !call.muted; muteB.classList.toggle('on', call.muted); if (call.muted) speechSynthesis?.cancel?.(); });
    const keypadB = btn(Grid3x3, 'keypad', () => { keypad.hidden = !keypad.hidden; grid.classList.toggle('kp', !keypad.hidden); keypadB.classList.toggle('on', !keypad.hidden); });
    const holdB = btn(Pause, 'hold', () => { call.hold = !call.hold; holdB.classList.toggle('on', call.hold); updateCall(); });
    const addB = btn(UserPlus, 'add call', () => ui.alert('Conference calling isn’t available on this network.', 'add call'));
    const contactsB = btn(Users, c.contact ? 'contact' : 'save', () => { minimizeCall(); if (call?.contact) os.launch('people', { contact: call.contact.id }); else os.launch('people', { add: { number: call.number } }); });
    const grid = el('div.phone-call-grid', speakerB, muteB, keypadB, holdB, addB, contactsB);
    const endB = el('button.phone-call-end.tilt', { onclick: endCall }, el('span', { html: ui.iconSVG(PhoneOff, { size: 24 }) }), 'end call');
    const top = el('div.phone-call-top', el('div.phone-call-app', c.viaDevice || (deviceCalls && os.device.isMobile && !c.incoming) ? 'PHONE · VIA DEVICE' : 'PHONE'), nameEl, sub, status, digits);
    callScreen = el('div.phone-call', bg, top, el('div.phone-call-bottom', keypad, grid, endB));
    callRefs = { status, holdB };
    root.append(callScreen);
    offCallBack = ctx.onBack(() => { if (!keypad.hidden) { keypadB.click(); return true; } minimizeCall(); return true; });
  }
  function minimizeCall() { if (!callScreen) return; callScreen.hidden = true; returnBar.hidden = false; updateCall(); offCallBack?.(); offCallBack = null; }
  function showCall() {
    if (!call || !callScreen) return;
    callScreen.hidden = false; returnBar.hidden = true;
    offCallBack?.();
    offCallBack = ctx.onBack(() => { minimizeCall(); return true; });
  }
  function updateCall() {
    if (!call) return;
    const dur = call.start ? os.util.formatDuration((Date.now() - call.start) / 1000) : '';
    const txt = call.state === 'calling' ? 'calling…' : call.state === 'no answer' ? 'no answer' : call.hold ? `on hold · ${dur}` : dur;
    if (callRefs.status) callRefs.status.textContent = txt;
    returnBar.textContent = `${call.name}  ${txt} — tap to return to call`;
  }

  /* ---------------------------------------------------------------- incoming (simulated) */
  async function simulateIncoming(c) {
    if (call) return;
    if (!c) {
      const pool = contacts.filter((x) => x.phones?.length);
      c = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    const number = c ? c.phones[0].number : '+1 555 01' + String(Math.floor(Math.random() * 90 + 10));
    const ring = os.sounds.play(os.settings.get('ringtone'), { loop: true, volume: 0.25 });
    os.device.vibrate([400, 300, 400, 300, 400]);
    const bg = el('div.phone-call-bg');
    if (c?.photo) bg.style.backgroundImage = `url("${c.photo}")`;
    else if (c) { bg.classList.add('initials'); bg.style.background = hashColor(c.id); bg.append(el('span', initials(nameOf(c)))); }
    let done = false;
    const finish = async (how) => {
      if (done) return; done = true;
      ring?.stop?.();
      clearTimeout(timeout);
      layer.remove(); off();
      if (how === 'answer') startCall(number, { incoming: true, contactId: c?.id });
      else {
        await addHistory({ number, name: nameOf(c), contact: c?.id || null, type: 'missed' });
        missedUnseen++;
        await storage.set('missedUnseen', missedUnseen);
        pushTile();
        if (how === 'text') os.launch('messaging', { to: number, body: 'Sorry, I can’t talk right now.' });
        else if (how === 'timeout') os.notify({ appId: 'phone', title: 'Missed call', body: nameOf(c) || number, args: { history: true } });
      }
    };
    const layer = el('div.phone-call.phone-incoming', bg,
      el('div.phone-call-top', el('div.phone-call-app', 'INCOMING CALL'), el('div.phone-call-name', nameOf(c) || number), el('div.phone-call-sub', c ? `${c.phones[0].type} ${number}` : 'unknown number')),
      el('div.phone-call-bottom',
        el('div.phone-incoming-btns',
          el('button.phone-answer.tilt', { onclick: () => finish('answer') }, el('span', { html: ui.iconSVG(Phone, { size: 22 }) }), 'answer'),
          el('button.phone-ignore.tilt', { onclick: () => finish('ignore') }, 'ignore')),
        el('button.phone-textreply.tilt', { onclick: () => finish('text') }, el('span', { html: ui.iconSVG(MessageSquare, { size: 18 }) }), 'text reply')));
    root.append(layer);
    const off = ctx.onBack(() => { finish('ignore'); return true; });
    const timeout = setTimeout(() => finish('timeout'), 25000);
  }

  /* ---------------------------------------------------------------- main page */
  function mainPage(page) {
    let selectMode = false;
    const selected = new Set();
    let histC, speedC, keypadC;
    let number = '';
    let numEl, matchEl;

    const pv = ui.pivot({
      app: 'PHONE',
      items: [
        { header: 'history', render: (c) => { histC = c; renderHistory(); } },
        { header: 'speed dial', render: (c) => { speedC = c; renderSpeed(); } },
        { header: 'keypad', render: (c) => { keypadC = c; renderKeypad(); } },
      ],
    });
    pv.el.classList.add('phone-pivot');
    const bar = ui.appBar({});
    page.el.append(returnBar, pv.el, bar.el);

    function setBar() {
      if (selectMode) {
        bar.setButtons([{ icon: I.delete, label: 'delete', disabled: !selected.size, onClick: deleteSelected }]);
        bar.setMenu([{ label: 'select all', onClick: () => { history.forEach((h) => selected.add(h.id)); renderHistory(); setBar(); } }]);
        bar.el.classList.remove('minimized');
        return;
      }
      const menu = [
        { label: 'delete all', disabled: !history.length, onClick: deleteAll },
        { label: 'simulate incoming call', onClick: () => simulateIncoming() },
        { label: 'settings', onClick: () => ctx.navigate(settingsPage) },
      ];
      if (pv.index === 0) bar.setButtons([
        { icon: Grid3x3, label: 'keypad', onClick: () => pv.select(2) },
        { icon: I.search, label: 'search', onClick: searchContacts },
        { icon: ListChecks, label: 'select', disabled: !history.length, onClick: () => { selectMode = true; selected.clear(); renderHistory(); setBar(); } },
      ]);
      else if (pv.index === 1) bar.setButtons([
        { icon: I.add, label: 'add', onClick: addSpeedDial },
        { icon: Grid3x3, label: 'keypad', onClick: () => pv.select(2) },
      ]);
      else bar.setButtons([
        { icon: UserPlus, label: 'save', disabled: !number, onClick: () => number && os.launch('people', { add: { number } }) },
        { icon: I.search, label: 'search', onClick: searchContacts },
      ]);
      bar.setMenu(menu);
    }
    function exitSelect() { selectMode = false; selected.clear(); renderHistory(); setBar(); }
    pv.onChange((i) => { if (selectMode) exitSelect(); setBar(); if (i === 0 && isForeground()) clearMissed(); });
    setBar();
    if (ctx.args?.dial || ctx.args?.keypad) pv.select(2);

    async function deleteSelected() {
      if (!selected.size) return;
      history = history.filter((h) => !selected.has(h.id));
      await saveHistory();
      exitSelect();
    }
    async function deleteAll() {
      if (!(await ui.confirm('Delete all call history?', 'delete history', 'delete', 'cancel'))) return;
      history = [];
      await saveHistory();
      clearMissed();
    }
    async function searchContacts() {
      const opts = contacts.filter((c) => c.phones?.length).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((c) => ({ value: c.id, label: nameOf(c) }));
      if (!opts.length) return ui.alert('You don’t have any contacts with phone numbers yet.', 'search');
      const id = await ui.pickFromList({ title: 'call', options: opts });
      const c = contacts.find((x) => x.id === id);
      if (!c) return;
      const n = await chooseNumber(c);
      if (n) startCall(n, { contactId: c.id });
    }

    /* history */
    function grouped() {
      const out = [];
      for (const h of history) {
        const prev = out[out.length - 1];
        const sameDay = prev && new Date(prev.time).toDateString() === new Date(h.time).toDateString();
        if (prev && !selectMode && sameDay && prev.type === h.type && sameNumber(prev.number, h.number)) { prev.count++; prev.ids.push(h.id); continue; }
        out.push({ ...h, count: 1, ids: [h.id] });
      }
      return out;
    }
    function renderHistory() {
      if (!histC) return;
      histC.classList.toggle('phone-selecting', selectMode);
      if (!history.length) {
        histC.replaceChildren(el('div.phone-empty', el('div.wp-empty', 'No calls yet. Your call history will show up here.'), ui.button('open keypad', () => pv.select(2))));
        return;
      }
      const items = grouped();
      histC.replaceChildren(ui.list(items, {
        render: (h) => {
          const c = contactFor(h.number) || null;
          const name = nameOf(c) || h.name || h.number;
          const ic = h.type === 'missed' ? PhoneMissed : h.type === 'incoming' ? PhoneIncoming : PhoneOutgoing;
          const kind = c ? typeFor(c, h.number) || 'phone' : h.number;
          const row = el('div.phone-hrow' + (h.type === 'missed' ? '.missed' : '') + (selected.has(h.id) ? '.sel' : ''),
            el('div.phone-check', { html: ui.iconSVG(I.check, { size: 18, stroke: 3 }) }),
            avatar(c, 52, h.number ? '#' : ''),
            el('div.phone-hrow-text',
              el('div.phone-hrow-name', name + (h.count > 1 ? ` (${h.count})` : '')),
              el('div.phone-hrow-sub', el('span.phone-hrow-ic', { html: ui.iconSVG(ic, { size: 14 }) }), `${kind}, ${os.util.formatRelative(h.time)}${h.duration ? ' · ' + os.util.formatDuration(h.duration) : ''}`)));
          return row;
        },
        onClick: (h, row) => {
          if (selectMode) { selected.has(h.id) ? selected.delete(h.id) : selected.add(h.id); row.querySelector('.phone-hrow')?.classList.toggle('sel', selected.has(h.id)); row.classList.toggle('sel', selected.has(h.id)); setBar(); return; }
          startCall(h.number, { contactId: contactFor(h.number)?.id });
        },
        onHold: (h, row) => {
          if (selectMode) return;
          const c = contactFor(h.number);
          ui.contextMenu(row, [
            { label: 'call', onClick: () => startCall(h.number) },
            { label: 'text', onClick: () => os.launch('messaging', { to: h.number }) },
            c ? { label: 'view contact', onClick: () => os.launch('people', { contact: c.id }) } : { label: 'save to people', onClick: () => os.launch('people', { add: { number: h.number } }) },
            { label: 'copy number', onClick: () => os.device.copy(h.number).then(() => os.toast('Copied')).catch(() => {}) },
            { label: 'delete', onClick: async () => { history = history.filter((x) => !h.ids.includes(x.id)); await saveHistory(); } },
          ]);
        },
      }));
    }

    /* speed dial */
    async function addSpeedDial() {
      const opts = contacts.filter((c) => !c.favorite && c.phones?.length).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((c) => ({ value: c.id, label: nameOf(c) }));
      if (!opts.length) return ui.alert('All your contacts with phone numbers are already on speed dial — add more people first.', 'speed dial');
      const id = await ui.pickFromList({ title: 'add to speed dial', options: opts });
      if (!id) return;
      await setFavorite(id, true);
    }
    async function setFavorite(id, fav) {
      const list = await people.get('contacts', []);
      const c = list.find((x) => x.id === id);
      if (!c) return;
      c.favorite = fav;
      c.updated = Date.now();
      await people.set('contacts', list);
      contacts = list;
      os.tiles.refresh('people');
      refreshAll();
    }
    function renderSpeed() {
      if (!speedC) return;
      const favs = contacts.filter((c) => c.favorite);
      const grid = el('div.phone-speed');
      for (const c of favs) {
        const t = el('div.phone-speed-tile.tilt', { onclick: async () => { const n = await chooseNumber(c); if (n) startCall(n, { contactId: c.id }); } },
          avatar(c, 1), el('div.phone-speed-name', nameOf(c)));
        os.util.onLongPress(t, () => ui.contextMenu(t, [
          { label: 'remove from speed dial', onClick: () => setFavorite(c.id, false) },
          { label: 'text', disabled: !c.phones?.length, onClick: () => os.launch('messaging', { to: c.phones[0].number }) },
          { label: 'view contact', onClick: () => os.launch('people', { contact: c.id }) },
        ]));
        grid.append(t);
      }
      grid.append(el('div.phone-speed-tile.phone-speed-add.tilt', { onclick: addSpeedDial }, el('div', { html: ui.iconSVG(I.add, { size: 36 }) }), el('div.phone-speed-name', 'add')));
      speedC.replaceChildren(...(favs.length ? [] : [el('div.wp-desc', 'Add the people you call most to speed dial. They’re your favorites in People.')]), grid);
    }

    /* keypad */
    function renderKeypad() {
      if (!keypadC) return;
      numEl = el('div.phone-num');
      matchEl = el('div.phone-match.tilt', { onclick: () => { const m = matchEl._c; if (m) { number = m.number; drawNum(); } } });
      const keys = el('div.phone-keys');
      for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']) {
        const b = el('button.phone-key.tilt', {
          onpointerdown: () => tone(DTMF[k], 0.18),
          onclick: () => press(k),
        }, el('span.phone-key-d', k), el('span.phone-key-l', k === '1' ? 'voicemail' : LETTERS[k]));
        if (k === '0') os.util.onLongPress(b, () => { number += '+'; drawNum(); });
        if (k === '1') os.util.onLongPress(b, () => ui.alert('You have no new voicemail.', 'voicemail'));
        keys.append(b);
      }
      const back = el('button.phone-key.phone-key-back.tilt', { onclick: () => { number = number.slice(0, -1); drawNum(); }, 'aria-label': 'backspace', html: ui.iconSVG(Delete, { size: 28 }) });
      os.util.onLongPress(back, () => { number = ''; drawNum(); });
      const callB = el('button.phone-key-call.tilt', { onclick: dial }, el('span', { html: ui.iconSVG(Phone, { size: 22 }) }), 'call');
      keys.append(callB, back);
      keypadC.replaceChildren(el('div.phone-kp', el('div.phone-num-wrap', numEl, matchEl), keys));
      drawNum();
    }
    function press(k) { if (number.length < 32) number += k; drawNum(); }
    function drawNum() {
      if (!numEl) return;
      numEl.textContent = number;
      numEl.classList.toggle('small', number.length > 12);
      let m = null;
      if (normNum(number).length >= 3) {
        const q = normNum(number);
        outer: for (const c of contacts) for (const p of c.phones || []) {
          if (normNum(p.number).includes(q) || sameNumber(p.number, number)) { m = { c, number: p.number }; break outer; }
        }
        if (!m && /^\d+$/.test(q)) {
          for (const c of contacts) if (c.phones?.length && t9of(nameOf(c)).startsWith(q)) { m = { c, number: c.phones[0].number }; break; }
        }
      }
      matchEl._c = m;
      matchEl.textContent = m ? `${nameOf(m.c)} · ${m.number}` : '';
      setBar();
    }
    function dial() {
      if (!normNum(number)) {
        // WP behavior: pressing call with an empty number recalls the last dialed number
        const last = history.find((h) => h.type === 'outgoing');
        if (last) { number = last.number; drawNum(); }
        return;
      }
      const exact = contactFor(number);
      const target = !exact && matchEl?._c && !/^[+\d*#]{7,}$/.test(number) ? matchEl._c : null;
      startCall(target ? target.number : number, { contactId: target?.c.id });
      number = ''; drawNum();
    }
    page.setNumber = (n) => { number = n || ''; pv.select(2); drawNum(); };
    page.showHistory = () => pv.select(0);

    const onKey = (e) => {
      if (!isForeground() || pv.index !== 2 || call || document.activeElement?.matches('input,textarea')) return;
      if (/^[\d*#+]$/.test(e.key)) { tone(DTMF[e.key] || [941, 1336]); press(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { number = number.slice(0, -1); drawNum(); e.preventDefault(); }
      else if (e.key === 'Enter') { dial(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey, true);
    const r = () => { renderHistory(); renderSpeed(); };
    refreshers.add(r);
    if (pv.index === 0 && isForeground()) clearMissed();
    mainRef = page;
    return {
      el: page.el,
      onBack: () => { if (selectMode) { exitSelect(); return true; } return false; },
      onDestroy: () => { window.removeEventListener('keydown', onKey, true); refreshers.delete(r); },
    };
  }
  let mainRef = null;

  /* ---------------------------------------------------------------- settings */
  function settingsPage(page) {
    const p = ui.page({ app: 'PHONE', title: 'settings' });
    p.content.append(
      ui.toggle({ label: 'Use my device to place calls', value: deviceCalls, description: 'On a phone, calls are handed to your device’s real dialer (tel: link). On desktop, calls are always simulated.', onChange: async (v) => { deviceCalls = v; await storage.set('deviceCalls', v); } }),
      ui.listPicker({ label: 'Ringtone', options: os.sounds.ringtones, value: os.settings.get('ringtone'), onChange: (v) => { os.settings.set('ringtone', v); const t = os.sounds.play(v); setTimeout(() => t?.stop?.(), 4000); } }),
      ui.header('voicemail'),
      ui.desc('Voicemail number: 1 (long-press the 1 key).'),
      ui.header('history'),
      ui.button('delete call history', async () => { if (await ui.confirm('Delete all call history?', 'delete history', 'delete', 'cancel')) { history = []; await saveHistory(); clearMissed(); } }),
    );
    page.el.append(p.el);
    return page.el;
  }

  /* ---------------------------------------------------------------- args & lifecycle */
  async function handleArgs(a = {}) {
    if (!a || typeof a !== 'object') return;
    if (a.number || a.call) {
      const n = String(a.number || a.call);
      if (a.dial || a.keypad) { mainRef?.setNumber(n); return; }
      startCall(n, { contactId: a.contact });
      return;
    }
    if (a.contact) {
      const c = contacts.find((x) => x.id === a.contact);
      if (c) { const n = await chooseNumber(c); if (n) startCall(n, { contactId: c.id }); }
      return;
    }
    if (a.incoming) { simulateIncoming(contacts.find((x) => x.id === a.incoming) || null); return; }
    if (a.history) { mainRef?.showHistory(); clearMissed(); }
    if (a.keypad) mainRef?.setNumber('');
  }

  await ctx.navigate(mainPage);
  handleArgs(ctx.args);
  ctx.on('args', (a) => { handleArgs(a); });
  ctx.on('resume', async () => { await reload(); if (mainRef && !call) { /* nothing */ } });
  return {
    onDestroy: () => { if (call) { call.stopTone?.(); call.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); } },
  };
}
