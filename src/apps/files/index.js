// Files — Windows Phone 8.1 style file manager for the simulator's phone storage.
import './style.css';
import { FolderPlus, FolderInput, ListChecks, ArrowDownUp, HardDrive, FileArchive } from 'lucide';

const SORTS = [
  { value: 'name', label: 'name' },
  { value: 'date', label: 'date' },
  { value: 'size', label: 'size' },
  { value: 'type', label: 'type' },
];

export default async function launch(ctx) {
  const { root, os, storage } = ctx;
  const { el, I } = os.ui;
  const { formatBytes, formatRelative, debounce } = os.util;
  const P = os.path;

  let cwd = '/';
  let sort = await storage.get('sort', 'name');
  let selectMode = false;
  const selected = new Set();
  let searchQ = null;        // null = not searching
  let items = [];            // current listing (metas)
  let renderToken = 0;

  // ---------- layout
  const crumbs = el('div.files-crumbs');
  const summary = el('div.files-summary');
  const searchBox = os.ui.textbox({ placeholder: 'search phone', cls: 'files-search-input' });
  const searchWrap = el('div.files-search', searchBox);
  searchWrap.hidden = true;
  const listEl = el('div.wp-list.files-list');
  const pageObj = os.ui.page({ app: 'FILES', title: 'phone', cls: 'files-page' });
  pageObj.header.append(crumbs);
  pageObj.content.append(searchWrap, summary, listEl);
  const bar = os.ui.appBar({});
  pageObj.el.append(bar.el);
  root.append(pageObj.el);

  const fileInput = el('input', { type: 'file', multiple: true, style: { display: 'none' } });
  root.append(fileInput);
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files?.length) return;
    const dest = uploadDir();
    try {
      const metas = await os.fs.importFiles(fileInput.files, dest);
      os.toast(`${metas.length} item${metas.length === 1 ? '' : 's'} added to ${folderLabel(dest)}`, 'files');
      if (dest !== cwd) go(dest);
    } catch (e) { os.ui.alert(e.message || String(e), 'upload failed'); }
    fileInput.value = '';
  });

  // Drag & drop from the desktop into the current folder
  root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); root.classList.add('files-drop'); } });
  root.addEventListener('dragleave', (e) => { if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('files-drop'); });
  root.addEventListener('drop', async (e) => {
    e.preventDefault(); root.classList.remove('files-drop');
    const f = e.dataTransfer?.files;
    if (f?.length) { const metas = await os.fs.importFiles(f, uploadDir()); os.toast(`${metas.length} item(s) imported`, 'files'); }
  });

  const uploadDir = () => (cwd === '/' ? '/Downloads' : cwd);
  const folderLabel = (p) => (p === '/' ? 'Phone' : P.basename(p));

  // ---------- helpers
  const typeOf = (m) => (m.type === 'dir' ? '' : P.extname(m.name));
  function sorted(arr) {
    const cmpName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const cmp = {
      name: cmpName,
      date: (a, b) => (b.modified || 0) - (a.modified || 0) || cmpName(a, b),
      size: (a, b) => (b.size || 0) - (a.size || 0) || cmpName(a, b),
      type: (a, b) => typeOf(a).localeCompare(typeOf(b)) || cmpName(a, b),
    }[sort] || cmpName;
    return [...arr].sort((a, b) => (a.type === b.type ? cmp(a, b) : a.type === 'dir' ? -1 : 1));
  }

  function iconFor(m) {
    if (m.type === 'dir') return I.folder;
    const ext = P.extname(m.name);
    if (ext === 'zip') return FileArchive;
    return os.fileIconFor(m);
  }
  function typeClass(m) {
    if (m.type === 'dir') return 'dir';
    const t = m.mime || '';
    if (t.startsWith('image/')) return 'img';
    if (t.startsWith('audio/')) return 'aud';
    if (t.startsWith('video/')) return 'vid';
    const ext = P.extname(m.name);
    if (ext === 'wdoc' || ext === 'doc' || ext === 'docx') return 'word';
    if (ext === 'wxls' || ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'excel';
    if (ext === 'one') return 'note';
    if (ext === 'pdf') return 'pdf';
    return 'doc';
  }

  function renderCrumbs() {
    crumbs.replaceChildren();
    if (searchQ != null) { crumbs.append(el('span.files-crumb.current', 'search results')); return; }
    const parts = cwd === '/' ? [] : cwd.slice(1).split('/');
    const mk = (label, path, last) => el('span.files-crumb.tilt' + (last ? '.current' : ''), { onclick: () => { if (!last) go(path); } }, label);
    crumbs.append(mk('Phone', '/', !parts.length));
    let acc = '';
    parts.forEach((p, i) => {
      acc += '/' + p;
      crumbs.append(el('span.files-crumb-sep', '›'), mk(p, acc, i === parts.length - 1));
    });
    requestAnimationFrame(() => (crumbs.scrollLeft = crumbs.scrollWidth));
  }

  async function renderSummary() {
    summary.replaceChildren();
    if (cwd !== '/' || searchQ != null) { summary.hidden = true; return; }
    summary.hidden = false;
    const [u, est] = await Promise.all([os.fs.usage(), os.device.storageEstimate().catch(() => ({}))]);
    const quota = est.quota || 0;
    const used = u.total;
    const fill = el('div.files-summary-fill');
    const pct = quota ? Math.max(0.005, Math.min(1, (est.usage || used) / quota)) : 0;
    fill.style.width = pct * 100 + '%';
    summary.append(
      el('div.files-summary-row.tilt', { onclick: () => os.launch('storage') },
        el('div.files-summary-icon', { html: os.ui.iconSVG(HardDrive, { size: 30 }) }),
        el('div.wp-grow',
          el('div.files-summary-title', 'Phone'),
          el('div.files-summary-sub', quota ? `${formatBytes(used)} in files · ${formatBytes(Math.max(0, quota - (est.usage || used)))} free` : `${formatBytes(used)} used`))),
      quota ? el('div.files-summary-bar', fill) : null);
  }

  async function subtitleFor(m, sub) {
    if (m.type === 'dir') {
      const n = (await os.fs.list(m.path)).length;
      sub.textContent = `${n} item${n === 1 ? '' : 's'}`;
    } else sub.textContent = `${formatRelative(m.modified)} · ${formatBytes(m.size)}`;
  }

  function rowFor(m, { showPath = false } = {}) {
    const ic = el('div.files-icon.files-t-' + typeClass(m), { html: os.ui.iconSVG(iconFor(m), { size: 26 }) });
    const sub = el('div.wp-row-sub', '');
    const check = el('div.files-check', { html: os.ui.iconSVG(I.check, { size: 16, stroke: 3 }) });
    const row = el('div.files-row' + (selected.has(m.path) ? '.selected' : ''),
      check, ic,
      el('div.wp-row-text', el('div.wp-row-title', m.name), sub, showPath ? el('div.files-path', P.dirname(m.path) === '/' ? 'Phone' : 'Phone' + P.dirname(m.path).replace(/\//g, ' › ')) : null));
    row.dataset.path = m.path;
    subtitleFor(m, sub);
    if (m.type === 'file' && (m.mime || '').startsWith('image/')) {
      os.fs.thumb(m.path).then((u) => { if (u) { ic.classList.add('files-thumb'); ic.style.backgroundImage = `url("${u}")`; ic.innerHTML = ''; } }).catch(() => {});
    }
    return row;
  }

  async function render() {
    const token = ++renderToken;
    renderCrumbs();
    root.classList.toggle('files-selecting', selectMode);
    pageObj.setTitle(searchQ != null ? 'search' : cwd === '/' ? 'phone' : P.basename(cwd).toLowerCase());
    renderSummary();
    let arr;
    if (searchQ != null) {
      const q = searchQ.trim().toLowerCase();
      arr = q ? sorted(await os.fs.walk('/', (m) => m.name.toLowerCase().includes(q))) : [];
    } else {
      if (!(await os.fs.exists(cwd))) cwd = '/';
      arr = sorted(await os.fs.list(cwd));
    }
    if (token !== renderToken) return;
    items = arr;
    for (const p of [...selected]) if (!arr.some((m) => m.path === p)) selected.delete(p);
    listEl.replaceChildren();
    if (!arr.length) {
      listEl.append(os.ui.empty(searchQ != null ? (searchQ.trim() ? `no files match "${searchQ.trim()}"` : 'type to search all of your phone') : 'this folder is empty'));
      if (searchQ == null && cwd !== '/') listEl.append(os.ui.desc('Tap upload to add files from your device, or drop files here.'));
    }
    for (const m of arr) {
      const row = rowFor(m, { showPath: searchQ != null });
      row.classList.add('wp-list-item', 'tilt');
      row.addEventListener('click', () => onTap(m, row));
      os.util.onLongPress(row, () => onHold(m, row));
      listEl.append(row);
    }
    updateBar();
  }
  const rerender = debounce(render, 120);

  function go(dir) {
    cwd = dir;
    searchQ = null;
    searchWrap.hidden = true;
    selectMode = false;
    selected.clear();
    pageObj.content.scrollTop = 0;
    render();
  }

  function onTap(m, row) {
    if (selectMode) { toggleSel(m, row); return; }
    if (m.type === 'dir') go(m.path);
    else os.openFile(m.path);
  }
  function toggleSel(m, row) {
    selected.has(m.path) ? selected.delete(m.path) : selected.add(m.path);
    row.classList.toggle('selected', selected.has(m.path));
    updateBar();
  }

  function onHold(m, row) {
    if (selectMode) { toggleSel(m, row); return; }
    const isFile = m.type === 'file';
    os.ui.contextMenu(row, [
      { label: isFile ? 'open' : 'open folder', onClick: () => onTap(m, row) },
      searchQ != null ? { label: 'open file location', onClick: () => go(P.dirname(m.path)) } : null,
      isFile ? { label: 'share', onClick: () => os.share({ title: m.name, path: m.path }) } : null,
      { label: 'copy to…', onClick: () => transfer([m.path], 'copy') },
      { label: 'move to…', onClick: () => transfer([m.path], 'move') },
      { label: 'rename', onClick: () => rename(m) },
      isFile ? { label: 'save to device', onClick: () => os.fs.download(m.path) } : null,
      { label: 'select', onClick: () => { enterSelect(); selected.add(m.path); render(); } },
      { label: 'delete', onClick: () => remove([m.path]) },
    ]);
  }

  // ---------- actions
  async function newFolder() {
    const dir = cwd === '/' && searchQ == null ? '/' : cwd;
    const name = await os.ui.prompt('Name your new folder', 'New folder', 'new folder');
    if (name == null) return;
    const clean = name.trim().replace(/[\\/]/g, '-');
    if (!clean) return;
    const p = await os.fs.uniquePath(P.join(dir, clean));
    await os.fs.mkdir(p);
    render();
  }

  async function rename(m) {
    const name = await os.ui.prompt('New name', m.name, 'rename');
    if (name == null) return;
    const clean = name.trim().replace(/[\\/]/g, '-');
    if (!clean || clean === m.name) return;
    const target = P.join(P.dirname(m.path), clean);
    if (await os.fs.exists(target)) return os.ui.alert(`There's already an item named "${clean}" here.`, 'rename');
    try { await os.fs.rename(m.path, clean); } catch (e) { os.ui.alert(e.message, 'rename'); }
    exitSelect();
  }

  async function remove(paths) {
    if (!paths.length) return;
    const one = paths.length === 1 ? P.basename(paths[0]) : null;
    const ok = await os.ui.confirm(one ? `Delete "${one}"?` : `Delete ${paths.length} items?`, 'delete', 'delete', 'cancel');
    if (!ok) return;
    for (const p of paths) { try { await os.fs.remove(p); } catch (e) { console.warn(e); } }
    os.toast(`${paths.length} item${paths.length === 1 ? '' : 's'} deleted`, 'files');
    exitSelect();
  }

  async function transfer(paths, mode) {
    if (!paths.length) return;
    const dest = await pickFolder({ title: mode === 'copy' ? 'copy to' : 'move to', start: cwd, action: mode === 'copy' ? 'copy here' : 'move here', exclude: mode === 'move' ? paths : [] });
    if (!dest) return;
    let n = 0;
    for (const p of paths) {
      if (dest === p || dest.startsWith(p + '/')) { os.ui.alert(`Can't put "${P.basename(p)}" inside itself.`, mode); continue; }
      if (mode === 'move' && P.dirname(p) === dest) continue;
      const target = await os.fs.uniquePath(P.join(dest, P.basename(p)));
      try { mode === 'copy' ? await os.fs.copy(p, target) : await os.fs.move(p, target); n++; } catch (e) { os.ui.alert(e.message, mode); }
    }
    if (n) os.toast(`${n} item${n === 1 ? '' : 's'} ${mode === 'copy' ? 'copied' : 'moved'} to ${folderLabel(dest)}`, 'files');
    exitSelect();
  }

  async function shareSel(paths) {
    const files = [];
    for (const p of paths) { const st = await os.fs.stat(p); if (st?.type === 'file') files.push(p); }
    if (!files.length) return os.ui.alert('Select one or more files to share. Folders can’t be shared.', 'share');
    if (files.length > 1) os.toast('Sharing the first file', 'files');
    os.share({ title: P.basename(files[0]), path: files[0] });
  }
  async function downloadSel(paths) {
    let n = 0;
    for (const p of paths) {
      const st = await os.fs.stat(p);
      if (st?.type === 'file') { await os.fs.download(p); n++; await os.util.sleep(250); }
    }
    if (!n) os.ui.alert('Only files can be saved to your device.', 'save');
  }

  /** In-app full-screen folder chooser. Resolves a folder path or null. */
  function pickFolder({ title, start = '/', action = 'choose', exclude = [] }) {
    return new Promise((resolve) => {
      let dir = start;
      const path = el('div.files-crumbs.files-picker-crumbs');
      const lst = el('div.wp-list.files-picker-list');
      const layer = el('div.wp-fullpicker.files-picker.anim-turnstile-in', el('div.wp-app-title', title.toUpperCase()), path, lst);
      const finish = (v) => { layer.remove(); pop(); resolve(v); };
      const draw = async () => {
        if (!(await os.fs.exists(dir))) dir = '/';
        path.textContent = dir === '/' ? 'Phone' : 'Phone' + dir.replace(/\//g, ' › ');
        const dirs = (await os.fs.list(dir)).filter((m) => m.type === 'dir' && !exclude.includes(m.path));
        lst.replaceChildren();
        if (dir !== '/') {
          const up = os.ui.listItem({ title: '..', subtitle: 'up one level', icon: I.up });
          up.classList.add('wp-list-item', 'tilt');
          up.onclick = () => { dir = P.dirname(dir); draw(); };
          lst.append(up);
        }
        for (const m of dirs) {
          const r = os.ui.listItem({ title: m.name, icon: I.folder });
          r.classList.add('wp-list-item', 'tilt');
          r.onclick = () => { dir = m.path; draw(); };
          lst.append(r);
        }
        if (!dirs.length) lst.append(os.ui.empty('no folders here'));
      };
      const pb = os.ui.appBar({
        buttons: [
          { icon: I.check, label: action, onClick: () => finish(dir) },
          { icon: FolderPlus, label: 'new folder', onClick: async () => {
            const n = await os.ui.prompt('Name your new folder', 'New folder', 'new folder');
            if (!n?.trim()) return;
            const p = await os.fs.uniquePath(P.join(dir, n.trim().replace(/[\\/]/g, '-')));
            await os.fs.mkdir(p); dir = p; draw();
          } },
          { icon: I.close, label: 'cancel', onClick: () => finish(null) },
        ],
      });
      layer.append(pb.el);
      document.getElementById('overlay-layer').append(layer);
      const pop = os.ui.pushOverlayBack(() => { if (dir !== '/') { dir = P.dirname(dir); draw(); } else finish(null); });
      draw();
    });
  }

  async function chooseSort() {
    const v = await os.ui.pickFromList({ title: 'sort by', options: SORTS, value: sort });
    if (!v || v === sort) return;
    sort = v; storage.set('sort', sort); render();
  }

  function enterSelect() { selectMode = true; selected.clear(); render(); }
  function exitSelect() { selectMode = false; selected.clear(); render(); }

  function openSearch() {
    searchQ = '';
    searchWrap.hidden = false;
    selectMode = false; selected.clear();
    render();
    setTimeout(() => searchBox.focus(), 50);
  }
  function closeSearch() { searchQ = null; searchBox.value = ''; searchWrap.hidden = true; render(); }
  searchBox.addEventListener('input', debounce(() => { if (searchQ != null) { searchQ = searchBox.value; render(); } }, 180));

  function updateBar() {
    if (selectMode) {
      const sel = [...selected];
      const none = !sel.length;
      bar.setButtons([
        { icon: I.copy, label: 'copy', disabled: none, onClick: () => transfer(sel, 'copy') },
        { icon: FolderInput, label: 'move', disabled: none, onClick: () => transfer(sel, 'move') },
        { icon: I.delete, label: 'delete', disabled: none, onClick: () => remove(sel) },
        { icon: ListChecks, label: sel.length === items.length && items.length ? 'clear' : 'select all', onClick: () => {
          if (sel.length === items.length) selected.clear(); else items.forEach((m) => selected.add(m.path));
          render();
        } },
      ]);
      bar.setMenu([
        { label: 'share', disabled: none, onClick: () => shareSel(sel) },
        { label: 'save to device', disabled: none, onClick: () => downloadSel(sel) },
        { label: 'rename', disabled: sel.length !== 1, onClick: async () => rename(await os.fs.stat(sel[0])) },
        { label: 'cancel', onClick: exitSelect },
      ]);
      pageObj.setTitle(sel.length ? `${sel.length} selected` : 'select items');
      return;
    }
    if (searchQ != null) {
      bar.setButtons([
        { icon: I.close, label: 'close search', onClick: closeSearch },
        { icon: I.check, label: 'select', disabled: !items.length, onClick: enterSelect },
      ]);
      bar.setMenu([{ label: 'sort by ' + sort, onClick: chooseSort }]);
      return;
    }
    bar.setButtons([
      { icon: FolderPlus, label: 'new folder', onClick: newFolder },
      { icon: I.check, label: 'select', disabled: !items.length, onClick: enterSelect },
      { icon: I.search, label: 'search', onClick: openSearch },
      { icon: I.upload, label: 'upload', onClick: () => fileInput.click() },
    ]);
    bar.setMenu([
      { label: 'sort by: ' + sort, onClick: chooseSort },
      { label: 'refresh', onClick: render },
      { label: 'storage sense', onClick: () => os.launch('storage') },
    ]);
  }

  // ---------- back handling
  ctx.onBack(() => {
    if (selectMode) { exitSelect(); return true; }
    if (searchQ != null) { closeSearch(); return true; }
    if (cwd !== '/') { go(P.dirname(cwd)); return true; }
    return false;
  });

  const offFs = os.fs.on('change', () => rerender());

  async function applyArgs(a = {}) {
    const target = a.path || a.dir || a.folder;
    if (!target) return;
    const st = await os.fs.stat(target);
    if (!st) return;
    go(st.type === 'dir' ? st.path : P.dirname(st.path));
  }
  ctx.on('args', applyArgs);
  ctx.on('resume', () => rerender());

  render();
  await applyArgs(ctx.args);

  return { onDestroy: () => offFs() };
}
