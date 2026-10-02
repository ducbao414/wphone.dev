// Pure 2048 logic. Tiles: { id, v, r, c }. Board size N.
export const N = 4;
let nextId = 1;
export const setNextId = (n) => { nextId = Math.max(nextId, n); };
const newId = () => nextId++;

export function emptyCells(tiles, n = N) {
  const used = new Set(tiles.map((t) => t.r * n + t.c));
  const out = [];
  for (let i = 0; i < n * n; i++) if (!used.has(i)) out.push({ r: Math.floor(i / n), c: i % n });
  return out;
}

export function spawn(tiles, rng = Math.random, n = N) {
  const e = emptyCells(tiles, n);
  if (!e.length) return null;
  const p = e[Math.floor(rng() * e.length)];
  const t = { id: newId(), v: rng() < 0.9 ? 2 : 4, r: p.r, c: p.c };
  tiles.push(t);
  return t;
}

export function newGame(rng = Math.random) {
  const tiles = [];
  spawn(tiles, rng); spawn(tiles, rng);
  return { tiles, score: 0, won: false, keepPlaying: false, over: false };
}

/**
 * Slide tiles. dir: 'left'|'right'|'up'|'down'.
 * Returns { moved, tiles (new positions; merged results included), gained, moves: [{ id, r, c, gone, mergedInto }], merged: [newTile] }
 */
export function move(tiles, dir, n = N) {
  const grid = Array.from({ length: n }, () => Array(n).fill(null));
  for (const t of tiles) grid[t.r][t.c] = t;
  const vertical = dir === 'up' || dir === 'down';
  const reverse = dir === 'right' || dir === 'down';
  const out = [], moves = [], merged = [];
  let gained = 0, moved = false;
  for (let line = 0; line < n; line++) {
    const cells = [];
    for (let k = 0; k < n; k++) {
      const i = reverse ? n - 1 - k : k;
      const t = vertical ? grid[i][line] : grid[line][i];
      if (t) cells.push(t);
    }
    let pos = 0;
    for (let k = 0; k < cells.length; k++) {
      const a = cells[k], b = cells[k + 1];
      const idx = reverse ? n - 1 - pos : pos;
      const r = vertical ? idx : line, c = vertical ? line : idx;
      if (b && b.v === a.v) {
        const nt = { id: newId(), v: a.v * 2, r, c, merged: true };
        moves.push({ id: a.id, r, c, gone: true, mergedInto: nt.id }, { id: b.id, r, c, gone: true, mergedInto: nt.id });
        if (a.r !== r || a.c !== c || b.r !== r || b.c !== c) moved = true;
        moved = true; // a merge always changes the board
        out.push(nt); merged.push(nt);
        gained += nt.v;
        k++;
      } else {
        if (a.r !== r || a.c !== c) moved = true;
        moves.push({ id: a.id, r, c });
        out.push({ id: a.id, v: a.v, r, c });
      }
      pos++;
    }
  }
  return { moved, tiles: out, gained, moves, merged };
}

export function canMove(tiles, n = N) {
  if (tiles.length < n * n) return true;
  const g = Array.from({ length: n }, () => Array(n).fill(0));
  for (const t of tiles) g[t.r][t.c] = t.v;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (c + 1 < n && g[r][c] === g[r][c + 1]) return true;
    if (r + 1 < n && g[r][c] === g[r + 1][c]) return true;
  }
  return false;
}

export const maxTile = (tiles) => tiles.reduce((m, t) => Math.max(m, t.v), 0);
export const toGrid = (tiles, n = N) => { const g = Array.from({ length: n }, () => Array(n).fill(0)); for (const t of tiles) g[t.r][t.c] = t.v; return g; };
export const fromGrid = (g) => { const tiles = []; g.forEach((row, r) => row.forEach((v, c) => v && tiles.push({ id: newId(), v, r, c }))); return tiles; };
