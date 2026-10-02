// Pure falling-block game logic (no DOM). Time is injected via tick(dtMs) so it is testable in node.
export const W = 10, H = 22, HIDDEN = 2; // rows 0..1 are above the visible field

const SHAPES = {
  I: ['....', 'XXXX', '....', '....'],
  J: ['X..', 'XXX', '...'],
  L: ['..X', 'XXX', '...'],
  O: ['XX', 'XX'],
  S: ['.XX', 'XX.', '...'],
  T: ['.X.', 'XXX', '...'],
  Z: ['XX.', '.XX', '...'],
};
export const TYPES = Object.keys(SHAPES);

// cells for each rotation state: ROT[type][r] = [[x,y],...]
export const ROT = {};
for (const t of TYPES) {
  const n = SHAPES[t].length;
  let cells = [];
  SHAPES[t].forEach((row, y) => [...row].forEach((c, x) => c === 'X' && cells.push([x, y])));
  ROT[t] = [];
  for (let r = 0; r < 4; r++) {
    ROT[t].push(cells);
    cells = cells.map(([x, y]) => [n - 1 - y, x]); // rotate clockwise
  }
}

// SRS kick data (wiki convention, +y = up). Key: from*10+to.
const K_JLSTZ = {
  1: [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],   // 0->R
  10: [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],      // R->0
  12: [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],      // R->2
  21: [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],  // 2->R
  23: [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],     // 2->L
  32: [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],   // L->2
  30: [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],   // L->0
  3: [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],      // 0->L
};
const K_I = {
  1: [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  10: [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  12: [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  21: [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  23: [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  32: [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  30: [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  3: [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};
export function kicks(type, from, to) {
  if (type === 'O') return [[0, 0]];
  return (type === 'I' ? K_I : K_JLSTZ)[from * 10 + to].map(([x, y]) => [x, -y]); // convert to +y = down
}

/** 7-bag randomizer. rng() -> [0,1) */
export function makeBag(rng = Math.random) {
  let bag = [];
  return () => {
    if (!bag.length) {
      bag = [...TYPES];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    return bag.pop();
  };
}

export const gravityMs = (level) => Math.max(1, Math.pow(0.8 - (level - 1) * 0.007, level - 1) * 1000);
export const LOCK_DELAY = 500, MAX_RESETS = 15, CLEAR_MS = 320;
const LINE_SCORE = [0, 100, 300, 500, 800];
const TSPIN_SCORE = [400, 800, 1200, 1600];

export class Game {
  constructor({ level = 1, rng = Math.random, previews = 5 } = {}) {
    this.board = Array.from({ length: H }, () => Array(W).fill(null));
    this.next = makeBag(rng);
    this.queue = Array.from({ length: previews }, () => this.next());
    this.startLevel = level;
    this.level = level;
    this.lines = 0; this.score = 0; this.combo = -1; this.b2b = false;
    this.hold = null; this.canHold = true;
    this.over = false; this.piece = null;
    this.clearing = null; // { rows, t }
    this.events = [];
    this.stats = { tetrises: 0, tspins: 0, pieces: 0, maxCombo: 0, hardDrops: 0 };
    this.fall = 0; this.lockT = 0; this.resets = 0;
    this.spawn();
  }

  cells(p = this.piece, dx = 0, dy = 0, r = p.r) { return ROT[p.type][r].map(([x, y]) => [p.x + x + dx, p.y + y + dy]); }
  fits(p, dx = 0, dy = 0, r = p.r) {
    return this.cells(p, dx, dy, r).every(([x, y]) => x >= 0 && x < W && y < H && (y < 0 || !this.board[y][x]));
  }

  spawn(type) {
    type = type || this.queue.shift();
    if (this.queue.length < 5) this.queue.push(this.next());
    const p = { type, r: 0, x: type === 'O' ? 4 : 3, y: type === 'I' ? 0 : 1, lastRot: false };
    if (!this.fits(p)) { p.y -= 1; if (!this.fits(p)) { this.piece = p; this.over = true; this.events.push({ type: 'gameover' }); return false; } }
    this.piece = p; this.fall = 0; this.lockT = 0; this.resets = 0;
    // guideline: drop one row immediately if possible
    if (this.fits(p, 0, 1)) p.y++;
    return true;
  }

  get grounded() { return this.piece && !this.fits(this.piece, 0, 1); }
  resetLock() { if (this.grounded && this.resets < MAX_RESETS) { this.lockT = 0; this.resets++; } }

  move(dx) {
    if (!this.active()) return false;
    if (!this.fits(this.piece, dx, 0)) return false;
    this.piece.x += dx; this.piece.lastRot = false;
    this.resetLock(); this.events.push({ type: 'move' });
    return true;
  }
  rotate(dir = 1) {
    if (!this.active()) return false;
    const p = this.piece, to = (p.r + (dir > 0 ? 1 : 3)) % 4;
    for (const [kx, ky] of kicks(p.type, p.r, to)) {
      if (this.fits(p, kx, ky, to)) {
        p.x += kx; p.y += ky; p.r = to; p.lastRot = true;
        this.resetLock(); this.events.push({ type: 'rotate' });
        return true;
      }
    }
    return false;
  }
  softDrop() {
    if (!this.active() || !this.fits(this.piece, 0, 1)) return false;
    this.piece.y++; this.piece.lastRot = false; this.score += 1; this.fall = 0;
    return true;
  }
  ghostY() { let d = 0; while (this.fits(this.piece, 0, d + 1)) d++; return this.piece.y + d; }
  hardDrop() {
    if (!this.active()) return;
    const gy = this.ghostY(), d = gy - this.piece.y;
    if (d > 0) this.piece.lastRot = false;
    this.piece.y = gy; this.score += 2 * d;
    this.stats.hardDrops++;
    this.events.push({ type: 'harddrop', rows: d });
    this.lock();
  }
  holdPiece() {
    if (!this.active() || !this.canHold) return false;
    const cur = this.piece.type;
    const h = this.hold;
    this.hold = cur; this.canHold = false;
    this.events.push({ type: 'hold' });
    this.spawn(h || undefined);
    return true;
  }
  active() { return !this.over && !this.clearing && this.piece; }

  isTSpin() {
    const p = this.piece;
    if (p.type !== 'T' || !p.lastRot) return false;
    const corners = [[0, 0], [2, 0], [0, 2], [2, 2]];
    let n = 0;
    for (const [cx, cy] of corners) {
      const x = p.x + cx, y = p.y + cy;
      if (x < 0 || x >= W || y >= H || (y >= 0 && this.board[y][x])) n++;
    }
    return n >= 3;
  }

  lock() {
    const p = this.piece;
    const tspin = this.isTSpin();
    let above = true;
    for (const [x, y] of this.cells(p)) { if (y >= 0) this.board[y][x] = p.type; if (y >= HIDDEN) above = false; }
    this.stats.pieces++;
    this.events.push({ type: 'lock' });
    const rows = [];
    for (let y = 0; y < H; y++) if (this.board[y].every(Boolean)) rows.push(y);
    const n = rows.length;
    let pts = tspin ? TSPIN_SCORE[n] : LINE_SCORE[n];
    const difficult = n === 4 || (tspin && n > 0);
    if (n > 0) {
      if (difficult && this.b2b) pts *= 1.5;
      this.b2b = difficult ? true : false;
      this.combo++;
      if (this.combo > 0) pts += 50 * this.combo * this.level;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    } else this.combo = -1;
    this.score += Math.round(pts * this.level);
    if (n === 4) this.stats.tetrises++;
    if (tspin) this.stats.tspins++;
    this.piece = null; this.canHold = true;
    if (n > 0) {
      this.clearing = { rows, t: 0 };
      this.events.push({ type: 'clear', lines: n, tspin, b2b: difficult && this.b2b, combo: this.combo });
    } else {
      if (tspin) this.events.push({ type: 'tspin', lines: 0 });
      if (above) { this.over = true; this.events.push({ type: 'gameover' }); return; } // lock out
      this.spawn();
    }
  }

  finishClear() {
    const rows = this.clearing.rows;
    this.board = this.board.filter((_, y) => !rows.includes(y));
    while (this.board.length < H) this.board.unshift(Array(W).fill(null));
    const before = this.level;
    this.lines += rows.length;
    this.level = Math.max(this.startLevel, Math.floor(this.lines / 10) + 1);
    if (this.level > before) this.events.push({ type: 'levelup', level: this.level });
    if (this.board.every((r) => r.every((c) => !c))) { this.score += 2000 * this.level; this.events.push({ type: 'perfect' }); }
    this.clearing = null;
    this.spawn();
  }

  /** Advance time. softDropping: gravity x20 (soft drop scoring happens per row). */
  tick(dt, softDropping = false) {
    if (this.over) return;
    if (this.clearing) {
      this.clearing.t += dt;
      if (this.clearing.t >= CLEAR_MS) this.finishClear();
      return;
    }
    if (!this.piece) return;
    const g = softDropping ? Math.min(gravityMs(this.level), 50) : gravityMs(this.level);
    if (this.grounded) {
      this.lockT += dt;
      if (this.lockT >= LOCK_DELAY) this.lock();
      return;
    }
    this.fall += dt;
    while (this.fall >= g && this.piece && !this.grounded) {
      this.fall -= g;
      this.piece.y++; this.piece.lastRot = false;
      if (softDropping) this.score += 1;
    }
    if (this.grounded) this.fall = 0;
  }
}
