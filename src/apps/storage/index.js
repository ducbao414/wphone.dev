// Storage Sense — what's using space on the phone, temporary file cleanup, browser quota & persistence.
import './style.css';
import { HardDrive, ListChecks } from 'lucide';

const CATS = [
  { id: 'apps', label: 'apps data', color: '#A200FF' },
  { id: 'pictures', label: 'pictures', color: '#F09609' },
  { id: 'music', label: 'music', color: '#E51400' },
  { id: 'videos', label: 'videos', color: '#00ABA9' },
  { id: 'documents', label: 'documents', color: '#1BA1E2' },
  { id: 'other', label: 'other', color: '#A05000' },
  { id: 'temp', label: 'temporary files', color: '#8CBF26' },
];
const catOfMime = (t = '') => (t.startsWith('image/') ? 'pictures' : t.startsWith('audio/') ? 'music' : t.startsWith('video/') ? 'videos'
  : t.startsWith('text/') || t.includes('document') || t.includes('pdf') || t.includes('x-wp') ? 'documents' : 'other');

/* ---------------- raw IndexedDB access (read-only scans + safe cache deletion) */
function openRaw() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('wphone');
    // Never create/upgrade the OS database from here.
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('Could not open storage'));
    r.onblocked = () => rej(new Error('Storage is busy'));
  });
}
async function withDB(fn) {
  const db = await openRaw();
  try { return await fn(db); } finally { db.close(); }
}
const sizeOf = (v) => {
  if (v == null) return 0;
  if (v instanceof Blob) return v.size;
  if (v instanceof ArrayBuffer) return v.byteLength;
  try { return new Blob([JSON.stringify(v)]).size; } catch { return 0; }
};
function cursorEach(store, range, fn) {
  return new Promise((res, rej) => {
    const req = store.openCursor(range);
    req.onsuccess = () => { const c = req.result; if (!c) return res(); fn(c); c.continue(); };
    req.onerror = () => rej(req.error);
  });
}
/** Scan kv + thumbs stores. Returns { net: {bytes, count}, thumbs: {bytes, count}, apps: Map(ns -> bytes), system: bytes } */
async function scanDB() {
  return withDB(async (db) => {
    const out = { net: { bytes: 0, count: 0 }, thumbs: { bytes: 0, count: 0 }, apps: new Map(), system: 0 };
    const stores = ['kv', 'thumbs'].filter((s) => db.objectStoreNames.contains(s));
    if (!stores.length) return out;
    const t = db.transaction(stores, 'readonly');
    const jobs = [];
    if (stores.includes('kv')) jobs.push(cursorEach(t.objectStore('kv'), null, (c) => {
      const k = String(c.key), sz = sizeOf(c.value) + k.length;
      if (k.startsWith('net:')) { out.net.bytes += sz; out.net.count++; }
      else if (k.startsWith('app:')) { const ns = k.split(':')[1]; out.apps.set(ns, (out.apps.get(ns) || 0) + sz); }
      else out.system += sz;
    }));
    if (stores.includes('thumbs')) jobs.push(cursorEach(t.objectStore('thumbs'), null, (c) => { out.thumbs.bytes += sizeOf(c.value); out.thumbs.count++; }));
    await Promise.all(jobs);
    return out;
  });
}
function txDone(t) { return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
async function clearNetCache() {
  return withDB(async (db) => {
    const t = db.transaction('kv', 'readwrite');
    let n = 0;
    await cursorEach(t.objectStore('kv'), IDBKeyRange.bound('net:', 'net:￿'), (c) => { c.delete(); n++; });
    await txDone(t);
    return n;
  });
}
async function clearThumbs() {
  return withDB(async (db) => {
    if (!db.objectStoreNames.contains('thumbs')) return;
    const t = db.transaction('thumbs', 'readwrite');
    t.objectStore('thumbs').clear();
    await txDone(t);
  });
}
async function clearAppData(ns) {
  return withDB(async (db) => {
    const t = db.transaction('kv', 'readwrite');
    await cursorEach(t.objectStore('kv'), IDBKeyRange.bound(`app:${ns}:`, `app:${ns}:￿`), (c) => c.delete());
    await txDone(t);
  });
}

export default async function launch(ctx) {
  const { os } = ctx;
  const { el, I } = os.ui;
  const { formatBytes } = os.util;

  async function gather() {
    const [files, est, db] = await Promise.all([
      os.fs.walk('/', (m) => m.type === 'file'),
      os.device.storageEstimate().catch(() => ({ usage: 0, quota: 0 })),
      scanDB().catch(() => ({ net: { bytes: 0, count: 0 }, thumbs: { bytes: 0, count: 0 }, apps: new Map(), system: 0 })),
    ]);
    const sizes = { apps: 0, pictures: 0, music: 0, videos: 0, documents: 0, other: 0, temp: 0 };
    for (const m of files) sizes[catOfMime(m.mime)] += m.size || 0;
    for (const v of db.apps.values()) sizes.apps += v;
    sizes.apps += db.system;
    sizes.temp = db.net.bytes + db.thumbs.bytes;
    const total = Object.values(sizes).reduce((a, b) => a + b, 0);
    return { files, est, db, sizes, total };
  }

  function segBar(sizes, total, { scale } = {}) {
    const barEl = el('div.storage-bar');
    const denom = Math.max(scale || total, 1);
    for (const c of CATS) {
      const v = sizes[c.id] || 0;
      if (!v) continue;
      const w = (v / denom) * 100;
      barEl.append(el('div.storage-seg', { style: { width: `max(3px, ${w}%)`, background: c.color }, title: c.label }));
    }
    return barEl;
  }

  /* ---------------- main page */
  ctx.navigate(mainPage);
  function mainPage(page) {
    const p = os.ui.page({ app: 'STORAGE SENSE', title: 'storage sense' });
    const body = el('div');
    p.content.append(body);
    page.el.append(p.el);

    async function draw() {
      body.replaceChildren(os.ui.loadingDots({ inline: true }));
      const g = await gather();
      const quota = g.est.quota || 0;
      const used = g.est.usage || g.total;
      const free = Math.max(0, quota - used);
      const phone = el('div.storage-device.tilt', { onclick: () => ctx.navigate(phonePage) },
        el('div.storage-device-top',
          el('div.storage-device-icon', { html: os.ui.iconSVG(HardDrive, { size: 30 }) }),
          el('div.wp-grow', el('div.storage-device-name', 'phone'), el('div.storage-device-sub', quota ? `${formatBytes(free)} free of ${formatBytes(quota)}` : `${formatBytes(g.total)} used`))),
        segBar(g.sizes, g.total, { scale: quota ? Math.max(quota / 40, g.total) : 0 }),
        el('div.storage-device-hint', `${formatBytes(g.total)} used by the phone · tap to see what's using space`));
      const tempBytes = g.sizes.temp;
      const tempCard = el('div.storage-card',
        el('div.storage-card-title', 'temporary files'),
        os.ui.desc(tempBytes ? `${formatBytes(tempBytes)} of cached news, weather, images and thumbnails can be removed. Apps download them again when needed.` : 'There are no temporary files to delete right now.'),
        tempBytes ? os.ui.button('delete temporary files', async () => {
          await clearNetCache(); await clearThumbs();
          os.toast(`Freed ${formatBytes(tempBytes)}`, 'storage');
          draw();
        }, { accent: true }) : null);

      const persisted = await navigator.storage?.persisted?.().catch(() => false);
      const persistEl = el('div.storage-card',
        el('div.storage-card-title', 'keep my files'),
        os.ui.desc(persisted
          ? 'Your browser has made this phone’s storage persistent. Files won’t be cleared automatically when your real device runs low on space.'
          : 'Your phone lives in this browser. Under storage pressure the browser may clear it. Ask the browser to keep it permanently.'),
        persisted ? el('div.storage-ok', '✓ storage is persistent') : os.ui.button('make storage persistent', async () => {
          let ok = false;
          try { ok = await (os.device.persistStorage?.() ?? navigator.storage?.persist?.()); } catch {}
          if (ok) os.toast('Storage is now persistent', 'storage');
          else os.ui.alert('The browser declined the request. Browsers usually grant it after you bookmark or install this site, or use it often.', 'keep my files');
          draw();
        }));

      const quotaEl = el('div.storage-card',
        el('div.storage-card-title', 'browser quota'),
        el('div.storage-kv', el('span', 'used by this site'), el('span', formatBytes(used))),
        el('div.storage-kv', el('span', 'available quota'), el('span', quota ? formatBytes(quota) : 'unknown')),
        quota ? (() => { const pb = os.ui.progressBar(Math.min(1, used / quota)); pb.classList.add('storage-quota-bar'); return pb; })() : null,
        os.ui.desc('The quota is decided by your browser based on free space on your real device.'));

      body.replaceChildren(phone, tempCard, persistEl, quotaEl);
    }
    draw();
    const bar = os.ui.appBar({ buttons: [{ icon: I.refresh, label: 'refresh', onClick: draw }], menu: [{ label: 'open files', onClick: () => os.launch('files') }] });
    page.el.append(bar.el);
    let first = true;
    return { onShow: () => { if (first) { first = false; return; } draw(); } };
  }

  /* ---------------- phone breakdown */
  function phonePage(page) {
    const p = os.ui.page({ app: 'STORAGE SENSE', title: 'phone' });
    const body = el('div');
    p.content.append(body);
    page.el.append(p.el);
    async function draw() {
      body.replaceChildren(os.ui.loadingDots({ inline: true }));
      const g = await gather();
      const rows = CATS.map((c) => {
        const row = el('div.storage-cat.tilt.wp-list-item',
          el('div.storage-swatch', { style: { background: c.color } }),
          el('div.wp-grow', el('div.storage-cat-name', c.label)),
          el('div.storage-cat-size', formatBytes(g.sizes[c.id])));
        row.addEventListener('click', () => ctx.navigate(c.id === 'temp' ? tempPage : c.id === 'apps' ? appsPage : catPage, { cat: c }));
        return row;
      });
      body.replaceChildren(
        el('div.storage-total', el('span.storage-total-num', formatBytes(g.total)), el('span.subtle', ' used')),
        segBar(g.sizes, g.total),
        os.ui.desc('Tap a category to see and remove what’s inside.'),
        el('div.wp-list', rows));
    }
    draw();
    let first = true;
    return { onShow: () => { if (first) { first = false; return; } draw(); } };
  }

  /* ---------------- temp files */
  function tempPage(page) {
    const p = os.ui.page({ app: 'STORAGE SENSE', title: 'temporary files' });
    page.el.append(p.el);
    async function draw() {
      const db = await scanDB().catch(() => null);
      if (!db) { p.content.replaceChildren(os.ui.empty('couldn’t read temporary files')); return; }
      p.content.replaceChildren(
        el('div.storage-card',
          el('div.storage-card-title', 'internet cache'),
          os.ui.desc(`${db.net.count} cached responses (news, weather, maps, search…) · ${formatBytes(db.net.bytes)}`),
          os.ui.button('delete', async () => { const n = await clearNetCache(); os.toast(`${n} cached items deleted`, 'storage'); draw(); }, { disabled: !db.net.count })),
        el('div.storage-card',
          el('div.storage-card-title', 'thumbnails'),
          os.ui.desc(`${db.thumbs.count} picture previews · ${formatBytes(db.thumbs.bytes)}. They’re recreated when you browse pictures.`),
          os.ui.button('delete', async () => { await clearThumbs(); os.toast('Thumbnails deleted', 'storage'); draw(); }, { disabled: !db.thumbs.count })));
    }
    draw();
  }

  /* ---------------- apps data */
  function appsPage(page) {
    const p = os.ui.page({ app: 'STORAGE SENSE', title: 'apps data' });
    page.el.append(p.el);
    async function draw() {
      const db = await scanDB().catch(() => null);
      if (!db) { p.content.replaceChildren(os.ui.empty('couldn’t read app data')); return; }
      const arr = [...db.apps].map(([ns, bytes]) => ({ ns, bytes, m: os.apps.get(ns) })).sort((a, b) => b.bytes - a.bytes);
      const list = os.ui.list(arr, {
        empty: 'no apps have saved data yet',
        render: (x) => os.ui.listItem({ title: x.m?.name || x.ns, subtitle: formatBytes(x.bytes), icon: x.m?.icon || I.file }),
        onClick: (x, row) => menu(x, row), onHold: (x, row) => menu(x, row),
      });
      p.content.replaceChildren(os.ui.desc(`System settings & live tile cache: ${formatBytes(db.system)}`), list);
    }
    function menu(x, row) {
      os.ui.contextMenu(row, [
        x.m ? { label: 'open app', onClick: () => os.launch(x.ns) } : null,
        { label: 'clear data', onClick: async () => {
          const name = x.m?.name || x.ns;
          if (!(await os.ui.confirm(`Clear all saved data for ${name}? Settings and content saved inside the app will be lost. Files in your folders are kept.`, 'clear data', 'clear', 'cancel'))) return;
          await clearAppData(x.ns);
          os.toast(`${name} data cleared — restart the app`, 'storage');
          draw();
        } },
      ]);
    }
    draw();
  }

  /* ---------------- file category */
  function catPage(page) {
    const cat = page.params.cat;
    const p = os.ui.page({ app: 'STORAGE SENSE', title: cat.label });
    page.el.append(p.el);
    let selecting = false;
    const sel = new Set();
    let files = [];
    const bar = os.ui.appBar({});
    page.el.append(bar.el);

    async function draw() {
      files = (await os.fs.walk('/', (m) => m.type === 'file' && catOfMime(m.mime) === cat.id)).sort((a, b) => (b.size || 0) - (a.size || 0));
      for (const s of [...sel]) if (!files.some((f) => f.path === s)) sel.delete(s);
      const total = files.reduce((a, f) => a + (f.size || 0), 0);
      const list = el('div.wp-list');
      if (!files.length) list.append(os.ui.empty(`no ${cat.label} on your phone`));
      for (const m of files) {
        const ic = el('div.storage-ficon', { html: os.ui.iconSVG(os.fileIconFor(m), { size: 24 }) });
        const row = el('div.storage-file.wp-list-item.tilt' + (sel.has(m.path) ? '.selected' : ''),
          selecting ? el('div.storage-check', { html: os.ui.iconSVG(I.check, { size: 16, stroke: 3 }) }) : null,
          ic,
          el('div.wp-row-text', el('div.storage-fname', m.name), el('div.wp-row-sub', `${formatBytes(m.size)} · ${os.path.dirname(m.path)}`)));
        if ((m.mime || '').startsWith('image/')) os.fs.thumb(m.path).then((u) => { if (u) { ic.innerHTML = ''; ic.style.backgroundImage = `url("${u}")`; } }).catch(() => {});
        row.addEventListener('click', () => {
          if (selecting) { sel.has(m.path) ? sel.delete(m.path) : sel.add(m.path); row.classList.toggle('selected'); updateBar(); }
          else os.openFile(m.path);
        });
        os.util.onLongPress(row, () => {
          if (selecting) return;
          os.ui.contextMenu(row, [
            { label: 'open', onClick: () => os.openFile(m.path) },
            { label: 'show in files', onClick: () => os.launch('files', { path: m.path }) },
            { label: 'delete', onClick: () => del([m.path]) },
          ]);
        });
        list.append(row);
      }
      p.content.replaceChildren(el('div.storage-total', el('span.storage-total-num', formatBytes(total)), el('span.subtle', ` in ${files.length} file${files.length === 1 ? '' : 's'}`)), list);
      updateBar();
    }
    async function del(paths) {
      if (!paths.length) return;
      if (!(await os.ui.confirm(paths.length === 1 ? `Delete "${os.path.basename(paths[0])}"?` : `Delete ${paths.length} files?`, 'delete', 'delete', 'cancel'))) return;
      for (const x of paths) await os.fs.remove(x).catch(() => {});
      selecting = false; sel.clear();
      draw();
    }
    function updateBar() {
      if (selecting) {
        bar.setButtons([
          { icon: I.delete, label: 'delete', disabled: !sel.size, onClick: () => del([...sel]) },
          { icon: ListChecks, label: 'select all', onClick: () => { if (sel.size === files.length) sel.clear(); else files.forEach((f) => sel.add(f.path)); draw(); } },
          { icon: I.close, label: 'cancel', onClick: () => { selecting = false; sel.clear(); draw(); } },
        ]);
      } else {
        bar.setButtons([{ icon: I.check, label: 'select', disabled: !files.length, onClick: () => { selecting = true; draw(); } }]);
      }
      bar.setMenu([]);
    }
    const off = os.fs.on('change', os.util.debounce(draw, 200));
    draw();
    return {
      onBack: () => { if (selecting) { selecting = false; sel.clear(); draw(); return true; } return false; },
      onDestroy: off,
    };
  }
}
