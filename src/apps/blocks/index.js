// Blocks — falling-block puzzle (Tetris-like) for the WP simulator.
import './style.css';
import { Game, W, H, HIDDEN, ROT, CLEAR_MS, LOCK_DELAY } from './logic.js';
import { createKit } from './gamekit.js';
import { Pause, RotateCw, ArrowLeft, ArrowRight, ArrowDown, ArrowDownToLine, Archive } from 'lucide';

const COLORS = { I: '#1BA1E2', O: '#F0A30A', T: '#A200FF', S: '#60A917', Z: '#E51400', J: '#0050EF', L: '#FA6800' };
const GAME_COLOR = '#7A2FB0';
const DAS = 160, ARR = 45;

const ACH = [
  { id: 'first_line', title: 'Line Up', description: 'Clear your first line.', gamerscore: 5 },
  { id: 'quad', title: 'Four Score', description: 'Clear four lines with a single piece.', gamerscore: 15 },
  { id: 'tspin', title: 'Twist and Shout', description: 'Perform a T-spin.', gamerscore: 20 },
  { id: 'combo', title: 'Chain Reaction', description: 'Clear lines with 4 pieces in a row (combo x4).', gamerscore: 20 },
  { id: 'level10', title: 'Speed Demon', description: 'Reach level 10.', gamerscore: 25 },
  { id: 'score50k', title: 'High Roller', description: 'Score 50,000 points in one game.', gamerscore: 30 },
  { id: 'lines100', title: 'Centurion', description: 'Clear 100 lines in total.', gamerscore: 20 },
  { id: 'perfect', title: 'Spotless', description: 'Empty the whole board with a perfect clear.', gamerscore: 50 },
];
const STAT_DEFAULTS = { played: 0, won: 0, best: 0, bestTime: 0, bestLines: 0, bestLevel: 0, totalLines: 0, quads: 0, tspins: 0 };
const CLEAR_NAMES = ['', 'single', 'double', 'triple', 'quad!'];

export default async function launch(ctx) {
  const { os, root, storage } = ctx;
  const { el } = os.ui;
  const kit = createKit(ctx, { game: 'blocks', name: 'Blocks', achievements: ACH });
  root.classList.add('blocks-root');
  root.style.setProperty('--game-color', '#B36BF0');
  const prefs = { level: 1, ghost: true, ...(await storage.get('prefs', {})) };
  const savePrefs = () => storage.set('prefs', prefs);

  let current = null; // running game controller
  const offSuspend = ctx.on('suspend', () => current?.pause());
  const onKey = (e) => { if (current && kit.isActive()) current.key(e, true); };
  const onKeyUp = (e) => { if (current && kit.isActive()) current.key(e, false); };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);

  ctx.navigate(menuPage);

  /* ------------------------------------------------------------ menu */
  function menuPage(page) {
    const p = os.ui.page({ app: 'BLOCKS', title: 'blocks' });
    p.el.classList.add('blocks-menu');
    const render = async () => {
      const save = await storage.get('save', null);
      const stats = await kit.getStats(STAT_DEFAULTS);
      p.content.replaceChildren(logo());
      kit.menu(p.content, {
        items: [
          save && { label: 'continue', sub: `score ${save.score.toLocaleString()} · level ${save.level}`, accent: true, onClick: () => ctx.navigate(gamePage, { save }) },
          {
            label: save ? 'new game' : 'play', sub: `starting at level ${prefs.level}`, accent: !save,
            onClick: async () => {
              if (save && !(await os.ui.confirm('Your saved game will be lost.', 'start a new game?', 'start', 'cancel'))) return;
              await storage.del('save');
              ctx.navigate(gamePage, { level: prefs.level });
            },
          },
          {
            label: 'starting level', sub: 'level ' + prefs.level,
            onClick: async () => {
              const v = await os.ui.pickFromList({ title: 'starting level', value: prefs.level, options: Array.from({ length: 15 }, (_, i) => ({ value: i + 1, label: 'level ' + (i + 1) })) });
              if (v) { prefs.level = v; savePrefs(); render(); }
            },
          },
          { label: 'ghost piece', sub: prefs.ghost ? 'on' : 'off', onClick: () => { prefs.ghost = !prefs.ghost; savePrefs(); render(); } },
          { label: 'statistics', sub: stats.best ? `high score ${stats.best.toLocaleString()}` : 'no games yet', onClick: () => ctx.navigate(statsPage) },
          { label: 'how to play', onClick: () => ctx.navigate(helpPage) },
        ],
      });
    };
    page.el.append(p.el);
    return { onShow: render };
  }

  function logo() {
    // little procedurally drawn stack of blocks
    const c = el('canvas.blocks-logo', { width: 300, height: 60 });
    const g = c.getContext('2d');
    const pat = [['T', 0, 1], ['T', 1, 1], ['T', 2, 1], ['T', 1, 0], ['I', 3, 1], ['I', 4, 1], ['I', 5, 1], ['I', 6, 1], ['O', 7, 0], ['O', 8, 0], ['O', 7, 1], ['O', 8, 1], ['L', 9, 1], ['L', 10, 1], ['L', 11, 1], ['L', 11, 0], ['S', 12, 1], ['S', 13, 1], ['S', 13, 0], ['S', 14, 0]];
    for (const [t, x, y] of pat) drawCell(g, x * 20, y * 20 + 18, 20, COLORS[t]);
    return c;
  }

  function statsPage(page) {
    const p = os.ui.page({ app: 'BLOCKS', title: 'statistics' });
    const fill = async () => {
      const s = await kit.getStats(STAT_DEFAULTS);
      const unlocked = await kit.unlocked();
      const row = (k, v) => el('div.blocks-statrow', el('span', k), el('b', String(v)));
      p.content.replaceChildren(
        row('games played', s.played), row('high score', s.best.toLocaleString()), row('most lines', s.bestLines),
        row('highest level', s.bestLevel), row('total lines', s.totalLines), row('quads', s.quads), row('t-spins', s.tspins),
        row('longest game', kit.formatTime(s.bestTime)),
        os.ui.header('achievements'),
        ...ACH.map((a) => {
          const u = unlocked.find((x) => x.id === a.id);
          return el('div.blocks-ach' + (u ? '.on' : ''), el('div.blocks-ach-g', a.gamerscore + 'G'),
            el('div', el('div.blocks-ach-t', a.title), el('div.blocks-ach-d', u ? a.description : a.description + ' (locked)')));
        }));
    };
    fill();
    const bar = os.ui.appBar({
      minimized: true,
      menu: [{ label: 'reset statistics', onClick: async () => { if (await os.ui.confirm('Reset all Blocks statistics?', 'reset', 'reset', 'cancel')) { await storage.set('stats', {}); fill(); } } }],
    });
    page.el.append(p.el, bar.el);
  }

  function helpPage(page) {
    const p = os.ui.page({ app: 'BLOCKS', title: 'how to play' });
    const sec = (h, t) => [os.ui.header(h), el('p.blocks-help', t)];
    p.content.append(
      ...sec('goal', 'Move and rotate the falling pieces to fill complete horizontal lines. Full lines disappear. The game ends when the stack reaches the top.'),
      ...sec('touch', 'Tap the board to rotate. Drag left or right to slide the piece one cell at a time. Drag down slowly to soft drop, flick down to hard drop, flick up to hold. The buttons below the board do the same.'),
      ...sec('keyboard', '← → move · ↓ soft drop · ↑ or X rotate right · Z or Ctrl rotate left · Space hard drop · Shift or C hold · P pause · Esc back/pause'),
      ...sec('scoring', 'Single 100, double 300, triple 500, quad 800 points — times the level. T-spins and back-to-back quads earn bonus points, and consecutive clears build a combo. Soft drop gives 1 point per row, hard drop 2.'),
      ...sec('levels', 'Every 10 lines the level goes up and pieces fall faster.'));
    page.el.append(p.el);
  }

  /* ------------------------------------------------------------ game */
  function gamePage(page) {
    let g = page.params.save ? restore(page.params.save) : new Game({ level: page.params.level || 1 });
    let elapsed = page.params.save?.elapsed || 0;
    let paused = false, dialogOpen = false, finished = false, overT = -1, raf = 0, last = performance.now();
    const held = { dir: 0, t: 0, soft: false };
    let lastHud = '';

    const icon = (ic) => el('span', { html: os.ui.iconSVG(ic, { size: 22, stroke: 2 }) });
    const holdCv = el('canvas.blocks-holdcv');
    const scoreEl = el('div.blocks-score', '0');
    const levelEl = el('span'), linesEl = el('span');
    const pauseBtn = el('button.blocks-pausebtn.tilt', { 'aria-label': 'pause', onclick: () => showPauseDialog() }, icon(Pause));
    const top = el('div.blocks-top',
      el('div.blocks-holdbox', el('div.blocks-lbl', 'hold'), holdCv),
      el('div.blocks-hud', scoreEl, el('div.blocks-sub', el('span', 'level '), levelEl, el('span', ' · lines '), linesEl)),
      pauseBtn);
    const boardCv = el('canvas.blocks-board');
    const nextCv = el('canvas.blocks-nextcv');
    const popLayer = el('div.blocks-pops');
    const boardWrap = el('div.blocks-boardwrap', boardCv, popLayer);
    const side = el('div.blocks-side', el('div.blocks-lbl', 'next'), nextCv);
    const mid = el('div.blocks-mid', el('div.blocks-play', boardWrap, side));
    const pausedOv = el('div.blocks-paused', { hidden: true, onclick: () => resume() }, el('div.blocks-paused-t', 'paused'), el('div.blocks-paused-s', 'tap to resume'));
    const resultOv = el('div.blocks-result', { hidden: true });

    const btn = (ic, label, down, up) => {
      const b = el('button.blocks-btn', { 'aria-label': label }, icon(ic));
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!canPlay()) return; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch { /* */ } down(); });
      const end = () => { if (b.classList.contains('down')) { b.classList.remove('down'); up?.(); } };
      b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('lostpointercapture', end);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    const controls = el('div.blocks-controls',
      btn(Archive, 'hold', () => g.holdPiece()),
      btn(ArrowLeft, 'left', () => startDir(-1), () => stopDir(-1)),
      btn(ArrowDown, 'soft drop', () => startSoft(), () => (held.soft = false)),
      btn(ArrowRight, 'right', () => startDir(1), () => stopDir(1)),
      btn(RotateCw, 'rotate', () => g.rotate(1)),
      btn(ArrowDownToLine, 'hard drop', () => g.hardDrop()));
    const view = el('div.blocks-game', top, mid, controls, pausedOv, resultOv);
    page.el.append(view);

    const canPlay = () => !paused && !dialogOpen && !g.over && !finished;
    function startDir(d) { if (!canPlay()) return; g.move(d); held.dir = d; held.t = 0; }
    function stopDir(d) { if (held.dir === d) held.dir = 0; }
    function startSoft() { if (!canPlay()) return; g.softDrop(); held.soft = true; }

    /* ---- sizing */
    let cell = 20, sideW = 60, dpr = 1;
    const fit = (cv, w, h) => { cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); };
    const resize = () => {
      dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = mid.clientWidth - 12, h = mid.clientHeight - 8;
      if (w <= 0 || h <= 0) return;
      cell = Math.max(8, Math.floor(Math.min(h / (H - HIDDEN), (w - 8) / (W + 3.6))));
      sideW = Math.floor(cell * 3.6);
      fit(boardCv, cell * W, cell * (H - HIDDEN));
      fit(nextCv, sideW, Math.min(h - 20, Math.floor(sideW * 0.7) * 5 + 10));
      fit(holdCv, 58, 40);
      draw(performance.now());
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mid);

    /* ---- touch gestures on the board area */
    let gs = null;
    mid.addEventListener('pointerdown', (e) => {
      if (!canPlay()) return;
      try { mid.setPointerCapture(e.pointerId); } catch { /* */ }
      const t = performance.now();
      gs = { x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: t, axis: null, samples: [[t, e.clientY]], id: e.pointerId };
    });
    mid.addEventListener('pointermove', (e) => {
      if (!gs || e.pointerId !== gs.id || !canPlay()) return;
      const dx0 = e.clientX - gs.x0, dy0 = e.clientY - gs.y0;
      if (!gs.axis && Math.hypot(dx0, dy0) > 10) gs.axis = Math.abs(dx0) > Math.abs(dy0) ? 'x' : 'y';
      const step = Math.max(16, cell * 0.85);
      if (gs.axis === 'x') {
        while (e.clientX - gs.lx >= step) { g.move(1); gs.lx += step; }
        while (gs.lx - e.clientX >= step) { g.move(-1); gs.lx -= step; }
      } else if (gs.axis === 'y') {
        const t = performance.now();
        gs.samples.push([t, e.clientY]);
        while (gs.samples.length > 2 && t - gs.samples[0][0] > 90) gs.samples.shift();
        // slow drag down => soft drop per cell (fast flicks are resolved on release)
        const v = (e.clientY - gs.samples[0][1]) / Math.max(1, t - gs.samples[0][0]);
        if (v < 0.8) while (e.clientY - gs.ly >= step) { g.softDrop(); gs.ly += step; }
        else gs.ly = Math.max(gs.ly, e.clientY - step + 1);
      }
    });
    const gestureEnd = (e) => {
      if (!gs || e.pointerId !== gs.id) return;
      const s = gs; gs = null;
      if (!canPlay()) return;
      const t = performance.now();
      if (!s.axis) { if (t - s.t0 < 350) g.rotate(1); return; }
      if (s.axis === 'y') {
        const [t1, y1] = s.samples[0];
        const v = (e.clientY - y1) / Math.max(1, t - t1);
        const dy0 = e.clientY - s.y0;
        if (dy0 > 40 && v > 0.8) g.hardDrop();
        else if (dy0 < -40 && v < -0.5) g.holdPiece();
      }
    };
    mid.addEventListener('pointerup', gestureEnd);
    mid.addEventListener('pointercancel', (e) => { if (gs && e.pointerId === gs.id) gs = null; });

    /* ---- loop */
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, t - last); last = t;
      if (!paused && !dialogOpen && !finished) {
        if (!g.over) {
          if (held.dir) { held.t += dt; while (held.t >= DAS) { g.move(held.dir); held.t -= ARR; } }
          g.tick(dt, held.soft);
          elapsed += dt;
        } else if (overT >= 0) {
          overT += dt;
          if (overT > 900 && !finished) showResults();
        }
      }
      handleEvents();
      draw(t);
    };
    raf = requestAnimationFrame(loop);

    function handleEvents() {
      if (!g.events.length) return;
      const evs = g.events; g.events = [];
      for (const e of evs) {
        switch (e.type) {
          case 'move': kit.tone(1400, 0.02, 'square', 0.015); break;
          case 'rotate': kit.tone(900, 0.03, 'triangle', 0.03); break;
          case 'hold': kit.tone([500, 700], 0.04, 'triangle', 0.03); break;
          case 'lock': kit.tone(140, 0.06, 'triangle', 0.08); break;
          case 'harddrop': shake(); break;
          case 'clear': {
            kit.unlock('first_line');
            const label = (e.tspin ? 't-spin ' : '') + CLEAR_NAMES[e.lines];
            pop(label, e.lines === 4 || e.tspin ? 'big' : '');
            if (e.b2b) pop('back-to-back', 'small', 380);
            if (e.combo > 0) pop('combo ×' + e.combo, 'small', 700);
            if (e.lines === 4) { kit.unlock('quad'); kit.tone([523, 659, 784, 1047, 1319], 0.07, 'square', 0.05); } else kit.tone([523, 659, 784].slice(0, e.lines + 1), 0.06, 'square', 0.045);
            if (e.tspin) kit.unlock('tspin');
            if (e.combo >= 3) kit.unlock('combo');
            if (g.score >= 50000) kit.unlock('score50k');
            break;
          }
          case 'tspin': kit.unlock('tspin'); pop('t-spin', 'small'); kit.tone([700, 1000], 0.05, 'triangle', 0.04); break;
          case 'levelup': pop('level ' + e.level, 'level', 300); kit.tone([392, 523, 659, 784], 0.08, 'triangle', 0.05); if (e.level >= 10) kit.unlock('level10'); break;
          case 'perfect': pop('perfect clear!', 'big', 200); kit.unlock('perfect'); break;
          case 'gameover': gameOver(); break;
        }
      }
    }

    function pop(text, cls = '', delay = 0) {
      setTimeout(() => {
        const n = el('div.blocks-pop' + (cls ? '.' + cls : ''), text);
        popLayer.append(n);
        setTimeout(() => n.remove(), 1300);
      }, delay);
    }
    function shake() { boardWrap.classList.remove('blocks-shake'); void boardWrap.offsetWidth; boardWrap.classList.add('blocks-shake'); }

    /* ---- drawing */
    function draw(t) {
      const c = boardCv.getContext('2d');
      const bw = cell * W, bh = cell * (H - HIDDEN);
      c.clearRect(0, 0, bw, bh);
      c.strokeStyle = 'rgba(128,128,128,.14)'; c.lineWidth = 1;
      c.beginPath();
      for (let x = 1; x < W; x++) { c.moveTo(x * cell + 0.5, 0); c.lineTo(x * cell + 0.5, bh); }
      for (let y = 1; y < H - HIDDEN; y++) { c.moveTo(0, y * cell + 0.5); c.lineTo(bw, y * cell + 0.5); }
      c.stroke();
      const clearRows = g.clearing ? g.clearing.rows : [];
      const ph = g.clearing ? Math.min(1, g.clearing.t / CLEAR_MS) : 0;
      // game-over fill from the bottom
      const overRows = overT >= 0 ? Math.floor(Math.min(1, overT / 700) * (H - HIDDEN)) : 0;
      for (let y = HIDDEN; y < H; y++) {
        const vy = y - HIDDEN;
        const grey = overRows > 0 && vy >= H - HIDDEN - overRows;
        if (clearRows.includes(y)) {
          // flash white then collapse to the centre
          const flash = Math.sin(ph * Math.PI * 3) > 0;
          const shrink = ph < 0.45 ? 1 : 1 - (ph - 0.45) / 0.55;
          const half = (bw * shrink) / 2;
          c.fillStyle = flash || ph > 0.45 ? '#ffffff' : COLORS[g.board[y][0]] || '#fff';
          c.globalAlpha = ph > 0.45 ? shrink : 1;
          c.fillRect(bw / 2 - half, vy * cell + 1, half * 2, cell - 2);
          c.globalAlpha = 1;
          continue;
        }
        for (let x = 0; x < W; x++) {
          const v = g.board[y][x];
          if (v) drawCell(c, x * cell, vy * cell, cell, grey ? '#5a5a5a' : COLORS[v]);
          else if (grey) drawCell(c, x * cell, vy * cell, cell, '#333');
        }
      }
      const p = g.piece;
      if (p && !g.clearing) {
        if (prefs.ghost && !g.over) {
          const gy = g.ghostY();
          c.globalAlpha = 0.3;
          for (const [x, y] of g.cells(p, 0, gy - p.y)) if (y >= HIDDEN) {
            c.strokeStyle = COLORS[p.type]; c.lineWidth = 2;
            c.strokeRect(x * cell + 2, (y - HIDDEN) * cell + 2, cell - 4, cell - 4);
          }
          c.globalAlpha = 1;
        }
        const lockFade = g.grounded && !g.over ? 1 - 0.35 * Math.min(1, g.lockT / LOCK_DELAY) : 1;
        c.globalAlpha = lockFade;
        for (const [x, y] of g.cells(p)) if (y >= HIDDEN) drawCell(c, x * cell, (y - HIDDEN) * cell, cell, g.over ? '#777' : COLORS[p.type]);
        c.globalAlpha = 1;
      }
      // next queue
      const n = nextCv.getContext('2d');
      const nw = sideW, slot = Math.floor(sideW * 0.7);
      n.clearRect(0, 0, nw, slot * 5 + 10);
      g.queue.slice(0, 5).forEach((type, i) => {
        const size = i === 0 ? sideW / 4.6 : sideW / 6;
        drawPiece(n, type, nw / 2, i === 0 ? slot * 0.55 : slot * (i + 0.6) + 6, size, i === 0 ? 1 : 0.75);
      });
      // hold
      const h = holdCv.getContext('2d');
      h.clearRect(0, 0, 58, 40);
      if (g.hold) drawPiece(h, g.hold, 29, 20, 10, g.canHold ? 1 : 0.3);
      // HUD
      const hud = g.score + '|' + g.level + '|' + g.lines;
      if (hud !== lastHud) {
        lastHud = hud;
        scoreEl.textContent = g.score.toLocaleString();
        levelEl.textContent = g.level; linesEl.textContent = g.lines;
      }
    }

    /* ---- pause / resume */
    function pause() {
      if (g.over || finished || dialogOpen) return;
      paused = true; held.dir = 0; held.soft = false; gs = null;
      pausedOv.hidden = false;
    }
    function resume() {
      paused = false; pausedOv.hidden = true; last = performance.now();
    }
    async function showPauseDialog() {
      if (g.over || finished || dialogOpen) return;
      dialogOpen = true; held.dir = 0; held.soft = false; gs = null;
      const r = await kit.pauseDialog({ restart: true, message: `score ${g.score.toLocaleString()} · level ${g.level} · lines ${g.lines}` });
      dialogOpen = false;
      if (!page.el.isConnected) return;
      if (r === 'resume') resume();
      else if (r === 'restart') { storage.del('save'); newGame(); }
      else { await saveGame(); finished = true; page.close(); }
    }
    function newGame() {
      g = new Game({ level: g.startLevel });
      elapsed = 0; overT = -1; finished = false; paused = false; lastHud = '';
      resultOv.hidden = true; pausedOv.hidden = true; last = performance.now();
    }

    /* ---- save / restore */
    function serialize() {
      if (g.clearing) { g.finishClear(); g.events = []; }
      if (g.over || !g.piece) return null;
      return {
        board: g.board, queue: g.queue, hold: g.hold, piece: { ...g.piece }, score: g.score, level: g.level, startLevel: g.startLevel,
        lines: g.lines, combo: g.combo, b2b: g.b2b, stats: g.stats, canHold: g.canHold, elapsed,
      };
    }
    async function saveGame() {
      const s = serialize();
      if (s) await storage.set('save', s); else await storage.del('save');
    }

    /* ---- end of game */
    async function gameOver() {
      overT = 0; held.dir = 0; held.soft = false;
      kit.tone([392, 330, 262, 196], 0.14, 'triangle', 0.06);
      storage.del('save');
      const secs = Math.round(elapsed / 1000);
      const prev = await kit.getStats(STAT_DEFAULTS);
      g._newBest = g.score > prev.best && g.score > 0;
      const s = await kit.updateStats((st) => {
        st.played++;
        st.best = Math.max(st.best, g.score);
        st.bestLines = Math.max(st.bestLines, g.lines);
        st.bestLevel = Math.max(st.bestLevel, g.level);
        st.bestTime = Math.max(st.bestTime, secs);
        st.totalLines += g.lines;
        st.quads += g.stats.tetrises;
        st.tspins += g.stats.tspins;
      }, STAT_DEFAULTS);
      g._best = s.best;
      if (s.totalLines >= 100) kit.unlock('lines100');
      if (g.score >= 50000) kit.unlock('score50k');
    }
    function showResults() {
      finished = true;
      const best = g._best ?? g.score;
      resultOv.replaceChildren(
        el('div.blocks-result-t', 'game over'),
        g._newBest ? el('div.blocks-result-new', 'new high score!') : null,
        el('div.blocks-result-score', g.score.toLocaleString()),
        el('div.blocks-result-rows',
          el('div', el('b', String(g.lines)), el('span', 'lines')),
          el('div', el('b', String(g.level)), el('span', 'level')),
          el('div', el('b', kit.formatTime(elapsed / 1000)), el('span', 'time')),
          el('div', el('b', best.toLocaleString()), el('span', 'best'))),
        el('div.blocks-result-btns',
          os.ui.button('play again', () => newGame(), { accent: true }),
          os.ui.button('menu', () => page.close())));
      resultOv.hidden = false;
    }

    /* ---- keyboard */
    const keyMap = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'cw', x: 'cw', X: 'cw', z: 'ccw', Z: 'ccw', Control: 'ccw', ' ': 'drop', Shift: 'hold', c: 'hold', C: 'hold', p: 'pause', P: 'pause', Enter: 'enter' };
    function key(e, down) {
      if (!page.el.isConnected || page.el.hidden) return;
      const a = keyMap[e.key];
      if (!a) return;
      if (dialogOpen || document.querySelector('#overlay-layer .wp-dim, #overlay-layer .wp-fullpicker')) return;
      e.preventDefault(); e.stopPropagation();
      if (!down) {
        if (a === 'left') stopDir(-1); else if (a === 'right') stopDir(1); else if (a === 'down') held.soft = false;
        return;
      }
      if (finished) { if (a === 'enter' || a === 'drop') newGame(); return; }
      if (paused) { if (a === 'pause' || a === 'enter') resume(); return; }
      if (a === 'pause') { showPauseDialog(); return; }
      if (e.repeat) return;
      if (!canPlay()) return;
      switch (a) {
        case 'left': startDir(-1); break;
        case 'right': startDir(1); break;
        case 'down': startSoft(); break;
        case 'cw': g.rotate(1); break;
        case 'ccw': g.rotate(-1); break;
        case 'drop': g.hardDrop(); break;
        case 'hold': g.holdPiece(); break;
      }
    }

    const ctl = { pause, key };
    current = ctl;
    return {
      onBack: () => {
        if (finished || g.over) return false;
        showPauseDialog();
        return true;
      },
      onShow: () => { current = ctl; last = performance.now(); },
      onDestroy: () => {
        cancelAnimationFrame(raf); ro.disconnect();
        if (!finished && !g.over) saveGame();
        if (current === ctl) current = null;
      },
    };
  }

  function restore(s) {
    const g = new Game({ level: s.startLevel || 1 });
    Object.assign(g, {
      board: s.board, queue: s.queue, hold: s.hold, piece: s.piece, score: s.score, level: s.level, lines: s.lines,
      combo: s.combo, b2b: s.b2b, stats: { ...g.stats, ...s.stats }, canHold: s.canHold, events: [], fall: 0, lockT: 0, resets: 0,
    });
    return g;
  }

  return {
    onDestroy() {
      offSuspend?.();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    },
  };
}

/* ------------------------------------------------------------ drawing helpers */
function drawCell(c, x, y, s, color) {
  const g = Math.max(1, Math.round(s * 0.06));
  c.fillStyle = color;
  c.fillRect(x + g, y + g, s - g * 2, s - g * 2);
  c.fillStyle = 'rgba(255,255,255,.22)';
  c.fillRect(x + g, y + g, s - g * 2, Math.max(1, Math.round(s * 0.14)));
  c.fillStyle = 'rgba(0,0,0,.18)';
  c.fillRect(x + g, y + s - g - Math.max(1, Math.round(s * 0.1)), s - g * 2, Math.max(1, Math.round(s * 0.1)));
}
function drawPiece(c, type, cx, cy, s, alpha = 1) {
  const cells = ROT[type][0];
  const xs = cells.map((p) => p[0]), ys = cells.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const ox = cx - ((maxX - minX + 1) * s) / 2, oy = cy - ((maxY - minY + 1) * s) / 2;
  c.globalAlpha = alpha;
  for (const [x, y] of cells) drawCell(c, ox + (x - minX) * s, oy + (y - minY) * s, s, COLORS[type]);
  c.globalAlpha = 1;
}
