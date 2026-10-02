// Voice Recorder — MediaRecorder + live level waveform. Recordings live in /Music/Recordings.
import './style.css';
import { Mic, Square } from 'lucide';

const DIR = '/Music/Recordings';
const TYPES = [
  ['audio/webm;codecs=opus', 'webm', 'audio/webm'],
  ['audio/webm', 'webm', 'audio/webm'],
  ['audio/mp4', 'm4a', 'audio/mp4'],
  ['audio/ogg;codecs=opus', 'ogg', 'audio/ogg'],
  ['audio/ogg', 'ogg', 'audio/ogg'],
];

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I } = os.ui;
  const { formatDuration } = os.util;
  const offs = [];

  const pickType = () => {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const t of TYPES) if (MediaRecorder.isTypeSupported?.(t[0])) return t;
    return ['', 'webm', ''];
  };
  const stem = (name) => name.replace(/\.[^.]+$/, '');
  const accent = () => getComputedStyle(ctx.root).getPropertyValue('--accent').trim() || '#1BA1E2';

  /* ---------------- playback (local, stops when the app closes) */
  const player = new Audio();
  let playingPath = null;
  let playerUrl = null;
  const stopPlayback = () => { player.pause(); playingPath = null; if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null; } refreshRows(); };
  player.addEventListener('ended', stopPlayback);
  player.addEventListener('timeupdate', () => refreshRows(true));
  player.addEventListener('pause', () => refreshRows());
  player.addEventListener('play', () => refreshRows());
  async function togglePlay(path) {
    if (playingPath === path) { player.paused ? player.play() : player.pause(); return; }
    stopPlayback();
    try {
      playerUrl = URL.createObjectURL(await os.fs.read(path));
      player.src = playerUrl;
      playingPath = path;
      await player.play();
      if (os.media.playing) os.media.pause();
    } catch (e) { os.toast('Can’t play this recording'); stopPlayback(); }
  }

  /* ---------------- list page */
  let rowsEl = null;
  let durations = await storage.get('durations', {});
  const durOf = (m) => durations[m.path] || m.duration || 0;

  function refreshRows(timeOnly) {
    if (!rowsEl) return;
    rowsEl.querySelectorAll('.recorder-row').forEach((r) => {
      const on = r.dataset.path === playingPath;
      r.classList.toggle('playing', on);
      const prog = r.querySelector('.recorder-row-prog');
      const d = Number(r.dataset.dur) || (isFinite(player.duration) ? player.duration : 0);
      if (on) {
        prog.style.width = d ? Math.min(100, (player.currentTime / d) * 100) + '%' : '0';
        r.querySelector('.recorder-row-time').textContent = formatDuration(player.currentTime) + (d ? ' / ' + formatDuration(d) : '');
        if (!timeOnly) r.querySelector('.recorder-row-btn').innerHTML = os.ui.iconSVG(player.paused ? I.play : I.pause, { size: 18, stroke: 2 });
      } else if (!timeOnly) {
        prog.style.width = '0';
        r.querySelector('.recorder-row-time').textContent = d ? formatDuration(d) : '';
        r.querySelector('.recorder-row-btn').innerHTML = os.ui.iconSVG(I.play, { size: 18, stroke: 2 });
      }
    });
  }

  async function renderList() {
    if (!rowsEl) return;
    const files = (await os.fs.list(DIR).catch(() => [])).filter((m) => m.type === 'file' && (m.mime || '').startsWith('audio/')).sort((a, b) => b.created - a.created);
    if (!files.length) {
      rowsEl.replaceChildren(el('div.recorder-empty', el('div.recorder-empty-icon', { html: os.ui.iconSVG(Mic, { size: 64, stroke: 1.2 }) }),
        os.ui.empty('no recordings yet'), os.ui.desc('Tap record to capture a voice memo. Recordings are saved to Music › Recordings.')));
      return;
    }
    rowsEl.replaceChildren(...files.map((m) => {
      const d = durOf(m);
      const btn = el('button.recorder-row-btn', { 'aria-label': 'play', onclick: (e) => { e.stopPropagation(); togglePlay(m.path); } });
      const row = el('div.recorder-row.tilt', { dataset: { path: m.path, dur: d || '' }, onclick: () => togglePlay(m.path) },
        btn,
        el('div.recorder-row-text',
          el('div.recorder-row-title', stem(m.name)),
          el('div.recorder-row-sub', el('span', new Date(m.created).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })), el('span.recorder-row-time'), el('span', os.util.formatBytes(m.size))),
          el('div.recorder-row-track', el('div.recorder-row-prog'))));
      os.util.onLongPress(row, () => os.ui.contextMenu(row, [
        { label: 'rename', onClick: () => rename(m) },
        { label: 'share', onClick: () => os.share({ title: stem(m.name), path: m.path }) },
        { label: 'save to device', onClick: () => os.fs.download(m.path) },
        { label: 'delete', onClick: () => remove(m) },
      ]));
      return row;
    }));
    refreshRows();
  }

  async function rename(m) {
    const ext = os.path.extname(m.name);
    const n = (await os.ui.prompt('New name', stem(m.name), 'rename'))?.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!n || n === stem(m.name)) return;
    const to = os.path.join(DIR, n + (ext ? '.' + ext : ''));
    if (await os.fs.exists(to)) { os.ui.alert(`There's already a recording called "${n}".`, 'rename'); return; }
    if (playingPath === m.path) stopPlayback();
    await os.fs.rename(m.path, n + (ext ? '.' + ext : ''));
    if (durations[m.path]) { durations[to] = durations[m.path]; delete durations[m.path]; storage.set('durations', durations); }
    renderList();
  }
  async function remove(m) {
    if (!(await os.ui.confirm(`Delete "${stem(m.name)}"?`, 'delete', 'delete', 'cancel'))) return;
    if (playingPath === m.path) stopPlayback();
    await os.fs.remove(m.path);
    delete durations[m.path]; storage.set('durations', durations);
    renderList();
  }

  function listPage(page) {
    const pg = os.ui.page({ app: 'VOICE RECORDER', title: 'recordings' });
    rowsEl = el('div.recorder-list');
    pg.content.append(rowsEl);
    const bar = os.ui.appBar({
      buttons: [{ icon: Mic, label: 'record', onClick: () => ctx.navigate(recordPage) }],
      menu: [{ label: 'open folder in files', onClick: () => os.launch('files', { path: DIR }) }],
    });
    page.el.append(pg.el, bar.el);
    renderList();
    return { onShow: renderList, onHide: () => stopPlayback() };
  }

  /* ---------------- record page */
  let session = null; // active recording
  function recordPage(page) {
    stopPlayback();
    const timeEl = el('div.recorder-time', '0:00');
    const msEl = el('span.recorder-time-ms', '.0');
    const stateEl = el('div.recorder-state', 'starting…');
    const canvas = el('canvas.recorder-wave');
    const dot = el('div.recorder-dot');
    const wrap = el('div.recorder-rec',
      el('div.wp-app-title.recorder-apptitle', 'VOICE RECORDER'),
      el('div.recorder-timebox', dot, el('div.recorder-timewrap', timeEl, msEl)), stateEl,
      el('div.recorder-wavebox', canvas));
    const bar = os.ui.appBar({ buttons: [] });
    page.el.append(wrap, bar.el);

    let stream, ac, analyser, rec, raf, chunks = [], type, started = 0, accumulated = 0, paused = false, done = false, levels = [];
    const elapsed = () => (accumulated + (paused || !started ? 0 : performance.now() - started)) / 1000;

    const setButtons = () => bar.setButtons(done ? [] : [
      { icon: paused ? I.mic : I.pause, label: paused ? 'resume' : 'pause', onClick: togglePause, disabled: !rec || typeof rec.pause !== 'function' },
      { icon: Square, label: 'stop', onClick: () => finish(true), disabled: !rec },
      { icon: I.delete, label: 'discard', onClick: discard, disabled: !rec },
    ]);
    setButtons();

    function release() {
      cancelAnimationFrame(raf);
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
      try { ac?.close(); } catch {}
      stream = null; ac = null;
    }

    function draw() {
      raf = requestAnimationFrame(draw);
      const t = elapsed();
      const s = Math.floor(t);
      timeEl.textContent = formatDuration(s);
      msEl.textContent = '.' + Math.floor((t - s) * 10);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (analyser && !paused) {
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        let sum = 0, peak = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
        const rms = Math.sqrt(sum / buf.length);
        levels.push(Math.min(1, rms * 3.2 + peak * 0.3));
      }
      const BAR = 4, GAP = 2, n = Math.floor(w / (BAR + GAP));
      if (levels.length > n * 3) levels = levels.slice(-n * 3);
      const col = accent();
      g.fillStyle = col;
      // Bars scroll in from the right: one bar per 2 frames sampled.
      const samples = [];
      for (let i = levels.length - 1; i >= 0 && samples.length < n; i -= 2) samples.push(Math.max(levels[i], levels[i - 1] || 0));
      for (let k = 0; k < samples.length; k++) {
        const x = w - (k + 1) * (BAR + GAP);
        const bh = Math.max(2, samples[k] * (h - 8));
        g.globalAlpha = paused ? 0.35 : 1 - (k / n) * 0.6;
        g.fillRect(x, (h - bh) / 2, BAR, bh);
      }
      g.globalAlpha = 0.35;
      g.fillRect(0, h / 2 - 0.5, w, 1);
      g.globalAlpha = 1;
    }

    async function start() {
      type = pickType();
      if (!type) { fail('Recording isn’t supported in this browser.'); return; }
      try { stream = await os.device.getMicrophone(); } catch (e) {
        fail(e?.name === 'NotAllowedError' ? 'Voice Recorder needs permission to use your microphone. Allow microphone access in your browser and try again.' : (e?.message || 'No microphone found.'));
        return;
      }
      if (done) { release(); return; }
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaStreamSource(stream);
        analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        ac.resume?.();
      } catch {}
      try { rec = new MediaRecorder(stream, type[0] ? { mimeType: type[0], audioBitsPerSecond: 96000 } : undefined); } catch { rec = new MediaRecorder(stream); }
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.start(1000);
      started = performance.now();
      stateEl.textContent = 'recording';
      wrap.classList.add('live');
      session = { finish };
      setButtons();
      draw();
    }

    function fail(msg) {
      done = true;
      release();
      wrap.classList.remove('live');
      stateEl.textContent = '';
      wrap.querySelector('.recorder-wavebox').replaceChildren(el('div.recorder-error', os.ui.desc(msg), os.ui.button('try again', () => { page.close(); setTimeout(() => ctx.navigate(recordPage), 300); })));
      setButtons();
    }

    function togglePause() {
      if (!rec || done) return;
      if (!paused) { rec.pause(); accumulated += performance.now() - started; paused = true; stateEl.textContent = 'paused'; wrap.classList.remove('live'); }
      else { rec.resume(); started = performance.now(); paused = false; stateEl.textContent = 'recording'; wrap.classList.add('live'); }
      setButtons();
    }

    function stopRecorder() {
      return new Promise((res) => {
        if (!rec || rec.state === 'inactive') return res();
        rec.onstop = () => res();
        try { rec.stop(); } catch { res(); }
      });
    }

    async function finish(goBack) {
      if (done) return;
      done = true;
      session = null;
      const dur = elapsed();
      await stopRecorder();
      release();
      wrap.classList.remove('live');
      setButtons();
      if (!chunks.length || dur < 0.3) { stateEl.textContent = 'nothing recorded'; if (goBack) page.close(); return; }
      const mime = type[2] || chunks[0].type?.split(';')[0] || 'audio/webm';
      const ext = type[2] ? type[1] : mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(chunks, { type: mime });
      chunks = [];
      stateEl.textContent = 'saving…';
      try {
        const existing = await os.fs.list(DIR).catch(() => []);
        let n = 0;
        for (const m of existing) { const r = /^Recording (\d+)\./.exec(m.name); if (r) n = Math.max(n, +r[1]); }
        const path = await os.fs.uniquePath(`${DIR}/Recording ${n + 1}.${ext}`);
        await os.fs.write(path, blob, { mime, meta: { duration: dur } });
        durations[path] = dur;
        await storage.set('durations', durations);
        os.toast(`Saved ${os.path.basename(path)}`);
      } catch (e) {
        os.ui.alert('Couldn’t save the recording: ' + (e?.message || e), 'voice recorder');
      }
      if (goBack) page.close();
    }

    async function discard() {
      if (!rec) return;
      const wasPaused = paused;
      if (!wasPaused) togglePause();
      if (!(await os.ui.confirm('Discard this recording?', 'discard', 'discard', 'keep recording'))) { if (!wasPaused) togglePause(); return; }
      done = true; session = null;
      await stopRecorder();
      chunks = [];
      release();
      page.close();
    }

    start();
    return {
      // Back = stop and save (like the real app).
      onBack: () => { if (!done && rec) { finish(true); return true; } return false; },
      onDestroy: () => { if (!done) { if (rec) finish(false); else { done = true; release(); } } },
    };
  }

  await ctx.navigate(listPage);
  const onFsChange = (e) => { if (e.path?.startsWith(DIR)) renderList(); };
  offs.push(os.fs.on('change', onFsChange));

  return {
    onSuspend: () => { stopPlayback(); session?.finish(true); },
    onDestroy: () => { session?.finish(false); stopPlayback(); offs.forEach((f) => f()); },
  };
}
