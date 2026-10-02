// System pickers: file open/save, share sheet, "open with".
import { el, formatBytes, formatRelative } from './util.js';
import { iconSVG, I } from './icons.js';
import { fs, join, dirname, basename } from './fs.js';
import { kernel } from './kernel.js';
import * as ui from './ui.js';
import { device } from './device.js';

const host = () => document.getElementById('overlay-layer');

function matches(meta, accept) {
  if (!accept || accept === '*' || meta.type === 'dir') return true;
  return accept.split(',').map((s) => s.trim()).some((a) => a.startsWith('.') ? meta.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? (meta.mime || '').startsWith(a.slice(0, -1)) : meta.mime === a);
}

export function fileIconFor(meta) {
  if (meta.type === 'dir') return I.folder;
  const m = meta.mime || '';
  return m.startsWith('image/') ? I.image : m.startsWith('audio/') ? I.music : m.startsWith('video/') ? I.video : m.startsWith('text/') || m.includes('x-wp') ? I.doc : I.file;
}

/**
 * Full-screen file picker.
 *   const paths = await os.pick.file({ accept: 'image/*', multiple: true, start: '/Pictures' })
 * Resolves an array of paths (empty if cancelled). Includes "from device" which imports real files into /Downloads.
 */
export function pickFile({ accept = '*', multiple = false, start = '/', title = 'choose a file' } = {}) {
  return new Promise((resolve) => {
    let cwd = start;
    const selected = new Set();
    const listEl = el('div.wp-list');
    const crumbs = el('div.wp-picker-path');
    const layer = el('div.wp-fullpicker.wp-filepicker.anim-turnstile-in', el('div.wp-app-title', title.toUpperCase()), crumbs, listEl);
    const finish = (r) => { layer.remove(); pop(); offBack(); resolve(r); };
    const render = async () => {
      crumbs.textContent = cwd === '/' ? 'Phone' : 'Phone' + cwd.replace(/\//g, ' › ');
      const items = (await fs.list(cwd)).filter((m) => matches(m, accept));
      listEl.replaceChildren(...(cwd !== '/' ? [el('div.wp-list-item.tilt', { onclick: () => { cwd = dirname(cwd); render(); } }, ui.listItem({ title: '..', icon: I.up }))] : []),
        ...items.map((m) => {
          const row = ui.listItem({ title: m.name, subtitle: m.type === 'dir' ? 'folder' : `${formatBytes(m.size)} · ${formatRelative(m.modified)}`, icon: fileIconFor(m) });
          row.classList.add('wp-list-item', 'tilt');
          if (selected.has(m.path)) row.classList.add('selected');
          if (m.type === 'file' && m.mime?.startsWith('image/')) fs.thumb(m.path).then((u) => { if (u) row.querySelector('.wp-row-icon').replaceWith(el('div.wp-row-image', { style: { backgroundImage: `url("${u}")` } })); });
          row.addEventListener('click', () => {
            if (m.type === 'dir') { cwd = m.path; render(); return; }
            if (!multiple) return finish([m.path]);
            selected.has(m.path) ? selected.delete(m.path) : selected.add(m.path);
            row.classList.toggle('selected');
          });
          return row;
        }));
      if (!items.length) listEl.append(ui.empty('no matching files here'));
    };
    const fromDevice = () => {
      const inp = el('input', { type: 'file', multiple, accept: accept === '*' ? '' : accept, style: { display: 'none' } });
      inp.onchange = async () => { const metas = await fs.importFiles(inp.files, '/Downloads'); finish(metas.map((m) => m.path)); };
      document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
    };
    const bar = ui.appBar({
      buttons: [
        ...(multiple ? [{ icon: I.check, label: 'done', onClick: () => finish([...selected]) }] : []),
        { icon: I.upload, label: 'from device', onClick: fromDevice },
        { icon: I.close, label: 'cancel', onClick: () => finish([]) },
      ],
    });
    layer.append(bar.el);
    host().append(layer);
    const pop = ui.pushOverlayBack(() => { if (cwd !== '/' && cwd !== start) { cwd = dirname(cwd); render(); } else finish([]); });
    const offBack = () => {};
    render();
  });
}

/**
 * Save picker: choose folder + file name. Resolves the full path or null.
 *   const path = await os.pick.save({ name: 'Document.wdoc', start: '/Documents' })
 */
export async function pickSave({ name = 'Untitled.txt', start = '/Documents', title = 'save as' } = {}) {
  const n = await ui.prompt(`File name (saved in ${start})`, name, title);
  if (!n) return null;
  return fs.uniquePath(join(start, n));
}

/** Apps that can open a file (by manifest.handles). */
export function appsForFile(meta) {
  return kernel.list().filter((m) => (m.handles || []).some((h) => matches({ ...meta, type: 'file' }, h)));
}

/** Open a file with its associated app (asks if several). */
export async function openFile(path) {
  const meta = await fs.stat(path);
  if (!meta) return ui.alert('File not found.');
  const apps = appsForFile(meta);
  if (!apps.length) {
    if (await ui.confirm(`No app on your phone can open "${meta.name}". Save it to your real device instead?`, 'open', 'save', 'cancel')) fs.download(path);
    return;
  }
  let app = apps[0];
  if (apps.length > 1) {
    const id = await ui.pickFromList({ title: 'open with', options: apps.map((a) => ({ value: a.id, label: a.name })) });
    if (!id) return;
    app = kernel.get(id);
  }
  kernel.launch(app.id, { file: path });
}

/**
 * Share sheet. data: { title, text, url, path }   (path = file in the virtual FS)
 * Lists apps with manifest.shareTarget plus the real device share sheet, copy, and save-to-device.
 * The chosen app is launched with args { share: data }.
 */
export async function share(data = {}) {
  const targets = kernel.list().filter((m) => m.shareTarget && (data.path ? m.shareTarget === true || m.shareTarget.files : true));
  const opts = [
    ...targets.map((m) => ({ value: 'app:' + m.id, label: m.name })),
    { value: 'native', label: 'Share via device…' },
    ...(data.url || data.text ? [{ value: 'copy', label: data.url ? 'Copy link' : 'Copy text' }] : []),
    ...(data.path ? [{ value: 'download', label: 'Save to device' }] : []),
  ];
  const v = await ui.pickFromList({ title: 'share', options: opts });
  if (!v) return;
  if (v.startsWith('app:')) return kernel.launch(v.slice(4), { share: data });
  if (v === 'copy') { await device.copy(data.url || data.text); kernel.os.toast('Copied'); return; }
  if (v === 'download') return fs.download(data.path);
  if (v === 'native') {
    try {
      const files = data.path ? [new File([await fs.read(data.path)], basename(data.path), { type: (await fs.stat(data.path)).mime })] : undefined;
      await device.shareNative({ title: data.title, text: data.text, url: data.url, files });
    } catch (e) { if (e.name !== 'AbortError') ui.alert(e.message); }
  }
}
