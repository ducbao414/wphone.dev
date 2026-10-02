// Solitaire — Klondike (draw one / draw three) in the Microsoft Solitaire Collection / Xbox Live spirit.
import './style.css';
import { Undo2, Lightbulb, Plus } from 'lucide';
import * as L from './logic.js';
import { createKit } from './gamekit.js';

const ACH = [
  { id: 'first_win', title: 'Card Shark', description: 'Win a game of Klondike.', gamerscore: 10 },
  { id: 'draw3_win', title: 'Three’s Company', description: 'Win a game in draw three mode.', gamerscore: 20 },
  { id: 'fast', title: 'Speed Dealer', description: 'Win a game in under 3 minutes.', gamerscore: 30 },
  { id: 'no_undo', title: 'No Regrets', description: 'Win a game without using undo.', gamerscore: 20 },
  { id: 'score5000', title: 'High Roller', description: 'Finish a game with 5,000 points or more.', gamerscore: 25 },
  { id: 'win5', title: 'Regular', description: 'Win 5 games.', gamerscore: 20 },
  { id: 'streak3', title: 'Hat Trick', description: 'Win 3 games in a row.', gamerscore: 25 },
  { id: 'auto', title: 'Let It Ride', description: 'Finish a game with auto-complete.', gamerscore: 10 },
];
const GREEN = '#0F5C2E';
const STAT_DEFAULTS = { streak: 0, longestStreak: 0, wins1: 0, wins3: 0 };

export default async function launch(ctx) {
  const { os, storage, root } = ctx;
  const { el, I } = os.ui;
  const kit = createKit(ctx, { game: 'solitaire', name: 'Solitaire', achievements: ACH });
  root.classList.add('sol-app');
  root.style.setProperty('--game-color', '#2FBF5F');

  let prefs = await storage.get('prefs', { draw: 1 });
  const cleanups = [];

  ctx.navigate(menuPage);

  /* ------------------------------------------------------------ card DOM */
  function cardEl(c, cls = '') {
    const face = c.r > 10;
    return el('div.sol-card' + (L.isRed(c.s) ? '.red' : '') + (cls ? '.' + cls : ''), { dataset: { id: c.id } },
      el('div.sol-face',
        el('div.sol-corner', el('span.sol-rank', L.RANKS[c.r]), el('span.sol-suit', L.SUITS[c.s])),
        face ? el('div.sol-pip.sol-court', el('span', L.RANKS[c.r]), el('span', L.SUITS[c.s])) : el('div.sol-pip', L.SUITS[c.s])),
      el('div.sol-back'));
  }

  /* ------------------------------------------------------------ menu */
  async function menuPage(page) {
    const p = os.ui.page({ app: 'SOLITAIRE', title: 'klondike', cls: 'sol-menu' });
    const fan = el('div.sol-fan', [{ s: 0, r: 1 }, { s: 1, r: 13 }, { s: 2, r: 12 }, { s: 3, r: 11 }].map((c, i) => {
      const n = cardEl({ ...c, id: 'm' + i }, 'up');
      n.style.setProperty('--i', i);
      return n;
    }));
    const box = el('div');
    p.content.append(fan, box);
    const render = async () => {
      const saved = await storage.get('game', null);
      box.replaceChildren();
      const items = [];
      if (saved && !saved.won && saved.started) {
        items.push({ label: 'continue', sub: `draw ${saved.draw === 3 ? 'three' : 'one'} · ${saved.score} points · ${kit.formatTime(saved.time)}`, accent: true, onClick: () => ctx.navigate(gamePage, { resume: true }) });
      }
      items.push({ label: 'new game', sub: `draw ${prefs.draw === 3 ? 'three' : 'one'} · standard scoring`, accent: !items.length, onClick: () => startNew() });
      items.push({ label: 'mode', sub: prefs.draw === 3 ? 'draw three cards (harder)' : 'draw one card (easier)', onClick: pickMode });
      items.push({ label: 'statistics', sub: 'your records and achievements', onClick: () => ctx.navigate(statsPage) });
      items.push({ label: 'how to play', sub: 'rules and controls', onClick: () => ctx.navigate(helpPage) });
      kit.menu(box, { items });
    };
    const startNew = async () => {
      const saved = await storage.get('game', null);
      if (saved && saved.started && !saved.won) {
        if (!(await os.ui.confirm('Your current game will be counted as a loss.', 'start a new game?', 'new game', 'cancel'))) return;
        await recordLoss(saved);
      }
      ctx.navigate(gamePage, { resume: false });
    };
    const pickMode = async () => {
      const v = await os.ui.pickFromList({ title: 'mode', options: [{ value: 1, label: 'draw one' }, { value: 3, label: 'draw three' }], value: prefs.draw });
      if (v) { prefs.draw = v; await storage.set('prefs', prefs); render(); }
    };
    await render();
    page.el.append(p.el);
    return { onShow: render };
  }

  async function recordLoss(saved) {
    if (saved?.counted && !saved.won) await kit.updateStats((s) => { s.streak = 0; }, STAT_DEFAULTS);
    await storage.del('game');
  }

  /* ------------------------------------------------------------ stats */
  async function statsPage(page) {
    const p = os.ui.page({ app: 'SOLITAIRE', title: 'statistics' });
    const draw = async () => {
      const s = await kit.getStats(STAT_DEFAULTS);
      const un = await kit.unlocked();
      const rows = [
        ['games played', s.played], ['games won', s.won], ['win rate', s.played ? Math.round((s.won / s.played) * 100) + '%' : '–'],
        ['best score', s.best || '–'], ['fastest win', s.bestTime ? kit.formatTime(s.bestTime) : '–'],
        ['current streak', s.streak], ['longest streak', s.longestStreak], ['draw one wins', s.wins1], ['draw three wins', s.wins3],
      ];
      const gs = un.reduce((a, b) => a + (b.gamerscore || 0), 0);
      const total = ACH.reduce((a, b) => a + b.gamerscore, 0);
      p.content.replaceChildren(
        el('div.sol-stats', rows.map(([k, v]) => el('div.sol-stat', el('div.sol-stat-k', k), el('div.sol-stat-v', String(v))))),
        os.ui.header(`achievements · ${gs} of ${total} gamerscore`),
        el('div', ACH.map((a) => {
          const u = un.find((x) => x.id === a.id);
          return el('div.sol-ach' + (u ? '.on' : ''), el('div.sol-ach-badge', a.gamerscore + 'G'),
            el('div.sol-ach-text', el('div.sol-ach-title', a.title), el('div.sol-ach-desc', u ? `${a.description} · ${new Date(u.unlocked).toLocaleDateString()}` : a.description)));
        })),
        os.ui.button('reset statistics', async () => {
          if (await os.ui.confirm('Reset all Solitaire statistics? Achievements are kept.', 'reset', 'reset', 'cancel')) { await storage.set('stats', {}); draw(); }
        }));
    };
    await draw();
    page.el.append(p.el);
  }

  function helpPage(page) {
    const p = os.ui.page({ app: 'SOLITAIRE', title: 'how to play' });
    const sec = (h, t) => [os.ui.header(h), el('p.sol-help', t)];
    p.content.append(
      ...sec('goal', 'Build four foundation piles, one per suit, from ace up to king.'),
      ...sec('tableau', 'Stack cards in descending order with alternating colours (red on black). Only a king — or a run starting with a king — can fill an empty column. Turning over a face-down card earns 5 points.'),
      ...sec('stock', 'Tap the deck to turn over one card (draw one) or three cards (draw three). When the deck runs out, tap the empty spot to recycle the waste pile.'),
      ...sec('controls', 'Drag a card or a run of cards to move it. Tap a card to send it to the best spot automatically. Use undo, hint and auto-complete in the app bar. On a keyboard: U or Ctrl+Z undo, space draws, H hint, A auto-complete.'),
      ...sec('scoring', 'Waste → tableau +5 · to foundation +10 · turn over a card +5 · foundation → tableau −15 · recycling the deck −100 (draw one) or −20 after three passes (draw three) · −2 every 10 seconds. Winning adds a time bonus of 700,000 ÷ seconds played.'),
    );
    page.el.append(p.el);
  }

  /* ------------------------------------------------------------ game */
  async function gamePage(page) {
    let st;
    if (page.params.resume) st = await storage.get('game', null);
    if (!st || st.won) st = L.deal(prefs.draw);
    let busy = false, paused = false, dialogOpen = false, destroyed = false;

    const hudScore = el('span'), hudTime = el('span'), hudMoves = el('span');
    const hud = el('div.sol-hud', el('div', el('small', 'score '), hudScore), el('div.sol-hud-time', hudTime), el('div', el('small', 'moves '), hudMoves));
    const board = el('div.sol-board');
    const canvas = el('canvas.sol-canvas');
    const autoBtn = el('button.sol-autobtn', { onclick: () => autoComplete() }, 'auto-complete');
    const view = el('div.sol-game', hud, board, autoBtn);

    // slots
    const slotStock = el('div.sol-slot.sol-slot-stock', { html: '<svg viewBox="0 0 24 24" width="50%" height="50%" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>' });
    const slotFound = L.SUITS.map((s) => el('div.sol-slot.sol-slot-found', s));
    const slotTab = [...Array(7)].map(() => el('div.sol-slot.sol-slot-tab'));
    board.append(slotStock, ...slotFound, ...slotTab);
    const cardEls = new Map();
    for (const c of [...st.stock, ...st.waste, ...st.found.flat(), ...st.tab.flat()]) {
      const n = cardEl(c);
      cardEls.set(c.id, n);
      board.append(n);
    }

    const bar = os.ui.appBar({ buttons: [], menu: [] });
    const setBar = () => {
      bar.setButtons([
        { icon: Plus, label: 'new game', onClick: newGamePrompt },
        { icon: Undo2, label: 'undo', onClick: doUndo, disabled: !st.history.length || st.won },
        { icon: Lightbulb, label: 'hint', onClick: hint, disabled: st.won },
      ]);
      bar.setMenu([
        { label: 'auto-complete', onClick: autoComplete, disabled: !L.allUp(st) || st.won },
        { label: `restart this deal`, onClick: restartDeal },
        { label: `next game: draw ${prefs.draw === 3 ? 'three' : 'one'}`, onClick: async () => {
          const v = await os.ui.pickFromList({ title: 'mode', options: [{ value: 1, label: 'draw one' }, { value: 3, label: 'draw three' }], value: prefs.draw });
          if (v) { prefs.draw = v; storage.set('prefs', prefs); setBar(); }
        } },
        { label: 'statistics', onClick: () => ctx.navigate(statsPage) },
        { label: 'how to play', onClick: () => ctx.navigate(helpPage) },
      ]);
      autoBtn.classList.toggle('show', L.allUp(st) && !st.won && !busy);
    };
    view.append(bar.el);
    page.el.append(view);

    /* ---------- geometry */
    let G = null;
    const geom = () => {
      const W = board.clientWidth, H = board.clientHeight;
      const pad = 4, gap = W < 360 ? 3 : 5;
      let cw = Math.floor((W - 2 * pad - 6 * gap) / 7);
      cw = Math.min(cw, 96, Math.floor((H - 30) / (1.4 * 3.2)));
      cw = Math.max(cw, 24);
      const ch = Math.round(cw * 1.4);
      const offX = Math.round((W - (7 * cw + 6 * gap)) / 2);
      const topY = 6, tabY = topY + ch + Math.max(8, Math.round(ch * 0.16));
      return { W, H, cw, ch, gap, offX, topY, tabY, colX: (i) => offX + i * (cw + gap) };
    };
    const pilePositions = (p) => {
      const { ch, H, tabY } = G;
      const pile = st.tab[p];
      const down = pile.filter((c) => !c.up).length, up = pile.length - down;
      const avail = H - tabY - 6;
      let dOff = Math.max(4, Math.round(ch * 0.13)), uOff = Math.round(ch * 0.34);
      const need = () => ch + down * dOff + Math.max(0, up - 1) * uOff;
      if (need() > avail && up > 1) uOff = Math.max(Math.round(ch * 0.17), Math.floor((avail - ch - down * dOff) / (up - 1)));
      if (need() > avail) dOff = 3;
      const ys = [];
      let y = tabY;
      for (const c of pile) { ys.push(y); y += c.up ? uOff : dOff; }
      return ys;
    };

    const zTimers = new Map();
    function place(n, x, y, z, up, animate) {
      const moved = n._x !== x || n._y !== y;
      n._x = x; n._y = y; n._z = z;
      if (n._up === false && up && animate) { n.classList.remove('sol-flip'); void n.offsetWidth; n.classList.add('sol-flip'); }
      n._up = up;
      n.classList.toggle('up', up);
      n.style.transform = `translate(${x}px, ${y}px)`;
      if (moved && animate) {
        n.style.zIndex = 1000 + z;
        clearTimeout(zTimers.get(n));
        zTimers.set(n, setTimeout(() => { n.style.zIndex = n._z; }, 300));
      } else if (!zTimers.has(n) || !moved) n.style.zIndex = z;
    }

    function layout(animate = true) {
      G = geom();
      const { cw, ch, topY, tabY, colX } = G;
      board.style.setProperty('--cw', cw + 'px');
      board.style.setProperty('--ch', ch + 'px');
      board.classList.toggle('sol-noanim', !animate);
      const pos = (n, x, y) => { n.style.transform = `translate(${x}px, ${y}px)`; };
      pos(slotStock, colX(0), topY);
      slotFound.forEach((n, i) => pos(n, colX(3 + i), topY));
      slotTab.forEach((n, i) => pos(n, colX(i), tabY));
      st.stock.forEach((c, i) => place(cardEls.get(c.id), colX(0), topY, 10 + i, false, animate));
      const vis = st.draw === 3 ? Math.min(3, st.waste.length) : Math.min(1, st.waste.length);
      const fanDx = Math.round(cw * 0.42);
      st.waste.forEach((c, i) => {
        const k = i - (st.waste.length - vis);
        place(cardEls.get(c.id), colX(1) + (st.draw === 3 && k > 0 ? k * fanDx : 0), topY, 100 + i, true, animate);
      });
      st.found.forEach((f, s) => f.forEach((c, i) => place(cardEls.get(c.id), colX(3 + s), topY, 200 + i, true, animate)));
      st.tab.forEach((pile, p) => {
        const ys = pilePositions(p);
        pile.forEach((c, i) => place(cardEls.get(c.id), colX(p), ys[i], 300 + i, c.up, animate));
      });
      if (!animate) requestAnimationFrame(() => board.classList.remove('sol-noanim'));
    }

    const hudUpdate = () => {
      hudScore.textContent = st.score;
      hudTime.textContent = kit.formatTime(st.time);
      hudMoves.textContent = st.moves;
    };

    let saveT;
    const save = (now) => {
      clearTimeout(saveT);
      const doSave = () => { if (!st.won) storage.set('game', L.serialize(st)); };
      if (now) doSave(); else saveT = setTimeout(doSave, 400);
    };

    async function commit(sound = 'move') {
      if (st.started && !st.counted) {
        st.counted = true;
        await kit.updateStats((s) => { s.played++; }, STAT_DEFAULTS);
      }
      hudUpdate();
      layout(true);
      setBar();
      if (sound === 'move') kit.tone([660], 0.05, 'triangle', 0.05);
      else if (sound === 'found') kit.tone([880, 1175], 0.05, 'triangle', 0.05);
      else if (sound === 'draw') kit.tone([330], 0.04, 'triangle', 0.04);
      if (st.won) return win();
      save();
    }

    /* ---------- actions */
    function tryMove(src, dst) {
      if (!L.move(st, src, dst)) return false;
      commit(dst.to === 'found' ? 'found' : 'move');
      return true;
    }
    function tapAuto(src, els) {
      const dst = L.autoTarget(st, src);
      if (dst && tryMove(src, dst)) return;
      els.forEach((n) => { n.classList.remove('sol-shake'); void n.offsetWidth; n.classList.add('sol-shake'); });
      kit.tone([140], 0.08, 'square', 0.03);
    }
    function draw() {
      const r = L.drawStock(st);
      if (r) commit('draw');
    }
    function doUndo() {
      if (busy || st.won) return;
      if (L.undo(st)) { commit('none'); kit.tone([440, 330], 0.04, 'triangle', 0.04); }
    }
    function hint() {
      if (busy || st.won) return;
      const h = L.findHint(st);
      const flash = (nodes) => nodes.filter(Boolean).forEach((n) => { n.classList.remove('sol-hint'); void n.offsetWidth; n.classList.add('sol-hint'); setTimeout(() => n.classList.remove('sol-hint'), 1300); });
      if (!h) { os.toast('No more moves. Try undo or start a new game.', 'solitaire'); return; }
      if (h.draw) { flash([st.stock.length ? cardEls.get(st.stock[st.stock.length - 1].id) : slotStock]); return; }
      const cards = L.takeable(st, h.src).map((c) => cardEls.get(c.id));
      let target;
      if (h.dst.to === 'found') { const f = st.found[L.takeable(st, h.src)[0].s]; target = f.length ? cardEls.get(f[f.length - 1].id) : slotFound[L.takeable(st, h.src)[0].s]; }
      else { const p = st.tab[h.dst.pile]; target = p.length ? cardEls.get(p[p.length - 1].id) : slotTab[h.dst.pile]; }
      flash(cards);
      setTimeout(() => flash([target]), 450);
    }
    async function autoComplete() {
      if (busy || st.won || !L.allUp(st)) return;
      busy = true; st.autoUsed = true; setBar();
      let idle = 0;
      while (!st.won && !destroyed) {
        const r = L.autoStep(st);
        if (!r) break;
        if (r === 'move') idle = 0; else if (++idle > st.stock.length + st.waste.length + 3) break;
        hudUpdate(); layout(true);
        kit.tone([700 + st.found.flat().length * 12], 0.04, 'triangle', 0.035);
        await os.util.sleep(r === 'move' ? 95 : 60);
      }
      busy = false;
      commit('none');
    }
    async function newGamePrompt() {
      if (busy) return;
      if (st.started && !st.won) {
        if (!(await os.ui.confirm('Your current game will be counted as a loss.', 'start a new game?', 'new game', 'cancel'))) return;
        await recordLoss(st);
      }
      reset(L.deal(prefs.draw));
    }
    async function restartDeal() {
      if (busy) return;
      if (st.started && !st.won) {
        if (!(await os.ui.confirm('Restart this deal from the beginning? It counts as a loss.', 'restart', 'restart', 'cancel'))) return;
        await recordLoss(st);
      }
      reset(L.deal(st.draw, st.seed));
    }
    function reset(ns) {
      stopCascade();
      st = ns;
      dealAnim();
      hudUpdate(); setBar();
      storage.del('game');
    }

    /* ---------- win */
    let cascadeStop = null;
    async function win() {
      busy = true;
      const bonus = L.winBonus(st);
      st.score += bonus;
      hudUpdate(); setBar();
      storage.del('game');
      const stats = await kit.updateStats((s) => {
        s.won++;
        s.best = Math.max(s.best || 0, st.score);
        s.bestTime = s.bestTime ? Math.min(s.bestTime, st.time) : st.time;
        s.streak = (s.streak || 0) + 1;
        s.longestStreak = Math.max(s.longestStreak || 0, s.streak);
        if (st.draw === 3) s.wins3 = (s.wins3 || 0) + 1; else s.wins1 = (s.wins1 || 0) + 1;
      }, STAT_DEFAULTS);
      kit.tone([523, 659, 784, 1047, 784, 1047], 0.11, 'triangle', 0.06);
      kit.unlock('first_win');
      if (st.draw === 3) kit.unlock('draw3_win');
      if (st.time < 180) kit.unlock('fast');
      if (!st.undos) kit.unlock('no_undo');
      if (st.score >= 5000) kit.unlock('score5000');
      if (stats.won >= 5) kit.unlock('win5');
      if (stats.streak >= 3) kit.unlock('streak3');
      if (st.autoUsed) kit.unlock('auto');
      await cascade();
      if (destroyed) return;
      const best = st.score >= stats.best;
      dialogOpen = true;
      const i = await os.ui.messageBox({
        title: 'you win!',
        message: `score ${st.score.toLocaleString()}${bonus ? ` (time bonus ${bonus.toLocaleString()})` : ''}${best ? ' · new best!' : ''}\ntime ${kit.formatTime(st.time)} · ${st.moves} moves\nwins ${stats.won} · streak ${stats.streak}`,
        buttons: ['new game', 'menu'],
      });
      dialogOpen = false;
      stopCascade();
      busy = false;
      if (i === 1) { offBack(); page.close(); return; }
      reset(L.deal(prefs.draw));
    }

    function drawCardCanvas(g, c, w, h) {
      const r = Math.max(2, w * 0.09);
      g.beginPath();
      g.roundRect ? g.roundRect(0.5, 0.5, w - 1, h - 1, r) : g.rect(0.5, 0.5, w - 1, h - 1);
      g.fillStyle = '#fff'; g.fill();
      g.strokeStyle = '#999'; g.lineWidth = 1; g.stroke();
      g.fillStyle = L.isRed(c.s) ? '#d4111e' : '#111';
      g.textBaseline = 'top';
      g.font = `700 ${Math.round(w * 0.36)}px "Segoe UI", system-ui, sans-serif`;
      g.fillText(L.RANKS[c.r] + L.SUITS[c.s], w * 0.05, 2);
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.font = `${Math.round(w * 0.6)}px "Segoe UI Symbol", system-ui, sans-serif`;
      g.fillText(c.r > 10 ? L.RANKS[c.r] : L.SUITS[c.s], w / 2, h * 0.9);
      g.textAlign = 'left';
    }

    function cascade() {
      return new Promise((resolve) => {
        const { W, H, cw, ch, colX, topY } = G;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = W * dpr; canvas.height = H * dpr;
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        board.append(canvas);
        const g = canvas.getContext('2d');
        g.scale(dpr, dpr);
        const sprites = new Map();
        for (const f of st.found) for (const c of f) {
          const oc = document.createElement('canvas');
          oc.width = cw * dpr; oc.height = ch * dpr;
          const og = oc.getContext('2d'); og.scale(dpr, dpr);
          drawCardCanvas(og, c, cw, ch);
          sprites.set(c.id, oc);
        }
        const queue = [];
        for (let r = 13; r >= 1; r--) for (let s = 0; s < 4; s++) queue.push(st.found[s][r - 1]);
        const live = [];
        let frame = 0, raf = 0, done = false;
        const k = Math.max(0.6, cw / 46);
        const finish = () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(raf);
          canvas.removeEventListener('pointerdown', finish);
          resolve();
        };
        cascadeStop = () => { finish(); canvas.remove(); cardEls.forEach((n) => (n.style.visibility = '')); cascadeStop = null; };
        canvas.addEventListener('pointerdown', finish);
        const step = () => {
          if (destroyed) return finish();
          frame++;
          if (queue.length && frame % 7 === 1) {
            const c = queue.shift();
            cardEls.get(c.id).style.visibility = 'hidden';
            live.push({ c, x: colX(3 + c.s), y: topY, vx: (1.5 + Math.random() * 4) * k * (Math.random() < 0.5 ? -1 : 1), vy: -(Math.random() * 6) * k });
          }
          for (const p of live) {
            p.vy += 0.55 * k;
            p.x += p.vx; p.y += p.vy;
            if (p.y + ch > H) { p.y = H - ch; p.vy = -p.vy * (0.62 + Math.random() * 0.2); }
            g.drawImage(sprites.get(p.c.id), p.x, p.y, cw, ch);
          }
          for (let i = live.length - 1; i >= 0; i--) if (live[i].x > W + 2 || live[i].x + cw < -2) live.splice(i, 1);
          if (!queue.length && !live.length) return finish();
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    }
    function stopCascade() { cascadeStop?.(); }

    /* ---------- pointer input */
    let drag = null;
    const boardPt = (e) => { const r = board.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = (e) => {
      if (busy || dialogOpen || drag || e.button > 0) return;
      const n = e.target.closest('.sol-card');
      const pt = boardPt(e);
      if (!n) {
        if (e.target.closest('.sol-slot-stock')) drag = { stock: true, ...pt, moved: false };
        return;
      }
      const loc = L.locate(st, +n.dataset.id);
      if (!loc) return;
      if (loc.from === 'stock') { drag = { stock: true, ...pt, moved: false }; return; }
      let src;
      if (loc.from === 'waste') { if (!loc.top) return; src = { from: 'waste' }; }
      else if (loc.from === 'found') { if (!loc.top) return; src = { from: 'found', pile: loc.pile }; }
      else src = { from: 'tab', pile: loc.pile, index: loc.index };
      const cards = L.takeable(st, src);
      if (!cards) return;
      const els = cards.map((c) => cardEls.get(c.id));
      drag = { src, els, sx: pt.x, sy: pt.y, base: els.map((x) => ({ x: x._x, y: x._y })), moved: false, t: Date.now() };
      try { board.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!drag || drag.stock) return;
      const pt = boardPt(e);
      const dx = pt.x - drag.sx, dy = pt.y - drag.sy;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 7) return;
        drag.moved = true;
        drag.els.forEach((n, k) => { n.classList.add('sol-dragging'); clearTimeout(zTimers.get(n)); zTimers.delete(n); n.style.zIndex = 3000 + k; });
      }
      drag.dx = dx; drag.dy = dy;
      drag.els.forEach((n, k) => { n.style.transform = `translate(${drag.base[k].x + dx}px, ${drag.base[k].y + dy}px)`; });
    };
    const onUp = (e) => {
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.stock) { if (e.type === 'pointerup') draw(); return; }
      d.els.forEach((n) => n.classList.remove('sol-dragging'));
      if (e.type !== 'pointerup') { layout(true); return; }
      if (!d.moved) { tapAuto(d.src, d.els); return; }
      // drop: find the best overlapping target
      const { cw, ch, colX, topY } = G;
      const x0 = d.base[0].x + d.dx, y0 = d.base[0].y + d.dy;
      const overlap = (x, y, w, h) => Math.max(0, Math.min(x0 + cw, x + w) - Math.max(x0, x)) * Math.max(0, Math.min(y0 + ch, y + h) - Math.max(y0, y));
      const cands = [];
      for (let s = 0; s < 4; s++) cands.push({ dst: { to: 'found' }, a: overlap(colX(3 + s), topY, cw, ch) });
      for (let p = 0; p < 7; p++) {
        const ys = pilePositions(p);
        const y = ys.length ? ys[ys.length - 1] : G.tabY;
        cands.push({ dst: { to: 'tab', pile: p }, a: overlap(colX(p), (ys[0] ?? G.tabY), cw, y - (ys[0] ?? G.tabY) + ch) });
      }
      cands.sort((a, b) => b.a - a.a);
      for (const c of cands) if (c.a > 0 && L.isLegal(st, d.src, c.dst)) { tryMove(d.src, c.dst); return; }
      layout(true);
    };
    board.addEventListener('pointerdown', onDown);
    board.addEventListener('pointermove', onMove);
    board.addEventListener('pointerup', onUp);
    board.addEventListener('pointercancel', onUp);
    board.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ---------- keyboard */
    const onKey = (e) => {
      if (!kit.isActive() || page.el.hidden || dialogOpen || e.altKey) return;
      const k = e.key.toLowerCase();
      if ((k === 'z' && (e.ctrlKey || e.metaKey)) || (k === 'u' && !e.ctrlKey && !e.metaKey)) doUndo();
      else if (k === ' ' || k === 'd') { if (!busy) draw(); }
      else if (k === 'h') hint();
      else if (k === 'a') autoComplete();
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);

    /* ---------- timer, lifecycle */
    const timer = setInterval(() => {
      if (paused || busy || dialogOpen || !st.started || st.won || page.el.hidden || !kit.isActive()) return;
      L.tick(st); hudUpdate();
      if (st.time % 5 === 0) save();
    }, 1000);
    const offSuspend = ctx.on('suspend', () => { paused = true; save(true); });
    const offResume = ctx.on('resume', () => { paused = false; });
    const offBack = ctx.onBack(() => {
      if (page.el.hidden) return false;
      if (dialogOpen) return true;
      if (busy && !cascadeStop) return true;
      if (st.won) return false;
      dialogOpen = true; paused = true;
      kit.pauseDialog({ restart: true, message: `score ${st.score} · ${kit.formatTime(st.time)} · ${st.moves} moves` }).then(async (r) => {
        dialogOpen = false; paused = false;
        if (r === 'quit') { save(true); offBack(); page.close(); }
        else if (r === 'restart') { await recordLoss(st); reset(L.deal(st.draw, st.seed)); }
      });
      return true;
    });
    const ro = new ResizeObserver(() => { if (!page.el.hidden && board.clientWidth) layout(false); });
    ro.observe(board);

    // initial deal animation: start everything on the stock, then fly out
    function dealAnim() {
      G = geom();
      board.classList.add('sol-noanim');
      board.style.setProperty('--cw', G.cw + 'px'); board.style.setProperty('--ch', G.ch + 'px');
      cardEls.forEach((n) => { n._x = G.colX(0); n._y = G.topY; n._up = false; n.classList.remove('up'); n.style.zIndex = 10; n.style.transform = `translate(${n._x}px, ${n._y}px)`; });
      // stagger tableau cards so they fly out one after another
      st.tab.forEach((pile, p) => pile.forEach((c, i) => cardEls.get(c.id).style.transitionDelay = ((i * 7 + p) * 18) + 'ms'));
      void board.offsetWidth;
      requestAnimationFrame(() => {
        board.classList.remove('sol-noanim');
        layout(true);
        setTimeout(() => cardEls.forEach((n) => (n.style.transitionDelay = '')), 1300);
      });
      kit.tone([392, 523, 659], 0.06, 'triangle', 0.035);
    }
    requestAnimationFrame(() => { if (!page.params.resume) dealAnim(); else layout(false); });
    hudUpdate(); setBar();

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      save(true);
      clearInterval(timer); clearTimeout(saveT);
      zTimers.forEach((t) => clearTimeout(t));
      window.removeEventListener('keydown', onKey, true);
      offBack(); offSuspend?.(); offResume?.();
      ro.disconnect();
      stopCascade();
    };
    cleanups.push(destroy);
    return { onDestroy: destroy, onShow: () => { if (G) layout(false); } };
  }

  return { onDestroy: () => cleanups.forEach((f) => f()) };
}
