// Office Mobile hub: recent documents, places (phone storage), new document templates; opens Word/Excel/text editors.
import './style.css';
import { KINDS, TEMPLATES, kindOf, isSupported, stem, extOf, SUPPORTED } from './docs.js';
import { editorPage } from './word.js';
import { sheetPage } from './excel.js';

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I } = os.ui;
  const listeners = new Set();     // hub views to refresh on fs changes

  /* ---------------- recents ---------------- */
  async function touchRecent(path) {
    await storage.update('recent', (l) => [{ path, time: Date.now() }, ...(l || []).filter((x) => x.path !== path)].slice(0, 40), []);
    refreshAll();
  }
  async function dropRecent(path) { await storage.update('recent', (l) => (l || []).filter((x) => x.path !== path), []); refreshAll(); }
  async function renameRecent(from, to) { await storage.update('recent', (l) => (l || []).map((x) => (x.path === from ? { ...x, path: to } : x)), []); }

  /* ---------------- file actions ---------------- */
  async function openDoc(path) {
    const meta = await os.fs.stat(path);
    if (!meta || meta.type !== 'file') { dropRecent(path); return os.ui.alert('This document was moved or deleted.', 'office'); }
    // Any other text/* file (e.g. .log, .json) opens in the plain text editor
    const kind = kindOf(path) || ((meta.mime || '').startsWith('text/') || /json|xml/.test(meta.mime || '') ? 'text' : null);
    if (!kind) return os.ui.alert(`Office can’t open “${meta.name}”.`, 'office');
    ctx.navigate(kind === 'excel' ? sheetPage(app, path) : editorPage(app, path));
  }
  async function renameFile(path) {
    const name = os.path.basename(path);
    const ext = extOf(name);
    let n = await os.ui.prompt('New name', stem(name), 'rename');
    if (n == null) return null;
    n = n.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!n) return null;
    const target = os.path.join(os.path.dirname(path), n + (ext ? '.' + ext : ''));
    if (target === path) return null;
    if (await os.fs.exists(target)) { os.ui.alert(`There’s already a file named “${os.path.basename(target)}”.`, 'rename'); return null; }
    await os.fs.rename(path, os.path.basename(target));
    await renameRecent(path, target);
    refreshAll();
    return target;
  }
  async function deleteFile(path) {
    if (!(await os.ui.confirm(`Delete “${os.path.basename(path)}”? This can’t be undone.`, 'delete', 'delete', 'cancel'))) return;
    await os.fs.remove(path);
    await dropRecent(path);
  }
  async function newFromTemplate(t, closePage) {
    let n = await os.ui.prompt('Name your ' + (t.kind === 'excel' ? 'spreadsheet' : 'document'), t.name, 'new ' + KINDS[t.kind].label.toLowerCase());
    if (n == null) return;
    n = (n.trim() || t.name).replace(/[\\/:*?"<>|]/g, '');
    const path = await os.fs.uniquePath(`/Documents/${n}.${t.ext}`);
    await os.fs.write(path, t.content(os.settings.get('ownerName')), t.ext === 'txt' ? { mime: 'text/plain' } : undefined);
    await touchRecent(path);
    // Replace the template page with the editor
    if (closePage) await closePage();
    openDoc(path);
  }
  function holdMenu(meta, row, { recent = false } = {}) {
    os.ui.contextMenu(row, [
      { label: 'open', onClick: () => openDoc(meta.path) },
      { label: 'share', onClick: () => os.share({ title: stem(meta.name), path: meta.path }) },
      { label: 'rename', onClick: () => renameFile(meta.path) },
      { label: 'save to device', onClick: () => os.fs.download(meta.path) },
      recent ? { label: 'remove from recent', onClick: () => dropRecent(meta.path) } : null,
      { label: 'delete', onClick: () => deleteFile(meta.path) },
    ]);
  }

  /* ---------------- row rendering ---------------- */
  function docIcon(name) {
    const k = KINDS[kindOf(name)] || KINDS.text;
    const ext = extOf(name);
    return el('div.office-icon', { style: { background: k.color } }, el('span', k.letter), ext && ext !== 'wdoc' && ext !== 'wxls' ? el('i', ext) : null);
  }
  function docRow(meta, sub) {
    return el('div.office-row', docIcon(meta.name),
      el('div.wp-row-text', el('div.wp-row-title', stem(meta.name)), el('div.wp-row-sub', sub)));
  }
  const where = (path) => 'Phone › ' + (os.path.dirname(path) || '/').split('/').filter(Boolean).join(' › ');

  /* ---------------- hub ---------------- */
  const app = { os, ctx, touchRecent, renameFile, openDoc };

  function hubPage(page) {
    let placesDir = '/Documents';
    const recentC = el('div.office-pane');
    const placesC = el('div.office-pane');

    async function renderRecent() {
      const rec = await storage.get('recent', []);
      const metas = (await Promise.all(rec.map(async (r) => ({ r, m: await os.fs.stat(r.path) })))).filter((x) => x.m && x.m.type === 'file');
      if (metas.length !== rec.length) storage.set('recent', metas.map((x) => x.r));
      // Also suggest recently modified documents that were never opened here (e.g. created by other apps)
      const known = new Set(metas.map((x) => x.m.path));
      const others = (await os.fs.walk('/Documents', (m) => isSupported(m) && !known.has(m.path))).sort((a, b) => b.modified - a.modified).slice(0, 8);
      recentC.replaceChildren();
      if (!metas.length && !others.length) {
        recentC.append(el('div.office-empty',
          el('div.wp-empty', 'No recent documents.'),
          el('div.wp-desc', 'Documents you open or create show up here. Tap new to start a Word document or an Excel spreadsheet.'),
          os.ui.button('new document', () => ctx.navigate(newPage), { accent: true })));
        return;
      }
      if (metas.length) {
        recentC.append(os.ui.list(metas, {
          render: ({ r, m }) => docRow(m, `${os.util.formatRelative(r.time)} · ${where(m.path)}`),
          onClick: ({ m }) => openDoc(m.path),
          onHold: ({ m }, row) => holdMenu(m, row, { recent: true }),
        }));
      }
      if (others.length) {
        recentC.append(os.ui.header(metas.length ? 'also on your phone' : 'on your phone'),
          os.ui.list(others, { render: (m) => docRow(m, `${os.util.formatRelative(m.modified)} · ${where(m.path)}`), onClick: (m) => openDoc(m.path), onHold: (m, row) => holdMenu(m, row) }));
      }
    }

    async function renderPlaces() {
      if (!(await os.fs.exists(placesDir))) placesDir = '/Documents';
      const items = (await os.fs.list(placesDir)).filter((m) => m.type === 'dir' || isSupported(m));
      const crumbs = el('div.office-crumbs');
      const parts = placesDir.split('/').filter(Boolean);
      const go = (d) => { placesDir = d; renderPlaces(); };
      crumbs.append(el('span.tilt', { onclick: () => go('/') }, 'Phone'));
      parts.forEach((p, i) => crumbs.append(el('span.office-crumb-sep', '›'), el('span.tilt', { onclick: () => go('/' + parts.slice(0, i + 1).join('/')) }, p)));
      placesC.replaceChildren(crumbs);
      if (placesDir !== '/') {
        placesC.append(os.ui.list([{ up: true }], { render: () => os.ui.listItem({ title: 'up one level', subtitle: os.path.dirname(placesDir) === '/' ? 'Phone' : os.path.basename(os.path.dirname(placesDir)), icon: I.up }), onClick: () => go(os.path.dirname(placesDir)) }));
      }
      const folderCount = async (d) => (await os.fs.list(d.path)).filter((m) => m.type === 'dir' || isSupported(m)).length;
      const rows = await Promise.all(items.map(async (m) => ({ m, n: m.type === 'dir' ? await folderCount(m) : 0 })));
      placesC.append(os.ui.list(rows, {
        render: ({ m, n }) => (m.type === 'dir'
          ? os.ui.listItem({ title: m.name.toLowerCase(), subtitle: n ? `${n} item${n === 1 ? '' : 's'}` : 'empty', icon: I.folder })
          : docRow(m, `${os.util.formatBytes(m.size)} · ${os.util.formatRelative(m.modified)}`)),
        onClick: ({ m }) => (m.type === 'dir' ? go(m.path) : openDoc(m.path)),
        onHold: ({ m }, row) => {
          if (m.type !== 'dir') return holdMenu(m, row);
          os.ui.contextMenu(row, [{ label: 'open', onClick: () => go(m.path) }, { label: 'open in Files', onClick: () => os.launch('files', { path: m.path }) }]);
        },
        empty: placesDir === '/Documents' ? 'No documents yet. Tap new to create one.' : 'No Office documents in this folder.',
      }));
      placesC.append(os.ui.desc(`Office opens ${SUPPORTED.map((e) => '.' + e).join(' ')} files.`));
    }

    const piv = os.ui.pivot({
      app: 'OFFICE',
      items: [
        { header: 'recent', render: (c) => { c.append(recentC); renderRecent(); } },
        { header: 'places', render: (c) => { c.append(placesC); renderPlaces(); } },
      ],
    });
    const refresh = os.util.debounce(() => {
      if (piv.items[0].rendered) renderRecent();
      if (piv.items[1].rendered) renderPlaces();
    }, 250);
    listeners.add(refresh);

    async function importFromDevice() {
      const inp = el('input', { type: 'file', multiple: true, accept: '.wdoc,.wxls,.txt,.md,.csv,text/plain,text/csv,text/markdown', style: { display: 'none' } });
      inp.onchange = async () => {
        const metas = await os.fs.importFiles(inp.files, '/Documents');
        inp.remove();
        if (metas.length === 1 && kindOf(metas[0].name)) openDoc(metas[0].path);
        else os.toast(`Imported ${metas.length} file${metas.length === 1 ? '' : 's'} to Documents`, 'office');
      };
      document.body.append(inp);
      inp.click();
    }

    const bar = os.ui.appBar({
      buttons: [
        { icon: I.add, label: 'new', onClick: () => ctx.navigate(newPage) },
        { icon: I.search, label: 'search', onClick: () => ctx.navigate(searchPage) },
      ],
      menu: [
        { label: 'import from device', onClick: importFromDevice },
        { label: 'open folder in Files', onClick: () => os.launch('files', { path: placesDir }) },
        { label: 'clear recent list', onClick: async () => { await storage.set('recent', []); refreshAll(); } },
      ],
    });
    page.el.append(piv.el, bar.el);
    return { onShow: refresh, onDestroy: () => listeners.delete(refresh) };
  }

  /* ---------------- new document ---------------- */
  function newPage(page) {
    const p = os.ui.page({ app: 'OFFICE', title: 'new' });
    for (const kind of ['word', 'excel', 'text']) {
      const ts = TEMPLATES.filter((t) => t.kind === kind);
      p.content.append(os.ui.header(kind === 'word' ? 'word' : kind === 'excel' ? 'excel' : 'other'));
      p.content.append(os.ui.list(ts, {
        render: (t) => el('div.office-row', el('div.office-template' + '.' + 'office-tpl-' + t.id, { style: { borderColor: KINDS[t.kind].color } }, el('span', { style: { background: KINDS[t.kind].color } }, KINDS[t.kind].letter)),
          el('div.wp-row-text', el('div.wp-row-title', t.title), el('div.wp-row-sub', t.sub))),
        onClick: (t) => newFromTemplate(t, page.close),
      }));
    }
    page.el.append(p.el);
  }

  /* ---------------- search ---------------- */
  function searchPage(page) {
    const p = os.ui.page({ app: 'OFFICE', title: 'search' });
    const results = el('div');
    const box = os.ui.textbox({ placeholder: 'search document names and text', onInput: os.util.debounce((q) => run(q), 250) });
    p.content.append(box, results);
    async function run(q) {
      q = q.trim().toLowerCase();
      if (!q) { results.replaceChildren(); return; }
      const all = await os.fs.walk('/', isSupported);
      const hits = [];
      for (const m of all) {
        let snippet = '';
        if (m.name.toLowerCase().includes(q)) snippet = where(m.path);
        else if ((m.size || 0) < 400000) {
          try {
            let t = await os.fs.read(m.path, 'text');
            if (m.name.endsWith('.wdoc')) { try { t = JSON.parse(t).html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '); } catch {} }
            if (m.name.endsWith('.wxls')) { try { t = Object.values(JSON.parse(t).cells || {}).join(' '); } catch {} }
            const i = t.toLowerCase().indexOf(q);
            if (i >= 0) snippet = '…' + t.slice(Math.max(0, i - 25), i + 50).replace(/\s+/g, ' ').trim() + '…';
          } catch {}
        }
        if (snippet) hits.push({ m, snippet });
      }
      results.replaceChildren(os.ui.list(hits, { render: ({ m, snippet }) => docRow(m, snippet), onClick: ({ m }) => openDoc(m.path), onHold: ({ m }, row) => holdMenu(m, row), empty: 'no documents found' }));
    }
    page.el.append(p.el);
    setTimeout(() => box.focus(), 400);
  }

  /* ---------------- wiring ---------------- */
  function refreshAll() { listeners.forEach((fn) => fn()); }
  const offFs = os.fs.on('change', ({ path }) => { if (!path || kindOf(path) || !/\.[a-z0-9]+$/i.test(path)) refreshAll(); });

  await ctx.navigate(hubPage);
  const handleArgs = (a) => {
    if (a?.file) openDoc(a.file);
    else if (a?.new) { const t = TEMPLATES.find((x) => x.id === a.new); if (t) newFromTemplate(t); }
  };
  handleArgs(ctx.args);
  ctx.on('args', handleArgs);

  return { onDestroy: () => offFs() };
}
