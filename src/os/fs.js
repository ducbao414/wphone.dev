// Virtual file system on IndexedDB. Each visitor gets their own private "phone storage".
// Paths are POSIX-like: "/Pictures/Camera Roll/WP_20140101.jpg".
import { tx, idb } from './db.js';
import { Emitter, makeThumbnail } from './util.js';

const MIME = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', csv: 'text/csv', xml: 'application/xml',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/opus', weba: 'audio/webm',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg',
  vcf: 'text/vcard', ics: 'text/calendar', pdf: 'application/pdf', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Simulator-native document formats (JSON inside)
  wdoc: 'application/x-wp-document', wxls: 'application/x-wp-spreadsheet', one: 'application/x-wp-note',
};

export const DEFAULT_DIRS = [
  '/Documents', '/Downloads', '/Music', '/Videos', '/Ringtones',
  '/Pictures', '/Pictures/Camera Roll', '/Pictures/Saved Pictures', '/Pictures/Screenshots',
];

export function mimeOf(name) {
  const ext = name.split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

export function normalize(p) {
  const parts = [];
  for (const seg of String(p).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}
export const dirname = (p) => { p = normalize(p); return p === '/' ? null : normalize(p.slice(0, p.lastIndexOf('/')) || '/'); };
export const basename = (p) => normalize(p).split('/').pop();
export const join = (...p) => normalize(p.join('/'));
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };

const ROOT = { path: '/', parent: null, name: '', type: 'dir', created: 0, modified: 0 };

class FileSystem extends Emitter {
  #urls = new Map(); // path -> objectURL cache for fs.url()
  #thumbUrls = new Map();

  async init() {
    for (const d of DEFAULT_DIRS) if (!(await this.stat(d))) await this.mkdir(d);
  }

  async stat(path) {
    path = normalize(path);
    if (path === '/') return ROOT;
    return (await idb.get('files', path)) || null;
  }
  async exists(path) { return !!(await this.stat(path)); }

  /** List directory entries (dirs first, then by name). */
  async list(dir = '/') {
    dir = normalize(dir);
    const items = await idb.byIndex('files', 'parent', dir);
    return items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
  }

  async mkdir(path) {
    path = normalize(path);
    if (path === '/') return ROOT;
    const ex = await this.stat(path);
    if (ex) { if (ex.type !== 'dir') throw new Error('Not a directory: ' + path); return ex; }
    await this.mkdir(dirname(path));
    const now = Date.now();
    const meta = { path, parent: dirname(path), name: basename(path), type: 'dir', created: now, modified: now };
    await idb.set('files', undefined, meta);
    this.emit('change', { type: 'mkdir', path });
    return meta;
  }

  /**
   * Write a file. data: string | Blob | ArrayBuffer | TypedArray | plain object (stored as JSON).
   * Creates parent folders. Returns metadata.
   */
  async write(path, data, { mime, meta: extra } = {}) {
    path = normalize(path);
    await this.mkdir(dirname(path));
    let blob;
    if (data instanceof Blob) blob = data;
    else if (typeof data === 'string') blob = new Blob([data], { type: mime || mimeOf(path) });
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) blob = new Blob([data], { type: mime || mimeOf(path) });
    else blob = new Blob([JSON.stringify(data)], { type: mime || mimeOf(path) || 'application/json' });
    const type = mime || (blob.type && blob.type !== 'application/octet-stream' ? blob.type : mimeOf(path));
    const prev = await this.stat(path);
    if (prev?.type === 'dir') throw new Error('Is a directory: ' + path);
    const now = Date.now();
    const meta = { ...(prev || {}), ...(extra || {}), path, parent: dirname(path), name: basename(path), type: 'file', mime: type, size: blob.size, created: prev?.created || now, modified: now };
    await tx(['files', 'blobs', 'thumbs'], 'readwrite', (f, b, t) => { f.put(meta); b.put(blob, path); t.delete(path); });
    this.#revoke(path);
    this.emit('change', { type: prev ? 'modify' : 'create', path });
    return meta;
  }

  /** Read a file. as: 'blob' (default) | 'text' | 'json' | 'arraybuffer' | 'dataurl' */
  async read(path, as = 'blob') {
    path = normalize(path);
    const blob = await idb.get('blobs', path);
    if (!blob) throw new Error('File not found: ' + path);
    if (as === 'text') return blob.text();
    if (as === 'json') return JSON.parse(await blob.text());
    if (as === 'arraybuffer') return blob.arrayBuffer();
    if (as === 'dataurl') return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    return blob;
  }

  /** Cached object URL for a file (valid until the file changes or is deleted). */
  async url(path) {
    path = normalize(path);
    if (this.#urls.has(path)) return this.#urls.get(path);
    const u = URL.createObjectURL(await this.read(path));
    this.#urls.set(path, u);
    return u;
  }

  /** Cached object URL of a JPEG thumbnail for an image (or video poster if stored). */
  async thumb(path, max = 256) {
    path = normalize(path);
    if (this.#thumbUrls.has(path)) return this.#thumbUrls.get(path);
    let t = await idb.get('thumbs', path);
    if (!t) {
      const st = await this.stat(path);
      if (!st?.mime?.startsWith('image/')) return null;
      try { t = await makeThumbnail(await this.read(path), max); } catch { return this.url(path); }
      await idb.set('thumbs', path, t);
    }
    const u = URL.createObjectURL(t);
    this.#thumbUrls.set(path, u);
    return u;
  }

  /** Store a custom thumbnail (e.g. a video poster frame or album art). */
  async setThumb(path, blob) {
    path = normalize(path);
    await idb.set('thumbs', path, blob);
    const u = this.#thumbUrls.get(path); if (u) URL.revokeObjectURL(u);
    this.#thumbUrls.delete(path);
  }

  #revoke(path) {
    for (const m of [this.#urls, this.#thumbUrls]) {
      const u = m.get(path);
      if (u) { URL.revokeObjectURL(u); m.delete(path); }
    }
  }

  /** Delete file or folder (recursive). */
  async remove(path) {
    path = normalize(path);
    if (path === '/') throw new Error('Cannot remove root');
    const st = await this.stat(path);
    if (!st) return;
    const all = st.type === 'dir' ? await this.walk(path) : [];
    const targets = [...all.map((x) => x.path), path];
    await tx(['files', 'blobs', 'thumbs'], 'readwrite', (f, b, t) => { for (const p of targets) { f.delete(p); b.delete(p); t.delete(p); } });
    targets.forEach((p) => this.#revoke(p));
    this.emit('change', { type: 'delete', path });
  }

  /** Recursively list everything below dir (not including dir). Optional filter(meta). */
  async walk(dir = '/', filter) {
    dir = normalize(dir);
    const prefix = dir === '/' ? '/' : dir + '/';
    const all = await idb.all('files');
    return all.filter((m) => m.path.startsWith(prefix) && m.path !== dir && (!filter || filter(m)));
  }

  /** Find files by mime prefix, e.g. find('image/') or find('audio/', '/Music'). Newest first. */
  async find(mimePrefix, dir = '/') {
    const r = await this.walk(dir, (m) => m.type === 'file' && (m.mime || '').startsWith(mimePrefix));
    return r.sort((a, b) => b.modified - a.modified);
  }

  async copy(from, to) {
    from = normalize(from); to = normalize(to);
    const st = await this.stat(from);
    if (!st) throw new Error('Not found: ' + from);
    if (st.type === 'dir') {
      await this.mkdir(to);
      for (const c of await this.list(from)) await this.copy(c.path, join(to, c.name));
    } else {
      const { path, parent, name, type, mime, size, created, modified, ...extra } = st;
      await this.write(to, await this.read(from), { mime, meta: extra });
    }
  }

  /** Move/rename in place (keeps dates and content; one 'rename' change event). */
  async move(from, to) {
    from = normalize(from); to = normalize(to);
    if (from === to) return;
    if (to.startsWith(from + '/')) throw new Error('Cannot move a folder into itself');
    const st = await this.stat(from);
    if (!st) throw new Error('Not found: ' + from);
    if (await this.exists(to)) throw new Error('Already exists: ' + to);
    await this.mkdir(dirname(to));
    const items = [st, ...(st.type === 'dir' ? await this.walk(from) : [])];
    const re = (p) => to + p.slice(from.length);
    const blobs = new Map();
    await tx(['blobs'], 'readonly', async (b) => {
      for (const m of items) if (m.type === 'file') blobs.set(m.path, await new Promise((r) => { const q = b.get(m.path); q.onsuccess = () => r(q.result); }));
    });
    await tx(['files', 'blobs', 'thumbs'], 'readwrite', (f, b, t) => {
      for (const m of items) {
        const np = re(m.path);
        f.delete(m.path); t.delete(m.path);
        f.put({ ...m, path: np, parent: dirname(np), name: basename(np) });
        if (m.type === 'file') { b.delete(m.path); if (blobs.get(m.path)) b.put(blobs.get(m.path), np); }
      }
    });
    items.forEach((m) => this.#revoke(m.path));
    this.emit('change', { type: 'rename', path: to, from });
  }

  rename(path, newName) { return this.move(path, join(dirname(path), newName)); }

  /** Returns a path that doesn't exist yet: "photo.jpg" -> "photo (2).jpg". */
  async uniquePath(path) {
    path = normalize(path);
    if (!(await this.exists(path))) return path;
    const dir = dirname(path), base = basename(path);
    const i = base.lastIndexOf('.');
    const stem = i > 0 ? base.slice(0, i) : base, ext = i > 0 ? base.slice(i) : '';
    for (let n = 2; ; n++) {
      const p = join(dir, `${stem} (${n})${ext}`);
      if (!(await this.exists(p))) return p;
    }
  }

  /** Import browser File objects (from <input type=file>, drag-drop) into a folder. */
  async importFiles(files, dir = '/Downloads') {
    const out = [];
    for (const f of files) {
      const p = await this.uniquePath(join(dir, f.name));
      out.push(await this.write(p, f, { mime: f.type || mimeOf(f.name) }));
    }
    return out;
  }

  /** Export a file to the real device (browser download). */
  async download(path) {
    const blob = await this.read(path);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = basename(path);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /** Total bytes used, grouped by top-level category. */
  async usage() {
    const all = await idb.all('files');
    const by = { total: 0, pictures: 0, music: 0, videos: 0, documents: 0, other: 0 };
    for (const m of all) {
      if (m.type !== 'file') continue;
      by.total += m.size || 0;
      const t = m.mime || '';
      const k = t.startsWith('image/') ? 'pictures' : t.startsWith('audio/') ? 'music' : t.startsWith('video/') ? 'videos' : t.startsWith('text/') || t.includes('document') || t.includes('pdf') || t.includes('x-wp') ? 'documents' : 'other';
      by[k] += m.size || 0;
    }
    return by;
  }
}

export const fs = new FileSystem();
