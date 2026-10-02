import './style.css';
import { LayoutGrid, List, ListChecks, Bold, Italic, Underline, ImagePlus, Undo2, Palette, Mic } from 'lucide';
import {
  DIR, DEFAULT_COLOR, COLORS, listNotes, loadNote, resolvePath, textOf, firstImage,
  displayTitle, safeName, textToHtml, sanitize,
} from './notes.js';

const ListBullet = [['line', { x1: 9, y1: 6, x2: 20, y2: 6 }], ['line', { x1: 9, y1: 12, x2: 20, y2: 12 }], ['line', { x1: 9, y1: 18, x2: 20, y2: 18 }],
  ['circle', { cx: 4.5, cy: 6, r: 1.2 }], ['circle', { cx: 4.5, cy: 12, r: 1.2 }], ['circle', { cx: 4.5, cy: 18, r: 1.2 }]];

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I } = os.ui;
  const { esc, debounce, formatRelative } = os.util;

  let view = await storage.get('view', 'cards');
  let notes = [];
  let listApi = null;       // { refresh } of the list page
  let editor = null;        // currently open editor { path, flush(), close() }
  const offs = [];

  const refreshTiles = debounce(() => os.tiles.refresh('onenote'), 1500);

  /* --------------------------------------------------------------- saving */
  async function addRedirect(from, to) {
    await storage.update('moved', (m) => {
      const out = { ...(m || {}) };
      for (const k of Object.keys(out)) if (out[k] === from) out[k] = to;
      out[from] = to;
      return out;
    }, {});
  }

  async function writeNote(n) {
    await os.fs.write(n.path, {
      title: n.title, html: n.html, created: n.created, modified: n.modified, color: n.color,
      ...(n.checklist?.length ? { checklist: n.checklist } : {}),
    }, { mime: 'application/x-wp-note' });
  }

  async function createNote({ title = '', html = '', color = DEFAULT_COLOR } = {}) {
    const name = safeName(title || textOf(html).split('\n')[0]);
    const path = await os.fs.uniquePath(os.path.join(DIR, name + '.one'));
    const now = Date.now();
    const n = { path, title, html, created: now, modified: now, color, checklist: [] };
    await writeNote(n);
    refreshTiles();
    return path;
  }

  async function deleteNote(path) {
    await os.fs.remove(path);
    const key = 'onenote:' + path;
    if (os.tiles.isPinned('onenote', key)) os.tiles.unpin(key);
    refreshTiles();
  }

  async function pinNote(path, title) {
    const key = 'onenote:' + path;
    if (os.tiles.isPinned('onenote', key)) { os.toast('Already pinned to Start'); return; }
    await ctx.pinTile({ key, title: title || 'Note', args: { note: path }, size: 'medium' });
    os.toast('Pinned to Start');
  }

  async function chooseColor(current) {
    let chosen;
    const grid = el('div.onenote-swatches', COLORS.map((c) => el('button.onenote-swatch.tilt' + (c.hex === current ? '.sel' : ''), {
      style: { background: c.hex }, 'aria-label': c.name,
      onclick: (e) => { chosen = c.hex; e.currentTarget.closest('.wp-msgbox').querySelector('.wp-msgbox-buttons .wp-button').click(); },
    })));
    await os.ui.messageBox({ title: 'note color', content: grid, buttons: ['cancel'] });
    return chosen;
  }

  async function holdMenu(n, row) {
    os.ui.contextMenu(row, [
      { label: 'open', onClick: () => openNote(n.path) },
      { label: 'pin to start', onClick: () => pinNote(n.path, displayTitle(n)) },
      { label: 'change color', onClick: async () => {
        const c = await chooseColor(n.color);
        if (c) { await writeNote({ ...n, color: c, modified: n.modified }); refreshTiles(); }
      } },
      { label: 'share', onClick: () => os.share({ title: displayTitle(n), text: textOf(n.html), path: n.path }) },
      { label: 'delete', onClick: async () => {
        if (await os.ui.confirm(`Delete "${displayTitle(n)}"? This can't be undone.`, 'delete note', 'delete', 'cancel')) deleteNote(n.path);
      } },
    ]);
  }

  /* --------------------------------------------------------------- list page */
  function listPage(page) {
    const p = os.ui.page({ app: 'ONENOTE', title: 'recent notes', cls: 'onenote-listpage' });
    let query = '';
    const search = os.ui.textbox({ placeholder: 'search notes', onInput: (v) => { query = v.trim().toLowerCase(); render(); } });
    const searchWrap = el('div.onenote-search', search);
    searchWrap.hidden = true;
    const host = el('div.onenote-notes');
    const countEl = el('div.onenote-count');
    p.content.append(searchWrap, countEl, host);
    p.content.prepend(os.ui.loadingDots({ inline: true }));

    const showSearch = (on) => {
      searchWrap.hidden = !on;
      if (on) setTimeout(() => search.focus(), 50);
      else { search.value = ''; query = ''; render(); }
    };

    function card(n) {
      const text = textOf(n.html).split('\n').filter(Boolean);
      const snippet = (n.title ? text : text.slice(1)).slice(0, 6);
      const img = firstImage(n.html);
      const checks = (n.html.match(/class="onenote-check/g) || []).length;
      const done = (n.html.match(/class="onenote-check done/g) || []).length;
      if (view === 'list') {
        return el('div.onenote-row',
          el('div.onenote-row-mark', { style: { background: n.color } }),
          el('div.onenote-row-text',
            el('div.onenote-row-title', displayTitle(n)),
            el('div.onenote-row-sub', (checks ? `${done}/${checks} done · ` : '') + (snippet.join('  ') || 'empty note')),
            el('div.onenote-row-date', formatRelative(n.modified))));
      }
      return el('div.onenote-card', { style: { background: n.color } },
        img ? el('div.onenote-card-img', { style: { backgroundImage: `url("${img}")` } }) : null,
        el('div.onenote-card-title', displayTitle(n)),
        el('div.onenote-card-snippet', snippet.map((s) => el('div', s))),
        el('div.onenote-card-foot', (checks ? `☑ ${done}/${checks}  ·  ` : '') + formatRelative(n.modified)));
    }

    function render() {
      const items = query ? notes.filter((n) => (n.title + '\n' + textOf(n.html)).toLowerCase().includes(query)) : notes;
      countEl.textContent = query ? `${items.length} result${items.length === 1 ? '' : 's'}` : '';
      host.className = 'onenote-notes onenote-view-' + view;
      host.replaceChildren();
      if (!items.length) {
        host.append(query
          ? os.ui.empty(`no notes match "${query}"`)
          : el('div.onenote-empty', el('div.onenote-empty-big', 'no notes yet'), el('div.wp-desc', 'Tap + to jot something down, start a checklist, snap a picture into a note or dictate one with your voice.'),
            os.ui.button('new note', () => openNote(null), { accent: true })));
        return;
      }
      for (const n of items) {
        const node = card(n);
        node.classList.add('tilt');
        node.addEventListener('click', () => openNote(n.path));
        os.util.onLongPress(node, () => holdMenu(n, node));
        host.append(node);
      }
    }

    async function refresh() {
      try { notes = await listNotes(os); } catch (e) { console.warn(e); }
      p.content.querySelector('.wp-dots')?.remove();
      render();
    }

    const viewBtn = () => ({ icon: view === 'cards' ? List : LayoutGrid, label: view === 'cards' ? 'list' : 'cards', onClick: toggleView });
    const bar = os.ui.appBar({
      buttons: [],
      menu: [
        { label: 'new checklist', onClick: () => openNote(null, { checklist: true }) },
        { label: 'refresh', onClick: refresh },
      ],
    });
    const setButtons = () => bar.setButtons([
      { icon: I.add, label: 'new', onClick: () => openNote(null) },
      { icon: I.search, label: 'search', onClick: () => showSearch(searchWrap.hidden) },
      viewBtn(),
    ]);
    function toggleView() { view = view === 'cards' ? 'list' : 'cards'; storage.set('view', view); setButtons(); render(); }
    setButtons();

    page.el.append(p.el, bar.el);
    listApi = { refresh };
    return {
      onShow: refresh,
      onBack: () => { if (!searchWrap.hidden) { showSearch(false); return true; } return false; },
    };
  }

  /* --------------------------------------------------------------- editor page */
  async function openNote(path, opts = {}) {
    if (path) path = (await resolvePath(os, path)) || path;
    if (editor) { await editor.flush(); if (editor.path === path && path) return; await editor.close(); }
    let note = null;
    if (path) {
      const p = await resolvePath(os, path);
      note = p && (await loadNote(os, p));
      if (!note) { os.ui.alert('This note has been deleted or moved.', 'onenote'); return; }
    }
    ctx.navigate(editorPage, { note, opts });
  }

  function editorPage(page) {
    const isNew = !page.params.note;
    const note = page.params.note || { path: null, title: '', html: '', created: Date.now(), modified: Date.now(), color: DEFAULT_COLOR };
    let path = note.path;
    let color = note.color || DEFAULT_COLOR;
    let dirty = false, saving = Promise.resolve(), destroyed = false;
    let lastRange = null;

    const titleIn = el('input.onenote-title', { type: 'text', placeholder: 'Title', value: note.title || '', maxlength: 120 });
    titleIn.value = note.title || '';
    const body = el('div.onenote-body', { contenteditable: 'true', spellcheck: true, 'data-placeholder': 'Tap here to start writing' });
    body.innerHTML = note.html || '';
    const status = el('div.onenote-status');
    const dateEl = el('div.onenote-date');
    const header = el('div.onenote-ed-head', el('div.wp-app-title', 'ONENOTE'), titleIn, dateEl);
    const setColor = (c) => { color = c; header.style.background = c; };
    setColor(color);
    const updDate = () => (dateEl.textContent = new Date(note.modified || Date.now()).toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: !window.__wp_h24 }));
    updDate();

    /* ---- toolbar */
    const tb = (icon, label, fn, cmd) => {
      const b = el('button.onenote-tb.tilt', { 'aria-label': label, title: label, html: os.ui.iconSVG(icon, { size: 20, stroke: 2 }) });
      if (cmd) b.dataset.cmd = cmd;
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep caret in the body
      b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
      return b;
    };
    const exec = (cmd, val) => { restoreRange(); document.execCommand(cmd, false, val); changed(); updateStates(); };
    const micBtn = tb(Mic, 'dictate', dictate);
    const toolbar = el('div.onenote-toolbar.no-swipe',
      tb(ListChecks, 'checklist', toggleChecklist),
      tb(Bold, 'bold', () => exec('bold'), 'bold'),
      tb(Italic, 'italic', () => exec('italic'), 'italic'),
      tb(Underline, 'underline', () => exec('underline'), 'underline'),
      tb(ListBullet, 'bullets', () => exec('insertUnorderedList'), 'insertUnorderedList'),
      tb(ImagePlus, 'picture', insertPicture),
      micBtn,
      tb(Palette, 'color', async () => { const c = await chooseColor(color); if (c) { setColor(c); changed(); } }),
      tb(Undo2, 'undo', () => exec('undo')));
    if (!os.device.canListen) micBtn.classList.add('onenote-disabled');

    const scroller = el('div.onenote-ed-scroll', body);
    const root = el('div.onenote-editor', header, toolbar, status, scroller);

    function updateStates() {
      for (const b of toolbar.querySelectorAll('[data-cmd]')) {
        let on = false;
        try { on = document.queryCommandState(b.dataset.cmd); } catch {}
        b.classList.toggle('on', on && body.contains(getSelection().anchorNode));
      }
    }
    const onSel = () => {
      const s = getSelection();
      if (s.rangeCount && body.contains(s.anchorNode)) { lastRange = s.getRangeAt(0).cloneRange(); updateStates(); }
    };
    document.addEventListener('selectionchange', onSel);

    function restoreRange() {
      body.focus({ preventScroll: true });
      const s = getSelection();
      if (lastRange && body.contains(lastRange.startContainer)) { s.removeAllRanges(); s.addRange(lastRange); }
      else if (!s.rangeCount || !body.contains(s.anchorNode)) {
        const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); s.removeAllRanges(); s.addRange(r);
      }
    }
    const placeCaret = (node, atEnd = false) => {
      const r = document.createRange(); r.selectNodeContents(node); r.collapse(!atEnd);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    };
    const blockOf = (n) => { while (n && n.parentNode !== body) n = n.parentNode; return n && n !== body ? n : null; };
    const checkOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement)?.closest?.('.onenote-check');

    /* ---- checklist */
    function toggleChecklist() {
      restoreRange();
      const s = getSelection();
      let blk = blockOf(s.anchorNode);
      if (!body.childNodes.length || (!blk && s.anchorNode === body && !body.textContent)) {
        const d = el('div.onenote-check', el('br'));
        body.append(d); placeCaret(d); changed(); return;
      }
      if (!blk || blk.nodeType === 3 || blk.tagName === 'BR') {
        document.execCommand('formatBlock', false, 'div');
        blk = blockOf(getSelection().anchorNode);
      }
      const li = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest('li');
      if (li && body.contains(li)) {
        // turn the list item into a checklist item after the list
        const d = el('div.onenote-check');
        d.append(...li.childNodes); if (!d.textContent) d.append(el('br'));
        const ul = li.parentElement;
        ul.after(d); li.remove(); if (!ul.children.length) ul.remove();
        placeCaret(d, true); changed(); return;
      }
      if (blk && blk.nodeType === 1 && /^(DIV|P|H\d)$/.test(blk.tagName)) {
        if (blk.classList.contains('onenote-check')) blk.classList.remove('onenote-check', 'done');
        else blk.classList.add('onenote-check');
      } else {
        const d = el('div.onenote-check', el('br'));
        (blk || body.lastChild).after(d); placeCaret(d);
      }
      changed();
    }
    body.addEventListener('click', (e) => {
      const c = checkOf(e.target);
      if (!c) return;
      const r = c.getBoundingClientRect();
      if (e.clientX - r.left < 34) {
        e.preventDefault();
        c.classList.toggle('done');
        os.sounds.tap();
        changed();
      }
    });
    body.addEventListener('keydown', (e) => {
      const s = getSelection();
      if (!s.rangeCount) return;
      const item = checkOf(s.anchorNode);
      if (!item || !body.contains(item)) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!item.textContent.trim() && !item.querySelector('img')) {
          item.classList.remove('onenote-check', 'done'); changed(); return;
        }
        const r = s.getRangeAt(0); r.deleteContents();
        const tail = document.createRange();
        tail.setStart(r.endContainer, r.endOffset); tail.setEnd(item, item.childNodes.length);
        const frag = tail.extractContents();
        const n = el('div.onenote-check');
        n.append(frag);
        n.querySelectorAll('.onenote-check').forEach((x) => x.replaceWith(...x.childNodes));
        if (!n.textContent && !n.querySelector('img')) n.replaceChildren(el('br'));
        if (!item.textContent && !item.querySelector('img')) item.replaceChildren(el('br'));
        item.after(n); placeCaret(n);
        n.scrollIntoView({ block: 'nearest' });
        changed();
      } else if (e.key === 'Backspace' && s.isCollapsed) {
        const pre = document.createRange(); pre.setStart(item, 0); pre.setEnd(s.anchorNode, s.anchorOffset);
        if (!pre.toString().length && !pre.cloneContents().querySelector?.('img')) {
          e.preventDefault(); item.classList.remove('onenote-check', 'done'); changed();
        }
      }
    });

    /* ---- pictures */
    async function embedImage(p) {
      const blob = await os.fs.read(p);
      let out = blob;
      try { if (!/svg|gif/.test(blob.type)) out = await os.util.makeThumbnail(blob, 1200, 0.85); } catch { out = blob; }
      return os.util.blobToDataURL(out);
    }
    async function insertPicture() {
      const saved = lastRange;
      const paths = await os.pick.file({ accept: 'image/*', multiple: true, start: '/Pictures', title: 'insert picture' });
      if (!paths.length) return;
      status.textContent = 'adding picture…';
      try {
        const urls = [];
        for (const p of paths) urls.push(await embedImage(p));
        lastRange = saved;
        restoreRange();
        document.execCommand('insertHTML', false, urls.map((u) => `<div><img class="onenote-img" src="${u}"></div>`).join('') + '<div><br></div>');
        changed();
      } catch (e) { os.ui.alert('Couldn\'t add that picture. ' + (e.message || '')); }
      status.textContent = '';
    }
    body.addEventListener('paste', async (e) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const file = [...dt.files].find((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (file) {
        let out = file;
        try { out = await os.util.makeThumbnail(file, 1200, 0.85); } catch {}
        const u = await os.util.blobToDataURL(out);
        document.execCommand('insertHTML', false, `<div><img class="onenote-img" src="${u}"></div><div><br></div>`);
      } else {
        const t = dt.getData('text/plain');
        if (t) document.execCommand('insertText', false, t);
      }
      changed();
    });
    body.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) e.preventDefault(); });

    /* ---- dictation */
    let listening = false;
    async function dictate() {
      if (!os.device.canListen) { os.ui.alert('Speech recognition isn\'t supported in this browser. Try Chrome or Edge.', 'voice note'); return; }
      if (listening) return;
      listening = true;
      const saved = lastRange;
      micBtn.classList.add('on', 'onenote-listening');
      status.textContent = 'listening… speak now';
      try {
        const text = await os.device.listen({ onInterim: (t) => (status.textContent = '“' + t + '”') });
        if (text && !destroyed) {
          lastRange = saved; restoreRange();
          const s = getSelection();
          const prev = s.anchorNode?.nodeType === 3 ? s.anchorNode.textContent.slice(0, s.anchorOffset) : '';
          const out = (prev && !/\s$/.test(prev) ? ' ' : '') + text.charAt(0).toUpperCase() + text.slice(1);
          document.execCommand('insertText', false, out);
          changed();
        } else if (!text) os.toast('Didn\'t catch that');
      } catch (e) {
        os.ui.alert(e.message === 'not-allowed' ? 'Microphone access was blocked. Allow it in your browser to dictate notes.' : 'Voice input stopped: ' + e.message, 'voice note');
      }
      listening = false;
      micBtn.classList.remove('on', 'onenote-listening');
      status.textContent = '';
    }

    /* ---- autosave */
    const isEmpty = () => !titleIn.value.trim() && !body.textContent.trim() && !body.querySelector('img');
    function snapshot() {
      const checklist = [...body.querySelectorAll('.onenote-check')].map((d) => ({ text: d.textContent.trim(), done: d.classList.contains('done') }));
      return { title: titleIn.value.trim(), html: body.innerHTML, color, checklist };
    }
    async function doSave() {
      if (!dirty) return;
      dirty = false;
      const snap = snapshot();
      if (!path && isEmpty()) return;
      const now = Date.now();
      const n = { ...snap, created: note.created || now, modified: now };
      try {
        if (!path) {
          path = await os.fs.uniquePath(os.path.join(DIR, safeName(snap.title || textOf(snap.html).split('\n')[0]) + '.one'));
        } else if (snap.title) {
          const want = safeName(snap.title) + '.one';
          if (want !== os.path.basename(path)) {
            const old = path;
            const dir = os.path.dirname(old) || DIR;
            const np = await os.fs.uniquePath(os.path.join(dir, want));
            await writeNote({ ...n, path: np });
            await os.fs.remove(old);
            await addRedirect(old, np);
            path = np; note.path = np; note.modified = now; updDate();
            if (editorRef) editorRef.path = np;
            refreshTiles();
            return;
          }
        }
        await writeNote({ ...n, path });
        note.path = path; note.modified = now; updDate();
        if (editorRef) editorRef.path = path;
        refreshTiles();
      } catch (e) {
        dirty = true;
        console.warn('onenote save failed', e);
        status.textContent = 'couldn\'t save: ' + (e.message || e);
      }
    }
    const save = () => (saving = saving.then(doSave, doSave));
    const debounced = debounce(save, 900);
    function changed() { dirty = true; debounced(); }
    body.addEventListener('input', changed);
    titleIn.addEventListener('input', changed);
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); placeCaret(body, true); } });

    async function flush() {
      await save();
      if (path && isEmpty()) { await deleteNote(path); path = null; }
    }

    /* ---- app bar */
    const bar = os.ui.appBar({
      buttons: [
        { icon: I.check, label: 'done', onClick: () => ctx.back() },
        { icon: I.pin, label: 'pin', onClick: async () => { dirty = true; await flush(); if (!path) return os.toast('Write something first'); pinNote(path, displayTitle({ title: titleIn.value, html: body.innerHTML })); } },
        { icon: I.share, label: 'share', onClick: async () => {
          dirty = true; await flush();
          const t = displayTitle({ title: titleIn.value, html: body.innerHTML });
          os.share({ title: t, text: (titleIn.value.trim() ? titleIn.value.trim() + '\n' : '') + textOf(body.innerHTML), ...(path ? { path } : {}) });
        } },
        { icon: I.delete, label: 'delete', onClick: async () => {
          if (!(await os.ui.confirm('Delete this note? This can\'t be undone.', 'delete note', 'delete', 'cancel'))) return;
          dirty = false;
          if (path) await deleteNote(path);
          path = null; titleIn.value = ''; body.innerHTML = '';
          ctx.back();
        } },
      ],
      menu: [
        { label: 'insert picture', onClick: insertPicture },
        { label: 'voice note', onClick: dictate },
        { label: 'note color', onClick: async () => { const c = await chooseColor(color); if (c) { setColor(c); changed(); } } },
        { label: 'copy text', onClick: async () => { try { await os.device.copy(textOf(body.innerHTML)); os.toast('Copied'); } catch { os.toast('Copy failed'); } } },
      ],
    });
    // Hide the app bar while the soft keyboard / editing is active on small screens so the toolbar stays usable.
    root.append(bar.el);
    page.el.append(root);

    const offSuspend = ctx.on('suspend', () => { save(); });
    const editorRef = { path, flush, close: () => page.close() };
    editor = editorRef;

    if (page.params.opts?.checklist) setTimeout(() => { body.focus(); toggleChecklist(); }, 380);
    else if (isNew) setTimeout(() => titleIn.focus(), 380);
    else if (page.params.opts?.focusEnd) setTimeout(() => { body.focus(); placeCaret(body, true); }, 380);

    return {
      async onBack() { await flush(); return false; },
      onDestroy() {
        destroyed = true;
        document.removeEventListener('selectionchange', onSel);
        offSuspend();
        if (editor === editorRef) editor = null;
        if (dirty) save();
        else if (path && isEmpty()) deleteNote(path);
        listApi?.refresh();
      },
    };
  }

  /* --------------------------------------------------------------- args */
  async function fromShare(share) {
    let html = '';
    let title = (share.title || '').trim();
    if (share.text) html += textToHtml(share.text);
    if (share.url && !(share.text || '').includes(share.url)) html += `<div><a href="${esc(share.url)}">${esc(share.url)}</a></div>`;
    if (share.path) {
      try {
        const st = await os.fs.stat(share.path);
        if (st?.mime?.startsWith('image/')) {
          const blob = await os.fs.read(share.path);
          let out = blob;
          try { out = await os.util.makeThumbnail(blob, 1200, 0.85); } catch {}
          html += `<div><img class="onenote-img" src="${await os.util.blobToDataURL(out)}"></div>`;
          title ||= st.name.replace(/\.[^.]+$/, '');
        } else if (st && (st.mime?.startsWith('text/') || /json|xml/.test(st.mime || ''))) {
          html += textToHtml((await os.fs.read(share.path, 'text')).slice(0, 200000));
          title ||= st.name.replace(/\.[^.]+$/, '');
        } else if (st) {
          html += `<div>📎 ${esc(st.name)} (${esc(share.path)})</div>`;
          title ||= st.name;
        }
      } catch (e) { console.warn(e); }
    }
    if (!html && !title) return;
    if (!title) title = textOf(html).split('\n')[0].slice(0, 50);
    const path = await createNote({ title, html: sanitize(html) });
    os.toast('Saved to OneNote');
    await openNote(path, { focusEnd: true });
  }

  async function handleArgs(a) {
    if (!a) return;
    if (a.share) return fromShare(a.share);
    const p = a.note || a.file;
    if (p) {
      if (a.file && !(await os.fs.exists(a.file))) return os.ui.alert('File not found.');
      return openNote(p);
    }
    if (a.new) return openNote(null, { checklist: a.new === 'checklist' });
  }

  /* --------------------------------------------------------------- boot */
  await ctx.navigate(listPage);
  const onFs = debounce(() => listApi?.refresh(), 300);
  offs.push(os.fs.on('change', ({ path }) => { if (path && (path.startsWith(DIR) || /\.one$/i.test(path) || path === '/Documents')) onFs(); }));
  offs.push(ctx.on('resume', () => listApi?.refresh()));
  offs.push(ctx.on('args', (a) => handleArgs(a)));
  handleArgs(ctx.args);

  return {
    onDestroy() { offs.forEach((f) => f?.()); },
  };
}

