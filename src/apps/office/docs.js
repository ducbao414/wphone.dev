// Document types, templates, sanitizing and small converters shared by the Office hub and editors.

export const KINDS = {
  word: { label: 'Word', letter: 'W', color: '#2B579A' },
  excel: { label: 'Excel', letter: 'X', color: '#217346' },
  text: { label: 'Text', letter: 'T', color: '#5C5C5C' },
};

export const SUPPORTED = ['wdoc', 'wxls', 'txt', 'md', 'csv'];

export function kindOf(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  if (ext === 'wdoc') return 'word';
  if (ext === 'wxls' || ext === 'csv') return 'excel';
  if (ext === 'txt' || ext === 'md') return 'text';
  return null;
}
export const isSupported = (meta) => meta.type === 'file' && !!kindOf(meta.name);
export const stem = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
export const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };

const today = () => new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

export const TEMPLATES = [
  {
    id: 'blank-doc', kind: 'word', title: 'blank document', sub: 'Word', ext: 'wdoc', name: 'Document',
    content: () => ({ html: '<p><br></p>' }),
  },
  {
    id: 'letter', kind: 'word', title: 'letter', sub: 'Word · formal letter', ext: 'wdoc', name: 'Letter',
    content: (owner = 'Your Name') => ({
      html: `<p><b>${escapeHTML(owner)}</b><br>123 Main Street<br>Redmond, WA 98052</p><p>${today()}</p>`
        + '<p>Recipient Name<br>Company<br>Address</p><p>Dear Recipient,</p>'
        + '<p>I am writing to you regarding… Use this paragraph to introduce the purpose of your letter.</p>'
        + '<p>Add supporting details here. Keep each paragraph focused on one idea.</p>'
        + '<p>Thank you for your time and consideration. I look forward to hearing from you.</p>'
        + `<p>Sincerely,</p><p>${escapeHTML(owner)}</p>`,
    }),
  },
  {
    id: 'notes-doc', kind: 'word', title: 'meeting notes', sub: 'Word · agenda & action items', ext: 'wdoc', name: 'Meeting notes',
    content: () => ({
      html: `<h1>Meeting notes</h1><p><i>${today()}</i></p><h2>Attendees</h2><ul><li><br></li></ul>`
        + '<h2>Agenda</h2><ol><li><br></li></ol><h2>Action items</h2><ul><li><br></li></ul>',
    }),
  },
  {
    id: 'blank-sheet', kind: 'excel', title: 'blank spreadsheet', sub: 'Excel', ext: 'wxls', name: 'Book',
    content: () => ({ cells: {}, cols: 10, rows: 40 }),
  },
  {
    id: 'budget', kind: 'excel', title: 'budget', sub: 'Excel · monthly budget', ext: 'wxls', name: 'Budget',
    content: () => {
      const cells = {
        A1: 'Monthly budget', A3: 'Income', B3: 'Planned', C3: 'Actual', D3: 'Difference',
        A4: 'Salary', B4: '3200', C4: '3200', A5: 'Side jobs', B5: '300', C5: '420',
        A6: 'Total income', B6: '=SUM(B4:B5)', C6: '=SUM(C4:C5)',
        A8: 'Expenses', B8: 'Planned', C8: 'Actual', D8: 'Difference',
        A9: 'Rent', B9: '1200', C9: '1200', A10: 'Groceries', B10: '400', C10: '455',
        A11: 'Transport', B11: '150', C11: '120', A12: 'Utilities', B12: '180', C12: '196',
        A13: 'Phone & internet', B13: '70', C13: '70', A14: 'Fun', B14: '200', C14: '260',
        A15: 'Savings', B15: '500', C15: '500',
        A16: 'Total expenses', B16: '=SUM(B9:B15)', C16: '=SUM(C9:C15)',
        A18: 'Balance', B18: '=B6-B16', C18: '=C6-C16', D18: '=IF(C18>=0,"on track","over budget")',
        A19: 'Savings rate', C19: '=ROUND(C15/C6,3)',
      };
      for (let r = 4; r <= 6; r++) cells['D' + r] = `=C${r}-B${r}`;
      for (let r = 9; r <= 16; r++) cells['D' + r] = `=B${r}-C${r}`;
      const fmt = {};
      for (let r = 4; r <= 18; r++) for (const c of 'BCD') if (r !== 7 && r !== 8 && r !== 17) fmt[c + r] = 'currency';
      fmt.D18 = 'general'; fmt.C19 = 'percent';
      const bold = { A1: 1, A3: 1, B3: 1, C3: 1, D3: 1, A8: 1, B8: 1, C8: 1, D8: 1, A6: 1, A16: 1, A18: 1, B18: 1, C18: 1 };
      return { cells, cols: 8, rows: 40, fmt, bold, widths: { A: 130 } };
    },
  },
  {
    id: 'blank-text', kind: 'text', title: 'plain text', sub: 'Text file (.txt)', ext: 'txt', name: 'Notes',
    content: () => '',
  },
];

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'SPAN', 'DIV', 'FONT', 'A', 'BLOCKQUOTE', 'IMG', 'SUB', 'SUP', 'MARK', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'HR', 'PRE', 'CODE']);
const ALLOWED_ATTR = new Set(['style', 'color', 'href', 'src', 'alt', 'align', 'colspan', 'rowspan']);

/** Strip scripts, event handlers and unknown tags from editor HTML. */
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const walk = (node) => {
    for (const ch of [...node.children]) {
      if (!ALLOWED.has(ch.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'].includes(ch.tagName)) { ch.remove(); continue; }
        walk(ch);
        ch.replaceWith(...ch.childNodes);
        continue;
      }
      for (const a of [...ch.attributes]) {
        const v = a.value.trim().toLowerCase();
        if (!ALLOWED_ATTR.has(a.name) || v.startsWith('javascript:') || (a.name === 'src' && !/^(data:image\/|blob:|https?:)/.test(v))) ch.removeAttribute(a.name);
      }
      walk(ch);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Rich HTML → readable plain text. */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const out = [];
  const walk = (n, ctx) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { out.push(c.nodeValue.replace(/\s+/g, ' ')); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === 'BR') { out.push('\n'); continue; }
      if (t === 'LI') {
        const ol = c.parentElement?.tagName === 'OL';
        const idx = [...c.parentElement.children].indexOf(c) + 1;
        out.push('\n' + '  '.repeat(ctx.depth) + (ol ? idx + '. ' : '• '));
        walk(c, { depth: ctx.depth + 1 });
        continue;
      }
      const block = /^(P|DIV|H1|H2|H3|BLOCKQUOTE|PRE|UL|OL|TR|TABLE|HR)$/.test(t);
      if (block) out.push('\n');
      walk(c, ctx);
      if (block) out.push('\n');
      if (t === 'TD' || t === 'TH') out.push('\t');
    }
  };
  walk(doc.body, { depth: 0 });
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text → editor HTML paragraphs. */
export function textToHTML(text) {
  return String(text || '').split(/\r?\n/).map((l) => `<p>${l ? escapeHTML(l) : '<br>'}</p>`).join('') || '<p><br></p>';
}

/** Minimal Markdown renderer for previewing .md files (headings, emphasis, lists, code, links, quotes). */
export function markdownToHTML(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const html = [];
  let list = null, code = false, para = [];
  const inline = (s) => escapeHTML(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (/^```/.test(line)) { flushPara(); closeList(); html.push(code ? '</code></pre>' : '<pre><code>'); code = !code; continue; }
    if (code) { html.push(escapeHTML(line) + '\n'); continue; }
    let m;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flushPara(); closeList(); const n = Math.min(3, m[1].length); html.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); closeList(); html.push('<hr>'); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); closeList(); html.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = /^\s*[-*+]\s+(\[[ xX]\]\s+)?(.*)$/.exec(line))) {
      flushPara(); if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; }
      const box = m[1] ? (/x/i.test(m[1]) ? '☑ ' : '☐ ') : '';
      html.push(`<li>${box}${inline(m[2])}</li>`); continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; } html.push(`<li>${inline(m[1])}</li>`); continue; }
    closeList();
    para.push(line.trim());
  }
  flushPara(); closeList();
  if (code) html.push('</code></pre>');
  return html.join('');
}

/** Wrap editor HTML into a standalone .html document for export. */
export function standaloneHTML(title, body) {
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(title)}</title>`
    + '<style>body{font-family:"Segoe UI",Calibri,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.5;color:#222}h1,h2{font-weight:400;color:#2B579A}</style>'
    + `</head><body>\n${body}\n</body></html>\n`;
}
