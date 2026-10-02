// Pure Klondike rules (no DOM). Cards: { id, s (0♠ 1♥ 2♦ 3♣), r (1..13), up }.
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const isRed = (s) => s === 1 || s === 2;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newDeck(seed) {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ id: s * 13 + r - 1, s, r, up: false });
  const rand = rng(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function deal(draw = 1, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0) {
  const deck = newDeck(seed);
  const tab = [[], [], [], [], [], [], []];
  for (let row = 0; row < 7; row++) for (let col = row; col < 7; col++) tab[col].push(deck.pop());
  tab.forEach((p) => (p[p.length - 1].up = true));
  return {
    draw, seed, stock: deck, waste: [], found: [[], [], [], []], tab,
    score: 0, moves: 0, time: 0, passes: 0, history: [], undos: 0, won: false, autoUsed: false, started: false,
  };
}

const top = (a) => a[a.length - 1];
const clampScore = (st) => { if (st.score < 0) st.score = 0; };

function snapshot(st) {
  st.history.push(JSON.stringify({ stock: st.stock, waste: st.waste, found: st.found, tab: st.tab, score: st.score, moves: st.moves, passes: st.passes }));
  if (st.history.length > 300) st.history.shift();
}

export function undo(st) {
  const h = st.history.pop();
  if (!h) return false;
  Object.assign(st, JSON.parse(h));
  st.undos++;
  return true;
}

export function canOnTableau(card, pile) {
  const t = top(pile);
  if (!t) return card.r === 13;
  return t.up && isRed(t.s) !== isRed(card.s) && t.r === card.r + 1;
}
export function canOnFoundation(card, st) {
  const f = st.found[card.s];
  return f.length + 1 === card.r;
}

/** Cards that would move for a source { from: 'waste'|'tab'|'found', pile, index }, or null. */
export function takeable(st, src) {
  if (src.from === 'waste') return st.waste.length ? [top(st.waste)] : null;
  if (src.from === 'found') { const f = st.found[src.pile]; return f?.length ? [top(f)] : null; }
  if (src.from === 'tab') {
    const p = st.tab[src.pile];
    const i = src.index ?? p.length - 1;
    if (!p || i < 0 || i >= p.length || !p[i].up) return null;
    const run = p.slice(i);
    for (let k = 1; k < run.length; k++) if (!(isRed(run[k].s) !== isRed(run[k - 1].s) && run[k - 1].r === run[k].r + 1)) return null;
    return run;
  }
  return null;
}

export function isLegal(st, src, dst) {
  const cards = takeable(st, src);
  if (!cards) return false;
  if (dst.to === 'found') return cards.length === 1 && canOnFoundation(cards[0], st) && src.from !== 'found';
  if (dst.to === 'tab') {
    if (src.from === 'tab' && src.pile === dst.pile) return false;
    return canOnTableau(cards[0], st.tab[dst.pile]);
  }
  return false;
}

/** Perform a move. Returns true when it happened. Standard (Windows) scoring. */
export function move(st, src, dst) {
  if (st.won || !isLegal(st, src, dst)) return false;
  snapshot(st);
  const cards = takeable(st, src);
  // remove from source
  if (src.from === 'waste') st.waste.pop();
  else if (src.from === 'found') st.found[src.pile].pop();
  else st.tab[src.pile].splice(src.index ?? st.tab[src.pile].length - 1);
  // add to destination
  if (dst.to === 'found') st.found[cards[0].s].push(cards[0]);
  else st.tab[dst.pile].push(...cards);
  // score
  if (dst.to === 'found') st.score += src.from === 'found' ? 0 : 10;
  else if (src.from === 'waste') st.score += 5;
  else if (src.from === 'found') st.score -= 15;
  // flip newly exposed tableau card
  if (src.from === 'tab') {
    const t = top(st.tab[src.pile]);
    if (t && !t.up) { t.up = true; st.score += 5; }
  }
  clampScore(st);
  st.moves++;
  st.started = true;
  st.won = isWon(st);
  return true;
}

/** Tap on stock: deal draw-count cards to waste, or recycle waste. */
export function drawStock(st) {
  if (st.won) return false;
  if (st.stock.length) {
    snapshot(st);
    const n = Math.min(st.draw, st.stock.length);
    for (let i = 0; i < n; i++) { const c = st.stock.pop(); c.up = true; st.waste.push(c); }
    st.moves++; st.started = true;
    return 'draw';
  }
  if (st.waste.length) {
    snapshot(st);
    st.stock = st.waste.reverse().map((c) => ({ ...c, up: false }));
    st.waste = [];
    st.passes++;
    if (st.draw === 1) st.score -= 100;
    else if (st.passes > 3) st.score -= 20;
    clampScore(st);
    st.moves++; st.started = true;
    return 'recycle';
  }
  return false;
}

/** One second of play: timed scoring loses 2 points every 10 seconds. */
export function tick(st) {
  st.time++;
  if (st.time % 10 === 0) { st.score -= 2; clampScore(st); }
}

export const winBonus = (st) => (st.time >= 30 ? Math.round(700000 / st.time) : 0);
export const isWon = (st) => st.found.every((f) => f.length === 13);
export const allUp = (st) => st.tab.every((p) => p.every((c) => c.up));

/** Find where a card is. Returns a source descriptor (with stock as from:'stock'). */
export function locate(st, id) {
  let i = st.waste.findIndex((c) => c.id === id);
  if (i >= 0) return { from: 'waste', index: i, top: i === st.waste.length - 1 };
  i = st.stock.findIndex((c) => c.id === id);
  if (i >= 0) return { from: 'stock', index: i };
  for (let p = 0; p < 4; p++) { i = st.found[p].findIndex((c) => c.id === id); if (i >= 0) return { from: 'found', pile: p, index: i, top: i === st.found[p].length - 1 }; }
  for (let p = 0; p < 7; p++) { i = st.tab[p].findIndex((c) => c.id === id); if (i >= 0) return { from: 'tab', pile: p, index: i }; }
  return null;
}

/** Best destination for a tap-to-move. */
export function autoTarget(st, src) {
  const cards = takeable(st, src);
  if (!cards) return null;
  if (cards.length === 1 && src.from !== 'found' && canOnFoundation(cards[0], st)) return { to: 'found' };
  const order = [];
  for (let k = 1; k <= 7; k++) order.push(((src.from === 'tab' ? src.pile : -1) + k + 7) % 7);
  // non-empty piles first
  for (const p of order) if (st.tab[p].length && isLegal(st, src, { to: 'tab', pile: p })) return { to: 'tab', pile: p };
  // kings to empty piles (but not a king already at the bottom of a pile)
  if (!(src.from === 'tab' && src.index === 0)) for (const p of order) if (!st.tab[p].length && isLegal(st, src, { to: 'tab', pile: p })) return { to: 'tab', pile: p };
  return null;
}

/** One auto-complete step: foundation move, else draw. Returns 'move' | 'draw' | false. */
export function autoStep(st) {
  // lowest card first so the cascade looks tidy
  const cands = [];
  if (st.waste.length) cands.push({ from: 'waste' });
  st.tab.forEach((p, i) => { if (p.length) cands.push({ from: 'tab', pile: i, index: p.length - 1 }); });
  cands.sort((a, b) => takeable(st, a)[0].r - takeable(st, b)[0].r);
  for (const src of cands) if (move(st, src, { to: 'found' })) return 'move';
  if (st.stock.length || st.waste.length) return drawStock(st) ? 'draw' : false;
  return false;
}

/** Run auto-complete to the end (used by tests). Returns true if won. */
export function autoComplete(st) {
  let idle = 0;
  while (!st.won) {
    const r = autoStep(st);
    if (!r) break;
    if (r === 'move') idle = 0;
    else if (++idle > st.stock.length + st.waste.length + 3) break;
  }
  return st.won;
}

/** A useful move suggestion: { src, dst } | { draw: true } | null. */
export function findHint(st) {
  const srcs = [];
  if (st.waste.length) srcs.push({ from: 'waste' });
  st.tab.forEach((p, i) => p.forEach((c, j) => { if (c.up) srcs.push({ from: 'tab', pile: i, index: j }); }));
  // 1. to foundation
  for (const src of srcs) {
    const cs = takeable(st, src);
    if (cs && cs.length === 1 && canOnFoundation(cs[0], st)) return { src, dst: { to: 'found' } };
  }
  // 2. tableau moves that reveal a hidden card or empty a pile for a king
  for (const src of srcs) {
    if (src.from !== 'tab') continue;
    const p = st.tab[src.pile];
    const reveals = src.index > 0 && !p[src.index - 1].up;
    if (!reveals) continue;
    for (let d = 0; d < 7; d++) if (isLegal(st, src, { to: 'tab', pile: d })) return { src, dst: { to: 'tab', pile: d } };
  }
  // 3. waste to tableau
  if (st.waste.length) for (let d = 0; d < 7; d++) if (isLegal(st, { from: 'waste' }, { to: 'tab', pile: d })) return { src: { from: 'waste' }, dst: { to: 'tab', pile: d } };
  // 4. stock
  if (st.stock.length || st.waste.length) return { draw: true };
  return null;
}

/** Strip history for compact persistence (keeps last N snapshots). */
export function serialize(st, keep = 60) {
  return { ...st, history: st.history.slice(-keep) };
}
