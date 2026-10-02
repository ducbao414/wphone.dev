// Alarms (Windows Phone 8.1): alarm list, add/edit, timer and stopwatch pivots.
import './style.css';
import { Flag, RotateCcw } from 'lucide';
import {
  loadAlarms, loadSnoozed, saveAlarms, upsertAlarm, updateAlarm, deleteAlarm, clearSnooze, store, bus, normalizeAlarm, defaultSound,
  nextOccurrence, nextAlarm, daysLabel, dayLong, weekOrder, fmtTime, fmtTimeStr, untilText, fmtDuration, refreshLockDetail,
} from './shared.js';
import { stopRing, isRinging } from './ring.js';

const SNOOZE_OPTS = [5, 10, 15, 20, 30];
const PRESETS = [1, 3, 5, 10, 15, 30, 45, 60];

export default async function launch(ctx) {
  const { os } = ctx;
  const { el, I } = os.ui;
  const h24 = () => !!os.settings.get('h24');
  const st = store(os);
  const cleanups = [];

  let mainPivot = null;
  let pivotIndex = 0;

  await ctx.navigate(mainPage);
  handleArgs(ctx.args || {});
  ctx.on('args', handleArgs);

  function handleArgs(args) {
    if (!args) return;
    if (args.dismiss) {
      clearSnooze(os, args.dismiss).then((had) => { if (had) os.toast('Snoozed alarm dismissed', 'alarms'); });
      stopRing('alarm:' + args.dismiss, 'dismiss');
    }
    if (args.pivot === 'timer') mainPivot?.select(1);
    else if (args.pivot === 'stopwatch') mainPivot?.select(2);
    else if (args.ring || args.dismiss) mainPivot?.select(0);
    if (args.add || args.new) ctx.navigate(editPage, { alarm: null });
    if (args.edit) loadAlarms(os).then((l) => { const a = l.find((x) => x.id === args.edit); if (a) ctx.navigate(editPage, { alarm: a }); });
  }

  /* =================================================================== main pivot */
  function mainPage(page) {
    let alarmsApi, timerApi, swApi;
    const bar = os.ui.appBar({});
    const pv = os.ui.pivot({
      app: 'ALARMS',
      items: [
        { header: 'alarms', render: (c) => (alarmsApi = renderAlarms(c)) },
        { header: 'timer', render: (c) => (timerApi = renderTimer(c, bar)) },
        { header: 'stopwatch', render: (c) => (swApi = renderStopwatch(c, bar)) },
      ],
      onChange: (i) => {
        pivotIndex = i;
        [alarmsApi, timerApi, swApi].forEach((x, k) => (k === i ? x?.show?.() : x?.hide?.()));
        updateBar();
      },
    });
    mainPivot = pv;
    function updateBar() {
      if (pivotIndex === 0) {
        bar.setButtons([{ icon: I.add, label: 'new', onClick: () => ctx.navigate(editPage, { alarm: null }) }]);
        bar.setMenu([
          { label: 'turn all alarms off', onClick: async () => { const l = await loadAlarms(os); for (const a of l) a.enabled = false; await saveAlarms(os, l); for (const a of l) await clearSnooze(os, a.id); } },
          { label: 'about alarms', onClick: about },
        ]);
      } else if (pivotIndex === 1) timerApi?.syncBar();
      else swApi?.syncBar();
    }
    updateBar();
    page.el.append(pv.el, bar.el);
    const offBus = bus.on((ev) => { if (ev === 'alarms') alarmsApi?.refresh(); if (ev === 'timer') timerApi?.reload(); });
    const onResume = () => { alarmsApi?.refresh(); timerApi?.reload(); swApi?.reload(); };
    ctx.on('resume', onResume);
    ctx.on('suspend', () => { timerApi?.hide(); swApi?.hide(); });
    ctx.on('resume', () => { if (pivotIndex === 1) timerApi?.show(); if (pivotIndex === 2) swApi?.show(); });
    return {
      onShow: () => { alarmsApi?.refresh(); updateBar(); if (pivotIndex === 1) timerApi?.show(); if (pivotIndex === 2) swApi?.show(); },
      onHide: () => { timerApi?.hide(); swApi?.hide(); },
      onDestroy: () => { offBus(); timerApi?.hide(); swApi?.hide(); },
    };
  }

  function about() {
    os.ui.messageBox({
      title: 'about alarms',
      message: 'Alarms ring while this phone is running in a browser tab — even on the lock screen.\n\nBrowsers slow down or pause pages in background tabs and on sleeping devices, so an alarm may ring late (it still rings when you come back, if it was missed by less than 15 minutes). For important wake-ups, keep the tab open and the device plugged in.',
    });
  }

  /* -------------------------------------------------------------- alarms list */
  function renderAlarms(c) {
    const head = el('div.alarms-next');
    const listEl = el('div.alarms-list');
    const note = el('div.alarms-note.tilt', { onclick: about }, 'Alarms ring while this tab is open. Background tabs may ring late.');
    c.append(head, listEl, note);
    let clock = null;

    async function refresh() {
      const [alarms, snoozed] = await Promise.all([loadAlarms(os), loadSnoozed(os)]);
      const now = Date.now();
      alarms.sort((a, b) => a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes));
      const n = nextAlarm(alarms, snoozed, now);
      head.textContent = n ? `next alarm in ${untilText(n.at, now)}` : '';
      head.hidden = !n;
      if (!alarms.length) {
        listEl.replaceChildren(el('div.alarms-empty',
          el('div.alarms-empty-title', 'no alarms'),
          el('div.alarms-empty-sub', 'Tap ', el('b', '+'), ' to set one — or ask Cortana to "wake me up at 7".')));
        return;
      }
      listEl.replaceChildren(...alarms.map((a) => row(a, snoozed.find((s) => s.id === a.id))));
    }

    function row(a, snooze) {
      const t = fmtTime(a.hours, a.minutes, h24());
      const sw = el('div.alarms-switch' + (a.enabled ? '.on' : ''), { role: 'switch', 'aria-checked': String(a.enabled) }, el('div.alarms-switch-track', el('div.alarms-switch-thumb')));
      const sub = [daysLabel(a.days)];
      if (snooze) { const d = new Date(snooze.at); sub.push('snoozed until ' + fmtTimeStr(d.getHours(), d.getMinutes(), h24())); }
      const r = el('div.alarms-item' + (a.enabled ? '' : '.off'),
        el('div.alarms-item-main.tilt', { onclick: () => ctx.navigate(editPage, { alarm: a }) },
          el('div.alarms-item-time', t.time, t.ampm ? el('span.alarms-item-ampm', t.ampm) : null),
          el('div.alarms-item-label', a.label || 'Alarm'),
          el('div.alarms-item-days' + (snooze ? '.accent' : ''), sub.join(' · '))),
        el('div.alarms-item-toggle', {
          onclick: async (e) => {
            e.stopPropagation();
            os.sounds.tap();
            const on = !a.enabled;
            sw.classList.toggle('on', on); r.classList.toggle('off', !on);
            await updateAlarm(os, a.id, { enabled: on });
            if (!on) await clearSnooze(os, a.id);
            else { const nx = nextOccurrence(a); if (nx) os.toast(`Alarm set for ${untilText(+nx)} from now`, 'alarms'); }
          },
        }, sw));
      os.util.onLongPress(r, () => os.ui.contextMenu(r, [
        { label: 'edit', onClick: () => ctx.navigate(editPage, { alarm: a }) },
        { label: a.enabled ? 'turn off' : 'turn on', onClick: async () => { await updateAlarm(os, a.id, { enabled: !a.enabled }); if (a.enabled) await clearSnooze(os, a.id); } },
        snooze ? { label: 'dismiss snooze', onClick: () => clearSnooze(os, a.id) } : null,
        { label: 'delete', onClick: () => deleteAlarm(os, a.id) },
      ]));
      return r;
    }

    refresh();
    clock = setInterval(() => { if (c.isConnected && c.classList.contains('active')) refresh(); }, 30e3);
    cleanups.push(() => clearInterval(clock));
    return { refresh };
  }

  /* -------------------------------------------------------------- timer */
  function renderTimer(c, bar) {
    let tm = { duration: 5 * 60e3, running: false, endAt: null, remaining: null, done: false };
    let raf = 0, visible = false;
    const digits = el('div.alarms-big.tilt', { onclick: () => { if (!tm.running) editDuration(); } });
    const sub = el('div.alarms-big-sub');
    const prog = os.ui.progressBar(0);
    prog.classList.add('alarms-timer-prog');
    const presets = el('div.alarms-presets', PRESETS.map((m) => el('button.alarms-preset.tilt', { onclick: () => setDuration(m * 60e3) }, el('b', String(m >= 60 ? m / 60 : m)), m >= 60 ? 'hour' : 'min')));
    c.append(el('div.alarms-timer', digits, prog, sub, el('div.alarms-section-label', 'quick set'), presets,
      el('div.alarms-hint', 'Tap the time to set any length. The timer keeps running when you leave the app.')));

    const remaining = () => (tm.running ? Math.max(0, tm.endAt - Date.now()) : tm.remaining ?? tm.duration);
    function draw() {
      const r = remaining();
      digits.textContent = fmtDuration(Math.ceil(r / 1000) * 1000);
      digits.classList.toggle('alarms-dim', !tm.running && tm.remaining == null);
      prog.set(tm.duration ? 1 - r / tm.duration : 0);
      sub.textContent = tm.running ? `ends at ${fmtTimeStr(new Date(tm.endAt).getHours(), new Date(tm.endAt).getMinutes(), h24())}`
        : tm.remaining != null ? 'paused' : tm.done ? 'done — tap start to go again' : 'tap the time to change it';
      presets.classList.toggle('alarms-disabled', tm.running);
    }
    function loop() { draw(); if (visible && tm.running) raf = requestAnimationFrame(loop); }
    async function save() { await st.set('timer', tm); }
    async function reload() { tm = { ...tm, ...(await st.get('timer', {})) }; draw(); syncBar(); if (visible && tm.running) { cancelAnimationFrame(raf); loop(); } }
    function setDuration(ms) {
      if (tm.running) return;
      tm = { ...tm, duration: Math.max(1000, ms), remaining: null, done: false };
      save(); draw(); syncBar();
    }
    async function editDuration() {
      const tot = Math.round(tm.duration / 1000);
      const mk = (v, max) => { const i = el('input.wp-textbox.alarms-dur-in', { type: 'number', min: 0, max, inputMode: 'numeric' }); i.value = v; return i; };
      const H = mk(Math.floor(tot / 3600), 23), M = mk(Math.floor((tot % 3600) / 60), 59), S = mk(tot % 60, 59);
      const content = el('div.alarms-dur', el('label', H, el('span', 'hours')), el('label', M, el('span', 'min')), el('label', S, el('span', 'sec')));
      const r = await os.ui.messageBox({ title: 'timer length', content, buttons: ['done', 'cancel'] });
      if (r !== 0) return;
      const ms = ((+H.value || 0) * 3600 + (+M.value || 0) * 60 + (+S.value || 0)) * 1000;
      if (ms > 0) setDuration(Math.min(ms, 24 * 3600e3 - 1000));
    }
    function startPause() {
      if (tm.running) tm = { ...tm, running: false, remaining: Math.max(0, tm.endAt - Date.now()), endAt: null };
      else tm = { ...tm, running: true, endAt: Date.now() + (tm.remaining ?? tm.duration), remaining: null, done: false };
      save(); draw(); syncBar();
      if (tm.running && visible) { cancelAnimationFrame(raf); loop(); }
    }
    function reset() {
      tm = { ...tm, running: false, endAt: null, remaining: null, done: false };
      if (isRinging('timer')) stopRing('timer');
      save(); draw(); syncBar();
    }
    function syncBar() {
      if (pivotIndex !== 1) return;
      bar.setButtons([
        { icon: tm.running ? I.pause : I.play, label: tm.running ? 'pause' : (tm.remaining != null ? 'resume' : 'start'), onClick: startPause },
        { icon: RotateCcw, label: 'reset', onClick: reset, disabled: !tm.running && tm.remaining == null },
      ]);
      bar.setMenu([{ label: 'set length', onClick: editDuration, disabled: tm.running }]);
    }
    reload();
    return {
      reload, syncBar,
      show() { visible = true; cancelAnimationFrame(raf); loop(); },
      hide() { visible = false; cancelAnimationFrame(raf); },
    };
  }

  /* -------------------------------------------------------------- stopwatch */
  function renderStopwatch(c, bar) {
    let sw = { running: false, startAt: 0, base: 0, laps: [] };
    let raf = 0, visible = false;
    const digits = el('div.alarms-big.alarms-sw');
    const lapNow = el('div.alarms-big-sub');
    const laps = el('div.alarms-laps');
    c.append(el('div.alarms-timer', digits, lapNow, laps));
    const elapsed = () => sw.base + (sw.running ? Date.now() - sw.startAt : 0);
    function draw() {
      const e = elapsed();
      digits.textContent = fmtDuration(e, { cs: true });
      const last = sw.laps.length ? sw.laps[sw.laps.length - 1] : 0;
      lapNow.textContent = sw.laps.length ? `lap ${sw.laps.length + 1}  ${fmtDuration(e - last, { cs: true })}` : (e ? '' : 'tap start');
    }
    function drawLaps() {
      if (!sw.laps.length) { laps.replaceChildren(); return; }
      const splits = sw.laps.map((t, i) => t - (i ? sw.laps[i - 1] : 0));
      const best = splits.length > 1 ? Math.min(...splits) : -1, worst = splits.length > 1 ? Math.max(...splits) : -1;
      laps.replaceChildren(
        el('div.alarms-lap.alarms-lap-head', el('span', 'lap'), el('span', 'lap time'), el('span', 'total')),
        ...sw.laps.map((t, i) => el('div.alarms-lap' + (splits[i] === best ? '.best' : splits[i] === worst ? '.worst' : ''),
          el('span', String(i + 1)), el('span', fmtDuration(splits[i], { cs: true })), el('span', fmtDuration(t, { cs: true })))).reverse());
    }
    function loop() { draw(); if (visible && sw.running) raf = requestAnimationFrame(loop); }
    const save = () => st.set('stopwatch', sw);
    async function reload() { sw = { ...sw, ...(await st.get('stopwatch', {})) }; draw(); drawLaps(); syncBar(); if (visible && sw.running) { cancelAnimationFrame(raf); loop(); } }
    function startPause() {
      if (sw.running) sw = { ...sw, running: false, base: elapsed() };
      else sw = { ...sw, running: true, startAt: Date.now() };
      save(); draw(); syncBar();
      if (sw.running && visible) { cancelAnimationFrame(raf); loop(); }
    }
    function lap() { if (!sw.running) return; sw = { ...sw, laps: [...sw.laps, elapsed()] }; save(); drawLaps(); draw(); }
    function reset() { sw = { running: false, startAt: 0, base: 0, laps: [] }; save(); draw(); drawLaps(); syncBar(); }
    function syncBar() {
      if (pivotIndex !== 2) return;
      bar.setButtons([
        { icon: sw.running ? I.pause : I.play, label: sw.running ? 'pause' : (elapsed() ? 'resume' : 'start'), onClick: startPause },
        { icon: Flag, label: 'lap', onClick: lap, disabled: !sw.running },
        { icon: RotateCcw, label: 'reset', onClick: reset, disabled: sw.running || !elapsed() },
      ]);
      bar.setMenu([{ label: 'copy laps', disabled: !sw.laps.length, onClick: async () => {
        const txt = sw.laps.map((t, i) => `Lap ${i + 1}\t${fmtDuration(t - (i ? sw.laps[i - 1] : 0), { cs: true })}\t${fmtDuration(t, { cs: true })}`).join('\n');
        try { await os.device.copy(txt); os.toast('Laps copied', 'alarms'); } catch { os.ui.alert(txt, 'laps'); }
      } }]);
    }
    reload();
    return {
      reload, syncBar,
      show() { visible = true; cancelAnimationFrame(raf); loop(); },
      hide() { visible = false; cancelAnimationFrame(raf); },
    };
  }

  /* =================================================================== edit page */
  function editPage(page) {
    const existing = page.params.alarm;
    const now = new Date();
    const a = normalizeAlarm(existing || { hours: (now.getHours() + 1) % 24, minutes: 0, days: [], label: '', enabled: true, sound: defaultSound(os), snooze: 10 });
    let preview = null;
    const stopPreview = () => { preview?.stop?.(); preview = null; previewBtn.classList.remove('playing'); previewBtn.innerHTML = os.ui.iconSVG(I.play, { size: 20 }); };

    const p = os.ui.page({ app: 'ALARMS', title: existing ? 'edit alarm' : 'new alarm' });
    const name = os.ui.textbox({ label: 'Name', value: a.label, placeholder: 'Alarm' });

    const timeBox = el('div.wp-listpicker.tilt.alarms-timebox');
    const drawTime = () => (timeBox.textContent = fmtTimeStr(a.hours, a.minutes, h24()));
    drawTime();
    timeBox.addEventListener('click', async () => {
      const r = await os.ui.pickTime({ hours: a.hours, minutes: a.minutes, h24: h24() });
      if (r) { a.hours = r.hours; a.minutes = r.minutes; drawTime(); drawUntil(); }
    });

    const daysBox = el('div.wp-listpicker.tilt');
    const drawDays = () => (daysBox.textContent = daysLabel(a.days));
    drawDays();
    daysBox.addEventListener('click', async () => {
      const r = await pickDays(a.days);
      if (r) { a.days = r; drawDays(); drawUntil(); }
    });

    const sounds = os.sounds.ringtones || [];
    const soundPick = os.ui.listPicker({ options: sounds, value: a.sound, title: 'sound', onChange: (v) => { a.sound = v; stopPreview(); togglePreview(); } });
    soundPick.style.flex = '1'; soundPick.style.margin = '0';
    const previewBtn = el('button.alarms-preview.tilt', { 'aria-label': 'preview sound', html: os.ui.iconSVG(I.play, { size: 20 }), onclick: () => togglePreview() });
    function togglePreview() {
      if (preview) return stopPreview();
      preview = os.sounds.play(a.sound, { volume: 0.3 });
      previewBtn.classList.add('playing');
      previewBtn.innerHTML = os.ui.iconSVG(I.pause, { size: 20 });
      const mine = preview;
      preview.then(() => { if (preview === mine) stopPreview(); });
    }

    const snoozePick = os.ui.listPicker({
      label: 'Snooze time', title: 'snooze time', value: a.snooze,
      options: [...new Set([...SNOOZE_OPTS, a.snooze])].sort((x, y) => x - y).map((m) => ({ value: m, label: `${m} minutes` })),
      onChange: (v) => (a.snooze = v),
    });

    const until = el('div.wp-desc.alarms-until');
    function drawUntil() { const nx = nextOccurrence(a); until.textContent = nx ? `rings in ${untilText(+nx)}` : ''; }
    drawUntil();

    p.content.append(
      name,
      el('div.wp-field', el('div.wp-field-label', 'Time'), timeBox),
      until,
      el('div.wp-field', el('div.wp-field-label', 'Repeats'), daysBox),
      el('div.wp-field', el('div.wp-field-label', 'Sound'), el('div.alarms-soundrow', soundPick, previewBtn)),
      snoozePick,
    );

    async function save() {
      stopPreview();
      a.label = name.value.trim();
      a.enabled = true;
      await upsertAlarm(os, a);
      const nx = nextOccurrence(a);
      if (nx) os.toast(`Alarm set for ${untilText(+nx)} from now`, 'alarms');
      ctx.back();
    }
    async function del() {
      stopPreview();
      if (!(await os.ui.confirm(`Delete the alarm "${a.label || fmtTimeStr(a.hours, a.minutes, h24())}"?`, 'delete alarm', 'delete', 'cancel'))) return;
      await deleteAlarm(os, a.id);
      ctx.back();
    }
    const bar = os.ui.appBar({
      buttons: [
        { icon: I.save, label: 'save', onClick: save },
        ...(existing ? [{ icon: I.delete, label: 'delete', onClick: del }] : []),
        { icon: I.close, label: 'cancel', onClick: () => { stopPreview(); ctx.back(); } },
      ],
    });
    page.el.append(p.el, bar.el);
    return { onHide: stopPreview, onDestroy: stopPreview };
  }

  /** Full-screen "repeats on" multi-select. Resolves the day array or null. */
  function pickDays(days) {
    return new Promise((resolve) => {
      const names = dayLong();
      const sel = new Set(days);
      const checks = weekOrder().map((d) => os.ui.checkbox({ label: names[d].toLowerCase(), checked: sel.has(d), onChange: (v) => (v ? sel.add(d) : sel.delete(d)) }));
      const layer = el('div.wp-fullpicker.anim-turnstile-in', el('div.wp-app-title', 'REPEATS ON'), el('div.wp-fullpicker-list.alarms-days', checks));
      const finish = (ok) => { layer.remove(); pop(); resolve(ok ? [...sel].sort() : null); };
      layer.append(os.ui.appBar({ buttons: [{ icon: I.check, label: 'done', onClick: () => finish(true) }, { icon: I.close, label: 'cancel', onClick: () => finish(false) }] }).el);
      document.getElementById('overlay-layer').append(layer);
      const pop = os.ui.pushOverlayBack(() => finish(false));
    });
  }

  refreshLockDetail(os);
  return { onDestroy: () => cleanups.forEach((f) => f()) };
}
