// Pure Minesweeper logic (no DOM) — unit-testable in node.

export const DIFFICULTIES = {
  beginner: { w: 9, h: 9, mines: 10, label: 'beginner' },
  intermediate: { w: 16, h: 16, mines: 40, label: 'intermediate' },
  expert: { w: 16, h: 30, mines: 99, label: 'expert' }, // 30x16 rotated for portrait
};

export function createGame(w, h, mines) {
  const cells = [];
  for (let i = 0; i < w * h; i++) cells.push({ mine: false, n: 0, open: false, flag: false });
  return { w, h, mines, cells, generated: false, status: 'ready', opened: 0, flags: 0, exploded: -1 };
}

export function neighbors(g, i) {
  const x = i % g.w, y = (i / g.w) | 0, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h) out.push(ny * g.w + nx);
  }
  return out;
}

/** Place mines avoiding `safe` (and its neighbours when there is room). */
export function placeMines(g, safe, rng = Math.random) {
  const excl = new Set([safe]);
  if (g.w * g.h - g.mines >= 9) for (const n of neighbors(g, safe)) excl.add(n);
  const pool = [];
  for (let i = 0; i < g.cells.length; i++) if (!excl.has(i)) pool.push(i);
  for (let k = 0; k < g.mines; k++) {
    const j = k + Math.floor(rng() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
    g.cells[pool[k]].mine = true;
  }
  for (let i = 0; i < g.cells.length; i++) g.cells[i].n = neighbors(g, i).filter((n) => g.cells[n].mine).length;
  g.generated = true;
  g.status = 'playing';
}

/** Reveal a cell (flood fills zeros). Returns array of newly opened indices. */
export function reveal(g, i, rng) {
  if (g.status === 'won' || g.status === 'lost') return [];
  if (!g.generated) placeMines(g, i, rng);
  const c = g.cells[i];
  if (c.open || c.flag) return [];
  if (c.mine) {
    c.open = true;
    g.status = 'lost';
    g.exploded = i;
    return [i];
  }
  const opened = [];
  const stack = [i];
  while (stack.length) {
    const k = stack.pop();
    const cc = g.cells[k];
    if (cc.open || cc.flag || cc.mine) continue;
    cc.open = true;
    g.opened++;
    opened.push(k);
    if (cc.n === 0) for (const n of neighbors(g, k)) if (!g.cells[n].open) stack.push(n);
  }
  checkWin(g);
  return opened;
}

/** Chord: on an open number whose flag count matches, reveal all unflagged neighbours. */
export function chord(g, i) {
  const c = g.cells[i];
  if (g.status !== 'playing' || !c.open || c.n === 0) return [];
  const nb = neighbors(g, i);
  const flags = nb.filter((n) => g.cells[n].flag).length;
  if (flags !== c.n) return [];
  let out = [];
  for (const n of nb) {
    if (g.status !== 'playing') break;
    const cc = g.cells[n];
    if (!cc.open && !cc.flag) out = out.concat(reveal(g, n));
  }
  return out;
}

export function toggleFlag(g, i) {
  const c = g.cells[i];
  if (c.open || g.status === 'won' || g.status === 'lost') return false;
  c.flag = !c.flag;
  g.flags += c.flag ? 1 : -1;
  return true;
}

export function checkWin(g) {
  if (g.status === 'playing' && g.opened === g.w * g.h - g.mines) {
    g.status = 'won';
    // auto-flag remaining mines
    for (const c of g.cells) if (c.mine && !c.flag) { c.flag = true; g.flags++; }
  }
  return g.status === 'won';
}

/** Serialize for save/continue. */
export function serialize(g) {
  return {
    w: g.w, h: g.h, mines: g.mines, generated: g.generated, status: g.status, opened: g.opened, flags: g.flags, exploded: g.exploded,
    c: g.cells.map((c) => (c.mine ? 1 : 0) | (c.open ? 2 : 0) | (c.flag ? 4 : 0) | (c.n << 3)),
  };
}
export function deserialize(s) {
  const g = createGame(s.w, s.h, s.mines);
  Object.assign(g, { generated: s.generated, status: s.status, opened: s.opened, flags: s.flags, exploded: s.exploded });
  g.cells = s.c.map((v) => ({ mine: !!(v & 1), open: !!(v & 2), flag: !!(v & 4), n: v >> 3 }));
  return g;
}
