// Photo editor: rotate, square crop, auto-fix, filters. Saves an edited copy next to the original.
import { Crop, RotateCw, WandSparkles, Undo2 } from 'lucide';
import { FILTERS, autoLevels, processPixels, renderTransformed } from './lib.js';

export async function editorPage(page) {
  const { os, ctx } = page;
  const { meta, onSaved } = page.params;
  const { el, I } = os.ui;
  const st = { rotate: page.params.rotate || 0, square: false, autofix: false, filter: 'none' };
  let src = null, levels = null, saving = false;

  const canvasWrap = el('div.photos-edit-stage', os.ui.loadingDots());
  const filters = el('div.photos-edit-filters');
  const status = el('div.photos-edit-status');
  const root = el('div.photos-editor', el('div.wp-app-title.photos-edit-title', 'EDIT'), canvasWrap, status, filters);

  try {
    src = await createImageBitmap(await os.fs.read(meta.path));
  } catch {
    canvasWrap.replaceChildren(os.ui.empty('This picture can’t be edited.'));
    return { el: root };
  }

  // Small preview source for fast filter swatches and live preview.
  const preview = renderTransformed(src, { max: 1100 });
  levels = autoLevels(preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data);

  function draw() {
    const c = renderTransformed(preview, { rotate: st.rotate, square: st.square });
    const g = c.getContext('2d');
    if (st.autofix || st.filter !== 'none') {
      const img = g.getImageData(0, 0, c.width, c.height);
      processPixels(img, { levels: st.autofix ? levels : null, filter: st.filter });
      g.putImageData(img, 0, 0);
    }
    c.className = 'photos-edit-canvas';
    canvasWrap.replaceChildren(c);
    const tags = [st.rotate % 360 ? `rotated ${st.rotate % 360}°` : '', st.square ? 'square' : '', st.autofix ? 'auto-fixed' : '', st.filter !== 'none' ? st.filter : ''].filter(Boolean);
    status.textContent = tags.length ? tags.join(' · ') : 'original';
    for (const b of filters.children) b.classList.toggle('active', b.dataset.id === st.filter);
    setBar();
  }

  // Filter swatches from a tiny thumbnail
  const sw = renderTransformed(preview, { square: true, max: 96 });
  for (const f of FILTERS) {
    const c = document.createElement('canvas');
    c.width = sw.width; c.height = sw.height;
    const g = c.getContext('2d');
    g.drawImage(sw, 0, 0);
    if (f.id !== 'none') { const img = g.getImageData(0, 0, c.width, c.height); processPixels(img, { filter: f.id }); g.putImageData(img, 0, 0); }
    filters.append(el('button.photos-edit-filter.tilt', { dataset: { id: f.id }, onclick: () => { st.filter = f.id; draw(); } }, c, el('span', f.name)));
  }

  const bar = os.ui.appBar({});
  root.append(bar.el);
  function setBar() {
    bar.setButtons([
      { icon: RotateCw, label: 'rotate', onClick: () => { st.rotate = (st.rotate + 90) % 360; draw(); } },
      { icon: Crop, label: st.square ? 'uncrop' : 'crop', onClick: () => { st.square = !st.square; draw(); } },
      { icon: WandSparkles, label: st.autofix ? 'undo fix' : 'auto-fix', onClick: () => { st.autofix = !st.autofix; draw(); } },
      { icon: I.save, label: 'save', onClick: save },
    ]);
    const fixBtn = bar.el.querySelectorAll('.wp-appbar-btn')[2];
    fixBtn?.classList.toggle('photos-fav-on', st.autofix);
    bar.setMenu([
      { label: 'reset', onClick: () => { Object.assign(st, { rotate: 0, square: false, autofix: false, filter: 'none' }); draw(); } },
      { label: 'save and replace original', onClick: () => save(true) },
    ]);
  }

  async function save(replace = false) {
    if (saving) return;
    if (!st.rotate && !st.square && !st.autofix && st.filter === 'none') { os.toast('Nothing to save yet'); return; }
    saving = true;
    status.textContent = 'saving…';
    await os.util.sleep(30);
    try {
      const c = renderTransformed(src, { rotate: st.rotate, square: st.square, max: 4096 });
      const g = c.getContext('2d');
      if (st.autofix || st.filter !== 'none') {
        const img = g.getImageData(0, 0, c.width, c.height);
        processPixels(img, { levels: st.autofix ? levels : null, filter: st.filter });
        g.putImageData(img, 0, 0);
      }
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      let path = meta.path;
      if (!replace) {
        const stem = meta.name.replace(/\.[^.]+$/, '');
        path = await os.fs.uniquePath(os.path.join(meta.parent, `${stem}_edited.jpg`));
      } else if (!/\.jpe?g$/i.test(path)) {
        path = await os.fs.uniquePath(path.replace(/\.[^.]+$/, '') + '.jpg');
      }
      const extra = { width: c.width, height: c.height, taken: Date.now(), editedFrom: meta.path };
      if (meta.geo) extra.geo = meta.geo;
      const saved = await os.fs.write(path, blob, { mime: 'image/jpeg', meta: extra });
      if (replace && path !== meta.path) await os.fs.remove(meta.path);
      c.width = c.height = 0;
      os.toast(replace ? 'Saved' : 'Saved a copy');
      os.tiles.refresh('photos');
      onSaved?.(saved, replace, meta.path);
      ctx.back();
    } catch (e) {
      os.ui.alert('Couldn’t save: ' + (e.message || e));
    } finally { saving = false; }
  }

  draw();
  return { el: root, onDestroy() { src?.close?.(); } };
}

export { Undo2 };
