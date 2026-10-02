import './style.css';
import { createKit } from './gamekit.js';
import { LETTER_VALUES, NEIGHBORS, isAdjacent, buildTrie, parseWords, scoreWord, pathWord, generateBoard, findPath, totalScore } from './logic.js';

const ROUND_SECONDS = 120;
const ACHIEVEMENTS = [
  { id: 'first_round', title: 'Wordsmith Apprentice', description: 'Complete your first round.', gamerscore: 10 },
  { id: 'words20', title: 'Word Hoard', description: 'Find 20 words in one round.', gamerscore: 20 },
  { id: 'words40', title: 'Walking Lexicon', description: 'Find 40 words in one round.', gamerscore: 30 },
  { id: 'long7', title: 'Long Haul', description: 'Find a word of 7 letters or more.', gamerscore: 20 },
  { id: 'score300', title: 'Big Scorer', description: 'Score 300 points in one round.', gamerscore: 25 },
  { id: 'rapid', title: 'Rapid Fire', description: 'Find 5 words within 10 seconds.', gamerscore: 15 },
  { id: 'rounds10', title: 'Regular', description: 'Play 10 rounds.', gamerscore: 20 },
];

let triePromise = null;
const loadTrie = () => (triePromise ??= import('./words.js').then((m) => buildTrie(parseWords(m.default))));

export default async function launch(ctx) {
  const { root, os, storage } = ctx;
  const { el, I } = os.ui;
  const kit = createKit(ctx, { game: 'wordament', name: 'Wordament', achievements: ACHIEVEMENTS });
  root.classList.add('wordament-app');
  loadTrie(); // warm up in the background

  let current = null; // active game controller (for suspend / destroy)

  ctx.on('suspend', () => current?.pause());
  ctx.navigate(menuPage);

  /* ------------------------------------------------------------ menu */
  async function menuPage(page) {
    const p = os.ui.page({ app: 'WORDAMENT', title: 'wordament', cls: 'wordament-menu' });
    const logo = el('div.wordament-logo', [...'WORD'].map((ch, i) => el('div.wordament-logo-tile', { style: { animationDelay: i * 70 + 'ms' } }, ch, el('i', String(LETTER_VALUES[ch])))));
    const bestLine = el('div.wordament-bestline');
    p.content.append(logo, bestLine);
    kit.menu(p.content, {
      items: [
        { label: 'play', sub: 'new 2 minute round', accent: true, onClick: () => ctx.navigate(gamePage) },
        { label: 'scores', sub: 'high scores and statistics', onClick: () => ctx.navigate(scoresPage) },
        { label: 'how to play', sub: 'rules and scoring', onClick: () => ctx.navigate(helpPage) },
      ],
    });
    const refresh = async () => {
      const s = await kit.getStats();
      bestLine.textContent = s.played ? `best score ${s.best} · ${s.played} round${s.played === 1 ? '' : 's'} played` : 'find words. beat the clock.';
    };
    refresh();
    return { el: p.el, onShow: refresh };
  }

  /* ------------------------------------------------------------ help */
  function helpPage() {
    const p = os.ui.page({ app: 'WORDAMENT', title: 'how to play' });
    const sec = (h, t) => [os.ui.header(h), el('p', t)];
    p.content.append(
      ...sec('the goal', 'Find as many words as you can in 2 minutes by swiping through adjacent tiles — up, down, sideways or diagonally. Each tile can be used once per word.'),
      ...sec('words', 'Words must be at least 3 letters long. Proper nouns and abbreviations don\'t count. Some boards have a "QU" tile that counts as two letters.'),
      ...sec('colours', 'When you lift your finger the tiles flash green for a new word, yellow for a word you already found, and red when it isn\'t a word.'),
      ...sec('scoring', 'Each tile shows its letter value in the corner. A word scores the sum of its tiles, multiplied for length: 5 letters ×1.5, 6 ×2, 7 ×2.5, 8+ ×3.'),
      ...sec('keyboard', 'On a PC you can type a word and press Enter. Press Space or Delete to clear what you typed. Press Esc to pause.'),
    );
    return p.el;
  }

  /* ------------------------------------------------------------ scores */
  async function scoresPage() {
    const s = await kit.getStats();
    const hs = await storage.get('highscores', []);
    const pv = os.ui.pivot({
      app: 'WORDAMENT',
      items: [
        {
          header: 'high scores',
          render(c) {
            if (!hs.length) { c.append(os.ui.empty('no rounds played yet')); return; }
            c.append(os.ui.list(hs, {
              render: (h, i) => el('div.wordament-hs-row',
                el('div.wordament-hs-rank', String(hs.indexOf(h) + 1)),
                el('div.wp-row-text', el('div.wp-row-title', h.score + ' points'),
                  el('div.wp-row-sub', `${h.words} words${h.longest ? ' · longest "' + h.longest + '"' : ''} · ${new Date(h.date).toLocaleDateString()}`))),
            }));
          },
        },
        {
          header: 'statistics',
          render(c) {
            const row = (k, v) => el('div.wordament-stat', el('div.wordament-stat-k', k), el('div.wordament-stat-v', String(v)));
            c.append(
              row('rounds played', s.played),
              row('best score', s.best),
              row('average score', s.played ? Math.round((s.totalScore || 0) / s.played) : 0),
              row('most words in a round', s.bestWords || 0),
              row('total words found', s.totalWords || 0),
              row('longest word', s.longest || '—'),
              row('best word', s.bestWord ? `${s.bestWord} (${s.bestWordScore})` : '—'),
            );
          },
        },
      ],
    });
    const bar = os.ui.appBar({
      minimized: true,
      menu: [{
        label: 'reset statistics',
        onClick: async () => {
          if (!(await os.ui.confirm('Clear all Wordament scores and statistics?', 'reset', 'reset', 'cancel'))) return;
          await storage.set('stats', {}); await storage.set('highscores', []);
          os.tiles.refresh('wordament')?.catch?.(() => {});
          ctx.back();
        },
      }],
    });
    pv.el.append(bar.el);
    return pv.el;
  }

  /* ------------------------------------------------------------ game */
  async function gamePage(page) {
    const wrap = el('div.wordament-game');
    page.el.append(wrap);
    wrap.append(el('div.wordament-loading', el('div.wp-app-title', 'WORDAMENT'), el('div.wordament-loading-text', 'shuffling tiles…'), os.ui.loadingDots()));
    let trie;
    try { trie = await loadTrie(); } catch (e) {
      wrap.replaceChildren(el('div.wordament-loading', el('div.wordament-loading-text', 'Couldn\'t load the dictionary.')));
      return {};
    }
    const { board, words: all } = generateBoard(trie, { minWords: 120 });

    // --- state
    const found = new Map(); // word -> { score, path }
    const foundTimes = [];
    let score = 0;
    let elapsed = 0, lastTick = 0, running = false, finished = false, timer = 0;
    let trace = [];
    let typed = '';
    let dialogOpen = false;
    let lastWarn = -1;
    let introRunning = true;

    // --- DOM
    const timeEl = el('div.wordament-time', kit.formatTime(ROUND_SECONDS));
    const scoreEl = el('div.wordament-score', '0');
    const countEl = el('div.wordament-count', '0 words');
    const wordEl = el('div.wordament-word');
    const tiles = board.map((t, i) => el('div.wordament-tile', { dataset: { i } },
      el('span.wordament-letter' + (t.length > 1 ? '.wordament-digraph' : ''), t[0] + t.slice(1).toLowerCase()),
      el('span.wordament-value', String(LETTER_VALUES[t]))));
    const svgNS = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(svgNS, 'polyline');
    line.setAttribute('class', 'wordament-line');
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'wordament-svg');
    svg.setAttribute('viewBox', '0 0 400 400');
    svg.append(line);
    const grid = el('div.wordament-grid', ...tiles, svg);
    const pauseCover = el('div.wordament-cover', { onclick: () => resume() }, el('div', 'paused'), el('div.wordament-cover-sub', 'tap to resume'));
    pauseCover.hidden = true;
    const gridBox = el('div.wordament-gridbox', grid, pauseCover);
    const foundList = el('div.wordament-found');
    const foundHead = el('div.wordament-found-head', `words found · ${all.size} on this board`);
    wrap.replaceChildren(
      el('div.wordament-top',
        el('div', el('div.wp-app-title', 'WORDAMENT'), el('div.wordament-scoreline', scoreEl, countEl)),
        timeEl),
      wordEl, gridBox, foundHead, foundList);

    // --- timer
    const tick = () => {
      if (!running) return;
      const now = performance.now();
      elapsed += (now - lastTick) / 1000; lastTick = now;
      const left = Math.max(0, ROUND_SECONDS - elapsed);
      timeEl.textContent = kit.formatTime(Math.ceil(left));
      timeEl.classList.toggle('low', left <= 10);
      const sec = Math.ceil(left);
      if (sec <= 5 && sec > 0 && sec !== lastWarn) { lastWarn = sec; kit.tone(880, 0.06, 'sine', 0.05); }
      if (left <= 0) endRound();
    };
    const start = () => { if (finished || running) return; running = true; lastTick = performance.now(); clearInterval(timer); timer = setInterval(tick, 100); pauseCover.hidden = true; };
    // pausing always hides the board (no peeking)
    const pause = () => {
      if (!running) return;
      tick(); running = false; clearInterval(timer);
      cancelTrace();
      if (!finished) pauseCover.hidden = false;
    };
    const resume = () => { if (!finished && !dialogOpen) start(); };

    // --- word evaluation
    const setWord = (text, cls = '') => { wordEl.className = 'wordament-word' + (cls ? ' ' + cls : ''); wordEl.textContent = text; };
    const flash = (path, cls) => {
      for (const i of path) {
        const t = tiles[i];
        t.classList.remove('sel', 'good', 'dup', 'bad');
        void t.offsetWidth;
        t.classList.add(cls);
        setTimeout(() => t.classList.remove(cls), 450);
      }
    };
    const drawLine = () => {
      const pts = trace.map((i) => `${(i & 3) * 100 + 50},${(i >> 2) * 100 + 50}`).join(' ');
      line.setAttribute('points', pts);
    };
    const markSel = () => {
      tiles.forEach((t, i) => t.classList.toggle('sel', trace.includes(i)));
      drawLine();
    };
    const submit = (path) => {
      if (!path.length) return;
      const w = pathWord(board, path);
      if (path.length < 2 || w.length < 3) { setWord(w.toUpperCase(), 'muted'); flash(path, 'bad'); return; }
      if (found.has(w)) { setWord(w.toUpperCase() + ' · already found', 'dup'); flash(path, 'dup'); kit.tone([330, 330], 0.06, 'triangle', 0.04); return; }
      if (!all.has(w)) { setWord(w.toUpperCase(), 'bad'); flash(path, 'bad'); kit.tone(140, 0.16, 'sawtooth', 0.03); os.device.vibrate?.(30); return; }
      const pts = scoreWord(board, path);
      found.set(w, { score: pts, path });
      score += pts;
      foundTimes.push(elapsed);
      setWord(`${w.toUpperCase()} +${pts}`, 'good');
      flash(path, 'good');
      kit.tone([523, 659, 784].slice(0, Math.min(3, w.length - 1)), 0.06, 'sine', 0.06);
      scoreEl.textContent = String(score);
      scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump');
      countEl.textContent = `${found.size} word${found.size === 1 ? '' : 's'}`;
      const item = el('div.wordament-found-item', el('span', w), el('b', '+' + pts));
      foundList.prepend(item);
      if (w.length >= 7) kit.unlock('long7');
      if (found.size >= 20) kit.unlock('words20');
      if (found.size >= 40) kit.unlock('words40');
      if (foundTimes.length >= 5 && elapsed - foundTimes[foundTimes.length - 5] <= 10) kit.unlock('rapid');
    };

    // --- pointer tracing
    let tracing = false;
    const cellAt = (e) => {
      const r = grid.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const cs = r.width / 4;
      const c = Math.floor(x / cs), rr = Math.floor(y / cs);
      if (c < 0 || c > 3 || rr < 0 || rr > 3) return -1;
      const dx = x - (c + 0.5) * cs, dy = y - (rr + 0.5) * cs;
      return { i: rr * 4 + c, inner: Math.hypot(dx, dy) < cs * 0.4 };
    };
    const extend = (i) => {
      const last = trace[trace.length - 1];
      if (i === last) return;
      if (trace.length >= 2 && i === trace[trace.length - 2]) { trace.pop(); markSel(); updateTraceWord(); return; }
      if (trace.includes(i) || (last != null && !isAdjacent(last, i))) return;
      trace.push(i);
      kit.tone(600 + trace.length * 40, 0.03, 'sine', 0.015);
      markSel(); updateTraceWord();
    };
    const updateTraceWord = () => setWord(pathWord(board, trace).toUpperCase());
    function cancelTrace() { tracing = false; trace = []; markSel(); }
    grid.addEventListener('pointerdown', (e) => {
      if (!running) return;
      const c = cellAt(e);
      if (c === -1) return;
      e.preventDefault();
      typed = '';
      tracing = true; trace = [];
      try { grid.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      extend(c.i);
    });
    grid.addEventListener('pointermove', (e) => {
      if (!tracing) return;
      const c = cellAt(e);
      if (c === -1 || !c.inner) return;
      extend(c.i);
    });
    const finishTrace = () => {
      if (!tracing) return;
      tracing = false;
      const p = trace; trace = [];
      markSel();
      if (running) submit(p);
    };
    grid.addEventListener('pointerup', finishTrace);
    grid.addEventListener('pointercancel', () => cancelTrace());

    // --- keyboard (desktop): type a word + Enter
    const showTyped = () => {
      const p = typed ? findPath(board, typed) : null;
      trace = p || []; markSel();
      setWord(typed.toUpperCase(), typed && !p ? 'muted' : '');
    };
    const onKey = (e) => {
      if (!kit.isActive() || !running || dialogOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key)) { typed += e.key.toLowerCase(); showTyped(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const p = typed ? findPath(board, typed) : null;
        const t = typed; typed = ''; trace = []; markSel();
        if (p) submit(p);
        else if (t) { setWord(t.toUpperCase() + ' · not on board', 'bad'); kit.tone(140, 0.16, 'sawtooth', 0.03); }
      } else if (e.key === ' ' || e.key === 'Delete') { e.preventDefault(); typed = ''; showTyped(); }
    };
    window.addEventListener('keydown', onKey, true);

    // --- end of round
    async function endRound() {
      if (finished) return;
      finished = true; running = false; clearInterval(timer);
      cancelTrace();
      kit.tone([784, 659, 523, 392], 0.12, 'triangle', 0.06);
      grid.classList.add('over');
      const longest = [...found.keys()].sort((a, b) => b.length - a.length)[0] || '';
      let bestW = null;
      for (const [w, v] of found) if (!bestW || v.score > bestW[1]) bestW = [w, v.score];
      const prevStats = await kit.getStats();
      const isBest = score > (prevStats.best || 0);
      const stats = await kit.updateStats((s) => {
        s.played++;
        if (found.size >= 10) s.won++;
        s.best = Math.max(s.best || 0, score);
        s.bestWords = Math.max(s.bestWords || 0, found.size);
        s.totalWords = (s.totalWords || 0) + found.size;
        s.totalScore = (s.totalScore || 0) + score;
        if (longest.length > (s.longest || '').length) s.longest = longest;
        if (bestW && bestW[1] > (s.bestWordScore || 0)) { s.bestWord = bestW[0]; s.bestWordScore = bestW[1]; }
      });
      const hs = await storage.get('highscores', []);
      const entry = { score, words: found.size, longest, date: Date.now() };
      hs.push(entry);
      hs.sort((a, b) => b.score - a.score || a.date - b.date);
      const rank = hs.indexOf(entry) + 1;
      await storage.set('highscores', hs.slice(0, 10));
      os.tiles.refresh('wordament')?.catch?.(() => {});
      kit.unlock('first_round');
      if (score >= 300) kit.unlock('score300');
      if (stats.played >= 10) kit.unlock('rounds10');
      setTimeout(() => showResults({ isBest, rank: rank <= 10 ? rank : 0, longest }), 900);
    }

    function miniBoard(path) {
      return el('div.wordament-mini', board.map((t, i) => {
        const k = path.indexOf(i);
        return el('div.wordament-mini-tile' + (k >= 0 ? '.on' : '') + (k === 0 ? '.first' : ''), t[0] + t.slice(1).toLowerCase(), k >= 0 ? el('i', String(k + 1)) : null);
      }));
    }
    const showWord = (w, v) => os.ui.messageBox({ title: `${w} · ${v.score} points`, content: miniBoard(v.path), buttons: ['close'] });

    function showResults({ isBest, rank, longest }) {
      const missed = [...all.entries()].filter(([w]) => !found.has(w)).sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
      const foundArr = [...found.entries()].sort((a, b) => b[1].score - a[1].score);
      const possible = totalScore(all);
      const wordRow = ([w, v], cls = '') => el('div.wordament-res-word' + cls + '.tilt', { onclick: () => showWord(w, v) }, el('span', w), el('b', String(v.score)));
      const pv = os.ui.pivot({
        app: 'WORDAMENT',
        items: [
          {
            header: 'results',
            render(c) {
              c.append(
                el('div.wordament-res-big', String(score)),
                el('div.wordament-res-sub', isBest ? 'new personal best!' : rank ? `#${rank} on your high scores` : 'points'),
                el('div.wordament-stat', el('div.wordament-stat-k', 'words found'), el('div.wordament-stat-v', `${found.size} of ${all.size}`)),
                el('div.wordament-stat', el('div.wordament-stat-k', 'points possible'), el('div.wordament-stat-v', String(possible))),
                el('div.wordament-stat', el('div.wordament-stat-k', 'longest word'), el('div.wordament-stat-v', longest || '—')),
                el('div.wordament-stat', el('div.wordament-stat-k', 'best word on board'), el('div.wordament-stat-v', missed[0] && (!foundArr[0] || missed[0][1].score > foundArr[0][1].score) ? `${missed[0][0]} (${missed[0][1].score})` : foundArr[0] ? `${foundArr[0][0]} (${foundArr[0][1].score})` : '—')),
                miniBoard([]),
              );
            },
          },
          {
            header: 'found',
            render(c) {
              if (!foundArr.length) { c.append(os.ui.empty('no words this time')); return; }
              c.append(el('div.wordament-res-list', foundArr.map((x) => wordRow(x, '.found'))));
            },
          },
          {
            header: 'missed',
            render(c) {
              if (!missed.length) { c.append(os.ui.empty('you found every word!')); return; }
              c.append(os.ui.desc(`${missed.length} words you didn't find · tap a word to see it`), el('div.wordament-res-list', missed.map((x) => wordRow(x))));
            },
          },
        ],
      });
      const bar = os.ui.appBar({
        buttons: [
          { icon: I.refresh, label: 'play again', onClick: async () => { await page.close(); ctx.navigate(gamePage); } },
          { icon: I.home, label: 'menu', onClick: () => page.close() },
        ],
      });
      pv.el.classList.add('wordament-results', 'anim-turnstile-in');
      pv.el.append(bar.el);
      wrap.replaceChildren(pv.el);
    }

    // --- back = pause dialog
    const offBack = ctx.onBack(async () => {
      if (finished) return false;
      if (dialogOpen) return true;
      pause();
      dialogOpen = true;
      const r = await kit.pauseDialog({ restart: true, message: `${kit.formatTime(Math.ceil(ROUND_SECONDS - elapsed))} left · ${score} points` });
      dialogOpen = false;
      if (r === 'resume') { if (!introRunning) start(); }
      else if (r === 'restart') { finished = true; await page.close(); ctx.navigate(gamePage); }
      else { finished = true; page.close(); }
      return true;
    });

    current = { pause };

    // countdown intro, then go
    const intro = el('div.wordament-intro', '3');
    gridBox.append(intro);
    setWord('get ready…', 'muted');
    (async () => {
      for (const n of ['3', '2', '1']) {
        if (finished) return;
        intro.textContent = n;
        intro.classList.remove('pop'); void intro.offsetWidth; intro.classList.add('pop');
        kit.tone(n === '1' ? 660 : 440, 0.08, 'sine', 0.04);
        await os.util.sleep(600);
      }
      introRunning = false;
      intro.remove();
      if (finished) return;
      setWord('swipe to make words', 'muted');
      if (!dialogOpen && kit.isActive()) start();
      else pauseCover.hidden = false;
    })();

    return {
      onDestroy() {
        finished = true; running = false; clearInterval(timer);
        offBack(); window.removeEventListener('keydown', onKey, true);
        if (current?.pause === pause) current = null;
      },
    };
  }

  return {
    onDestroy() { current = null; },
  };
}

// exported for tests / debugging
export { NEIGHBORS };
