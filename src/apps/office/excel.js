// Excel page: grid with frozen headers, selection, formula bar, formula engine, formats, CSV.
import { Sigma, Bold } from 'lucide';
import {
  colName, refName, parseRef, evaluateAll, formatValue, isErr, FORMATS, FUNCTIONS, csvToSheet, sheetToCSV, parseCSV, offsetFormula, restructure,
} from './formula.js';
import { stem, extOf } from './docs.js';

const FX_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4.5C8 4 7 5 6.6 7.5L5 18c-.3 1.8-1.3 2.4-3 2"/><path d="M3.5 10h6"/><path d="m13 10 7 8"/><path d="m20 10-7 8"/></svg>';
const DEFAULT_W = 84, HEAD_W = 40;

export function sheetPage(app, path) {
  return async (page) => {
    const { os, ctx } = app;
    const { el, I, iconSVG } = os.ui;
    const isCSV = extOf(path) === 'csv';
    let name = os.path.basename(path);

    let doc;
    try {
      if (isCSV) doc = csvToSheet(await os.fs.read(path, 'text'));
      else {
        const raw = await os.fs.read(path, 'text');
        doc = raw.trim() ? JSON.parse(raw) : {};
      }
    } catch (e) {
      os.ui.alert('This spreadsheet couldn’t be read: ' + e.message, 'excel');
      doc = {};
    }
    doc = normalizeDoc(doc);
    app.touchRecent(path);

    let values = {};
    let sel = { c: 0, r: 0 };          // active cell
    let range = null;                  // { c0, r0, c1, r1 } normalized, or null for single cell
    let editing = false;               // formula bar is being edited
    let editOrig = '';
    let dirty = false, saveTimer, saving = null, csvWarned = false;
    const tds = new Map();

    /* ---------------- layout ---------------- */
    const title = el('div.office-doc-title', stem(name));
    const head = el('div.office-doc-head.compact', el('div.wp-app-title', 'EXCEL'), title);
    const refLabel = el('button.office-fx-ref.tilt', { onclick: gotoCell }, 'A1');
    const input = el('input.office-fx-input', { type: 'text', spellcheck: false, autocomplete: 'off', autocapitalize: 'off', placeholder: '' });
    const okBtn = el('button.office-fx-btn.ok', { 'aria-label': 'enter', html: iconSVG(I.check, { size: 20, stroke: 2.4 }) });
    const cancelBtn = el('button.office-fx-btn', { 'aria-label': 'cancel', html: iconSVG(I.close, { size: 20, stroke: 2.4 }) });
    const fxBtn = el('button.office-fx-btn.fx', { 'aria-label': 'insert function', html: iconSVG(FX_ICON, { size: 20 }) });
    const fxBar = el('div.office-fx', refLabel, fxBtn, input, okBtn, cancelBtn);
    const table = el('table.office-grid');
    const wrap = el('div.office-grid-wrap.no-swipe', table);
    const statusEl = el('div.office-sheet-status');
    const root = el('div.office-sheet', head, fxBar, wrap, statusEl);

    /* ---------------- rendering ---------------- */
    const widthOf = (c) => doc.widths[colName(c)] || DEFAULT_W;
    function build() {
      tds.clear();
      const colgroup = el('colgroup', el('col', { style: { width: HEAD_W + 'px' } }), [...Array(doc.cols).keys()].map((c) => el('col', { style: { width: widthOf(c) + 'px' } })));
      const thead = el('thead', el('tr', el('th.office-corner', { onclick: selectAll }), [...Array(doc.cols).keys()].map((c) => {
        const th = el('th.office-colh', { dataset: { c } }, colName(c));
        th.addEventListener('click', () => selectCol(c));
        os.util.onLongPress(th, () => colMenu(th, c));
        return th;
      })));
      const tbody = el('tbody');
      for (let r = 0; r < doc.rows; r++) {
        const rh = el('th.office-rowh', { dataset: { r } }, String(r + 1));
        rh.addEventListener('click', () => selectRow(r));
        os.util.onLongPress(rh, () => rowMenu(rh, r));
        const tr = el('tr', rh);
        for (let c = 0; c < doc.cols; c++) {
          const ref = refName(c, r);
          const td = el('td', { dataset: { ref, c, r } });
          tds.set(ref, td);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.style.width = HEAD_W + [...Array(doc.cols).keys()].reduce((s, c) => s + widthOf(c), 0) + 'px';
      table.replaceChildren(colgroup, thead, tbody);
      recalc();
      paintSel();
    }
    function recalc() {
      values = evaluateAll(doc.cells);
      for (const [ref, td] of tds) paintCell(ref, td);
      updateStatus();
    }
    function paintCell(ref, td = tds.get(ref)) {
      if (!td) return;
      const raw = doc.cells[ref];
      const v = raw == null || raw === '' ? null : values[ref];
      const f = doc.fmt[ref] || 'general';
      td.textContent = f === 'text' && raw != null ? String(raw) : formatValue(v, f);
      td.className = (typeof v === 'number' && f !== 'text' ? 'num' : typeof v === 'boolean' ? 'bool' : '') + (isErr(v) ? ' err' : '') + (doc.bold[ref] ? ' bold' : '');
    }
    const norm = (a, b) => ({ c0: Math.min(a.c, b.c), r0: Math.min(a.r, b.r), c1: Math.max(a.c, b.c), r1: Math.max(a.r, b.r) });
    const curRange = () => range || { c0: sel.c, r0: sel.r, c1: sel.c, r1: sel.r };
    const inRange = (c, r, R = curRange()) => c >= R.c0 && c <= R.c1 && r >= R.r0 && r <= R.r1;
    let painted = [];
    function paintSel() {
      for (const n of painted) n.classList.remove('sel', 'inrange', 'hsel');
      painted = [];
      const R = curRange();
      for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
        const td = tds.get(refName(c, r));
        if (td) { td.classList.add('inrange'); painted.push(td); }
      }
      const a = tds.get(refName(sel.c, sel.r));
      if (a) { a.classList.add('sel'); painted.push(a); }
      table.querySelectorAll('.office-colh').forEach((th) => { if (+th.dataset.c >= R.c0 && +th.dataset.c <= R.c1) { th.classList.add('hsel'); painted.push(th); } });
      table.querySelectorAll('.office-rowh').forEach((th) => { if (+th.dataset.r >= R.r0 && +th.dataset.r <= R.r1) { th.classList.add('hsel'); painted.push(th); } });
      refLabel.textContent = range && (range.c0 !== range.c1 || range.r0 !== range.r1) ? `${refName(R.c0, R.r0)}:${refName(R.c1, R.r1)}` : refName(sel.c, sel.r);
      if (!editing) input.value = doc.cells[refName(sel.c, sel.r)] ?? '';
      updateStatus();
    }
    function updateStatus() {
      const R = curRange();
      const nums = [];
      let count = 0;
      for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
        const k = refName(c, r);
        if (doc.cells[k] == null || doc.cells[k] === '') continue;
        count++;
        if (typeof values[k] === 'number') nums.push(values[k]);
      }
      if ((R.c0 !== R.c1 || R.r0 !== R.r1) && nums.length) {
        const sum = nums.reduce((s, x) => s + x, 0);
        statusEl.textContent = `average ${formatValue(sum / nums.length)}   count ${count}   sum ${formatValue(sum)}`;
      } else {
        const v = values[refName(sel.c, sel.r)];
        statusEl.textContent = isErr(v) ? errHelp(v.code) : `${doc.rows} rows × ${doc.cols} columns${dirty ? ' · editing' : ''}`;
      }
    }
    const errHelp = (code) => ({
      '#CIRC!': '#CIRC! — this formula refers to itself (circular reference)',
      '#REF!': '#REF! — the formula refers to a cell that doesn’t exist',
      '#DIV/0!': '#DIV/0! — division by zero',
      '#NAME?': '#NAME? — unknown function or name',
      '#VALUE!': '#VALUE! — wrong type of value (e.g. text in a sum)',
      '#NUM!': '#NUM! — number is too big or invalid',
      '#ERROR!': '#ERROR! — the formula couldn’t be understood',
    }[code] || code);

    function scrollIntoView(c, r) {
      const td = tds.get(refName(c, r));
      if (!td) return;
      const w = wrap, x = td.offsetLeft, y = td.offsetTop, hh = table.tHead.offsetHeight;
      if (x - HEAD_W < w.scrollLeft) w.scrollLeft = x - HEAD_W;
      else if (x + td.offsetWidth > w.scrollLeft + w.clientWidth) w.scrollLeft = x + td.offsetWidth - w.clientWidth;
      if (y - hh < w.scrollTop) w.scrollTop = y - hh;
      else if (y + td.offsetHeight > w.scrollTop + w.clientHeight) w.scrollTop = y + td.offsetHeight - w.clientHeight;
    }
    function select(c, r, extend = false) {
      c = Math.max(0, Math.min(doc.cols - 1, c)); r = Math.max(0, Math.min(doc.rows - 1, r));
      if (extend) { range = norm(anchor, { c, r }); sel = { c, r }; }
      else { sel = { c, r }; anchor = { c, r }; range = null; }
      paintSel();
      scrollIntoView(c, r);
    }
    let anchor = { c: 0, r: 0 };
    function selectCol(c) { commitIfEditing(); sel = { c, r: 0 }; anchor = { c, r: 0 }; range = { c0: c, c1: c, r0: 0, r1: doc.rows - 1 }; paintSel(); }
    function selectRow(r) { commitIfEditing(); sel = { c: 0, r }; anchor = { c: 0, r }; range = { c0: 0, c1: doc.cols - 1, r0: r, r1: r }; paintSel(); }
    function selectAll() { commitIfEditing(); sel = { c: 0, r: 0 }; anchor = sel; range = { c0: 0, r0: 0, c1: doc.cols - 1, r1: doc.rows - 1 }; paintSel(); }

    /* ---------------- editing ---------------- */
    const setEditing = (on) => {
      editing = on;
      fxBar.classList.toggle('editing', on);
      if (on) editOrig = doc.cells[refName(sel.c, sel.r)] ?? '';
    };
    input.addEventListener('focus', () => { if (!editing) setEditing(true); });
    input.addEventListener('input', () => { if (!editing) setEditing(true); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); select(sel.c, sel.r + (e.shiftKey ? -1 : 1)); input.blur(); }
      else if (e.key === 'Tab') { e.preventDefault(); commit(); select(sel.c + (e.shiftKey ? -1 : 1), sel.r); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); input.blur(); }
    });
    okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    okBtn.addEventListener('click', () => { commit(); input.blur(); });
    cancelBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    cancelBtn.addEventListener('click', () => { cancel(); input.blur(); });
    fxBtn.addEventListener('click', insertFunction);

    function setCell(ref, raw) {
      if (raw == null || raw === '') delete doc.cells[ref];
      else doc.cells[ref] = raw;
    }
    function commit() {
      if (!editing) return;
      setEditing(false);
      let v = input.value;
      // Auto-close parentheses like Excel does for simple cases
      if (v.startsWith('=')) { const open = (v.match(/\(/g) || []).length - (v.match(/\)/g) || []).length; if (open > 0) v += ')'.repeat(open); v = '=' + v.slice(1).replace(/\b([a-z]+)\(/gi, (m, f) => f.toUpperCase() + '(').replace(/\b([a-z]{1,3}\d+)\b/gi, (m) => m.toUpperCase()); }
      const ref = refName(sel.c, sel.r);
      if ((doc.cells[ref] ?? '') !== v) {
        pushUndo();
        setCell(ref, v);
        changed();
        recalc();
      }
      paintSel();
    }
    function cancel() { setEditing(false); input.value = editOrig; paintSel(); }
    function commitIfEditing() { if (editing) commit(); }

    /* ---------------- undo ---------------- */
    const undoStack = [], redoStack = [];
    const snapshot = () => JSON.stringify({ cells: doc.cells, fmt: doc.fmt, bold: doc.bold, rows: doc.rows, cols: doc.cols, widths: doc.widths });
    function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
    function restore(s) { Object.assign(doc, JSON.parse(s)); build(); changed(); }
    function undo() { commitIfEditing(); if (!undoStack.length) return os.toast('Nothing to undo', 'office'); redoStack.push(snapshot()); restore(undoStack.pop()); }
    function redo() { if (!redoStack.length) return os.toast('Nothing to redo', 'office'); undoStack.push(snapshot()); restore(redoStack.pop()); }

    /* ---------------- pointer interaction ---------------- */
    // When typing a formula, tapping cells inserts references (Excel behavior)
    const refMode = () => editing && input.value.startsWith('=') && /[=(,+\-*/^&<>:]\s*$/.test(input.value.slice(0, input.selectionStart ?? input.value.length));
    let drag = null, lastPointer = 'mouse', refModeHandled = false;
    wrap.addEventListener('pointerdown', (e) => {
      lastPointer = e.pointerType;
      const td = e.target.closest('td');
      if (!td) return;
      const c = +td.dataset.c, r = +td.dataset.r;
      if (e.pointerType === 'mouse' && (refMode() || drag?.ref)) {
        e.preventDefault();
        const pos = input.selectionStart ?? input.value.length;
        const ins = refName(c, r);
        drag = { ref: true, start: { c, r }, pos, len: ins.length };
        input.value = input.value.slice(0, pos) + ins + input.value.slice(input.selectionEnd ?? pos);
        input.setSelectionRange(pos + ins.length, pos + ins.length);
        input.focus();
        refModeHandled = true;
        return;
      }
      if (e.pointerType !== 'mouse') return; // touch: select on click so scrolling doesn't move the selection
      commitIfEditing();
      if (e.shiftKey) { select(c, r, true); return; }
      select(c, r);
      drag = { start: { c, r } };
    });
    wrap.addEventListener('click', (e) => {
      const td = e.target.closest('td');
      if (!td || lastPointer === 'mouse' || refModeHandled) { refModeHandled = false; return; }
      const c = +td.dataset.c, r = +td.dataset.r;
      if (refMode()) {
        // Touch: tapping a cell while typing a formula inserts its reference
        const pos = input.selectionStart ?? input.value.length;
        const ins = refName(c, r);
        input.value = input.value.slice(0, pos) + ins + input.value.slice(input.selectionEnd ?? pos);
        input.focus();
        input.setSelectionRange(pos + ins.length, pos + ins.length);
        return;
      }
      const wasSel = !range && sel.c === c && sel.r === r && !editing;
      commitIfEditing();
      select(c, r);
      if (wasSel) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!drag || e.buttons !== 1) return;
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('td');
      if (!t || !wrap.contains(t)) return;
      const c = +t.dataset.c, r = +t.dataset.r;
      if (drag.ref) {
        const R = norm(drag.start, { c, r });
        const ins = R.c0 === R.c1 && R.r0 === R.r1 ? refName(R.c0, R.r0) : `${refName(R.c0, R.r0)}:${refName(R.c1, R.r1)}`;
        input.value = input.value.slice(0, drag.pos) + ins + input.value.slice(drag.pos + drag.len);
        drag.len = ins.length;
        input.setSelectionRange(drag.pos + ins.length, drag.pos + ins.length);
      } else if (c !== sel.c || r !== sel.r) { anchor = drag.start; select(c, r, true); }
    });
    const endDrag = () => { if (drag?.ref) setTimeout(() => input.focus(), 0); drag = null; };
    window.addEventListener('pointerup', endDrag);
    wrap.addEventListener('dblclick', (e) => { if (e.target.closest('td')) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
    os.util.onLongPress(wrap, (e) => {
      const td = e.target.closest?.('td');
      if (!td) return;
      const c = +td.dataset.c, r = +td.dataset.r;
      if (!inRange(c, r)) select(c, r);
      cellMenu(td);
    });

    /* ---------------- keyboard (desktop) ---------------- */
    const onKey = (e) => {
      if (!root.isConnected || page.el.hidden || root.closest('.app-frame:not(.active)') || document.querySelector('#overlay-layer > *')) return;
      if (document.activeElement === input) return;
      if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      const mv = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (mv) { e.preventDefault(); select(sel.c + mv[0], sel.r + mv[1], e.shiftKey); return; }
      if (e.key === 'Tab') { e.preventDefault(); select(sel.c + (e.shiftKey ? -1 : 1), sel.r); return; }
      if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSel(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copySel(); return; }
      if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); copySel(true); return; }
      if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSel(); return; }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleBold(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      if (e.key.length === 1 && !mod && !e.altKey) {
        e.preventDefault();
        input.value = e.key;
        input.focus();
        setEditing(true);
        input.setSelectionRange(1, 1);
      }
    };
    window.addEventListener('keydown', onKey);

    /* ---------------- commands ---------------- */
    function forEachInSel(fn) { const R = curRange(); for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) fn(refName(c, r), c, r); }
    function clearSel() { pushUndo(); forEachInSel((k) => { delete doc.cells[k]; }); changed(); recalc(); paintSel(); }
    function toggleBold() {
      commitIfEditing();
      pushUndo();
      const on = !doc.bold[refName(sel.c, sel.r)];
      forEachInSel((k) => { if (on) doc.bold[k] = 1; else delete doc.bold[k]; });
      changed(); recalc();
    }
    async function chooseFormat() {
      commitIfEditing();
      const cur = doc.fmt[refName(sel.c, sel.r)] || 'general';
      const v = await os.ui.pickFromList({ title: 'number format', options: FORMATS, value: cur });
      if (!v) return;
      pushUndo();
      forEachInSel((k) => { if (v === 'general') delete doc.fmt[k]; else doc.fmt[k] = v; });
      changed(); recalc();
    }
    async function insertFunction() {
      const name = await os.ui.pickFromList({ title: 'insert function', options: FUNCTIONS.map((f) => ({ value: f, label: f.toLowerCase() + '()' })) });
      if (!name) return;
      if (!editing || !input.value.startsWith('=')) { input.value = '='; setEditing(true); }
      const pos = input.selectionStart ?? input.value.length;
      const ins = name + '(' + (['PI', 'TODAY'].includes(name) ? ')' : '');
      input.value = input.value.slice(0, pos) + ins + input.value.slice(pos);
      input.focus();
      input.setSelectionRange(pos + ins.length, pos + ins.length);
    }
    function autoSum() {
      commitIfEditing();
      const isNum = (c, r) => typeof values[refName(c, r)] === 'number';
      let formula;
      // Range selected: put sum below it
      if (range && (range.r1 > range.r0 || range.c1 > range.c0)) {
        const R = range;
        const target = R.r1 + 1 < doc.rows ? { c: R.c0, r: R.r1 + 1 } : null;
        if (!target) return;
        pushUndo();
        for (let c = R.c0; c <= R.c1; c++) setCell(refName(c, R.r1 + 1), `=SUM(${refName(c, R.r0)}:${refName(c, R.r1)})`);
        changed(); recalc(); select(R.c0, R.r1 + 1);
        return;
      }
      let r = sel.r - 1;
      while (r >= 0 && isNum(sel.c, r)) r--;
      if (r < sel.r - 1) formula = `=SUM(${refName(sel.c, r + 1)}:${refName(sel.c, sel.r - 1)})`;
      else {
        let c = sel.c - 1;
        while (c >= 0 && isNum(c, sel.r)) c--;
        formula = c < sel.c - 1 ? `=SUM(${refName(c + 1, sel.r)}:${refName(sel.c - 1, sel.r)})` : '=SUM()';
      }
      input.value = formula;
      setEditing(true);
      input.focus();
      input.setSelectionRange(formula.length - 1, formula.length - 1);
    }
    function structural(axis, at, by) {
      commitIfEditing();
      if (by < 0 && (axis === 'row' ? doc.rows : doc.cols) + by < 1) return;
      pushUndo();
      Object.assign(doc, restructure(doc, { axis, at, by }));
      range = null;
      sel = { c: Math.min(sel.c, doc.cols - 1), r: Math.min(sel.r, doc.rows - 1) };
      build(); changed();
    }
    function addRows(n = 10) { pushUndo(); doc.rows = Math.min(2000, doc.rows + n); build(); changed(); setTimeout(() => (wrap.scrollTop = wrap.scrollHeight), 30); }
    function addCols(n = 1) { pushUndo(); doc.cols = Math.min(200, doc.cols + n); build(); changed(); setTimeout(() => (wrap.scrollLeft = wrap.scrollWidth), 30); }
    function resizeCol(c, delta) {
      pushUndo();
      const k = colName(c);
      doc.widths[k] = Math.max(40, Math.min(320, widthOf(c) + delta));
      if (doc.widths[k] === DEFAULT_W) delete doc.widths[k];
      build(); changed();
    }
    function fill(dir) {
      const R = curRange();
      if ((dir === 'down' && R.r1 === R.r0) || (dir === 'right' && R.c1 === R.c0)) return os.toast('Select a range first (drag, or tap a row/column header)', 'office');
      pushUndo();
      if (dir === 'down') for (let c = R.c0; c <= R.c1; c++) { const src = doc.cells[refName(c, R.r0)]; for (let r = R.r0 + 1; r <= R.r1; r++) setCell(refName(c, r), src == null ? '' : offsetFormula(src, r - R.r0, 0)); }
      else for (let r = R.r0; r <= R.r1; r++) { const src = doc.cells[refName(R.c0, r)]; for (let c = R.c0 + 1; c <= R.c1; c++) setCell(refName(c, r), src == null ? '' : offsetFormula(src, 0, c - R.c0)); }
      changed(); recalc();
    }
    async function sortBy(desc) {
      commitIfEditing();
      // Sort the data rows below the first row (treated as header if it contains text), keyed on the active column
      let maxR = -1, maxC = -1;
      for (const k of Object.keys(doc.cells)) { const p = parseRef(k); if (p) { maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c); } }
      if (maxR < 1) return;
      const header = typeof values[refName(sel.c, 0)] === 'string';
      const start = header ? 1 : 0;
      const hasFormula = Object.values(doc.cells).some((v) => String(v).startsWith('='));
      if (hasFormula && !(await os.ui.confirm('Sorting moves rows; formulas keep pointing at their original cells. Sort anyway?', 'sort', 'sort', 'cancel'))) return;
      pushUndo();
      const rows = [];
      for (let r = start; r <= maxR; r++) rows.push({ r, key: values[refName(sel.c, r)], cells: [...Array(maxC + 1).keys()].map((c) => [doc.cells[refName(c, r)], doc.fmt[refName(c, r)], doc.bold[refName(c, r)]]) });
      rows.sort((a, b) => {
        const x = a.key, y = b.key;
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return desc ? -cmp : cmp;
      });
      rows.forEach((row, i) => row.cells.forEach(([v, f, b], c) => {
        const k = refName(c, start + i);
        setCell(k, v ?? '');
        if (f) doc.fmt[k] = f; else delete doc.fmt[k];
        if (b) doc.bold[k] = 1; else delete doc.bold[k];
      }));
      changed(); recalc();
    }

    /* ---------------- clipboard ---------------- */
    let clip = null; // { cells: [[raw]], origin: {c, r}, text }
    async function copySel(cut = false) {
      commitIfEditing();
      const R = curRange();
      const grid = [];
      for (let r = R.r0; r <= R.r1; r++) { const row = []; for (let c = R.c0; c <= R.c1; c++) row.push(doc.cells[refName(c, r)] ?? ''); grid.push(row); }
      const text = [];
      for (let r = R.r0; r <= R.r1; r++) { const row = []; for (let c = R.c0; c <= R.c1; c++) { const k = refName(c, r); row.push(doc.cells[k] == null ? '' : formatValue(values[k], doc.fmt[k])); } text.push(row.join('\t')); }
      clip = { cells: grid, origin: { c: R.c0, r: R.r0 }, text: text.join('\n') };
      try { await os.device.copy(clip.text); } catch {}
      if (cut) { pushUndo(); forEachInSel((k) => delete doc.cells[k]); changed(); recalc(); }
      os.toast(cut ? 'Cut' : 'Copied', 'office');
    }
    async function pasteSel() {
      commitIfEditing();
      let ext = null;
      try { ext = await os.device.paste(); } catch {}
      let grid, shift = true;
      if (clip && (ext == null || ext === clip.text)) grid = clip.cells;
      else if (ext) { grid = ext.includes('\t') ? ext.replace(/\r/g, '').split('\n').map((l) => l.split('\t')) : parseCSV(ext); shift = false; }
      if (!grid?.length) return os.toast('Clipboard is empty', 'office');
      pushUndo();
      const dr = sel.r - (clip?.origin.r ?? 0), dc = sel.c - (clip?.origin.c ?? 0);
      grid.forEach((row, i) => row.forEach((v, j) => {
        const r = sel.r + i, c = sel.c + j;
        if (r >= doc.rows) doc.rows = r + 1;
        if (c >= doc.cols) doc.cols = c + 1;
        setCell(refName(c, r), shift ? offsetFormula(v, dr, dc) : v);
      }));
      build(); changed();
    }

    /* ---------------- menus ---------------- */
    function cellMenu(td) {
      os.ui.contextMenu(td, [
        { label: 'edit', onClick: () => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } },
        { label: 'copy', onClick: () => copySel() },
        { label: 'cut', onClick: () => copySel(true) },
        { label: 'paste', onClick: pasteSel },
        { label: 'clear', onClick: clearSel },
        { label: doc.bold[refName(sel.c, sel.r)] ? 'not bold' : 'bold', onClick: toggleBold },
        { label: 'number format…', onClick: chooseFormat },
      ]);
    }
    function colMenu(th, c) {
      os.ui.contextMenu(th, [
        { label: 'insert column left', onClick: () => structural('col', c, 1) },
        { label: 'insert column right', onClick: () => structural('col', c + 1, 1) },
        { label: 'delete column', onClick: () => structural('col', c, -1) },
        { label: 'wider', onClick: () => resizeCol(c, 30) },
        { label: 'narrower', onClick: () => resizeCol(c, -30) },
        { label: 'sort a → z', onClick: () => { sel.c = c; sortBy(false); } },
        { label: 'sort z → a', onClick: () => { sel.c = c; sortBy(true); } },
      ]);
    }
    function rowMenu(th, r) {
      os.ui.contextMenu(th, [
        { label: 'insert row above', onClick: () => structural('row', r, 1) },
        { label: 'insert row below', onClick: () => structural('row', r + 1, 1) },
        { label: 'delete row', onClick: () => structural('row', r, -1) },
      ]);
    }
    async function gotoCell() {
      commitIfEditing();
      const v = await os.ui.prompt('Go to a cell or range, e.g. B12 or A1:C5', '', 'go to');
      if (!v) return;
      const [a, b] = v.trim().toUpperCase().split(':');
      const A = parseRef(a);
      if (!A) return os.toast('That’s not a cell reference', 'office');
      if (A.r >= doc.rows) doc.rows = Math.min(2000, A.r + 10), build();
      if (A.c >= doc.cols) doc.cols = Math.min(200, A.c + 1), build();
      select(A.c, A.r);
      const B = b && parseRef(b);
      if (B && B.r < doc.rows && B.c < doc.cols) select(B.c, B.r, true);
    }

    /* ---------------- save / export ---------------- */
    function changed() {
      dirty = true;
      updateStatus();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 700);
    }
    const serialize = () => {
      if (isCSV) return sheetToCSV(doc);
      const out = { cells: doc.cells, cols: doc.cols, rows: doc.rows };
      if (Object.keys(doc.fmt).length) out.fmt = doc.fmt;
      if (Object.keys(doc.bold).length) out.bold = doc.bold;
      if (Object.keys(doc.widths).length) out.widths = doc.widths;
      return out;
    };
    async function save() {
      clearTimeout(saveTimer);
      if (!dirty) return;
      if (saving) { await saving; if (!dirty) return; }
      dirty = false;
      if (isCSV && !csvWarned && Object.values(doc.cells).some((v) => String(v).startsWith('='))) {
        csvWarned = true;
        os.toast('CSV keeps values only — use “save as workbook” to keep formulas', 'office');
      }
      saving = os.fs.write(path, serialize(), isCSV ? { mime: 'text/csv' } : undefined)
        .then(() => updateStatus())
        .catch((e) => { dirty = true; os.toast('Couldn’t save: ' + e.message, 'office'); });
      await saving;
      saving = null;
    }
    async function exportCSV() {
      commitIfEditing();
      await save();
      const p = await os.fs.uniquePath(`/Downloads/${stem(name)}.csv`);
      await os.fs.write(p, sheetToCSV(doc), { mime: 'text/csv' });
      await os.fs.download(p);
      os.toast(`Saved ${os.path.basename(p)} to Downloads`, 'office');
    }
    async function saveAs(kind) {
      commitIfEditing();
      await save();
      const p = await os.fs.uniquePath(os.path.join(os.path.dirname(path), stem(name) + (kind === 'csv' ? '.csv' : '.wxls')));
      if (kind === 'csv') await os.fs.write(p, sheetToCSV(doc), { mime: 'text/csv' });
      else await os.fs.write(p, { cells: doc.cells, cols: doc.cols, rows: doc.rows, fmt: doc.fmt, bold: doc.bold, widths: doc.widths });
      os.toast('Saved ' + os.path.basename(p), 'office');
      app.openDoc(p);
    }
    async function importCSV() {
      const [p] = await os.pick.file({ accept: '.csv,text/csv,text/plain', start: '/Documents', title: 'import csv' });
      if (!p) return;
      try {
        const imported = csvToSheet(await os.fs.read(p, 'text'));
        const dest = await os.fs.uniquePath(`/Documents/${stem(os.path.basename(p))}.wxls`);
        await os.fs.write(dest, imported);
        app.openDoc(dest);
      } catch (e) { os.ui.alert('Import failed: ' + e.message); }
    }
    async function share() {
      commitIfEditing();
      await save();
      os.share({ title: stem(name), text: sheetToCSV(doc), path });
    }
    async function rename() {
      commitIfEditing();
      await save();
      const np = await app.renameFile(path);
      if (np) { path = np; name = os.path.basename(np); title.textContent = stem(name); }
    }

    const bar = os.ui.appBar({
      buttons: [
        { icon: Sigma, label: 'autosum', onClick: autoSum },
        { icon: Bold, label: 'bold', onClick: toggleBold },
        { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><text x="3" y="17" font-size="13" font-family="Segoe UI, sans-serif" fill="currentColor" stroke="none">$%</text></svg>', label: 'format', onClick: chooseFormat },
        { icon: I.share, label: 'share', onClick: share },
      ],
      menu: [
        { label: 'undo', onClick: undo },
        { label: 'redo', onClick: redo },
        { label: 'copy', onClick: () => copySel() },
        { label: 'paste', onClick: pasteSel },
        { label: 'clear cells', onClick: clearSel },
        { label: 'fill down', onClick: () => fill('down') },
        { label: 'fill right', onClick: () => fill('right') },
        { label: 'insert row above', onClick: () => structural('row', sel.r, 1) },
        { label: 'insert column left', onClick: () => structural('col', sel.c, 1) },
        { label: 'delete row', onClick: () => structural('row', sel.r, -1) },
        { label: 'delete column', onClick: () => structural('col', sel.c, -1) },
        { label: 'add 10 rows', onClick: () => addRows(10) },
        { label: 'add column', onClick: () => addCols(1) },
        { label: 'sort a → z (by this column)', onClick: () => sortBy(false) },
        { label: 'sort z → a (by this column)', onClick: () => sortBy(true) },
        { label: 'go to cell…', onClick: gotoCell },
        { label: 'export csv to device', onClick: exportCSV },
        isCSV ? { label: 'save as workbook (.wxls)', onClick: () => saveAs('wxls') } : { label: 'save a copy as .csv', onClick: () => saveAs('csv') },
        { label: 'import csv…', onClick: importCSV },
        { label: 'rename', onClick: rename },
      ],
    });
    root.append(bar.el);

    build();
    const offSuspend = ctx.on('suspend', () => { commitIfEditing(); save(); });
    page.el.append(root);
    return {
      onBack: async () => {
        if (editing) { cancel(); input.blur(); return true; }
        if (range) { range = null; paintSel(); return true; }
        await save();
        return false;
      },
      onHide: () => { commitIfEditing(); save(); },
      onDestroy: () => { commitIfEditing(); save(); offSuspend(); window.removeEventListener('keydown', onKey); window.removeEventListener('pointerup', endDrag); },
    };
  };
}

export function normalizeDoc(d) {
  d = d && typeof d === 'object' ? d : {};
  const cells = {};
  for (const [k, v] of Object.entries(d.cells || {})) { const p = parseRef(k); if (p && v != null && v !== '') cells[refName(p.c, p.r)] = String(v); }
  let maxR = 0, maxC = 0;
  for (const k of Object.keys(cells)) { const p = parseRef(k); maxR = Math.max(maxR, p.r + 1); maxC = Math.max(maxC, p.c + 1); }
  return {
    cells,
    cols: Math.min(200, Math.max(Number(d.cols) || 10, maxC, 1)),
    rows: Math.min(2000, Math.max(Number(d.rows) || 40, maxR, 1)),
    fmt: { ...(d.fmt || {}) },
    bold: { ...(d.bold || {}) },
    widths: { ...(d.widths || {}) },
  };
}
