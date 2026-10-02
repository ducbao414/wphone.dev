// Pure Wordament logic: letter values, trie, solver, board generator. No DOM — unit-testable in node.

export const LETTER_VALUES = {
  A: 2, B: 5, C: 3, D: 3, E: 1, F: 5, G: 4, H: 4, I: 2, J: 10, K: 6, L: 3, M: 4,
  N: 2, O: 2, P: 4, QU: 8, R: 2, S: 2, T: 2, U: 4, V: 6, W: 6, X: 9, Y: 5, Z: 8,
};

// Approximate English letter frequencies (per 1000) used to draw tiles. Q always comes as "QU".
const FREQ = {
  E: 110, A: 80, R: 70, I: 72, O: 66, T: 66, N: 62, S: 64, L: 50, C: 38, U: 32, D: 34, P: 28, M: 28,
  H: 26, G: 26, B: 18, F: 14, Y: 16, W: 12, K: 10, V: 9, X: 3, Z: 3, J: 2, QU: 3,
};
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

export const NEIGHBORS = Array.from({ length: 16 }, (_, i) => {
  const r = i >> 2, c = i & 3, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < 4 && cc >= 0 && cc < 4) out.push(rr * 4 + cc);
  }
  return out;
});
export const isAdjacent = (a, b) => NEIGHBORS[a].includes(b);

/** Trie node: { c: {letter: node}, w: word|undefined } */
export function buildTrie(words) {
  const root = { c: {} };
  for (const w of words) {
    let n = root;
    for (const ch of w) n = n.c[ch] ??= { c: {} };
    n.w = w;
  }
  return root;
}

export function parseWords(str) { return str.split(' '); }

/** Score of a word given the tile path. Sum of tile values × length multiplier. */
export function scoreWord(board, path) {
  let base = 0, len = 0;
  for (const i of path) { base += LETTER_VALUES[board[i]] || 1; len += board[i].length; }
  const mult = len >= 8 ? 3 : len === 7 ? 2.5 : len === 6 ? 2 : len === 5 ? 1.5 : 1;
  return Math.round(base * mult);
}

export const pathWord = (board, path) => path.map((i) => board[i]).join('').toLowerCase();

/** Solve: returns Map word -> { path, score } (best-scoring path per word). */
export function solve(board, trie) {
  const found = new Map();
  const used = new Array(16).fill(false);
  const path = [];
  const lower = board.map((t) => t.toLowerCase());
  const dfs = (i, node) => {
    let n = node;
    for (const ch of lower[i]) { n = n.c[ch]; if (!n) return; }
    used[i] = true; path.push(i);
    if (n.w && n.w.length >= 3) {
      const s = scoreWord(board, path);
      const prev = found.get(n.w);
      if (!prev || prev.score < s) found.set(n.w, { path: path.slice(), score: s });
    }
    for (const j of NEIGHBORS[i]) if (!used[j]) dfs(j, n);
    used[i] = false; path.pop();
  };
  for (let i = 0; i < 16; i++) dfs(i, trie);
  return found;
}

/** Find a traceable path for a typed word (keyboard input), or null. */
export function findPath(board, word) {
  word = word.toLowerCase();
  const lower = board.map((t) => t.toLowerCase());
  const used = new Array(16).fill(false);
  const path = [];
  const dfs = (i, pos) => {
    const t = lower[i];
    if (word.slice(pos, pos + t.length) !== t) return false;
    used[i] = true; path.push(i);
    const np = pos + t.length;
    if (np === word.length) return true;
    for (const j of NEIGHBORS[i]) if (!used[j] && dfs(j, np)) return true;
    used[i] = false; path.pop();
    return false;
  };
  for (let i = 0; i < 16; i++) if (dfs(i, 0)) return path;
  return null;
}

/** Mulberry32 seeded RNG. */
export function rng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FREQ_ENTRIES = Object.entries(FREQ);
const FREQ_TOTAL = FREQ_ENTRIES.reduce((s, [, f]) => s + f, 0);
function drawLetter(rand) {
  let x = rand() * FREQ_TOTAL;
  for (const [l, f] of FREQ_ENTRIES) { if ((x -= f) < 0) return l; }
  return 'E';
}

export function randomBoard(rand = Math.random) {
  for (;;) {
    const b = Array.from({ length: 16 }, () => drawLetter(rand));
    const vowels = b.filter((l) => VOWELS.has(l)).length;
    const counts = {};
    for (const l of b) counts[l] = (counts[l] || 0) + 1;
    const maxDup = Math.max(...Object.values(counts));
    const rare = b.filter((l) => 'JXZQUKVW'.includes(l) || l === 'QU').length;
    if (vowels >= 5 && vowels <= 8 && maxDup <= 3 && rare <= 2) return b;
  }
}

/** Generate a board guaranteeing at least minWords words (keeps best of attempts). */
export function generateBoard(trie, { minWords = 100, attempts = 60, rand = Math.random } = {}) {
  let best = null;
  for (let k = 0; k < attempts; k++) {
    const board = randomBoard(rand);
    const words = solve(board, trie);
    if (!best || words.size > best.words.size) best = { board, words };
    if (words.size >= minWords) break;
  }
  return best;
}

export const totalScore = (words) => { let s = 0; for (const v of words.values()) s += v.score; return s; };
