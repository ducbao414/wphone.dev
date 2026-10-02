import './style.css';
import { createKit } from './gamekit.js';
import { DIFFICULTIES, createGame, reveal, chord, toggleFlag, neighbors, serialize, deserialize } from './logic.js';

const ACHIEVEMENTS = [
  { id: 'first_win', title: 'Sweeper', description: 'Win your first game', gamerscore: 10 },
  { id: 'beginner', title: 'Basic Training', description: 'Win a game on beginner', gamerscore: 10 },
  { id: 'intermediate', title: 'Field Agent', description: 'Win a game on intermediate', gamerscore: 20 },
  { id: 'expert', title: 'Mine Master', description: 'Win a game on expert', gamerscore: 50 },
  { id: 'speed', title: 'Speed Demon', description: 'Win beginner in under 30 seconds', gamerscore: 30 },
  { id: 'noflag', title: 'No Flags Needed', description: 'Win intermediate or expert without placing a flag', gamerscore: 30 },
  { id: 'streak', title: 'On a Roll', description: 'Win 5 games in a row', gamerscore: 20 },
  { id: 'veteran', title: 'Veteran Sweeper', description: 'Play 25 games', gamerscore: 15 },
];
const CELL = 36, GAP = 2, PAD = 6;
const DIFF_KEYS = ['beginner', 'intermediate', 'expert'];

export default async function launch(ctx) {
  const { os, storage, root } = ctx;
  const { el, I } = os.ui;
  const kit = createKit(ctx, { game: 'minesweeper', name: 'Minesweeper', achievements: ACHIEVEMENTS });
  root.classList.add('ms-app');

  const statDefaults = () => ({ byDiff: Object.fromEntries(DIFF_KEYS.map((k) => [k, { played: 0, won: 0, bestTime: 0, streak: 0, bestStreak: 0 }])), streak: 0 });
  const getStats = async () => {
    const s = await kit.getStats(statDefaults());
    for (const k of DIFF_KEYS) s.byDiff[k] = { played: 0, won: 0, bestTime: 0, streak: 0, bestStreak: 0, ...(s.byDiff[k] || {}) };
    return s;
  };

  let game = null; // active game controller (for suspend/destroy)
  const offs = [];
  offs.push(ctx.on('suspend', () => game?.suspend()));
  offs.push(ctx.on('resume', () => game?.resumeApp()));

  ctx.navigate(menuPage);

  /* ------------------------------------------------------------ menu */
  function menuPage() {
    const p = os.ui.page({ app: 'MINESWEEPER', title: 'minesweeper', cls: 'ms-menu' });
    const hero = el('div.ms-hero', ['1', '2', 'f', '3', 'c', 'm', '1', 'c'].map((t, i) =>
      el('div.ms-cell' + ({ c: '', f: '.flag', m: '.open.mine' }[t] ?? `.open.n${t}`), { style: { animationDelay: i * 60 + 'ms' } }, /\d/.test(t) ? t : '')));
    const body = el('div');
    p.content.append(hero, body);
    const render = async () => {
      body.replaceChildren();
      const [stats, saved] = await Promise.all([getStats(), storage.get('current', null)]);
      const items = [];
      if (saved && saved.game && saved.game.status !== 'won' && saved.game.status !== 'lost') {
        items.push({ label: 'continue', accent: true, sub: `${saved.diff} · ${kit.formatTime(saved.elapsed / 1000)} elapsed`, onClick: () => ctx.navigate(gamePage, { diff: saved.diff, saved }) });
      }
      if (items.length) kit.menu(body, { items });
      body.append(os.ui.header('new game'));
      kit.menu(body, { items: (DIFF_KEYS.map((k) => {
        const d = DIFFICULTIES[k], st = stats.byDiff[k];
        const dims = k === 'expert' ? '30×16 (portrait 16×30)' : `${d.w}×${d.h}`;
        return { label: d.label, sub: `${dims}, ${d.mines} mines${st.bestTime ? ' · best ' + kit.formatTime(st.bestTime) : ''}`, onClick: () => newGame(k) };
      })) });
      body.append(os.ui.header('more'));
      kit.menu(body, { items: [
        { label: 'statistics', sub: `${stats.played} played · ${stats.won} won`, onClick: () => ctx.navigate(statsPage) },
        { label: 'how to play', onClick: () => ctx.navigate(helpPage) },
        { label: 'achievements', sub: 'view in Games', onClick: () => os.apps.get('games') ? os.launch('games', { section: 'achievements', game: 'minesweeper' }) : os.toast('Games hub not available') },
      ] });
    };
    const newGame = async (k) => {
      const saved = await storage.get('current', null);
      if (saved && saved.game?.generated && saved.game.status === 'playing') {
        if (!(await os.ui.confirm('Starting a new game will forfeit the game in progress.', 'new game?', 'start', 'cancel'))) return;
        await recordLoss(saved.diff);
        await storage.del('current');
      }
      ctx.navigate(gamePage, { diff: k });
    };
    render();
    return { el: p.el, onShow: render };
  }

  async function recordLoss(diff) {
    await kit.updateStats((s) => {
      s.played++; s.byDiff[diff].played++; s.byDiff[diff].streak = 0; s.streak = 0;
    }, statDefaults());
  }

  /* ------------------------------------------------------------ stats / help */
  function statsPage() {
    const p = os.ui.page({ app: 'MINESWEEPER', title: 'statistics' });
    const render = async () => {
      const s = await getStats();
      p.content.replaceChildren();
      for (const k of DIFF_KEYS) {
        const d = s.byDiff[k];
        p.content.append(os.ui.header(k), el('div.ms-stats',
          ...[['games played', d.played], ['games won', d.won], ['win rate', d.played ? Math.round((d.won / d.played) * 100) + '%' : '–'],
            ['best time', d.bestTime ? kit.formatTime(d.bestTime) : '–'], ['current streak', d.streak], ['longest streak', d.bestStreak]]
            .map(([a, b]) => el('div.ms-stat', el('span', a), el('b', String(b))))));
      }
    };
    render();
    const bar = os.ui.appBar({ minimized: true, menu: [{ label: 'reset statistics', onClick: async () => {
      if (await os.ui.confirm('Reset all Minesweeper statistics?', 'reset', 'reset', 'cancel')) { await storage.set('stats', statDefaults()); render(); }
    } }] });
    p.el.append(bar.el);
    return p.el;
  }

  function helpPage() {
    const p = os.ui.page({ app: 'MINESWEEPER', title: 'how to play' });
    const lines = [
      ['goal', 'Uncover every square that doesn’t hide a mine. The first square you tap is always safe.'],
      ['numbers', 'A number tells you how many mines touch that square (including diagonals).'],
      ['flags', 'Tap and hold a square to plant a flag, or switch the bottom toggle to flag mode so a tap flags. On desktop, right-click flags.'],
      ['chording', 'Tap an uncovered number that already has the right number of flags around it to uncover all of its other neighbours at once.'],
      ['big boards', 'Pinch to zoom and drag to pan. On desktop, scroll to pan and Ctrl+scroll to zoom. Arrow keys move a cursor, Space/Enter reveals, F flags.'],
      ['pause', 'Press Back during a game to pause. Unfinished games can be continued from the menu.'],
    ];
    for (const [h, t] of lines) p.content.append(os.ui.header(h), el('p.ms-help', t));
    return p.el;
  }

  /* ------------------------------------------------------------ game */
  function gamePage(page) {
    const { diff } = page.params;
    const D = DIFFICULTIES[diff];
    let g, elapsed = 0, startedAt = 0, running = false, flagMode = false, flagsPlaced = 0, over = false, userZoom = false, busy = false;
    let cursor = -1, tickT = 0, saveT = 0, shown = false;

    if (page.params.saved) {
      g = deserialize(page.params.saved.game);
      elapsed = page.params.saved.elapsed || 0;
      flagsPlaced = page.params.saved.flagsPlaced || 0;
    } else g = createGame(D.w, D.h, D.mines);

    // ---- DOM
    const mineCount = el('span.ms-hud-num');
    const timeEl = el('span.ms-hud-num');
    const hud = el('div.ms-hud',
      el('div.ms-hud-item', el('span.ms-hud-ico.ms-ico-mine'), mineCount),
      el('div.ms-hud-title', D.label),
      el('div.ms-hud-item.right', timeEl, el('span.ms-hud-ico', { html: os.ui.iconSVG(I.clock, { size: 20 }) })));
    const board = el('div.ms-board', { style: { gridTemplateColumns: `repeat(${g.w}, ${CELL}px)`, gridAutoRows: CELL + 'px', gap: GAP + 'px', padding: PAD + 'px' } });
    const cells = g.cells.map((_, i) => el('div.ms-cell', { dataset: { i } }));
    board.append(...cells);
    const view = el('div.ms-view', board);
    const modeBtn = el('button.ms-mode', { 'aria-label': 'toggle flag mode', onclick: () => setMode(!flagMode) },
      el('span.ms-mode-opt.dig', el('span.ms-ico-shovel'), 'dig'), el('span.ms-mode-opt.flg', el('span.ms-ico-flag'), 'flag'));
    const tool = el('div.ms-tools',
      el('button.ms-tool.tilt', { 'aria-label': 'new game', onclick: () => restart(true) }, el('span', { html: os.ui.iconSVG(I.refresh, { size: 22 }) }), el('small', 'new')),
      modeBtn,
      el('button.ms-tool.tilt', { 'aria-label': 'fit board', onclick: () => { userZoom = false; fit(true); } }, el('span', { html: os.ui.iconSVG(I.minimize, { size: 22 }) }), el('small', 'fit')));
    const wrap = el('div.ms-game', hud, view, tool);

    // ---- render
    const render = (popped = [], origin = -1) => {
      const ox = origin % g.w, oy = (origin / g.w) | 0;
      const popSet = new Set(popped);
      g.cells.forEach((c, i) => {
        let cls = 'ms-cell';
        if (c.open) cls += c.mine ? ' open mine' : ' open n' + c.n;
        else if (c.flag) cls += ' flag';
        if (over && g.status === 'lost' && c.flag && !c.mine) cls += ' wrong';
        if (i === g.exploded) cls += ' boom';
        if (i === cursor) cls += ' cursor';
        const n = cells[i];
        if (popSet.has(i)) {
          cls += ' pop';
          const dist = Math.hypot(i % g.w - ox, ((i / g.w) | 0) - oy);
          n.style.animationDelay = Math.min(dist * 18, 500) + 'ms';
        }
        if (n.className !== cls) n.className = cls;
        const txt = c.open && !c.mine && c.n ? String(c.n) : '';
        if (n.textContent !== txt) n.textContent = txt;
      });
      mineCount.textContent = String(g.mines - g.flags);
      updateTime();
    };
    const curElapsed = () => elapsed + (running ? performance.now() - startedAt : 0);
    const updateTime = () => { timeEl.textContent = kit.formatTime(curElapsed() / 1000); };
    const startClock = () => { if (running || over || !g.generated) return; running = true; startedAt = performance.now(); clearInterval(tickT); tickT = setInterval(updateTime, 250); };
    const stopClock = () => { if (!running) return; elapsed += performance.now() - startedAt; running = false; clearInterval(tickT); updateTime(); };
    const setMode = (f) => { flagMode = f; modeBtn.classList.toggle('flagging', f); os.sounds.tap?.(); };

    const save = () => {
      clearTimeout(saveT);
      saveT = setTimeout(() => {
        if (over || !g.generated) return;
        storage.set('current', { diff, game: serialize(g), elapsed: curElapsed(), flagsPlaced });
      }, 300);
    };

    // ---- actions
    const act = (i, kind) => {
      if (over || busy || i < 0) return;
      const c = g.cells[i];
      let opened = [];
      if (kind === 'flag') {
        if (c.open) { opened = chord(g, i); }
        else if (toggleFlag(g, i)) {
          if (c.flag) flagsPlaced++;
          kit.tone(c.flag ? [880, 1320] : [660], 0.05, 'triangle', 0.05);
          os.device.vibrate?.(15);
        }
      } else if (c.open) opened = chord(g, i);
      else if (c.flag) return;
      else {
        const first = !g.generated;
        opened = reveal(g, i);
        if (first && g.generated) startClock();
      }
      if (opened.length && g.status !== 'lost') kit.tone(opened.length > 6 ? [520, 780, 1040] : [700], 0.04, 'triangle', 0.045);
      render(opened, i);
      if (g.status === 'won') return onWin();
      if (g.status === 'lost') return onLose();
      save();
    };

    async function onWin() {
      over = true; stopClock(); storage.del('current');
      const secs = Math.max(1, Math.round(curElapsed() / 1000));
      render();
      // win cascade
      busy = true;
      kit.tone([523, 659, 784, 1047, 1319], 0.11, 'triangle', 0.07);
      cells.forEach((n, i) => { n.style.animationDelay = ((i % g.w) + ((i / g.w) | 0)) * 22 + 'ms'; n.classList.add('win'); });
      view.classList.add('won');
      const st = await kit.updateStats((s) => {
        const d = s.byDiff[diff];
        s.played++; s.won++; d.played++; d.won++;
        d.streak++; d.bestStreak = Math.max(d.bestStreak, d.streak); s.streak = (s.streak || 0) + 1;
        s.best = Math.max(s.best || 0, s.streak);
        d.newBest = !d.bestTime || secs < d.bestTime;
        if (d.newBest) d.bestTime = secs;
        s.bestTime = s.bestTime ? Math.min(s.bestTime, secs) : secs;
      }, statDefaults());
      const d = st.byDiff[diff];
      kit.unlock('first_win'); kit.unlock(diff);
      if (diff === 'beginner' && secs < 30) kit.unlock('speed');
      if (diff !== 'beginner' && flagsPlaced === 0) kit.unlock('noflag');
      if (st.streak >= 5) kit.unlock('streak');
      if (st.played >= 25) kit.unlock('veteran');
      await os.ui.sleep(Math.min(1800, (g.w + g.h) * 22 + 700));
      busy = false;
      if (!shown) return;
      const msg = `time  ${kit.formatTime(secs)}${d.newBest ? '  ·  new best!' : `\nbest  ${kit.formatTime(d.bestTime)}`}\nwin streak  ${d.streak}`;
      const r = await os.ui.messageBox({ title: 'you win!', message: msg, buttons: ['play again', 'menu'] });
      if (r === 0) restart(false); else if (r === 1) page.close();
    }

    async function onLose() {
      over = true; stopClock(); storage.del('current');
      busy = true;
      kit.tone([180, 120, 80, 60], 0.09, 'sawtooth', 0.09);
      os.device.vibrate?.([60, 40, 120]);
      view.classList.remove('shake'); void view.offsetWidth; view.classList.add('shake');
      render();
      const st = await kit.updateStats((s) => {
        s.played++; s.byDiff[diff].played++; s.byDiff[diff].streak = 0; s.streak = 0;
      }, statDefaults());
      if (st.played >= 25) kit.unlock('veteran');
      const ex = g.exploded, ex0 = ex % g.w, ey = (ex / g.w) | 0;
      const mines = g.cells.map((c, i) => i).filter((i) => g.cells[i].mine && i !== ex && !g.cells[i].flag)
        .sort((a, b) => Math.hypot(a % g.w - ex0, ((a / g.w) | 0) - ey) - Math.hypot(b % g.w - ex0, ((b / g.w) | 0) - ey));
      const step = Math.max(12, Math.min(70, 1400 / Math.max(1, mines.length)));
      for (let k = 0; k < mines.length; k++) {
        if (!shown && !root.isConnected) break;
        const i = mines[k];
        g.cells[i].open = true;
        cells[i].className = 'ms-cell open mine reveal';
        if (k % 3 === 0) kit.tone([140 + Math.random() * 80], 0.06, 'sawtooth', 0.03);
        await os.ui.sleep(step);
      }
      render();
      await os.ui.sleep(500);
      busy = false;
      if (!shown) return;
      const r = await os.ui.messageBox({ title: 'game over', message: `You hit a mine after ${kit.formatTime(curElapsed() / 1000)}.\nBetter luck next time.`, buttons: ['try again', 'menu'] });
      if (r === 0) restart(false); else if (r === 1) page.close();
    }

    async function restart(ask) {
      if (busy) return;
      if (ask && g.generated && !over) {
        stopClock();
        if (!(await os.ui.confirm('Abandon this game and start a new one? It will count as a loss.', 'new game?', 'new game', 'cancel'))) { startClock(); return; }
        await recordLoss(diff);
      }
      stopClock();
      storage.del('current');
      g = createGame(D.w, D.h, D.mines);
      elapsed = 0; over = false; flagsPlaced = 0; cursor = cursor >= 0 ? 0 : -1;
      view.classList.remove('won', 'shake');
      cells.forEach((n) => { n.style.animationDelay = ''; });
      render();
      userZoom = false; fit(true);
    }

    // ---- zoom / pan
    let s = 1, tx = 0, ty = 0;
    const bw = () => g.w * CELL + (g.w - 1) * GAP + PAD * 2;
    const bh = () => g.h * CELL + (g.h - 1) * GAP + PAD * 2;
    const limits = () => {
      const vw = view.clientWidth, vh = view.clientHeight;
      const fitAll = Math.min(vw / bw(), vh / bh());
      return { min: Math.min(fitAll, 1), max: Math.max(2.2, fitAll), fitAll, fitW: vw / bw(), vw, vh };
    };
    const apply = (anim) => {
      const L = limits();
      s = Math.min(L.max, Math.max(L.min, s));
      const W = bw() * s, H = bh() * s;
      tx = W <= L.vw ? (L.vw - W) / 2 : Math.min(0, Math.max(L.vw - W, tx));
      ty = H <= L.vh ? (L.vh - H) / 2 : Math.min(0, Math.max(L.vh - H, ty));
      board.classList.toggle('anim', !!anim);
      board.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    };
    const fit = (anim) => {
      const L = limits();
      if (!L.vw) return;
      // small boards: fit all; large: fit width (pan vertically) unless cells get tiny
      s = L.fitAll * CELL >= 26 ? L.fitAll : Math.max(L.fitAll, Math.min(L.fitW, 1.6));
      tx = 0; ty = 0;
      apply(anim);
    };
    const zoomAt = (ns, px, py) => {
      const L = limits();
      ns = Math.min(L.max, Math.max(L.min, ns));
      const bx = (px - tx) / s, by = (py - ty) / s;
      s = ns; tx = px - bx * s; ty = py - by * s;
      userZoom = true;
      apply();
    };

    // ---- pointer handling: tap / long-press flag / pan / pinch
    const pts = new Map();
    let gesture = null; // { kind: 'tap'|'pan'|'pinch', ... }
    let lpT = 0;
    const local = (e) => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const cellAt = (e) => { const n = e.target.closest?.('.ms-cell'); return n && board.contains(n) ? Number(n.dataset.i) : -1; };
    view.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { e.preventDefault(); act(cellAt(e), 'flag'); return; }
      if (e.button === 1) { e.preventDefault(); const i = cellAt(e); if (i >= 0 && g.cells[i].open) act(i, 'dig'); return; }
      view.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, local(e));
      clearTimeout(lpT);
      if (pts.size === 1) {
        const i = cellAt(e), p = local(e);
        gesture = { kind: 'tap', i, sx: p.x, sy: p.y, tx0: tx, ty0: ty };
        if (i >= 0) cells[i].classList.add('press');
        if (i >= 0 && !over) lpT = setTimeout(() => {
          if (gesture?.kind !== 'tap') return;
          cells[i].classList.remove('press');
          gesture = { kind: 'done' };
          act(i, flagMode ? 'dig' : 'flag');
        }, 380);
      } else if (pts.size === 2) {
        clearPress();
        const [a, b] = [...pts.values()];
        gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx0: tx, ty0: ty };
      }
    });
    const clearPress = () => board.querySelectorAll('.press').forEach((n) => n.classList.remove('press'));
    view.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (!gesture) return;
      if (gesture.kind === 'tap' && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > 9) {
        clearTimeout(lpT); clearPress();
        gesture = { ...gesture, kind: 'pan' };
      }
      if (gesture.kind === 'pan') {
        tx = gesture.tx0 + p.x - gesture.sx; ty = gesture.ty0 + p.y - gesture.sy;
        apply();
      } else if (gesture.kind === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const L = limits();
        const ns = Math.min(L.max, Math.max(L.min, gesture.s0 * d / gesture.d0));
        const bx = (gesture.mx - gesture.tx0) / gesture.s0, by = (gesture.my - gesture.ty0) / gesture.s0;
        s = ns; tx = mx - bx * s; ty = my - by * s; userZoom = true;
        apply();
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      clearTimeout(lpT); clearPress();
      if (gesture?.kind === 'tap' && e.type === 'pointerup' && gesture.i >= 0) act(gesture.i, flagMode ? 'flag' : 'dig');
      if (gesture?.kind === 'pinch' && pts.size === 1) {
        const [q] = [...pts.values()];
        gesture = { kind: 'pan', sx: q.x, sy: q.y, tx0: tx, ty0: ty };
      } else if (!pts.size) gesture = null;
    };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) zoomAt(s * Math.exp(-e.deltaY * 0.01), p.x, p.y);
      else { tx -= e.deltaX; ty -= e.deltaY; apply(); }
    }, { passive: false });
    const ro = new ResizeObserver(() => (userZoom ? apply() : fit()));
    ro.observe(view);

    // ---- keyboard
    const onKey = (e) => {
      if (!shown || !kit.isActive() || busy) return;
      if (document.querySelector('#overlay-layer > *')) return; // dialog open
      const k = e.key;
      const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (move) {
        e.preventDefault(); e.stopPropagation();
        if (cursor < 0) cursor = Math.floor(g.h / 2) * g.w + Math.floor(g.w / 2);
        else {
          const x = Math.min(g.w - 1, Math.max(0, cursor % g.w + move[0])), y = Math.min(g.h - 1, Math.max(0, ((cursor / g.w) | 0) + move[1]));
          cursor = y * g.w + x;
        }
        render(); ensureVisible(cursor);
      } else if ((k === ' ' || k === 'Enter') && cursor >= 0) { e.preventDefault(); e.stopPropagation(); act(cursor, 'dig'); }
      else if ((k === 'f' || k === 'F') && cursor >= 0) { e.preventDefault(); act(cursor, 'flag'); }
      else if (k === 'n' || k === 'N') { e.preventDefault(); restart(true); }
      else if (k === 'm' || k === 'M') { e.preventDefault(); setMode(!flagMode); }
    };
    const ensureVisible = (i) => {
      const L = limits();
      const cx = (PAD + (i % g.w) * (CELL + GAP)) * s + tx, cy = (PAD + ((i / g.w) | 0) * (CELL + GAP)) * s + ty, cs = CELL * s;
      if (cx < 0) tx -= cx - 8; else if (cx + cs > L.vw) tx -= cx + cs - L.vw + 8;
      if (cy < 0) ty -= cy - 8; else if (cy + cs > L.vh) ty -= cy + cs - L.vh + 8;
      apply(true);
    };
    window.addEventListener('keydown', onKey, true);

    // ---- pause
    let pausing = false;
    async function pause() {
      if (pausing) return;
      pausing = true;
      stopClock(); save();
      wrap.classList.add('paused');
      const r = await kit.pauseDialog({ restart: true, message: `${D.label} · ${kit.formatTime(curElapsed() / 1000)}` });
      wrap.classList.remove('paused');
      pausing = false;
      if (r === 'resume') startClock();
      else if (r === 'restart') restart(true);
      else { flushSave(); page.close(); }
    }
    const flushSave = () => {
      clearTimeout(saveT);
      if (!over && g.generated) storage.set('current', { diff, game: serialize(g), elapsed: curElapsed(), flagsPlaced });
    };

    const ctl = {
      suspend() { if (!shown) return; stopClock(); flushSave(); },
      resumeApp() { if (shown && g.generated && !over && !busy) pause(); },
    };
    game = ctl;

    render();

    return {
      el: wrap,
      onShow() { shown = true; game = ctl; requestAnimationFrame(() => (userZoom ? apply() : fit())); if (g.generated && !over && !pausing) startClock(); },
      onHide() { shown = false; stopClock(); },
      onBack() {
        if (busy) return true;
        if (g.generated && !over) { pause(); return true; }
        return false;
      },
      onDestroy() {
        shown = false; stopClock(); flushSave();
        clearTimeout(lpT); ro.disconnect();
        window.removeEventListener('keydown', onKey, true);
        if (game === ctl) game = null;
      },
    };
  }

  return {
    onDestroy() {
      game?.suspend();
      offs.forEach((f) => typeof f === 'function' && f());
    },
  };
}
