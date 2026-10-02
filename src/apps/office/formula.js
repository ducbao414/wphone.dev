// Pure spreadsheet engine: cell references, tokenizer, parser, evaluator, CSV helpers, number formatting.
// No DOM access — testable in node.

export const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export const colIndex = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
export const refName = (c, r) => colName(c) + (r + 1);
export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) return null;
  const r = Number(m[2]) - 1;
  if (r < 0) return null;
  return { c: colIndex(m[1]), r };
}

export class FErr { constructor(code) { this.code = code; } toString() { return this.code; } }
const E = (c) => new FErr(c);
export const isErr = (v) => v instanceof FErr;

/* ---------------- tokenizer ---------------- */
export function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= src.length) throw E('#ERROR!');
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      t.push({ type: 'str', v: s }); i = j + 1; continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?/i.exec(src.slice(i));
    if (num) {
      let s = num[0], pct = s.endsWith('%');
      if (pct) s = s.slice(0, -1);
      t.push({ type: 'num', v: Number(s) / (pct ? 100 : 1) }); i += num[0].length; continue;
    }
    const range = /^(\$?[A-Za-z]{1,3}\$?\d+)\s*:\s*(\$?[A-Za-z]{1,3}\$?\d+)/.exec(src.slice(i));
    if (range) { t.push({ type: 'range', a: range[1].replace(/\$/g, '').toUpperCase(), b: range[2].replace(/\$/g, '').toUpperCase() }); i += range[0].length; continue; }
    const id = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i));
    if (id) {
      const w = id[0];
      i += w.length;
      // function call?
      let k = i; while (src[k] === ' ') k++;
      if (src[k] === '(') { t.push({ type: 'fn', v: w.toUpperCase() }); i = k + 1; continue; }
      const up = w.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') { t.push({ type: 'bool', v: up === 'TRUE' }); continue; }
      if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(w)) { t.push({ type: 'ref', v: w.replace(/\$/g, '').toUpperCase() }); continue; }
      t.push({ type: 'name', v: up }); continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { t.push({ type: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>(),;'.includes(ch)) { t.push({ type: ch === '(' || ch === ')' ? ch : ch === ',' || ch === ';' ? ',' : 'op', v: ch }); i++; continue; }
    throw E('#ERROR!');
  }
  return t;
}

/* ---------------- parser (recursive descent → AST) ---------------- */
export function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops) => peek()?.type === 'op' && ops.includes(peek().v);
  const bin = (next, ops) => () => {
    let l = next();
    while (isOp(...ops)) { const op = toks[p++].v; l = { k: 'bin', op, l, r: next() }; }
    return l;
  };
  const primary = () => {
    const t = toks[p++];
    if (!t) throw E('#ERROR!');
    if (t.type === 'num' || t.type === 'str' || t.type === 'bool') return { k: 'lit', v: t.v };
    if (t.type === 'ref') return { k: 'ref', v: t.v };
    if (t.type === 'range') return { k: 'range', a: t.a, b: t.b };
    if (t.type === 'name') return { k: 'name', v: t.v };
    if (t.type === '(') { const e = cmp(); if (peek()?.type !== ')') throw E('#ERROR!'); p++; return e; }
    if (t.type === 'fn') {
      const args = [];
      if (peek()?.type === ')') { p++; return { k: 'fn', name: t.v, args }; }
      for (;;) {
        args.push(cmp());
        const n = toks[p++];
        if (n?.type === ')') break;
        if (n?.type !== ',') throw E('#ERROR!');
      }
      return { k: 'fn', name: t.v, args };
    }
    throw E('#ERROR!');
  };
  // Excel precedence: unary minus binds tighter than ^, and ^ is left-associative.
  const unary = () => {
    if (isOp('-')) { p++; return { k: 'neg', e: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return primary();
  };
  const power = bin(unary, ['^']);
  const mul = bin(power, ['*', '/']);
  const add = bin(mul, ['+', '-']);
  const cat = bin(add, ['&']);
  const cmp = bin(cat, ['=', '<>', '<', '>', '<=', '>=']);
  const ast = cmp();
  if (p < toks.length) throw E('#ERROR!');
  return ast;
}

/* ---------------- evaluation ---------------- */
const toNum = (v) => {
  if (isErr(v)) return v;
  if (v == null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).trim());
  return String(v).trim() !== '' && isFinite(n) ? n : E('#VALUE!');
};
const toStr = (v) => (v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(+v.toPrecision(15)) : String(v));
const toBool = (v) => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : v == null || v === '' ? false : String(v).toUpperCase() === 'TRUE' ? true : String(v).toUpperCase() === 'FALSE' ? false : E('#VALUE!'));
const flat = (args) => args.flat(Infinity);
const firstErr = (arr) => arr.find(isErr);

function compare(op, a, b) {
  const norm = (x) => (x == null ? '' : x);
  a = norm(a); b = norm(b);
  let x, y;
  if (typeof a === 'number' && typeof b === 'number') { x = a; y = b; }
  else if (typeof a === 'boolean' && typeof b === 'boolean') { x = +a; y = +b; }
  else if (a === '' && typeof b === 'number') { x = 0; y = b; }
  else if (b === '' && typeof a === 'number') { x = a; y = 0; }
  else { x = toStr(a).toLowerCase(); y = toStr(b).toLowerCase(); }
  switch (op) {
    case '=': return x === y; case '<>': return x !== y; case '<': return x < y;
    case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y;
  }
}

const numsOf = (args) => flat(args).filter((v) => typeof v === 'number');
const FN = {
  SUM: (a) => firstErr(flat(a)) || numsOf(a).reduce((s, x) => s + x, 0),
  AVERAGE: (a) => { const e = firstErr(flat(a)); if (e) return e; const n = numsOf(a); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : E('#DIV/0!'); },
  MIN: (a) => firstErr(flat(a)) || (numsOf(a).length ? Math.min(...numsOf(a)) : 0),
  MAX: (a) => firstErr(flat(a)) || (numsOf(a).length ? Math.max(...numsOf(a)) : 0),
  COUNT: (a) => numsOf(a).length,
  COUNTA: (a) => flat(a).filter((v) => v != null && v !== '').length,
  ABS: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.abs(n); },
  ROUND: (a) => {
    const n = toNum(a[0]), d = a.length > 1 ? toNum(a[1]) : 0;
    if (isErr(n)) return n; if (isErr(d)) return d;
    const f = 10 ** Math.trunc(d);
    return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f;
  },
  SQRT: (a) => { const n = toNum(a[0]); return isErr(n) ? n : n < 0 ? E('#NUM!') : Math.sqrt(n); },
  LEN: (a) => (isErr(a[0]) ? a[0] : toStr(a[0]).length),
  UPPER: (a) => (isErr(a[0]) ? a[0] : toStr(a[0]).toUpperCase()),
  LOWER: (a) => (isErr(a[0]) ? a[0] : toStr(a[0]).toLowerCase()),
  CONCAT: (a) => firstErr(flat(a)) || flat(a).map(toStr).join(''),
  NOT: (a) => { const b = toBool(a[0]); return isErr(b) ? b : !b; },
  AND: (a) => { const v = flat(a).filter((x) => x != null && x !== '').map(toBool); return firstErr(v) || v.every(Boolean); },
  OR: (a) => { const v = flat(a).filter((x) => x != null && x !== '').map(toBool); return firstErr(v) || v.some(Boolean); },
  PI: () => Math.PI,
  TODAY: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
};
FN.CONCATENATE = FN.CONCAT;
FN.AVG = FN.AVERAGE;
export const FUNCTIONS = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'ROUND', 'ABS', 'SQRT', 'LEN', 'UPPER', 'LOWER', 'CONCAT', 'AND', 'OR', 'NOT', 'IFERROR', 'PI', 'TODAY'];

/** Coerce a raw (non-formula) cell entry into a value: number, boolean, or string. */
export function literal(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  const t = s.trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return Number(t);
  if (/^[-+]?(\d+\.?\d*|\.\d+)%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  const money = /^[-]?[$€£¥]\s?[\d,]+(\.\d+)?$/.exec(t);
  if (money) return Number(t.replace(/[^\d.-]/g, ''));
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^(true|false)$/i.test(t)) return t.toUpperCase() === 'TRUE';
  return s;
}

/**
 * Create an evaluator over a cells map ({ A1: '=B1*2', B1: '3' }).
 * Returns { value(ref) } with memoization and cycle detection.
 */
export function createSheet(cells, { maxRows = 10000, maxCols = 702 } = {}) {
  const cache = new Map();
  const visiting = new Set();
  const asts = new Map();

  function value(ref) {
    ref = ref.toUpperCase();
    if (cache.has(ref)) return cache.get(ref);
    const raw = cells[ref];
    if (raw == null || raw === '') return null;
    if (typeof raw !== 'string' || raw[0] !== '=') { const v = literal(raw); cache.set(ref, v); return v; }
    if (visiting.has(ref)) return E('#CIRC!');
    visiting.add(ref);
    let v;
    try {
      let ast = asts.get(ref);
      if (!ast) { ast = parse(raw.slice(1)); asts.set(ref, ast); }
      v = ev(ast);
      if (Array.isArray(v)) v = v.length === 1 ? v[0] : E('#VALUE!');
      if (v == null) v = 0;
      if (typeof v === 'number' && !isFinite(v)) v = E('#NUM!');
    } catch (e) {
      v = isErr(e) ? e : E('#ERROR!');
    }
    visiting.delete(ref);
    // If this cell participates in a cycle, every member reports #CIRC!
    cache.set(ref, v);
    return v;
  }

  function cellRef(name) {
    const p = parseRef(name);
    if (!p || p.r >= maxRows || p.c >= maxCols) return E('#REF!');
    return value(refName(p.c, p.r));
  }

  function rangeVals(a, b) {
    const A = parseRef(a), B = parseRef(b);
    if (!A || !B || Math.max(A.r, B.r) >= maxRows || Math.max(A.c, B.c) >= maxCols) return E('#REF!');
    const out = [];
    for (let r = Math.min(A.r, B.r); r <= Math.max(A.r, B.r); r++)
      for (let c = Math.min(A.c, B.c); c <= Math.max(A.c, B.c); c++) out.push(value(refName(c, r)));
    return out;
  }

  function ev(n) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'ref': return cellRef(n.v);
      case 'range': return rangeVals(n.a, n.b);
      case 'name': return E('#NAME?');
      case 'neg': { const v = toNum(scalar(ev(n.e))); return isErr(v) ? v : -v; }
      case 'bin': {
        const l = scalar(ev(n.l)), r = scalar(ev(n.r));
        if (isErr(l)) return l; if (isErr(r)) return r;
        if (n.op === '&') return toStr(l) + toStr(r);
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) return compare(n.op, l, r);
        const x = toNum(l), y = toNum(r);
        if (isErr(x)) return x; if (isErr(y)) return y;
        switch (n.op) {
          case '+': return x + y; case '-': return x - y; case '*': return x * y;
          case '/': return y === 0 ? E('#DIV/0!') : x / y;
          case '^': { const v = x ** y; return isFinite(v) ? v : E('#NUM!'); }
        }
        return E('#ERROR!');
      }
      case 'fn': {
        if (n.name === 'IF') {
          if (n.args.length < 2) return E('#VALUE!');
          const c = toBool(scalar(ev(n.args[0])));
          if (isErr(c)) return c;
          return c ? ev(n.args[1]) : n.args.length > 2 ? ev(n.args[2]) : false;
        }
        if (n.name === 'IFERROR') {
          const v = scalar(ev(n.args[0]));
          return isErr(v) ? (n.args[1] ? ev(n.args[1]) : '') : v;
        }
        const f = FN[n.name];
        if (!f) return E('#NAME?');
        const args = n.args.map(ev);
        // Scalar functions see a single value
        return f(args);
      }
    }
    return E('#ERROR!');
  }
  const scalar = (v) => (Array.isArray(v) ? (v.length === 1 ? v[0] : E('#VALUE!')) : v);

  return { value, invalidate() { cache.clear(); } };
}

/** Evaluate every cell; returns { ref: value }. */
export function evaluateAll(cells, opts) {
  const s = createSheet(cells, opts);
  const out = {};
  for (const k of Object.keys(cells)) out[k] = s.value(k);
  return out;
}

/* ---------------- formatting ---------------- */
export const FORMATS = [
  { value: 'general', label: 'general' },
  { value: 'number', label: 'number (1,234.00)' },
  { value: 'integer', label: 'whole number (1,234)' },
  { value: 'currency', label: 'currency ($1,234.00)' },
  { value: 'percent', label: 'percentage (12.5%)' },
  { value: 'text', label: 'text' },
];

export function formatValue(v, fmt = 'general', currency = 'USD') {
  if (v == null) return '';
  if (isErr(v)) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    switch (fmt) {
      case 'number': return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'integer': return Math.round(v).toLocaleString('en-US');
      case 'currency': try { return v.toLocaleString('en-US', { style: 'currency', currency }); } catch { return '$' + v.toFixed(2); }
      case 'percent': return (v * 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
      default: {
        if (Number.isInteger(v)) return String(v);
        const s = String(+v.toPrecision(10));
        return s.length > 12 ? v.toPrecision(6).replace(/\.?0+(e|$)/, '$1') : s;
      }
    }
  }
  return String(v);
}

/* ---------------- CSV ---------------- */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false, i = 0;
  text = String(text).replace(/^﻿/, '');
  const delim = (() => { const first = text.split(/\r?\n/)[0] || ''; return (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ','; })();
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV rows (string[][]) → sheet doc. */
export function csvToSheet(text) {
  const rows = parseCSV(text);
  const cells = {};
  let cols = 0;
  rows.forEach((r, ri) => { cols = Math.max(cols, r.length); r.forEach((v, ci) => { if (v !== '') cells[refName(ci, ri)] = v; }); });
  return { cells, cols: Math.max(cols, 8), rows: Math.max(rows.length, 30) };
}

/** Sheet → CSV text. values=true exports computed values (default), else raw formulas. */
export function sheetToCSV(doc, { values = true } = {}) {
  const ev = values ? evaluateAll(doc.cells) : null;
  let maxR = -1, maxC = -1;
  for (const k of Object.keys(doc.cells)) { const p = parseRef(k); if (p && doc.cells[k] !== '') { maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c); } }
  const esc = (s) => (/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const lines = [];
  for (let r = 0; r <= maxR; r++) {
    const line = [];
    for (let c = 0; c <= maxC; c++) {
      const k = refName(c, r);
      const raw = doc.cells[k];
      const v = values ? (raw == null ? '' : formatValue(ev[k], 'general')) : raw ?? '';
      line.push(esc(String(v)));
    }
    lines.push(line.join(','));
  }
  return lines.join('\r\n');
}

const REF_RE = /("[^"]*")|(?<![A-Za-z0-9_])(\$?)([A-Z]{1,3})(\$?)(\d+)(?:\s*:\s*(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9(_])/gi;

/** Move relative references by (dr, dc) — used when copying/filling formulas. Absolute ($) parts stay. */
export function offsetFormula(src, dr, dc) {
  if (typeof src !== 'string' || src[0] !== '=') return src;
  const one = (d1, col, d2, row) => {
    let c = colIndex(col), r = Number(row) - 1;
    if (!d1) c += dc;
    if (!d2) r += dr;
    if (r < 0 || c < 0) return null;
    return d1 + colName(c) + d2 + (r + 1);
  };
  return '=' + src.slice(1).replace(REF_RE, (m, str, a1, ac, a2, ar, b1, bc, b2, br) => {
    if (str) return str;
    const A = one(a1, ac, a2, ar);
    if (!bc) return A ?? '#REF!';
    const B = one(b1, bc, b2, br);
    return A && B ? A + ':' + B : '#REF!';
  });
}

/**
 * Insert (by > 0) or delete (by < 0) rows/columns at index `at`, rewriting references.
 * axis: 'row' | 'col'. References into deleted cells become #REF!; ranges shrink.
 */
export function shiftFormula(src, { axis = 'row', at, by }) {
  if (typeof src !== 'string' || src[0] !== '=') return src;
  const isRow = axis === 'row';
  const mv = (i) => (i >= at ? i + by : i);
  const deleted = (i) => by < 0 && i >= at && i < at - by;
  const fmt = (d1, c, d2, r) => d1 + colName(c) + d2 + (r + 1);
  return '=' + src.slice(1).replace(REF_RE, (m, str, a1, ac, a2, ar, b1, bc, b2, br) => {
    if (str) return str;
    let c1 = colIndex(ac), r1 = Number(ar) - 1;
    if (!bc) {
      const i = isRow ? r1 : c1;
      if (deleted(i)) return '#REF!';
      return isRow ? fmt(a1, c1, a2, mv(r1)) : fmt(a1, mv(c1), a2, r1);
    }
    let c2 = colIndex(bc), r2 = Number(br) - 1;
    let lo = isRow ? Math.min(r1, r2) : Math.min(c1, c2), hi = isRow ? Math.max(r1, r2) : Math.max(c1, c2);
    if (by < 0) {
      const d0 = at, d1x = at - by - 1; // deleted span
      if (lo >= d0 && hi <= d1x) return '#REF!';
      const newLo = lo > d1x ? lo + by : lo >= d0 ? d0 : lo;
      const newHi = hi > d1x ? hi + by : hi >= d0 ? d0 - 1 : hi;
      lo = newLo; hi = newHi;
    } else { lo = mv(lo); hi = mv(hi); }
    if (isRow) return fmt(a1, Math.min(c1, c2), a2, lo) + ':' + fmt(b1, Math.max(c1, c2), b2, hi);
    return fmt(a1, lo, a2, Math.min(r1, r2)) + ':' + fmt(b1, hi, b2, Math.max(r1, r2));
  });
}

/** Apply a row/col insert/delete to a whole sheet doc (cells + per-cell formats). Returns a new doc. */
export function restructure(doc, { axis, at, by }) {
  const isRow = axis === 'row';
  const remap = (map, fn) => {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) {
      const p = parseRef(k);
      if (!p) continue;
      const i = isRow ? p.r : p.c;
      if (by < 0 && i >= at && i < at - by) continue;
      const ni = i >= at ? i + by : i;
      out[isRow ? refName(p.c, ni) : refName(ni, p.r)] = fn ? fn(v) : v;
    }
    return out;
  };
  const next = { ...doc };
  next.cells = remap(doc.cells, (v) => shiftFormula(v, { axis, at, by }));
  next.fmt = remap(doc.fmt);
  next.bold = remap(doc.bold);
  if (isRow) next.rows = Math.max(1, (doc.rows || 1) + by);
  else {
    next.cols = Math.max(1, (doc.cols || 1) + by);
    if (doc.widths) {
      const w = {};
      for (const [k, v] of Object.entries(doc.widths)) { const i = colIndex(k); if (by < 0 && i >= at && i < at - by) continue; w[colName(i >= at ? i + by : i)] = v; }
      next.widths = w;
    }
  }
  return next;
}
