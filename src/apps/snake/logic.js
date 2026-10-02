// Pure Snake II game logic (no DOM). Grid coordinates: x 0..w-1, y 0..h-1.
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

export const MAZES = {
  none: 'no walls',
  box: 'box',
  tunnel: 'tunnel',
  mill: 'mill',
};

export function buildWalls(maze, w, h) {
  const s = new Set();
  const add = (x, y) => s.add(x + ',' + y);
  if (maze === 'box' || maze === 'tunnel') {
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
  }
  if (maze === 'tunnel') {
    // open gaps in the middle of each side, plus two inner bars
    const my = h >> 1, mx = w >> 1;
    for (let d = -1; d <= 1; d++) { s.delete('0,' + (my + d)); s.delete((w - 1) + ',' + (my + d)); s.delete((mx + d) + ',0'); s.delete((mx + d) + ',' + (h - 1)); }
    const y1 = Math.floor(h / 3), y2 = h - 1 - Math.floor(h / 3);
    for (let x = 4; x < w - 4; x++) { add(x, y1); add(x, y2); }
  }
  if (maze === 'mill') {
    const cx = w >> 1, cy = h >> 1;
    const L = Math.floor(Math.min(w, h) / 3);
    for (let i = 2; i <= L; i++) { add(cx, cy - i); add(cx, cy + i); add(cx - i, cy); add(cx + i, cy); }
    for (let i = 0; i < 4; i++) { add(cx - L + i, cy - L); add(cx + L - i, cy + L); add(cx + L, cy - L + i); add(cx - L, cy + L - i); }
  }
  return s;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createGame({ w = 20, h = 22, level = 5, maze = 'none', rng = Math.random } = {}) {
  const walls = buildWalls(maze, w, h);
  const y = h >> 1;
  let sx = Math.max(5, (w >> 1) - 2);
  // keep start row clear of walls
  let sy = y;
  while ([0, 1, 2, 3, 4].some((i) => walls.has((sx - i) + ',' + sy) || walls.has((sx + 2) + ',' + sy))) sy++;
  const g = {
    w, h, level, maze, walls, rng,
    snake: [[sx, sy], [sx - 1, sy], [sx - 2, sy], [sx - 3, sy], [sx - 4, sy]],
    dir: 'right', queue: [], grow: 0,
    food: null, bonus: null, eaten: 0, critters: 0,
    score: 0, alive: true, ticks: 0,
  };
  g.food = freeCell(g, 1);
  return g;
}

export const wrapped = (g, x, y) => (g.maze === 'none' || g.maze === 'tunnel' ? [(x + g.w) % g.w, (y + g.h) % g.h] : [x, y]);

function occupied(g, x, y) {
  if (g.walls.has(x + ',' + y)) return true;
  if (g.snake.some(([a, b]) => a === x && b === y)) return true;
  if (g.food && g.food[0] === x && g.food[1] === y) return true;
  if (g.bonus && g.bonus.y === y && (g.bonus.x === x || g.bonus.x + 1 === x)) return true;
  return false;
}

/** random free cell; width 2 for critters */
export function freeCell(g, width = 1) {
  const cells = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x <= g.w - width; x++) {
    let ok = true;
    for (let i = 0; i < width; i++) if (occupied(g, x + i, y)) ok = false;
    if (ok) cells.push([x, y]);
  }
  if (!cells.length) return null;
  return cells[Math.floor(g.rng() * cells.length)];
}

/** Queue a direction change (ignores reversals and duplicates). */
export function turn(g, dir) {
  if (!DIRS[dir]) return false;
  const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
  if (dir === last || dir === OPP[last]) return false;
  if (g.queue.length >= 3) return false;
  g.queue.push(dir);
  return true;
}

export const foodPoints = (level) => level;
export const bonusPoints = (level, ttl) => 5 * level + Math.ceil(ttl / 2);

/**
 * Advance one tick. Returns an events object: { ate, critter, died, critterGone }.
 */
export function step(g) {
  const ev = { ate: false, critter: 0, died: false, critterGone: false };
  if (!g.alive) return ev;
  if (g.queue.length) g.dir = g.queue.shift();
  const [dx, dy] = DIRS[g.dir];
  const [hx, hy] = g.snake[0];
  let [nx, ny] = wrapped(g, hx + dx, hy + dy);
  g.ticks++;
  const out = nx < 0 || ny < 0 || nx >= g.w || ny >= g.h;
  const willGrow = g.grow > 0 || (g.food && g.food[0] === nx && g.food[1] === ny);
  const body = willGrow ? g.snake : g.snake.slice(0, -1);
  if (out || g.walls.has(nx + ',' + ny) || body.some(([a, b]) => a === nx && b === ny)) {
    g.alive = false; ev.died = true; return ev;
  }
  g.snake.unshift([nx, ny]);
  if (g.food && g.food[0] === nx && g.food[1] === ny) {
    ev.ate = true;
    g.eaten++;
    g.score += foodPoints(g.level);
    g.grow += 1;
    g.food = null;
    if (g.eaten % 5 === 0 && !g.bonus) {
      const c = freeCell(g, 2);
      if (c) g.bonus = { x: c[0], y: c[1], ttl: 20 + Math.floor(g.w / 2), kind: Math.floor(g.rng() * 4) };
    }
    g.food = freeCell(g, 1);
  }
  if (g.bonus && g.bonus.y === ny && (g.bonus.x === nx || g.bonus.x + 1 === nx)) {
    const pts = bonusPoints(g.level, g.bonus.ttl);
    g.score += pts; ev.critter = pts; g.critters++;
    g.bonus = null;
  } else if (g.bonus && --g.bonus.ttl <= 0) { g.bonus = null; ev.critterGone = true; }
  if (g.grow > 0) g.grow--; else g.snake.pop();
  if (!g.food) g.food = freeCell(g, 1);
  return ev;
}

export const tickMs = (level) => Math.round(440 - level * 42);
