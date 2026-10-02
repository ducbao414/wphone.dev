// Shared OneNote helpers (used by index.js and tile.js).
// Note file: /Documents/OneNote/<title>.one  JSON { title, html, created, modified, color, checklist? }

export const DIR = '/Documents/OneNote';
export const DEFAULT_COLOR = '#7719AA';
export const COLORS = [
  { name: 'purple', hex: '#7719AA' }, { name: 'blue', hex: '#2B579A' }, { name: 'cyan', hex: '#1BA1E2' },
  { name: 'teal', hex: '#008299' }, { name: 'green', hex: '#00A300' }, { name: 'lime', hex: '#8CBF26' },
  { name: 'orange', hex: '#F09609' }, { name: 'red', hex: '#E51400' }, { name: 'magenta', hex: '#E3008C' },
  { name: 'brown', hex: '#825A2C' }, { name: 'steel', hex: '#647687' },
];
const NAMED = Object.fromEntries(COLORS.map((c) => [c.name, c.hex]));
NAMED.yellow = '#E3A21A'; NAMED.pink = '#F472D0'; NAMED.violet = '#AA00FF'; NAMED.indigo = '#6A00FF';

export function normColor(c) {
  if (!c || typeof c !== 'string') return DEFAULT_COLOR;
  const s = c.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
  return DEFAULT_COLOR;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Plain text -> html (one div per line). */
export function textToHtml(t) {
  return String(t ?? '').split(/\r?\n/).map((l) => `<div>${l ? esc(l) : '<br>'}</div>`).join('');
}

const parse = (html) => new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html').body;

/** Strip scripts/handlers from html we load into the contenteditable. */
export function sanitize(html) {
  const body = parse(html);
  body.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach((n) => n.remove());
  body.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on') || name === 'contenteditable') n.removeAttribute(a.name);
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    }
  });
  return body.innerHTML;
}

function checklistItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => (typeof x === 'string' ? { text: x, done: false } : { text: x?.text ?? x?.title ?? x?.label ?? '', done: !!(x?.done ?? x?.checked ?? x?.completed) }));
}

/** Normalize raw JSON from a .one file (tolerant of other writers like Cortana). */
export function normalizeNote(raw, path) {
  const r = raw && typeof raw === 'object' ? raw : { html: String(raw ?? '') };
  let html = r.html ?? r.content ?? r.body ?? r.text ?? '';
  if (typeof html !== 'string') html = String(html);
  if (html && !/<[a-z][\s\S]*>/i.test(html)) html = textToHtml(html);
  const items = checklistItems(r.checklist);
  if (items.length && !html.includes('onenote-check')) {
    html += items.map((i) => `<div class="onenote-check${i.done ? ' done' : ''}">${i.text ? esc(i.text) : '<br>'}</div>`).join('');
  }
  const base = path ? path.split('/').pop().replace(/\.one$/i, '') : '';
  return {
    path,
    title: typeof r.title === 'string' ? r.title : base,
    html: sanitize(html),
    created: Number(r.created) || Number(r.modified) || Date.now(),
    modified: Number(r.modified) || Number(r.created) || Date.now(),
    color: normColor(r.color),
    checklist: items,
  };
}

/** Plain text snippet of note html; checklist items prefixed with boxes. */
export function textOf(html) {
  const body = parse(html);
  body.querySelectorAll('.onenote-check').forEach((n) => n.prepend(n.classList.contains('done') ? '☑ ' : '☐ '));
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out.push(c.textContent);
      else if (c.nodeType === 1) {
        const block = /^(DIV|P|LI|H\d|BR|UL|OL|BLOCKQUOTE)$/.test(c.tagName);
        if (block) out.push('\n');
        walk(c);
        if (block) out.push('\n');
      }
    }
  };
  walk(body);
  return out.join('').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function firstImage(html) {
  const m = /<img[^>]+src="([^"]+)"/i.exec(html || '');
  return m ? m[1] : null;
}

export const displayTitle = (n) => (n.title || '').trim() || textOf(n.html).split('\n')[0].slice(0, 60) || 'Untitled note';

export function safeName(s) {
  const n = String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/^\.+/, '');
  return n || 'Untitled note';
}

export async function loadNote(os, path) {
  try { return normalizeNote(await os.fs.read(path, 'json'), path); } catch {
    try { return normalizeNote(await os.fs.read(path, 'text'), path); } catch { return null; }
  }
}

const cache = new Map(); // path -> { modified(meta), note }
/** All notes (any .one under /Documents/OneNote), newest first. */
export async function listNotes(os) {
  const metas = await os.fs.walk(DIR, (m) => m.type === 'file' && /\.one$/i.test(m.name));
  const out = [];
  for (const m of metas) {
    const c = cache.get(m.path);
    if (c && c.mtime === m.modified && c.size === m.size) { out.push(c.note); continue; }
    const n = await loadNote(os, m.path);
    if (!n) continue;
    cache.set(m.path, { mtime: m.modified, size: m.size, note: n });
    out.push(n);
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** Follow rename redirects (pinned tiles keep the old path). */
export async function resolvePath(os, path) {
  if (!path) return null;
  if (await os.fs.exists(path)) return path;
  const moved = (await os.storage('onenote').get('moved', {})) || {};
  let p = path;
  for (let i = 0; i < 20 && moved[p]; i++) { p = moved[p]; if (await os.fs.exists(p)) return p; }
  return null;
}
