// Snake II — Nokia LCD style snake.
import './style.css';
import { createKit } from './gamekit.js';
import { createGame, step, turn, tickMs, MAZES } from './logic.js';
import { drawText, textWidth } from './font.js';

const W = 20, H = 22;                 // grid cells
const CELL = 4;                       // LCD pixels per cell
const OX = 1, OY = 9;                 // field offset in LCD pixels
const LW = W * CELL + 2, LH = H * CELL + OY + 1;
const COLORS = { bg: '#9fbd36', on: '#1c2a0c', ghost: 'rgba(28,42,12,0.075)' };

const CRITTERS = [
  ['1001001', '0111110', '1010101'],
  ['0011100', '1111111', '0100010'],
  ['1100011', '0111110', '0010100'],
  ['0101010', '1111111', '1010101'],
];

const ACH = [
  { id: 'first', title: 'Hatchling', description: 'Eat your first snack.', gamerscore: 10 },
  { id: 'critter', title: 'Critter Hunter', description: 'Catch a bonus critter.', gamerscore: 15 },
  { id: 'long', title: 'Long Story', description: 'Grow your snake to a length of 40.', gamerscore: 25 },
  { id: 'score', title: 'High Scorer', description: 'Score 300 points in a single game.', gamerscore: 30 },
  { id: 'speed', title: 'Need for Speed', description: 'Score 100 points on level 9.', gamerscore: 20 },
];

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el } = os.ui;
  const kit = createKit(ctx, { game: 'snake', name: 'Snake', achievements: ACH });
  const prefs = { level: 5, maze: 'none', pad: true, ...(await storage.get('prefs', {})) };
  const savePrefs = () => storage.set('prefs', prefs);
  const key = () => prefs.level + ':' + prefs.maze;
  ctx.root.style.setProperty('--game-color', '#7A9C1C');

  let current = null; // active game controller (for suspend / keyboard)

  const onKey = (e) => {
    if (!kit.isActive() || !current || current.hidden()) return;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right', 8: 'up', 2: 'down', 4: 'left', 6: 'right' };
    if (map[e.key]) { e.preventDefault(); e.stopPropagation(); current.input(map[e.key]); }
    else if (e.key === ' ' || e.key === 'p' || e.key === 'P' || e.key === 'Enter' || e.key === '5') { e.preventDefault(); e.stopPropagation(); current.action(); }
  };
  window.addEventListener('keydown', onKey, true);

  ctx.on('suspend', () => current?.pause());
  ctx.navigate(menuPage);

  /* ---------------------------------------------------------------- menu */
  function menuPage() {
    const p = os.ui.page({ app: 'SNAKE II', title: 'snake' });
    p.el.classList.add('snake-menu');
    const banner = el('canvas.snake-banner', { width: LW * 6, height: 30 * 6 });
    drawBanner(banner);
    const items = el('div');
    const render = async () => {
      const st = await kit.getStats({ levels: {} });
      items.replaceChildren();
      kit.menu(items, {
        items: [
          { label: 'play', accent: true, sub: `level ${prefs.level} · ${MAZES[prefs.maze]} · best ${st.levels[key()] || 0}`, onClick: () => ctx.navigate(gamePage) },
          { label: 'level', sub: `speed ${prefs.level} of 9`, onClick: async () => {
            const v = await os.ui.pickFromList({ title: 'level', options: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: n, label: `level ${n}${n === 1 ? ' (slow)' : n === 9 ? ' (insane)' : ''}` })), value: prefs.level });
            if (v) { prefs.level = v; savePrefs(); render(); }
          } },
          { label: 'maze', sub: MAZES[prefs.maze], onClick: async () => {
            const v = await os.ui.pickFromList({ title: 'maze', options: Object.entries(MAZES).map(([value, label]) => ({ value, label })), value: prefs.maze });
            if (v) { prefs.maze = v; savePrefs(); render(); }
          } },
          { label: 'high scores', sub: `best ever ${st.best || 0}`, onClick: () => ctx.navigate(scoresPage) },
          { label: 'how to play', onClick: () => ctx.navigate(helpPage) },
        ],
      });
      const tg = os.ui.toggle({ label: 'on-screen d-pad', value: prefs.pad, onChange: (v) => { prefs.pad = v; savePrefs(); } });
      tg.el.style.marginTop = '18px';
      items.append(tg.el);
    };
    render();
    p.content.append(banner, items);
    return { el: p.el, onShow: render };
  }

  function drawBanner(c) {
    const g = c.getContext('2d');
    const px = new Uint8Array(LW * 30);
    const plot = (x, y) => { if (x >= 0 && y >= 0 && x < LW && y < 30) px[y * LW + x] = 1; };
    const t = 'SNAKE II';
    drawText(t, Math.floor((LW - textWidth(t) * 2) / 2 / 2), 2, (x, y) => { plot(x * 2, y * 2); plot(x * 2 + 1, y * 2); plot(x * 2, y * 2 + 1); plot(x * 2 + 1, y * 2 + 1); });
    for (let x = 6; x < LW - 14; x++) { plot(x, 20); plot(x, 21); }
    for (let i = 0; i < 3; i++) { plot(LW - 12 + i, 19); plot(LW - 12 + i, 22); }
    plot(LW - 9, 20); plot(LW - 9, 21); plot(LW - 10, 20);
    plot(LW - 4, 19); plot(LW - 5, 20); plot(LW - 3, 20); plot(LW - 4, 21);
    paint(g, c, px, LW, 30);
  }

  /* ---------------------------------------------------------------- scores / help */
  async function scoresPage() {
    const p = os.ui.page({ app: 'SNAKE II', title: 'high scores' });
    const st = await kit.getStats({ levels: {}, totalScore: 0, critters: 0 });
    const rows = [];
    for (const m of Object.keys(MAZES)) for (let l = 1; l <= 9; l++) if (st.levels[l + ':' + m]) rows.push({ title: String(st.levels[l + ':' + m]), subtitle: `level ${l} · ${MAZES[m]}` });
    rows.sort((a, b) => b.title - a.title);
    p.content.append(
      el('div.snake-statgrid',
        stat('games', st.played), stat('best', st.best || 0), stat('total points', st.totalScore || 0), stat('critters', st.critters || 0)),
      os.ui.header('per level'),
      os.ui.list(rows, { render: (r) => os.ui.listItem(r), empty: 'no scores yet — go play!' }));
    return p.el;
  }
  const stat = (label, v) => el('div.snake-stat', el('div.snake-stat-v', String(v)), el('div.snake-stat-l', label));

  function helpPage() {
    const p = os.ui.page({ app: 'SNAKE II', title: 'how to play' });
    p.content.append(
      el('p', 'Guide the snake to eat the dots. Every dot makes it longer and earns points equal to the level.'),
      el('p', 'After every fifth dot a critter appears for a short time — catch it for bonus points. The faster you get it, the more it\'s worth.'),
      el('p', 'Don\'t bite your own tail. In the box, tunnel and mill mazes, the walls are deadly. With no walls, the snake wraps around the screen edges.'),
      os.ui.header('controls'),
      el('p', 'Swipe anywhere on the screen, use the on-screen d-pad, or the arrow keys / WASD / numpad 2-4-6-8. Space or P pauses. Back pauses too.'));
    return p.el;
  }

  /* ---------------------------------------------------------------- game */
  function gamePage(page) {
    const lcd = el('canvas.snake-canvas');
    const lcdWrap = el('div.snake-lcd', lcd);
    const pad = el('div.snake-pad' + (prefs.pad ? '' : '.hidden'));
    const mkBtn = (dir, label) => {
      const b = el('button.snake-key.snake-key-' + dir, { 'aria-label': dir, html: label });
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); dir === 'mid' ? action() : input(dir); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => b.classList.remove('down')));
      return b;
    };
    const arrow = (r) => `<svg viewBox="0 0 24 24" width="26" height="26" style="transform:rotate(${r}deg)"><path d="M12 5l8 10H4z" fill="currentColor"/></svg>`;
    pad.append(mkBtn('up', arrow(0)), mkBtn('left', arrow(-90)), mkBtn('mid', '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>'), mkBtn('right', arrow(90)), mkBtn('down', arrow(180)));
    const view = el('div.snake-game', lcdWrap, pad);
    page.el.append(view);

    const g2d = lcd.getContext('2d');
    const px = new Uint8Array(LW * LH);
    let game, state, acc = 0, last = 0, raf = 0, deathT = 0, msg = null, newBest = false;

    const newGame = () => {
      game = createGame({ w: W, h: H, level: prefs.level, maze: prefs.maze });
      state = 'ready'; msg = ['READY?', os.device.isMobile ? 'SWIPE TO GO' : 'PRESS ARROW']; newBest = false;
      draw();
    };

    function input(dir) {
      if (state === 'ready') { turn(game, dir); start(); return; }
      if (state === 'paused') { resume(); turn(game, dir); return; }
      if (state === 'play') turn(game, dir);
      if (state === 'over' && performance.now() - deathT > 1800) newGame();
    }
    function action() {
      if (state === 'ready') start();
      else if (state === 'play') pause();
      else if (state === 'paused') resume();
      else if (state === 'over' && performance.now() - deathT > 1800) newGame();
    }
    function start() {
      state = 'play'; msg = null; acc = 0; last = performance.now();
      kit.updateStats((s) => { s.played++; }, { levels: {} });
      loop();
    }
    function pause() {
      if (state !== 'play') return;
      state = 'paused'; msg = ['PAUSED']; cancelAnimationFrame(raf); draw();
    }
    function resume() {
      if (state !== 'paused') return;
      state = 'play'; msg = null; last = performance.now(); acc = 0; loop();
    }
    function loop() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
    function frame(now) {
      if (state === 'dying') {
        const t = now - deathT;
        draw(Math.floor(t / 160) % 2 === 1);
        if (t > 1300) return gameOver();
        raf = requestAnimationFrame(frame);
        return;
      }
      if (state !== 'play') return;
      acc += Math.min(now - last, 250); last = now;
      const ms = tickMs(game.level);
      let stepped = false;
      while (acc >= ms && state === 'play') {
        acc -= ms; stepped = true;
        const ev = step(game);
        if (ev.ate) { kit.tone(1350, 0.04, 'square', 0.035); if (game.eaten === 1) kit.unlock('first'); }
        if (ev.critter) { kit.tone([880, 1175, 1568], 0.05, 'square', 0.04); kit.unlock('critter'); }
        if (game.snake.length >= 40) kit.unlock('long');
        if (game.score >= 300) kit.unlock('score');
        if (game.level === 9 && game.score >= 100) kit.unlock('speed');
        if (ev.died) {
          state = 'dying'; deathT = now;
          kit.tone([392, 311, 262, 196], 0.12, 'square', 0.05);
          if (os.settings.get('vibrate') !== false) os.device.vibrate?.([80, 60, 160]);
        }
      }
      if (stepped) draw();
      raf = requestAnimationFrame(frame);
    }
    async function gameOver() {
      state = 'over'; deathT = performance.now();
      const sc = game.score;
      const st = await kit.updateStats((s) => {
        s.levels = s.levels || {};
        s.totalScore = (s.totalScore || 0) + sc;
        s.critters = (s.critters || 0) + game.critters;
        if (sc > (s.levels[key()] || 0)) { s.levels[key()] = sc; newBest = sc > 0; }
        if (sc > (s.best || 0)) s.best = sc;
        if (newBest) s.won = (s.won || 0) + 1;
      }, { levels: {} });
      msg = ['GAME OVER', 'SCORE ' + pad4(sc), newBest ? 'NEW BEST!' : 'BEST ' + pad4(st.levels[key()] || 0), '', 'TAP TO PLAY'];
      draw();
    }

    /* ---- rendering */
    const plot = (x, y) => { if (x >= 0 && y >= 0 && x < LW && y < LH) px[y * LW + x] = 1; };
    const unplot = (x, y) => { if (x >= 0 && y >= 0 && x < LW && y < LH) px[y * LW + x] = 0; };
    const cellPx = (cx, cy) => [OX + cx * CELL, OY + cy * CELL];
    function draw(hideSnake = false) {
      if (!game) return;
      px.fill(0);
      // header: score + critter timer
      drawText(pad4(game.score), 1, 1, plot);
      if (game.bonus) {
        const k = CRITTERS[game.bonus.kind];
        k.forEach((row, r) => [...row].forEach((b, c) => b === '1' && plot(LW - 22 + c, 2 + r)));
        drawText(String(game.bonus.ttl).padStart(2, '0'), LW - 12, 1, plot);
      } else {
        drawText('L' + game.level, LW - 9, 1, plot);
      }
      for (let x = 0; x < LW; x++) plot(x, 7);
      // field border: dotted for wrap-around, solid otherwise
      for (let x = 0; x < LW; x++) { if (game.maze !== 'none' || x % 2 === 0) { plot(x, OY - 1); plot(x, LH - 1); } }
      for (let y = OY - 1; y < LH; y++) { if (game.maze !== 'none' || y % 2 === 0) { plot(0, y); plot(LW - 1, y); } }
      // walls
      for (const w of game.walls) { const [cx, cy] = w.split(',').map(Number); const [x, y] = cellPx(cx, cy); for (let i = 0; i < CELL; i++) for (let j = 0; j < CELL; j++) plot(x + i, y + j); }
      // food
      if (game.food) { const [x, y] = cellPx(...game.food); plot(x + 1, y); plot(x, y + 1); plot(x + 2, y + 1); plot(x + 1, y + 2); }
      // critter
      if (game.bonus && (game.bonus.ttl > 5 || game.bonus.ttl % 2 === 0)) {
        const [x, y] = cellPx(game.bonus.x, game.bonus.y);
        CRITTERS[game.bonus.kind].forEach((row, r) => [...row].forEach((b, c) => b === '1' && plot(x + c, y + r)));
      }
      if (!hideSnake) drawSnake();
      if (msg) drawMsg(msg);
      paint(g2d, lcd, px, LW, LH);
    }
    function drawSnake() {
      const s = game.snake;
      const adj = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1);
      s.forEach((seg, i) => {
        const [x, y] = cellPx(seg[0], seg[1]);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) plot(x + a, y + b);
        for (const n of [s[i - 1], s[i + 1]]) {
          if (!n || !adj(seg, n)) continue;
          if (n[0] === seg[0] + 1) for (let b = 0; b < 3; b++) plot(x + 3, y + b);
          if (n[1] === seg[1] + 1) for (let a = 0; a < 3; a++) plot(x + a, y + 3);
        }
        if (i > 0 && i < s.length - 1 && i % 2 === 0) unplot(x + 1, y + 1); // body texture
      });
      // head: eye + open mouth when food is ahead
      const [hx, hy] = cellPx(s[0][0], s[0][1]);
      const d = game.queue[0] || game.dir;
      const eye = { right: [1, 0], left: [1, 0], up: [0, 1], down: [0, 1] }[d];
      unplot(hx + eye[0], hy + eye[1]);
      const f = game.food;
      const ahead = f && ({ right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }[d]);
      if (ahead && f[0] === s[0][0] + ahead[0] && f[1] === s[0][1] + ahead[1]) {
        if (d === 'right') unplot(hx + 2, hy + 1); if (d === 'left') unplot(hx, hy + 1);
        if (d === 'up') unplot(hx + 1, hy); if (d === 'down') unplot(hx + 1, hy + 2);
      }
    }
    function drawMsg(lines) {
      const h = lines.length * 7 + 5;
      const wMax = Math.max(...lines.map(textWidth)) + 8;
      const x0 = Math.floor((LW - wMax) / 2), y0 = Math.floor(OY + (LH - OY - h) / 2);
      for (let x = x0; x < x0 + wMax; x++) for (let y = y0; y < y0 + h; y++) {
        const edge = x === x0 || x === x0 + wMax - 1 || y === y0 || y === y0 + h - 1;
        if (edge) plot(x, y); else unplot(x, y);
      }
      lines.forEach((t, i) => drawText(t, Math.floor((LW - textWidth(t)) / 2), y0 + 3 + i * 7, plot));
    }

    /* ---- sizing */
    const fit = () => {
      const r = lcdWrap.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const s = Math.min((r.width - 12) / LW, (r.height - 12) / LH);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      lcd.style.width = Math.floor(LW * s) + 'px';
      lcd.style.height = Math.floor(LH * s) + 'px';
      lcd.width = Math.floor(LW * s * dpr);
      lcd.height = Math.floor(LH * s * dpr);
      draw(state === 'dying');
    };
    const ro = new ResizeObserver(fit);
    ro.observe(lcdWrap);

    /* ---- swipe (fires during the move for snappy control) */
    let sp = null, swiped = false;
    view.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.snake-key')) return;
      sp = { x: e.clientX, y: e.clientY }; swiped = false;
    });
    view.addEventListener('pointermove', (e) => {
      if (!sp) return;
      const dx = e.clientX - sp.x, dy = e.clientY - sp.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      input(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      sp = { x: e.clientX, y: e.clientY }; swiped = true;
    });
    view.addEventListener('pointerup', (e) => {
      if (sp && !swiped && !e.target.closest('.snake-key')) {
        if (state === 'ready' || state === 'paused' || state === 'over') action();
      }
      sp = null;
    });
    view.addEventListener('pointercancel', () => (sp = null));

    const ctl = {
      input, action, pause,
      hidden: () => page.el.hidden || !page.el.isConnected,
    };
    current = ctl;
    newGame();

    return {
      el: view,
      onShow: () => { current = ctl; },
      async onBack() {
        if (state === 'play' || state === 'paused') {
          pause();
          const r = await kit.pauseDialog({ restart: true, message: `score ${game.score}` });
          if (r === 'resume') { resume(); return true; }
          if (r === 'restart') { newGame(); return true; }
          state = 'quit';
          return false; // let the page pop
        }
        return false;
      },
      onDestroy() { cancelAnimationFrame(raf); ro.disconnect(); if (current === ctl) current = null; },
    };
  }

  return {
    onDestroy() { window.removeEventListener('keydown', onKey, true); },
  };
}

const pad4 = (n) => String(n).padStart(4, '0');

const ghostCache = new Map();
function paint(g, canvas, px, lw, lh) {
  const W2 = canvas.width, H2 = canvas.height;
  if (!W2 || !H2) return;
  const p = W2 / lw, q = H2 / lh;
  const gap = Math.max(0.6, p * 0.14);
  const ck = W2 + 'x' + H2 + ':' + lw + 'x' + lh;
  let bg = ghostCache.get(ck);
  if (!bg) {
    bg = document.createElement('canvas');
    bg.width = W2; bg.height = H2;
    const b = bg.getContext('2d');
    b.fillStyle = COLORS.bg; b.fillRect(0, 0, W2, H2);
    b.fillStyle = COLORS.ghost;
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) b.fillRect(x * p, y * q, p - gap, q - gap);
    if (ghostCache.size > 4) ghostCache.clear();
    ghostCache.set(ck, bg);
  }
  g.drawImage(bg, 0, 0);
  g.fillStyle = COLORS.on;
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (px[y * lw + x]) g.fillRect(x * p, y * q, p - gap, q - gap);
}
