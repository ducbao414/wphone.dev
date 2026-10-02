// Photos hub (WP 8.1): collection (by month) / albums / favorites, album pages, viewer, editor, slideshow.
import './style.css';
import { Upload, Presentation, SquareCheck, FolderPlus } from 'lucide';
import { PICS, DEFAULT_ALBUMS, allMedia, albumOf, isMedia, isVideo, takenOf, byNewest, lazyThumbs, thumbFor, monthKey, monthLabel } from './lib.js';
import { viewerPage, slideshowPage } from './viewer.js';

export default async function launch(ctx) {
  const { os, storage, args } = ctx;
  const { el, I, iconSVG } = os.ui;
  const io = lazyThumbs(os);

  /* ---------------- favorites ---------------- */
  let favs = new Set(await storage.get('favs', []));
  const fav = {
    has: (p) => favs.has(p),
    async toggle(p) { favs.has(p) ? favs.delete(p) : favs.add(p); await storage.set('favs', [...favs]); emitChange(); return favs.has(p); },
    async drop(paths) { let ch = false; for (const p of paths) ch = favs.delete(p) || ch; if (ch) await storage.set('favs', [...favs]); },
  };

  /* ---------------- data + change notifications ---------------- */
  const listeners = new Set();
  const onData = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emitChange = os.util.debounce(() => listeners.forEach((fn) => fn()), 250);
  const offFs = os.fs.on('change', ({ path }) => {
    if (path.startsWith(PICS) || /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|mp4|webm|mov)$/i.test(path) || !path.includes('.')) emitChange();
  });

  const shared = { os, ctx, fav, io, onData, emitChange, importPhotos, deleteItems };

  async function importPhotos(dir = '/Pictures/Saved Pictures') {
    const inp = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, style: { display: 'none' } });
    document.body.append(inp);
    inp.onchange = async () => {
      const files = [...inp.files];
      inp.remove();
      if (!files.length) return;
      for (const f of files) {
        const p = await os.fs.uniquePath(os.path.join(dir, f.name));
        await os.fs.write(p, f, { mime: f.type || os.path.mimeOf(f.name), meta: { taken: f.lastModified || Date.now() } });
      }
      os.toast(`Imported ${files.length} item${files.length > 1 ? 's' : ''}`);
      os.tiles.refresh('photos');
    };
    inp.click();
    setTimeout(() => inp.remove(), 120000);
  }

  async function deleteItems(paths) {
    if (!paths.length) return false;
    const ok = await os.ui.confirm(paths.length === 1 ? 'Delete this item from your phone?' : `Delete these ${paths.length} items from your phone?`, 'delete', 'delete', 'cancel');
    if (!ok) return false;
    for (const p of paths) {
      await os.fs.remove(p);
      if (os.settings.get('lockWallpaper') === p) os.settings.set('lockWallpaper', 'bing');
      if (os.settings.get('startBackground') === p) os.settings.set('startBackground', null);
    }
    await fav.drop(paths);
    os.tiles.refresh('photos');
    return true;
  }

  /* ---------------- grid with lazy thumbs + selection ---------------- */
  function makeGrid(sel) {
    const cell = (m, list) => {
      const n = el('div.photos-cell.tilt' + (isVideo(m) ? '.video' : ''), { dataset: { path: m.path } });
      n._meta = m;
      if (isVideo(m)) n.append(el('span.photos-cell-play', { html: iconSVG(I.play, { size: 16, stroke: 2 }) }));
      if (fav.has(m.path)) n.append(el('span.photos-cell-fav', { html: iconSVG(I.star, { size: 12, stroke: 2.4 }) }));
      n.append(el('span.photos-cell-check', { html: iconSVG(I.check, { size: 14, stroke: 3 }) }));
      if (sel?.has(m.path)) n.classList.add('selected');
      n.addEventListener('click', () => {
        if (sel?.active) { sel.toggle(m.path, n); return; }
        ctx.navigate(viewerPage, { list, index: list.indexOf(m), shared });
      });
      if (sel) os.util.onLongPress(n, () => { if (!sel.active) sel.start(); sel.toggle(m.path, n); });
      io.observe(n);
      return n;
    };
    return cell;
  }

  function selection(onChange) {
    const s = new Set();
    return {
      active: false,
      has: (p) => s.has(p),
      get size() { return s.size; },
      get paths() { return [...s]; },
      start() { this.active = true; onChange(); },
      stop(root) { this.active = false; s.clear(); root?.querySelectorAll('.photos-cell.selected').forEach((n) => n.classList.remove('selected')); onChange(); },
      toggle(p, n) { s.has(p) ? s.delete(p) : s.add(p); n.classList.toggle('selected', s.has(p)); onChange(); },
      selectAll(root) { root.querySelectorAll('.photos-cell').forEach((n) => { s.add(n.dataset.path); n.classList.add('selected'); }); onChange(); },
    };
  }

  /* ---------------- album page ---------------- */
  function albumPage(page) {
    const { dir, title } = page.params;
    const p = os.ui.page({ app: 'PHOTOS', title: title.toLowerCase() });
    const grid = el('div.photos-grid');
    const count = el('div.photos-count');
    p.content.append(count, grid);
    p.content.classList.add('photos-scroll');
    let list = [];
    const sel = selection(() => { p.el.classList.toggle('photos-selecting', sel.active); setBar(); });
    const cell = makeGrid(sel);
    const render = async () => {
      const all = await allMedia(os);
      list = all.filter((m) => (dir === PICS ? m.parent === PICS : albumOf(m.path) === dir));
      count.textContent = list.length ? `${list.length} item${list.length > 1 ? 's' : ''}` : '';
      grid.replaceChildren(...list.map((m) => cell(m, list)));
      if (!list.length) grid.append(el('div.photos-empty', os.ui.empty('this album is empty'), os.ui.button('import from device', () => importPhotos(dir === PICS ? '/Pictures/Saved Pictures' : dir))));
    };
    const bar = os.ui.appBar({});
    const setBar = () => {
      if (sel.active) {
        bar.setButtons([
          { icon: I.delete, label: 'delete', disabled: !sel.size, onClick: async () => { if (await deleteItems(sel.paths)) sel.stop(grid); } },
          { icon: I.share, label: 'share', disabled: sel.size !== 1, onClick: () => os.share({ path: sel.paths[0], title: os.path.basename(sel.paths[0]) }) },
          { icon: I.close, label: 'cancel', onClick: () => sel.stop(grid) },
        ]);
        bar.setMenu([{ label: 'select all', onClick: () => sel.selectAll(grid) }]);
      } else {
        bar.setButtons([
          { icon: SquareCheck, label: 'select', onClick: () => sel.start() },
          { icon: Presentation, label: 'slideshow', disabled: !list.some((m) => !isVideo(m)), onClick: () => ctx.navigate(slideshowPage, { list, shared }) },
          { icon: Upload, label: 'import', onClick: () => importPhotos(dir === PICS ? '/Pictures/Saved Pictures' : dir) },
        ]);
        bar.setMenu([
          { label: 'pin to start', onClick: () => { ctx.pinTile({ key: 'photos:' + dir, title, args: { album: dir }, size: 'medium' }); os.toast('Pinned to Start'); } },
        ]);
      }
    };
    p.el.append(bar.el);
    const off = onData(async () => { await render(); setBar(); });
    render().then(setBar);
    return { el: p.el, onDestroy: off, onBack: () => { if (sel.active) { sel.stop(grid); return true; } } };
  }

  /* ---------------- hub (pivot) ---------------- */
  function hubPage(page) {
    let all = [];
    const views = {};
    const collSel = selection(() => { pv.el.classList.toggle('photos-selecting', collSel.active); setBar(); });
    const collCell = makeGrid(collSel);
    const favCell = makeGrid(null);

    const renderCollection = (c) => {
      if (!all.length) {
        c.replaceChildren(el('div.photos-empty',
          os.ui.empty('no photos yet'),
          os.ui.desc('Take some with the Camera, or import pictures from your device.'),
          os.ui.button('camera', () => os.launch('camera')), os.ui.button('import', () => importPhotos())));
        return;
      }
      const frag = document.createDocumentFragment();
      let curKey = null, grid = null;
      for (const m of all) {
        const k = monthKey(takenOf(m));
        if (k !== curKey) {
          curKey = k;
          frag.append(el('div.photos-month', monthLabel(takenOf(m))));
          grid = el('div.photos-grid');
          frag.append(grid);
        }
        grid.append(collCell(m, all));
      }
      c.replaceChildren(frag);
    };

    const renderAlbums = async (c) => {
      const groups = new Map();
      for (const d of DEFAULT_ALBUMS) groups.set(d, []);
      for (const d of await os.fs.list(PICS)) if (d.type === 'dir') groups.set(d.path, groups.get(d.path) || []);
      for (const m of all) { const k = albumOf(m.path); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
      const order = (k) => { const i = DEFAULT_ALBUMS.indexOf(k); return i >= 0 ? i : k.startsWith(PICS) ? 10 : 20; };
      const keys = [...groups.keys()].filter((k) => k !== PICS || groups.get(k).length).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
      const wrap = el('div.photos-albums');
      for (const k of keys) {
        const items = groups.get(k);
        const name = k === PICS ? 'Pictures' : k === '/' ? 'Phone' : os.path.basename(k);
        const cover = el('div.photos-album-cover');
        if (items[0]) { cover._meta = items[0]; io.observe(cover); } else cover.innerHTML = iconSVG(I.image, { size: 34, stroke: 1.4 });
        const a = el('div.photos-album.tilt', cover, el('div.photos-album-name', name), el('div.photos-album-count', String(items.length)));
        a.addEventListener('click', () => ctx.navigate(albumPage, { dir: k, title: name }));
        os.util.onLongPress(a, () => os.ui.contextMenu(a, [
          { label: 'pin to start', onClick: () => { ctx.pinTile({ key: 'photos:' + k, title: name, args: { album: k }, size: 'medium' }); os.toast('Pinned to Start'); } },
          !DEFAULT_ALBUMS.includes(k) && k.startsWith(PICS + '/') ? { label: 'rename', onClick: async () => {
            const n = (await os.ui.prompt('Album name', name, 'rename album'))?.trim();
            if (n && n !== name && !/[/\\]/.test(n)) { if (await os.fs.exists(os.path.join(PICS, n))) return os.ui.alert('An album with that name already exists.'); await os.fs.rename(k, n); }
          } } : null,
          !DEFAULT_ALBUMS.includes(k) && k.startsWith(PICS + '/') ? { label: 'delete', onClick: async () => {
            if (await os.ui.confirm(`Delete the album "${name}" and its ${items.length} item(s)?`, 'delete album', 'delete', 'cancel')) { await fav.drop(items.map((m) => m.path)); await os.fs.remove(k); os.tiles.refresh('photos'); }
          } } : null,
        ]));
        wrap.append(a);
      }
      c.replaceChildren(wrap);
    };

    const renderFavs = (c) => {
      const list = all.filter((m) => fav.has(m.path));
      if (!list.length) { c.replaceChildren(os.ui.empty('no favorites yet'), os.ui.desc('Tap the star while viewing a photo to add it here.')); return; }
      const grid = el('div.photos-grid');
      grid.append(...list.map((m) => favCell(m, list)));
      c.replaceChildren(grid);
    };

    const pv = os.ui.pivot({
      app: 'PHOTOS',
      items: [
        { header: 'collection', render: (c) => { views.collection = c; renderCollection(c); } },
        { header: 'albums', render: (c) => { views.albums = c; renderAlbums(c); } },
        { header: 'favorites', render: (c) => { views.favorites = c; renderFavs(c); } },
      ],
    });
    const bar = os.ui.appBar({});
    const setBar = () => {
      const i = pv.index;
      if (collSel.active && i === 0) {
        bar.setButtons([
          { icon: I.delete, label: 'delete', disabled: !collSel.size, onClick: async () => { if (await deleteItems(collSel.paths)) collSel.stop(views.collection); } },
          { icon: I.share, label: 'share', disabled: collSel.size !== 1, onClick: () => os.share({ path: collSel.paths[0] }) },
          { icon: I.close, label: 'cancel', onClick: () => collSel.stop(views.collection) },
        ]);
        bar.setMenu([]);
        return;
      }
      const btns = [];
      if (i === 0) btns.push({ icon: SquareCheck, label: 'select', disabled: !all.length, onClick: () => collSel.start() });
      if (i === 1) btns.push({ icon: FolderPlus, label: 'new album', onClick: newAlbum });
      btns.push({ icon: Presentation, label: 'slideshow', disabled: !all.some((m) => !isVideo(m)), onClick: () => {
        const src = i === 2 ? all.filter((m) => fav.has(m.path)) : all;
        if (!src.some((m) => !isVideo(m))) return os.toast('Nothing to show');
        ctx.navigate(slideshowPage, { list: src, shared });
      } });
      btns.push({ icon: Upload, label: 'import', onClick: () => importPhotos() });
      btns.push({ icon: I.camera, label: 'camera', onClick: () => os.launch('camera') });
      bar.setButtons(btns);
      bar.setMenu([
        { label: 'set start background…', onClick: () => os.toast('Open a photo, then use … › set as start background') },
        { label: 'refresh', onClick: () => refresh() },
      ]);
    };
    pv.onChange(() => { if (collSel.active) collSel.stop(views.collection); setBar(); });
    async function newAlbum() {
      const n = (await os.ui.prompt('Album name', '', 'new album'))?.trim();
      if (!n) return;
      if (/[/\\]/.test(n)) return os.ui.alert('Album names can’t contain slashes.');
      const p = os.path.join(PICS, n);
      if (await os.fs.exists(p)) return os.ui.alert('That album already exists.');
      await os.fs.mkdir(p);
      ctx.navigate(albumPage, { dir: p, title: n });
    }
    async function refresh() {
      all = await allMedia(os);
      if (views.collection) renderCollection(views.collection);
      if (views.albums) renderAlbums(views.albums);
      if (views.favorites) renderFavs(views.favorites);
      setBar();
    }
    const wrap = el('div.photos-hub', pv.el, bar.el);
    const off = onData(refresh);
    allMedia(os).then((a) => { all = a; refresh(); });
    return { el: wrap, onDestroy: off, onBack: () => { if (collSel.active) { collSel.stop(views.collection); return true; } } };
  }

  /* ---------------- open by args ---------------- */
  async function openArgs(a) {
    if (!a) return;
    if (a.file) {
      const meta = await os.fs.stat(a.file);
      if (!meta) { os.toast('That photo no longer exists'); return; }
      const sibs = (await os.fs.list(meta.parent)).filter((m) => isMedia(m) || m.path === meta.path).sort(byNewest);
      ctx.navigate(viewerPage, { list: sibs, index: Math.max(0, sibs.findIndex((m) => m.path === meta.path)), shared });
    } else if (a.album) {
      ctx.navigate(albumPage, { dir: a.album, title: a.album === PICS ? 'Pictures' : os.path.basename(a.album) });
    } else if (a.share?.path) {
      openArgs({ file: a.share.path });
    }
  }

  await ctx.navigate(hubPage);
  if (args && (args.file || args.album)) await openArgs(args);
  ctx.on('args', openArgs);

  return { onDestroy() { offFs(); io.disconnect(); } };
}

export { thumbFor };
