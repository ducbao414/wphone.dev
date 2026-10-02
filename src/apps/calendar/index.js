// Windows Phone 8.1 Calendar: day / week / month / agenda pivot, event details + editor,
// birthdays from People, reminders (background.js), .ics import/export.
import './style.css';
import * as L from './lib.js';

const HH = 56; // px per hour in day view

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I, iconSVG } = os.ui;
  const { onLongPress } = os.util;

  let events = await L.loadEvents(storage);
  let prefs = await L.loadPrefs(storage);
  let contacts = await L.loadBirthdayContacts(os);
  let cursor = L.startOfDay(Date.now());
  let selecting = false;
  const selected = new Set();
  const stack = []; // pages pushed above the main page
  const timers = [];

  await seed();

  /* ------------------------------------------------------------ data helpers */
  function allIn(from, to) {
    const b = prefs.birthdays ? L.birthdayEvents(contacts, from, to) : [];
    return L.inRange([...events, ...b], from, to);
  }
  function findEvent(id) {
    const e = events.find((x) => x.id === id);
    if (e) return e;
    const m = /^bday:(.+):(\d{4})$/.exec(id || '');
    if (m) {
      const y = +m[2];
      return L.birthdayEvents(contacts, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()).find((x) => x.id === id) || null;
    }
    return null;
  }
  async function persist() {
    await L.saveEvents(storage, events);
    L.syncLock(os, storage).catch(() => {});
    os.tiles.refresh('calendar');
    refreshAll();
  }
  async function reload() {
    events = await L.loadEvents(storage);
    prefs = await L.loadPrefs(storage);
    contacts = await L.loadBirthdayContacts(os);
    refreshAll();
    stack.forEach((p) => p.refresh?.());
  }
  async function seed() {
    if (await storage.get('seeded', false)) return;
    await storage.set('seeded', true);
    if (events.length) return;
    const today = L.startOfDay(Date.now());
    const at = (dayOff, h, m = 0) => L.addDays(today, dayOff) + h * L.HOUR + m * L.MIN;
    const lunchDay = Date.now() > at(0, 12, 0) ? 1 : 0;
    events = [
      { id: L.uid(), title: 'Lunch with Mom', start: at(lunchDay, 12, 30), end: at(lunchDay, 13, 30), allDay: false, location: 'Café Lumia', notes: 'Bring the photos from the trip.', reminder: 15, color: null },
      { id: L.uid(), title: 'Team meeting', start: at(lunchDay + 1, 10), end: at(lunchDay + 1, 11), allDay: false, location: 'Conference room 4', notes: '', reminder: 15, color: '#0050ef' },
      { id: L.uid(), title: 'Gym', start: at(2, 18), end: at(2, 19, 30), allDay: false, location: '', notes: 'Leg day', reminder: 30, color: '#60a917' },
      { id: L.uid(), title: 'Weekend trip', start: L.addDays(today, ((6 - new Date(today).getDay() + 7) % 7) || 7), end: L.addDays(today, (((6 - new Date(today).getDay() + 7) % 7) || 7) + 2), allDay: true, location: 'Seattle', notes: '', reminder: null, color: '#fa6800' },
    ].map(L.normalize);
    await L.saveEvents(storage, events);
    L.syncLock(os, storage).catch(() => {});
    os.tiles.refresh('calendar');
  }

  /* ------------------------------------------------------------ page stack helpers */
  async function push(builder, params) {
    const p = await ctx.navigate((page) => {
      const r = builder(page);
      const obj = r instanceof Node ? { el: r } : r || {};
      const prevDestroy = obj.onDestroy;
      obj.onDestroy = () => { prevDestroy?.(); const i = stack.indexOf(page); if (i >= 0) stack.splice(i, 1); };
      page.refresh = obj.refresh;
      stack.push(page);
      return obj;
    }, params);
    return p;
  }
  async function popToRoot() {
    while (stack.length) await stack[stack.length - 1].close();
  }

  /* ------------------------------------------------------------ shared bits */
  const colorOf = (e) => e.color || 'var(--accent)';
  const navHeader = (title, onPrev, onNext, onTitle) => el('div.calendar-nav',
    el('button.calendar-nav-btn.tilt', { 'aria-label': 'previous', onclick: onPrev, html: iconSVG(I.left, { size: 22 }) }),
    el('div.calendar-nav-title.tilt', { onclick: onTitle }, title),
    el('button.calendar-nav-btn.tilt', { 'aria-label': 'next', onclick: onNext, html: iconSVG(I.right, { size: 22 }) }));

  async function chooseDay() {
    const d = await os.ui.pickDate({ date: new Date(cursor) });
    if (d) { cursor = L.startOfDay(d.getTime()); refreshAll(); }
  }

  function eventMenu(e, anchor) {
    if (e.birthday) {
      os.ui.contextMenu(anchor, [
        { label: 'view contact', onClick: () => os.launch('people', { contact: e.contactId }) },
        { label: 'hide birthdays', onClick: async () => { prefs.birthdays = false; await storage.set('prefs', prefs); refreshAll(); } },
      ]);
      return;
    }
    os.ui.contextMenu(anchor, [
      { label: 'edit', onClick: () => push(editPage, { id: e.id }) },
      { label: 'delete', onClick: () => deleteEvents([e.id]) },
      { label: 'duplicate', onClick: () => push(editPage, { draft: { ...e, id: undefined } }) },
      { label: 'share', onClick: () => shareEvent(e) },
    ]);
  }

  function eventRow(e, { day } = {}) {
    let when;
    if (e.allDay) when = 'all day';
    else if (day != null && !L.sameDay(e.start, e.end)) {
      when = e.start < day ? (e.end <= L.addDays(day, 1) ? 'until ' + L.fmtTime(e.end) : 'all day') : L.fmtTime(e.start) + ' →';
    } else when = `${L.fmtTime(e.start)} – ${L.fmtTime(e.end)}`;
    const row = el('div.calendar-ev.tilt' + (e.birthday ? '.bday' : ''),
      el('div.calendar-ev-bar', { style: { background: colorOf(e) } }),
      el('div.calendar-ev-text',
        el('div.calendar-ev-title', e.title || '(no subject)'),
        el('div.calendar-ev-sub', [when, e.location, e.birthday && e.age ? 'turns ' + e.age : ''].filter(Boolean).join(' · '))));
    if (selecting && !e.birthday) {
      row.classList.add('selectable');
      row.classList.toggle('selected', selected.has(e.id));
      row.prepend(el('div.calendar-check', { html: iconSVG(I.check, { size: 16, stroke: 3 }) }));
    }
    row.addEventListener('click', () => {
      if (selecting) {
        if (e.birthday) return;
        selected.has(e.id) ? selected.delete(e.id) : selected.add(e.id);
        row.classList.toggle('selected', selected.has(e.id));
        updateBar();
        return;
      }
      push(detailsPage, { id: e.id });
    });
    onLongPress(row, () => { if (!selecting) eventMenu(e, row); });
    return row;
  }

  function newEventAt(start, allDay = false) {
    const s = start ?? defaultStart(cursor);
    push(editPage, { draft: { start: s, end: allDay ? L.addDays(s, 1) : s + L.HOUR, allDay } });
  }
  function defaultStart(day) {
    const now = Date.now();
    if (L.sameDay(day, now)) { const d = new Date(now); d.setMinutes(0, 0, 0); return d.getTime() + L.HOUR; }
    return day + 9 * L.HOUR;
  }

  /* ------------------------------------------------------------ views */
  let dayScroll = { day: null, top: null };

  function renderDay(c) {
    c.classList.add('calendar-fill');
    const day = cursor, dayEnd = L.addDays(day, 1);
    const evs = allIn(day, dayEnd);
    const allDay = evs.filter((e) => e.allDay || (e.start <= day && e.end >= dayEnd));
    const timed = evs.filter((e) => !allDay.includes(e));
    const isToday = L.sameDay(day, Date.now());

    const title = L.dayLabel(day) === 'today' || L.dayLabel(day) === 'tomorrow' || L.dayLabel(day) === 'yesterday'
      ? `${L.dayLabel(day)}, ${L.fmtDate(day, { month: 'short', day: 'numeric' })}` : L.fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' });
    const nav = navHeader(title, () => shiftDay(-1, 'right'), () => shiftDay(1, 'left'), chooseDay);
    const strip = el('div.calendar-allday', allDay.map((e) => eventRow(e, { day })));

    const grid = el('div.calendar-grid', { style: { height: 24 * HH + 'px' } });
    for (let h = 0; h < 24; h++) {
      grid.append(el('div.calendar-hour', { style: { top: h * HH + 'px', height: HH + 'px' }, onclick: () => newEventAt(day + h * L.HOUR) },
        el('div.calendar-hour-label', L.fmtHour(h))));
    }
    for (const { ev, col, cols } of L.layoutDay(timed)) {
      const s = Math.max(ev.start, day), en = Math.min(Math.max(ev.end, ev.start + 30 * L.MIN), dayEnd);
      const top = ((s - day) / L.HOUR) * HH, h = Math.max(22, ((en - s) / L.HOUR) * HH - 2);
      const b = el('div.calendar-block.tilt', {
        style: { top: top + 'px', height: h + 'px', left: `calc(var(--calendar-gutter) + (100% - var(--calendar-gutter)) * ${col / cols})`, width: `calc((100% - var(--calendar-gutter)) / ${cols} - 3px)`, background: colorOf(ev) },
        onclick: (e) => { e.stopPropagation(); push(detailsPage, { id: ev.id }); },
      }, el('div.calendar-block-title', ev.title || '(no subject)'), h > 40 && ev.location ? el('div.calendar-block-sub', ev.location) : null);
      onLongPress(b, () => eventMenu(ev, b));
      grid.append(b);
    }
    let nowLine = null;
    if (c._nowTimer) { clearInterval(c._nowTimer); c._nowTimer = null; }
    if (isToday) {
      nowLine = el('div.calendar-now');
      const place = () => { nowLine.style.top = ((Date.now() - day) / L.HOUR) * HH + 'px'; };
      place();
      grid.append(nowLine);
      c._nowTimer = setInterval(() => { if (L.sameDay(day, Date.now())) place(); else refreshAll(); }, 60e3);
      timers.push(c._nowTimer);
    }
    const scroller = el('div.calendar-hours.no-swipe', grid);
    swipeable(scroller, (dir) => shiftDay(dir === 'left' ? 1 : -1, dir));
    scroller.addEventListener('scroll', () => { dayScroll = { day, top: scroller.scrollTop }; }, { passive: true });
    const body = el('div.calendar-daybody', strip, scroller);
    c.replaceChildren(nav, body);
    if (c._slide) { body.classList.add('calendar-slide-' + c._slide); c._slide = null; }
    requestAnimationFrame(() => {
      if (dayScroll.day === day && dayScroll.top != null) { scroller.scrollTop = dayScroll.top; return; }
      const first = timed.length ? new Date(Math.max(timed[0].start, day)).getHours() : 8;
      const h = isToday ? Math.min(first, Math.max(0, new Date().getHours() - 1)) : Math.min(first, 8);
      scroller.scrollTop = h * HH;
    });
  }
  function shiftDay(n, dir) {
    cursor = L.addDays(cursor, n);
    const c = pivot.items[0].container;
    c._slide = dir;
    refreshAll();
  }

  function renderWeek(c) {
    const ws = L.startOfWeek(cursor);
    const we = L.addDays(ws, 7);
    const evs = allIn(ws, we);
    const last = L.addDays(ws, 6);
    const title = new Date(ws).getMonth() === new Date(last).getMonth()
      ? `${L.monthName(ws, 'short')} ${new Date(ws).getDate()} – ${new Date(last).getDate()}`
      : `${L.fmtDate(ws, { month: 'short', day: 'numeric' })} – ${L.fmtDate(last, { month: 'short', day: 'numeric' })}`;
    const list = el('div.calendar-week');
    for (let i = 0; i < 7; i++) {
      const d = L.addDays(ws, i), de = L.addDays(d, 1);
      const dayEvs = evs.filter((e) => e.start < de && e.end > d);
      const today = L.sameDay(d, Date.now());
      list.append(el('div.calendar-wday' + (today ? '.today' : '') + (d === cursor ? '.cur' : ''),
        el('div.calendar-wday-head.tilt', { onclick: () => { cursor = d; refreshAll(); pivot.select(0); } },
          el('div.calendar-wday-num', String(new Date(d).getDate())),
          el('div.calendar-wday-name', L.weekday(d, 'short'))),
        el('div.calendar-wday-evs', dayEvs.length ? dayEvs.map((e) => eventRow(e, { day: d }))
          : el('div.calendar-wday-free.tilt', { onclick: () => newEventAt(defaultStart(d)) }, 'free'))));
    }
    c.replaceChildren(navHeader(title, () => { cursor = L.addDays(cursor, -7); refreshAll(); }, () => { cursor = L.addDays(cursor, 7); refreshAll(); }, chooseDay), list);
  }

  function renderMonth(c) {
    const ms = L.startOfMonth(cursor), me = L.addMonths(cursor, 1);
    const gs = L.startOfWeek(ms);
    const weeks = Math.ceil(Math.round((me - gs) / L.DAY) / 7);
    const ge = L.addDays(gs, weeks * 7);
    const evs = allIn(gs, ge);
    const byDay = new Map();
    for (const e of evs) {
      for (let d = Math.max(L.startOfDay(e.start), gs), n = 0; d < Math.min(e.end, ge) && n < 62; d = L.addDays(d, 1), n++) {
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(e);
      }
    }
    const head = el('div.calendar-mgrid.calendar-mhead');
    for (let i = 0; i < 7; i++) head.append(el('div.calendar-mhead-cell', L.weekday(L.addDays(gs, i), 'narrow')));
    const grid = el('div.calendar-mgrid.no-swipe');
    for (let i = 0; i < weeks * 7; i++) {
      const d = L.addDays(gs, i);
      const list = byDay.get(d) || [];
      const inMonth = d >= ms && d < me;
      const cell = el('div.calendar-mcell.tilt' + (inMonth ? '' : '.out') + (L.sameDay(d, Date.now()) ? '.today' : '') + (d === cursor ? '.cur' : ''),
        { onclick: () => { if (d === cursor) { pivot.select(0); return; } cursor = d; refreshAll(); } },
        el('div.calendar-mcell-num', String(new Date(d).getDate())),
        el('div.calendar-mcell-bars', list.slice(0, 3).map((e) => el('i', { style: { background: colorOf(e) } }))));
      grid.append(cell);
    }
    swipeable(grid, (dir) => { shiftMonth(dir === 'left' ? 1 : -1); });
    const dayEvs = (byDay.get(cursor) || []).sort(L.sortEvents);
    const sel = el('div.calendar-mday',
      el('div.calendar-mday-title', L.dayLabel(cursor)),
      dayEvs.length ? dayEvs.map((e) => eventRow(e, { day: cursor })) : el('div.calendar-wday-free.tilt', { onclick: () => newEventAt() }, 'no events · tap to add'));
    const y = new Date(ms).getFullYear() !== new Date().getFullYear() ? ' ' + new Date(ms).getFullYear() : '';
    c.replaceChildren(navHeader(L.monthName(ms) + y, () => shiftMonth(-1), () => shiftMonth(1), chooseDay), head, grid, sel);
  }
  function shiftMonth(n) {
    const d = new Date(cursor);
    const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    cursor = new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)).getTime();
    refreshAll();
  }

  function renderAgenda(c) {
    const from = L.startOfDay(Date.now()), to = L.addDays(from, 365);
    const dayKey = (e) => Math.max(L.startOfDay(e.start), from);
    const evs = allIn(from, to).filter((e) => e.end > Date.now() || e.allDay)
      .sort((a, b) => dayKey(a) - dayKey(b) || (b.allDay - a.allDay) || a.start - b.start);
    if (!evs.length) {
      c.replaceChildren(el('div.calendar-empty',
        el('div.wp-empty', 'no upcoming events'),
        el('div.wp-desc', 'Tap + to add an appointment. Birthdays from People show up here too.'),
        os.ui.button('new event', () => newEventAt(), { icon: I.add })));
      return;
    }
    const out = [];
    let lastDay = null;
    for (const e of evs) {
      const d = Math.max(L.startOfDay(e.start), from);
      if (d !== lastDay) {
        lastDay = d;
        const dd = d;
        out.push(el('div.calendar-agenda-day.tilt', { onclick: () => { cursor = dd; refreshAll(); pivot.select(0); } }, L.dayLabel(d)));
      }
      out.push(eventRow(e, { day: d }));
    }
    c.replaceChildren(...out);
  }

  /** Horizontal swipe on an element (that also scrolls vertically). */
  function swipeable(node, cb) {
    let sx = null, sy = 0, st = 0;
    node.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = Date.now(); });
    node.addEventListener('pointerup', (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - st < 800) cb(dx < 0 ? 'left' : 'right');
    });
    node.addEventListener('pointercancel', () => (sx = null));
  }

  /* ------------------------------------------------------------ main page */
  const VIEWS = [
    { header: 'day', render: renderDay },
    { header: 'week', render: renderWeek },
    { header: 'month', render: renderMonth },
    { header: 'agenda', render: renderAgenda },
  ];
  let pivot, bar;
  function refreshAll() {
    if (!pivot) return;
    pivot.items.forEach((s, i) => { if (s.rendered) VIEWS[i].render(s.container); });
  }
  function updateBar() {
    if (!bar) return;
    if (selecting) {
      bar.setButtons([
        { icon: I.delete, label: 'delete', disabled: !selected.size, onClick: () => deleteEvents([...selected]) },
        { icon: I.close, label: 'cancel', onClick: () => setSelecting(false) },
      ]);
      bar.setMenu([]);
      return;
    }
    const btns = [
      { icon: I.calendar, label: 'today', onClick: () => { cursor = L.startOfDay(Date.now()); dayScroll = { day: null }; refreshAll(); } },
      { icon: I.add, label: 'new', onClick: () => newEventAt() },
    ];
    if (pivot?.index === 3 && events.length) btns.push({ icon: I.check, label: 'select', onClick: () => setSelecting(true) });
    bar.setButtons(btns);
    bar.setMenu([
      { label: 'go to date', onClick: chooseDay },
      { label: 'import from .ics file', onClick: pickImport },
      { label: 'export to .ics file', onClick: () => exportEvents(events, 'Calendar.ics') },
      { label: 'settings', onClick: () => push(settingsPage) },
    ]);
  }
  function setSelecting(v) {
    selecting = v;
    selected.clear();
    updateBar();
    refreshAll();
  }

  await ctx.navigate((page) => {
    const startView = Math.min(3, Math.max(0, prefs.view ?? 0));
    pivot = os.ui.pivot({
      app: 'CALENDAR', index: startView,
      items: VIEWS.map((v) => ({ header: v.header, render: (c) => v.render(c) })),
      onChange: (i, s) => {
        if (selecting) setSelecting(false);
        if (s.rendered && s.container.childElementCount) VIEWS[i].render(s.container);
        updateBar();
        if (prefs.view !== i) { prefs.view = i; storage.set('prefs', prefs); }
      },
    });
    bar = os.ui.appBar({});
    updateBar();
    page.el.append(el('div.calendar-root', pivot.el), bar.el);
    return {
      onShow: () => updateBar(),
      onBack: () => { if (selecting) { setSelecting(false); return true; } return false; },
    };
  });

  /* ------------------------------------------------------------ actions */
  async function deleteEvents(ids) {
    ids = ids.filter((id) => events.some((e) => e.id === id));
    if (!ids.length) return false;
    const one = ids.length === 1 ? events.find((e) => e.id === ids[0]) : null;
    const ok = await os.ui.confirm(one ? `"${one.title || '(no subject)'}" will be deleted.` : `${ids.length} events will be deleted.`, one ? 'delete event?' : 'delete events?', 'delete', 'cancel');
    if (!ok) return false;
    events = events.filter((e) => !ids.includes(e.id));
    if (selecting) { selecting = false; selected.clear(); updateBar(); }
    await persist();
    return true;
  }

  function shareEvent(e) {
    const text = `${e.title || '(no subject)'}\n${L.whenText(e)}${e.location ? '\n' + e.location : ''}${e.notes ? '\n\n' + e.notes : ''}`;
    os.share({ title: e.title, text });
  }

  async function exportEvents(list, name) {
    if (!list.length) { os.ui.alert('There are no events to export.', 'export'); return; }
    try {
      const path = await os.fs.uniquePath('/Documents/' + name.replace(/[\\/:*?"<>|]/g, '_'));
      await os.fs.write(path, L.toICS(list), { mime: 'text/calendar' });
      const r = await os.ui.messageBox({ title: 'exported', message: `${list.length} event${list.length > 1 ? 's' : ''} saved to ${path}`, buttons: ['ok', 'share', 'save to device'] });
      if (r === 1) os.share({ title: name, path });
      if (r === 2) os.fs.download(path);
    } catch (err) { os.ui.alert('Couldn’t export: ' + (err?.message || err), 'export'); }
  }

  async function pickImport() {
    const [path] = await os.pick.file({ accept: '.ics', start: '/Documents', title: 'import calendar' });
    if (path) importFile(path);
  }
  async function importFile(path) {
    let list;
    try { list = L.parseICS(await os.fs.read(path, 'text')); } catch (err) { os.ui.alert('Couldn’t read this file. ' + (err?.message || ''), 'import'); return; }
    const name = os.path.basename(path);
    if (!list.length) { os.ui.alert(`No events were found in ${name}.`, 'import'); return; }
    const preview = list.length === 1 ? `"${list[0].title || '(no subject)'}" ${L.whenText(list[0])}` : `${list.length} events`;
    if (!(await os.ui.confirm(`Add ${preview} from ${name} to your calendar?`, 'import', 'add', 'cancel'))) return;
    const ids = new Map(events.map((e, i) => [e.id, i]));
    for (const e of list) { if (ids.has(e.id)) events[ids.get(e.id)] = e; else events.push(e); }
    cursor = L.startOfDay(list[0].start);
    await persist();
    os.toast(`Imported ${list.length} event${list.length > 1 ? 's' : ''}`, 'calendar');
    if (list.length === 1) push(detailsPage, { id: list[0].id });
  }

  /* ------------------------------------------------------------ details page */
  function detailsPage(page) {
    const p = os.ui.page({ app: 'CALENDAR' });
    const b = os.ui.appBar({});
    const draw = () => {
      const e = findEvent(page.params.id);
      if (!e) { p.content.replaceChildren(os.ui.empty('This event no longer exists.')); b.setButtons([]); b.setMenu([]); return; }
      const rows = [];
      rows.push(el('div.calendar-d-color', { style: { background: colorOf(e) } }));
      rows.push(el('div.calendar-d-title', e.title || '(no subject)'));
      if (e.allDay) {
        const days = Math.round((e.end - e.start) / L.DAY);
        rows.push(el('div.calendar-d-when', L.fmtDate(e.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })));
        rows.push(el('div.calendar-d-sub', days > 1 ? `all day · until ${L.fmtDate(L.addDays(e.end, -1), { weekday: 'long', month: 'long', day: 'numeric' })}` : 'all day'));
      } else {
        rows.push(el('div.calendar-d-when', L.fmtDate(e.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })));
        rows.push(el('div.calendar-d-sub', L.sameDay(e.start, e.end) ? `${L.fmtTime(e.start)} – ${L.fmtTime(e.end)}` : `${L.fmtTime(e.start)} – ${L.fmtDate(e.end, { month: 'short', day: 'numeric' })} ${L.fmtTime(e.end)}`));
      }
      if (e.location) {
        rows.push(el('div.calendar-d-label', 'location'));
        rows.push(el('div.calendar-d-link.tilt', { onclick: () => os.launch('maps', { q: e.location, search: e.location }) },
          el('span', { html: iconSVG(I.location, { size: 20 }) }), el('span', e.location)));
      }
      if (e.birthday) {
        if (e.age) rows.push(el('div.calendar-d-sub', `turns ${e.age}`));
        rows.push(el('div.calendar-d-link.tilt', { onclick: () => os.launch('people', { contact: e.contactId }) },
          el('span', { html: iconSVG(I.user, { size: 20 }) }), el('span', 'view contact')));
        rows.push(el('div.calendar-d-link.tilt', { onclick: () => os.launch('messaging', { to: e.contactId ? (contacts.find((c) => c.id === e.contactId)?.phones?.[0]?.number || '') : '', body: 'Happy birthday! 🎂' }) },
          el('span', { html: iconSVG(I.message, { size: 20 }) }), el('span', 'send a birthday text')));
      } else {
        rows.push(el('div.calendar-d-label', 'reminder'));
        rows.push(el('div.calendar-d-val', e.reminder == null ? 'none' : e.reminder === 0 ? 'at start time' : reminderBefore(e.reminder)));
      }
      if (e.notes && !e.birthday) {
        rows.push(el('div.calendar-d-label', 'notes'));
        rows.push(el('div.calendar-d-notes', e.notes));
      }
      p.content.replaceChildren(...rows);
      if (e.birthday) {
        b.setButtons([{ icon: I.user, label: 'contact', onClick: () => os.launch('people', { contact: e.contactId }) }]);
        b.setMenu([]);
      } else {
        b.setButtons([
          { icon: I.edit, label: 'edit', onClick: () => push(editPage, { id: e.id }) },
          { icon: I.delete, label: 'delete', onClick: async () => { if (await deleteEvents([e.id])) page.close(); } },
          { icon: I.share, label: 'share', onClick: () => shareEvent(e) },
        ]);
        b.setMenu([
          { label: 'duplicate', onClick: () => push(editPage, { draft: { ...e, id: undefined } }) },
          { label: 'export as .ics', onClick: () => exportEvents([e], (e.title || 'event') + '.ics') },
          { label: 'show in day view', onClick: async () => { cursor = L.startOfDay(e.start); dayScroll = { day: null }; await popToRoot(); pivot.select(0); refreshAll(); } },
        ]);
      }
    };
    draw();
    page.el.append(p.el, b.el);
    return { onShow: draw, refresh: draw };
  }
  const reminderBefore = (m) => L.reminderLabel(m) + ' before';

  /* ------------------------------------------------------------ edit page */
  function editPage(page) {
    const existing = page.params.id ? events.find((e) => e.id === page.params.id) : null;
    const d = L.normalize({ title: '', reminder: prefs.defaultReminder, ...(existing || page.params.draft || {}), id: existing?.id || L.uid() });
    if (!existing && page.params.draft && !('reminder' in page.params.draft)) d.reminder = d.allDay ? (prefs.defaultReminder == null ? null : 18 * 60) : prefs.defaultReminder;
    const p = os.ui.page({ app: 'CALENDAR', title: existing ? 'edit event' : 'new event' });

    const subject = os.ui.textbox({ label: 'subject', value: d.title, placeholder: 'what?' });
    const location = os.ui.textbox({ label: 'location', value: d.location, placeholder: 'where?' });
    const notes = os.ui.textbox({ label: 'notes', value: d.notes, multiline: true, rows: 3 });

    const swatches = el('div.calendar-swatches');
    const drawSwatches = () => swatches.replaceChildren(...L.COLORS.map((c) => el('button.calendar-swatch.tilt' + (c === d.color ? '.sel' : ''), {
      style: { background: c || 'var(--accent)' }, 'aria-label': c || 'accent', onclick: () => { d.color = c; drawSwatches(); },
    })));
    drawSwatches();

    const whenBox = el('div.calendar-when');
    const field = (label, text, onClick) => el('div.wp-field.calendar-when-field', el('div.wp-field-label', label), el('div.wp-listpicker.tilt', { onclick: onClick }, text));
    const drawWhen = () => {
      const dateTxt = (t) => L.fmtDate(t, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      if (d.allDay) {
        whenBox.replaceChildren(
          el('div.calendar-when-row', field('starts', dateTxt(d.start), pickStartDate)),
          el('div.calendar-when-row', field('ends', dateTxt(L.addDays(d.end, -1)), pickEndDate)));
      } else {
        whenBox.replaceChildren(
          el('div.calendar-when-row', field('starts', dateTxt(d.start), pickStartDate), field('time', L.fmtTime(d.start), pickStartTime)),
          el('div.calendar-when-row', field('ends', dateTxt(d.end), pickEndDate), field('time', L.fmtTime(d.end), pickEndTime)));
      }
    };
    const timeOfDay = (t) => t - L.startOfDay(t);
    async function pickStartDate() {
      const r = await os.ui.pickDate({ date: new Date(d.start), title: 'START DATE' });
      if (!r) return;
      const dur = d.end - d.start;
      d.start = L.startOfDay(r.getTime()) + (d.allDay ? 0 : timeOfDay(d.start));
      d.end = d.allDay ? L.addDays(d.start, Math.max(1, Math.round(dur / L.DAY))) : d.start + dur;
      drawWhen();
    }
    async function pickStartTime() {
      const s = new Date(d.start);
      const r = await os.ui.pickTime({ hours: s.getHours(), minutes: s.getMinutes(), title: 'START TIME' });
      if (!r) return;
      const dur = d.end - d.start;
      d.start = L.startOfDay(d.start) + r.hours * L.HOUR + r.minutes * L.MIN;
      d.end = d.start + dur;
      drawWhen();
    }
    async function pickEndDate() {
      const r = await os.ui.pickDate({ date: new Date(d.allDay ? L.addDays(d.end, -1) : d.end), title: 'END DATE' });
      if (!r) return;
      if (d.allDay) d.end = Math.max(L.addDays(L.startOfDay(r.getTime()), 1), L.addDays(d.start, 1));
      else {
        d.end = L.startOfDay(r.getTime()) + timeOfDay(d.end);
        if (d.end < d.start) { d.end = d.start + L.HOUR; os.toast('End can’t be before start', 'calendar'); }
      }
      drawWhen();
    }
    async function pickEndTime() {
      const e = new Date(d.end);
      const r = await os.ui.pickTime({ hours: e.getHours(), minutes: e.getMinutes(), title: 'END TIME' });
      if (!r) return;
      let t = L.startOfDay(d.end) + r.hours * L.HOUR + r.minutes * L.MIN;
      if (t < d.start) {
        // picked an earlier time: assume next day if the event was a same-day event
        t = L.sameDay(d.start, d.end) && L.addDays(t, 1) - d.start <= 24 * L.HOUR ? L.addDays(t, 1) : d.start + L.HOUR;
      }
      d.end = t;
      drawWhen();
    }
    const allDay = os.ui.toggle({
      label: 'all day', value: d.allDay,
      onChange: (v) => {
        d.allDay = v;
        if (v) {
          const lastDay = L.startOfDay(Math.max(d.start, d.end - 1));
          d.start = L.startOfDay(d.start);
          d.end = L.addDays(lastDay, 1);
          if (d.reminder != null && d.reminder < 60) d.reminder = 18 * 60;
        } else {
          d.start = defaultStart(L.startOfDay(d.start));
          d.end = d.start + L.HOUR;
          if (d.reminder != null && d.reminder >= 18 * 60) d.reminder = prefs.defaultReminder;
        }
        reminder.value = d.reminder;
        drawWhen();
      },
    });
    const reminderOpts = L.REMINDERS.map((r) => ({ value: r.value, label: r.label }));
    if (!reminderOpts.some((o) => o.value === d.reminder)) reminderOpts.push({ value: d.reminder, label: L.reminderLabel(d.reminder) });
    const reminder = os.ui.listPicker({ label: 'reminder', options: reminderOpts, value: d.reminder, onChange: (v) => (d.reminder = v) });
    drawWhen();

    p.content.append(subject, location, el('div.wp-field-label', 'color'), swatches, allDay.el, whenBox, reminder, notes);

    const save = async () => {
      const ev = L.normalize({ ...d, title: subject.value.trim(), location: location.value.trim(), notes: notes.value.trim() });
      if (!ev.title && !ev.location) ev.title = '(no subject)';
      const i = events.findIndex((e) => e.id === ev.id);
      if (i >= 0) events[i] = ev; else events.push(ev);
      cursor = L.startOfDay(ev.start);
      dayScroll = { day: null };
      await persist();
      // clear "fired" state is keyed by start+reminder, so a re-timed event re-arms automatically
      page.close();
      if (i < 0) os.toast('Event saved', 'calendar');
    };
    const b = os.ui.appBar({
      buttons: [
        { icon: I.save, label: 'save', onClick: save },
        { icon: I.close, label: 'cancel', onClick: () => page.close() },
      ],
      menu: existing ? [{ label: 'delete', onClick: async () => { if (await deleteEvents([existing.id])) await popToRoot(); } }] : [],
    });
    page.el.append(p.el, b.el);
    if (!existing) setTimeout(() => subject.input?.focus(), 400);
    return {};
  }

  /* ------------------------------------------------------------ settings */
  function settingsPage(page) {
    const p = os.ui.page({ app: 'CALENDAR', title: 'settings' });
    const draw = () => {
      p.content.replaceChildren(
        os.ui.toggle({
          label: 'birthdays', value: prefs.birthdays, description: 'Show birthdays of your contacts from People.',
          onChange: async (v) => { prefs.birthdays = v; await storage.set('prefs', prefs); refreshAll(); },
        }).el,
        os.ui.listPicker({
          label: 'default reminder', options: L.REMINDERS.slice(0, 7).map((r) => ({ value: r.value, label: r.label })), value: prefs.defaultReminder,
          onChange: async (v) => { prefs.defaultReminder = v; await storage.set('prefs', prefs); },
        }),
        os.ui.header('lock screen'),
        os.ui.desc('Your next event today is shown on the lock screen (unless another app is using the detailed status).'),
        os.ui.header('your calendar'),
        os.ui.desc(`${events.length} event${events.length === 1 ? '' : 's'} on this phone.`),
        os.ui.button('import .ics', pickImport),
        os.ui.button('export .ics', () => exportEvents(events, 'Calendar.ics')),
        el('br'),
        os.ui.button('delete all events', async () => {
          if (!events.length) return;
          if (!(await os.ui.confirm(`All ${events.length} events will be permanently deleted.`, 'delete all?', 'delete', 'cancel'))) return;
          events = [];
          await persist();
          draw();
        }),
      );
    };
    draw();
    page.el.append(p.el);
    return { refresh: draw, onShow: draw };
  }

  /* ------------------------------------------------------------ launch args & lifecycle */
  async function handleArgs(a = {}) {
    if (!a || typeof a !== 'object') return;
    if (a.file) { await popToRoot(); importFile(a.file); return; }
    if (a.event) {
      await reload();
      const e = findEvent(a.event);
      await popToRoot();
      if (e) { cursor = L.startOfDay(e.start); refreshAll(); push(detailsPage, { id: e.id }); }
      else os.toast('That event no longer exists', 'calendar');
      return;
    }
    if (a.new) {
      await popToRoot();
      const n = { ...a.new };
      if (n.start == null) n.start = defaultStart(cursor);
      if (n.end == null) n.end = n.allDay ? L.addDays(L.startOfDay(n.start), 1) : Number(n.start) + L.HOUR;
      push(editPage, { draft: n });
      return;
    }
    if (a.date != null) {
      await popToRoot();
      cursor = L.startOfDay(Number(a.date) || Date.parse(a.date) || Date.now());
      dayScroll = { day: null };
      pivot.select(0);
      refreshAll();
    }
  }
  ctx.on('args', handleArgs);
  ctx.on('resume', reload);
  handleArgs(ctx.args);

  return {
    onDestroy() { timers.forEach(clearInterval); },
  };
}
