// 2048 — slide & merge puzzle.
import './style.css';
import { Undo2 } from 'lucide';
import { createKit } from './gamekit.js';
import { N, newGame, move, spawn, canMove, maxTile, setNextId } from './logic.js';

const ANIM = 110;
const ACH = [
  { id: 't512', title: 'Halfway There', description: 'Make a 512 tile.', gamerscore: 10 },
  { id: 't1024', title: 'Kilobyte', description: 'Make a 1024 tile.', gamerscore: 20 },
  { id: 't2048', title: 'Two Oh Four Eight', description: 'Make the 2048 tile.', gamerscore: 50 },
  { id: 't4096', title: 'Beyond Infinity', description: 'Keep going and make a 4096 tile.', gamerscore: 75 },
  { id: 'score', title: 'Big Numbers', description: 'Score 20,000 points in a single game.', gamerscore: 30 },
];

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I } = os.ui;
  const kit = createKit(ctx, { game: 'g2048', name: '2048', achievements: ACH });
  ctx.root.style.setProperty('--game-color', '#EDC22E');
  let current = null;

  const onKey = (e) => {
    if (!kit.isActive() || !current || current.hidden()) return;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
    if (map[e.key]) { e.preventDefault(); e.stopPropagation(); current.go(map[e.key]); }
    else if ((e.key === 'z' || e.key === 'u') && !e.repeat) { e.preventDefault(); current.undo(); }
  };
  window.addEventListener('keydown', onKey, true);
  ctx.on('suspend', () => current?.save());

  ctx.navigate(menuPage);

  /* ---------------------------------------------------------------- menu */
  function menuPage() {
    const p = os.ui.page({ app: '2048', title: 'menu' });
    p.el.classList.add('g2048-menu');
    const logo = el('div.g2048-logo', ...'2048'.split('').map((d) => el('span', d)));
    const items = el('div');
    const render = async () => {
      const saved = await storage.get('game', null);
      const st = await kit.getStats({ bestTile: 0 });
      items.replaceChildren();
      kit.menu(items, {
        items: [
          saved && !saved.over ? { label: 'continue', accent: true, sub: `score ${saved.score.toLocaleString()} · best tile ${maxTile(saved.tiles)}`, onClick: () => ctx.navigate(gamePage, { resume: true }) } : null,
          { label: 'new game', accent: !saved || saved.over, sub: `best score ${(st.best || 0).toLocaleString()}`, onClick: async () => {
            if (saved && !saved.over && !(await os.ui.confirm('Start a new game? Your current game will be lost.', 'new game', 'start', 'cancel'))) return;
            ctx.navigate(gamePage, { resume: false });
          } },
          { label: 'statistics', onClick: () => ctx.navigate(statsPage) },
          { label: 'how to play', onClick: () => ctx.navigate(helpPage) },
        ],
      });
    };
    render();
    p.content.append(logo, items);
    return { el: p.el, onShow: render };
  }

  async function statsPage() {
    const p = os.ui.page({ app: '2048', title: 'statistics' });
    const st = await kit.getStats({ bestTile: 0 });
    const box = (v, l) => el('div.g2048-stat', el('div.g2048-stat-v', String(v)), el('div.g2048-stat-l', l));
    p.content.append(el('div.g2048-statgrid',
      box(st.played, 'games played'), box(st.won, 'reached 2048'),
      box((st.best || 0).toLocaleString(), 'best score'), box(st.bestTile || 0, 'best tile'),
      box(st.bestTime ? kit.formatTime(st.bestTime) : '–', 'fastest 2048'), box(st.played ? Math.round((st.won / st.played) * 100) + '%' : '–', 'win rate')));
    const reset = os.ui.button('reset statistics', async () => {
      if (await os.ui.confirm('Reset all 2048 statistics?', 'reset', 'reset', 'cancel')) { await storage.set('stats', {}); ctx.back(); }
    });
    reset.style.marginTop = '20px';
    p.content.append(reset);
    return p.el;
  }

  function helpPage() {
    const p = os.ui.page({ app: '2048', title: 'how to play' });
    p.content.append(
      el('p', 'Swipe (or use the arrow keys) to slide all tiles. When two tiles with the same number touch, they merge into one with their sum.'),
      el('p', 'Every move adds a new 2 or 4. Reach the 2048 tile to win — then keep going for a higher score.'),
      el('p', 'Made a mistake? You can undo your last move once.'),
      os.ui.header('tips'),
      el('p', 'Keep your biggest tile in a corner and build towards it. Avoid swiping away from your corner unless you have to.'));
    return p.el;
  }

  /* ---------------------------------------------------------------- game */
  async function gamePage(page) {
    const saved = page.params.resume ? await storage.get('game', null) : null;
    let g;
    if (saved && saved.tiles?.length) {
      g = saved;
      setNextId(Math.max(...g.tiles.map((t) => t.id)) + 1);
    } else {
      g = { ...newGame(), elapsed: 0, undo: null };
      kit.updateStats((s) => { s.played++; }, { bestTile: 0 });
    }
    const st0 = await kit.getStats({ bestTile: 0 });
    let best = st0.best || 0;

    const scoreV = el('div.g2048-score-v', String(g.score));
    const bestV = el('div.g2048-score-v', String(best));
    const scoreBox = el('div.g2048-score', el('div.g2048-score-l', 'score'), scoreV);
    const board = el('div.g2048-board');
    for (let i = 0; i < N * N; i++) { const c = el('div.g2048-cell'); c.style.setProperty('--r', Math.floor(i / N)); c.style.setProperty('--c', i % N); board.append(c); }
    const overlay = el('div.g2048-overlay');
    overlay.hidden = true;
    board.append(overlay);
    const boardWrap = el('div.g2048-boardwrap', board);
    const view = el('div.g2048-game',
      el('div.g2048-top', el('div.g2048-title', '2048'), el('div.g2048-scores', scoreBox, el('div.g2048-score.best', el('div.g2048-score-l', 'best'), bestV))),
      el('div.g2048-hint', 'join the numbers and get to the 2048 tile!'),
      boardWrap);
    const bar = os.ui.appBar({
      buttons: [
        { icon: Undo2, label: 'undo', onClick: () => undo() },
        { icon: I.refresh, label: 'new game', onClick: () => restart(true) },
      ],
    });
    page.el.append(view, bar.el);

    const els = new Map();
    const tileEl = (t, cls = '') => {
      const n = el('div.g2048-tile' + cls, el('div.g2048-tile-in', String(t.v)));
      setTile(n, t);
      board.insertBefore(n, overlay);
      els.set(t.id, n);
      return n;
    };
    const setTile = (n, t) => {
      n.style.setProperty('--r', t.r); n.style.setProperty('--c', t.c);
      n.dataset.v = t.v > 2048 ? 'super' : t.v;
      n.dataset.len = String(t.v).length;
    };
    const rebuild = () => {
      for (const n of els.values()) n.remove();
      els.clear();
      for (const t of g.tiles) tileEl(t);
      scoreV.textContent = g.score;
      updateUndo();
    };
    const updateUndo = () => bar.setButtons([
      { icon: Undo2, label: 'undo', onClick: () => undo(), disabled: !g.undo },
      { icon: I.refresh, label: 'new game', onClick: () => restart(true) },
    ]);

    const fit = () => {
      // clientWidth/Height are layout sizes: unaffected by the page's turnstile-in transform (getBoundingClientRect isn't)
      const s = Math.floor(Math.min(boardWrap.clientWidth, boardWrap.clientHeight));
      if (s > 0) { board.style.width = board.style.height = s + 'px'; board.style.setProperty('--ts', (s - 5 * gapPx(s)) / 4 + 'px'); board.style.setProperty('--gap', gapPx(s) + 'px'); }
    };
    const gapPx = (s) => Math.max(6, Math.round(s * 0.028));
    const ro = new ResizeObserver(fit);
    ro.observe(boardWrap);

    // timing (active play seconds)
    let tStart = performance.now();
    const elapsed = () => g.elapsed + (performance.now() - tStart) / 1000;
    const save = () => { g.elapsed = elapsed(); tStart = performance.now(); return storage.set('game', g); };

    let busy = null; // { finish }
    function go(dir) {
      if (!overlay.hidden) return;
      busy?.finish();
      const res = move(g.tiles, dir);
      if (!res.moved) { board.classList.remove('g2048-bump-' + dir); void board.offsetWidth; board.classList.add('g2048-bump-' + dir); return; }
      g.undo = { tiles: g.tiles.map((t) => ({ ...t })), score: g.score };
      const goneEls = [];
      for (const mv of res.moves) {
        const n = els.get(mv.id);
        if (!n) continue;
        n.style.setProperty('--r', mv.r); n.style.setProperty('--c', mv.c);
        if (mv.gone) { goneEls.push(n); els.delete(mv.id); }
      }
      g.tiles = res.tiles.map(({ merged, ...t }) => t);
      g.score += res.gained;
      const sp = spawn(g.tiles);
      os.sounds.tap?.();
      if (res.gained) {
        scoreV.textContent = g.score;
        const plus = el('div.g2048-plus', '+' + res.gained);
        scoreBox.append(plus);
        setTimeout(() => plus.remove(), 700);
        if (g.score > best) { best = g.score; bestV.textContent = best; }
      }
      const timer = setTimeout(() => finish(), ANIM);
      const finish = () => {
        clearTimeout(timer);
        busy = null;
        goneEls.forEach((n) => n.remove());
        for (const m of res.merged) tileEl(m, '.merged');
        if (sp) tileEl(sp, '.new');
        afterMove();
      };
      busy = { finish };
      updateUndo();
    }

    function afterMove() {
      const mt = maxTile(g.tiles);
      if (mt >= 512) kit.unlock('t512');
      if (mt >= 1024) kit.unlock('t1024');
      if (mt >= 2048) kit.unlock('t2048');
      if (mt >= 4096) kit.unlock('t4096');
      if (g.score >= 20000) kit.unlock('score');
      if (mt >= 2048 && !g.won) {
        g.won = true;
        const secs = Math.round(elapsed());
        kit.updateStats((s) => { s.won++; if (!s.bestTime || secs < s.bestTime) s.bestTime = secs; }, { bestTile: 0 });
        kit.tone([523, 659, 784, 1047], 0.12, 'triangle', 0.08);
        showOverlay('you win!', `2048 in ${kit.formatTime(secs)}`, [['keep going', () => { g.keepPlaying = true; hideOverlay(); }], ['new game', () => restart(false)]], 'win');
      } else if (!canMove(g.tiles)) {
        g.over = true;
        kit.tone([392, 330, 262], 0.15, 'triangle', 0.07);
        showOverlay('game over', `score ${g.score.toLocaleString()}`, [['try again', () => restart(false)], ['undo', () => undo()]], 'lose');
      }
      kit.updateStats((s) => { if (g.score > (s.best || 0)) s.best = g.score; if (mt > (s.bestTile || 0)) s.bestTile = mt; }, { bestTile: 0 });
      save();
    }

    function showOverlay(title, sub, buttons, cls) {
      overlay.className = 'g2048-overlay ' + cls;
      overlay.replaceChildren(el('div.g2048-ov-title', title), el('div.g2048-ov-sub', sub),
        el('div.g2048-ov-buttons', buttons.map(([l, fn]) => os.ui.button(l, fn, { accent: l === buttons[0][0] }))));
      overlay.hidden = false;
    }
    const hideOverlay = () => { overlay.hidden = true; };

    function undo() {
      busy?.finish();
      if (!g.undo) { os.toast('nothing to undo'); return; }
      g.tiles = g.undo.tiles; g.score = g.undo.score; g.undo = null; g.over = false;
      hideOverlay();
      rebuild();
      save();
    }

    async function restart(ask) {
      if (ask && !g.over && g.tiles.length > 2 && !(await os.ui.confirm('Start a new game?', 'new game', 'start', 'cancel'))) return;
      busy?.finish();
      g = { ...newGame(), elapsed: 0, undo: null };
      tStart = performance.now();
      kit.updateStats((s) => { s.played++; }, { bestTile: 0 });
      hideOverlay();
      rebuild();
      for (const n of els.values()) n.classList.add('new');
      save();
    }

    // swipe
    let sp = null;
    view.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) sp = { x: e.clientX, y: e.clientY }; });
    view.addEventListener('pointermove', (e) => {
      if (!sp) return;
      const dx = e.clientX - sp.x, dy = e.clientY - sp.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
      sp = null;
      go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });
    const end = () => (sp = null);
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);

    rebuild();
    if (!saved) for (const n of els.values()) n.classList.add('new');
    if (g.over) showOverlay('game over', `score ${g.score.toLocaleString()}`, [['try again', () => restart(false)], ['undo', () => undo()]], 'lose');
    save();

    const ctl = { go, undo: () => undo(), save: () => save(), hidden: () => page.el.hidden || !page.el.isConnected };
    current = ctl;
    return {
      onShow: () => { current = ctl; tStart = performance.now(); },
      async onBack() {
        busy?.finish();
        if (g.over) { save(); return false; }
        const pauseStart = performance.now();
        const r = await kit.pauseDialog({ restart: true, message: `score ${g.score.toLocaleString()}` });
        tStart += performance.now() - pauseStart;
        if (r === 'resume') return true;
        if (r === 'restart') { restart(false); return true; }
        await save();
        return false;
      },
      onDestroy() { ro.disconnect(); busy?.finish(); save(); if (current === ctl) current = null; },
    };
  }

  return { onDestroy() { window.removeEventListener('keydown', onKey, true); } };
}
