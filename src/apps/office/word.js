// Word editor (rich .wdoc) and plain text editor (.txt / .md) pages.
import {
  Bold, Italic, Underline, Strikethrough, Heading1, Heading2, Type, List, ListOrdered, Undo2, Redo2, Baseline, Highlighter,
  RemoveFormatting, TextAlignStart, TextAlignCenter, Eye, Pencil,
} from 'lucide';
import { sanitize, htmlToText, textToHTML, markdownToHTML, standaloneHTML, stem, extOf, escapeHTML } from './docs.js';

const COLORS = ['#000000', '#FFFFFF', '#E51400', '#F0A30A', '#339933', '#1BA1E2', '#2B579A', '#A200FF', '#D80073', '#825A2C', '#647687', '#76608A'];
const HILITES = ['transparent', '#FFF100', '#00FF00', '#00FFFF', '#FF00FF', '#FF8C00', '#B4B4B4'];

/** Builder for the rich text / plain text editor page. app = { os, ctx, touchRecent, renameFile } */
export function editorPage(app, path) {
  return async (page) => {
    const { os, ctx } = app;
    const { el, I, iconSVG } = os.ui;
    const ext = extOf(path);
    const rich = ext === 'wdoc';
    let name = os.path.basename(path);
    let dirty = false, saving = null, lastSaved = 0, preview = false;

    let html = '<p><br></p>', text = '';
    try {
      if (rich) {
        const raw = await os.fs.read(path, 'text');
        let data;
        try { data = JSON.parse(raw); } catch { data = { html: textToHTML(raw) }; }
        html = sanitize(data?.html ?? '') || '<p><br></p>';
      } else text = await os.fs.read(path, 'text');
    } catch (e) {
      os.ui.alert('Couldn’t open this document: ' + e.message, 'office');
    }
    app.touchRecent(path);

    const title = el('div.office-doc-title', stem(name));
    const status = el('div.office-doc-status', rich ? 'Word' : ext === 'md' ? 'Markdown' : 'Text');
    const head = el('div.office-doc-head', el('div.wp-app-title', rich ? 'WORD' : 'OFFICE'), title, status);

    let editor, toolbar = null, previewEl = null;
    if (rich) {
      editor = el('div.office-word-page.selectable', { contentEditable: 'true', spellcheck: true, html });
      editor.setAttribute('contenteditable', 'true');
      toolbar = buildToolbar();
    } else {
      editor = el('textarea.office-text-area' + (ext === 'md' ? '.md' : ''), { spellcheck: true, placeholder: 'Start typing…' });
      editor.value = text;
      if (ext === 'md') previewEl = el('div.office-word-page.office-md-preview', { hidden: true });
    }
    const scroller = el('div.office-doc-scroll', editor, previewEl);
    const root = el('div.office-doc' + (rich ? '.rich' : '.plain'), head, toolbar, scroller);

    /* ---------------- toolbar (rich only) ---------------- */
    function buildToolbar() {
      const exec = (cmd, val = null) => { editor.focus(); try { document.execCommand('styleWithCSS', false, cmd === 'hiliteColor' || cmd === 'foreColor'); } catch {} document.execCommand(cmd, false, val); changed(); refreshState(); };
      const btn = (icon, label, fn, key) => {
        const b = el('button.office-tb-btn.tilt', { title: label, 'aria-label': label, dataset: key ? { state: key } : {}, html: iconSVG(icon, { size: 20, stroke: 2 }) });
        // Keep the caret in the editor: act on pointerdown and swallow focus change
        b.addEventListener('pointerdown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => { e.preventDefault(); fn(b); });
        return b;
      };
      const block = (tag) => () => {
        const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, '');
        exec('formatBlock', cur === tag ? '<p>' : `<${tag}>`);
      };
      const swatches = (list, cmd, label) => (b) => {
        const sel = saveSel();
        const host = document.getElementById('overlay-layer');
        const close = () => { layer.remove(); pop(); };
        const menu = el('div.office-swatch-menu', el('div.office-swatch-label', label), el('div.office-swatches', list.map((c) => el('button.office-swatch.tilt' + (c === 'transparent' ? '.none' : ''), {
          style: { background: c === 'transparent' ? 'transparent' : c }, 'aria-label': c === 'transparent' ? 'none' : c,
          onclick: () => { close(); restoreSel(sel); exec(cmd, c); },
        }))));
        const layer = el('div.office-swatch-layer', { onclick: (e) => { if (e.target === layer) close(); } }, menu);
        host.append(layer);
        const pop = os.ui.pushOverlayBack(close);
        const r = b.getBoundingClientRect(), hr = host.getBoundingClientRect();
        menu.style.top = Math.min(r.bottom - hr.top + 4, hr.height - menu.offsetHeight - 8) + 'px';
      };
      return el('div.office-toolbar.no-swipe',
        btn(Undo2, 'undo', () => exec('undo')),
        btn(Redo2, 'redo', () => exec('redo')),
        el('span.office-tb-sep'),
        btn(Bold, 'bold', () => exec('bold'), 'bold'),
        btn(Italic, 'italic', () => exec('italic'), 'italic'),
        btn(Underline, 'underline', () => exec('underline'), 'underline'),
        btn(Strikethrough, 'strikethrough', () => exec('strikeThrough'), 'strikeThrough'),
        el('span.office-tb-sep'),
        btn(Heading1, 'heading 1', block('h1'), 'h1'),
        btn(Heading2, 'heading 2', block('h2'), 'h2'),
        btn(Type, 'normal text', () => exec('formatBlock', '<p>')),
        btn(List, 'bullets', () => exec('insertUnorderedList'), 'insertUnorderedList'),
        btn(ListOrdered, 'numbering', () => exec('insertOrderedList'), 'insertOrderedList'),
        el('span.office-tb-sep'),
        btn(Baseline, 'font color', swatches(COLORS, 'foreColor', 'font color')),
        btn(Highlighter, 'highlight', swatches(HILITES, 'hiliteColor', 'highlight')),
        btn(TextAlignStart, 'align left', () => exec('justifyLeft')),
        btn(TextAlignCenter, 'center', () => exec('justifyCenter')),
        btn(RemoveFormatting, 'clear formatting', () => { exec('removeFormat'); exec('formatBlock', '<p>'); }));
    }
    const saveSel = () => { const s = getSelection(); return s.rangeCount && editor.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; };
    const restoreSel = (r) => { if (!r) return; editor.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
    function refreshState() {
      if (!toolbar) return;
      const blockTag = (document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, '');
      for (const b of toolbar.querySelectorAll('[data-state]')) {
        const k = b.dataset.state;
        let on = false;
        try { on = k === 'h1' || k === 'h2' ? blockTag === k : document.queryCommandState(k); } catch {}
        b.classList.toggle('on', on);
      }
    }
    const onSelChange = () => { if (rich && editor.contains(getSelection()?.anchorNode)) refreshState(); };
    document.addEventListener('selectionchange', onSelChange);

    /* ---------------- editing + autosave ---------------- */
    const counts = () => {
      const t = rich ? editor.innerText : editor.value;
      const words = (t.trim().match(/\S+/g) || []).length;
      return `${words} word${words === 1 ? '' : 's'}`;
    };
    const setStatus = (s) => (status.textContent = `${rich ? 'Word' : ext === 'md' ? 'Markdown' : 'Text'} · ${counts()}${s ? ' · ' + s : ''}`);
    setStatus('');
    let timer;
    function changed() {
      dirty = true;
      setStatus('editing…');
      clearTimeout(timer);
      timer = setTimeout(save, 900);
    }
    editor.addEventListener('input', changed);
    if (rich) {
      // Paste as clean HTML (sanitized) to keep documents tidy
      editor.addEventListener('paste', (e) => {
        const h = e.clipboardData?.getData('text/html');
        const t = e.clipboardData?.getData('text/plain');
        e.preventDefault();
        if (h) document.execCommand('insertHTML', false, sanitize(h).replace(/\s(style|class)="[^"]*"/g, ''));
        else if (t) document.execCommand('insertHTML', false, textToHTML(t));
        changed();
      });
      editor.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      });
    } else {
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  ') || editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); changed(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      });
    }

    const content = () => (rich ? { html: sanitize(editor.innerHTML) } : editor.value);
    async function save() {
      clearTimeout(timer);
      if (!dirty) return;
      if (saving) { await saving; if (!dirty) return; }
      dirty = false;
      saving = (async () => {
        try {
          await os.fs.write(path, content());
          lastSaved = Date.now();
          setStatus('saved');
        } catch (e) { dirty = true; setStatus('not saved'); os.toast('Couldn’t save: ' + e.message, 'office'); }
      })();
      await saving;
      saving = null;
    }

    /* ---------------- actions ---------------- */
    async function exportAs(kind) {
      await save();
      const base = stem(name);
      let p;
      if (kind === 'html') {
        const body = rich ? sanitize(editor.innerHTML) : ext === 'md' ? markdownToHTML(editor.value) : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHTML(editor.value)}</pre>`;
        p = await os.fs.uniquePath(`/Downloads/${base}.html`);
        await os.fs.write(p, standaloneHTML(base, body), { mime: 'text/html' });
      } else {
        p = await os.fs.uniquePath(`/Downloads/${base}.txt`);
        await os.fs.write(p, rich ? htmlToText(editor.innerHTML) : editor.value, { mime: 'text/plain' });
      }
      await os.fs.download(p);
      os.toast(`Saved ${os.path.basename(p)} to Downloads`, 'office');
    }
    async function share() {
      await save();
      const t = rich ? htmlToText(editor.innerHTML) : editor.value;
      os.share({ title: stem(name), text: t.slice(0, 5000), path });
    }
    async function rename() {
      await save();
      const np = await app.renameFile(path);
      if (np) { path = np; name = os.path.basename(np); title.textContent = stem(name); }
    }
    async function saveAsWord() {
      await save();
      const p = await os.fs.uniquePath(os.path.join(os.path.dirname(path), stem(name) + '.wdoc'));
      const h = ext === 'md' ? markdownToHTML(editor.value) : textToHTML(editor.value);
      await os.fs.write(p, { html: h });
      os.toast('Saved as ' + os.path.basename(p), 'office');
      app.openDoc(p);
    }
    function togglePreview() {
      preview = !preview;
      if (preview) previewEl.innerHTML = markdownToHTML(editor.value);
      previewEl.hidden = !preview;
      editor.hidden = preview;
      bar.setButtons(buttons());
    }
    async function wordCount() {
      const t = rich ? editor.innerText : editor.value;
      const words = (t.trim().match(/\S+/g) || []).length;
      const chars = t.replace(/\n/g, '').length;
      const paras = t.split(/\n+/).filter((x) => x.trim()).length;
      const st = await os.fs.stat(path);
      os.ui.messageBox({ title: 'properties', message: `${name}\n\nWords: ${words}\nCharacters: ${chars}\nParagraphs: ${paras}\n\nLocation: ${os.path.dirname(path)}\nSize: ${os.util.formatBytes(st?.size || 0)}\nModified: ${st ? new Date(st.modified).toLocaleString() : '—'}`, buttons: ['close'] });
    }
    const buttons = () => [
      { icon: I.save, label: 'save', onClick: async () => { dirty = true; await save(); os.toast('Saved', 'office'); } },
      ...(ext === 'md' ? [{ icon: preview ? Pencil : Eye, label: preview ? 'edit' : 'preview', onClick: togglePreview }] : []),
      { icon: I.share, label: 'share', onClick: share },
      { icon: I.download, label: 'export', onClick: () => exportAs(rich || ext === 'md' ? 'html' : 'txt') },
    ];
    const bar = os.ui.appBar({
      buttons: buttons(),
      menu: [
        { label: 'export as web page (.html)', onClick: () => exportAs('html') },
        { label: 'export as plain text (.txt)', onClick: () => exportAs('txt') },
        ...(!rich ? [{ label: 'save as Word document', onClick: saveAsWord }] : []),
        { label: 'rename', onClick: rename },
        { label: 'properties', onClick: wordCount },
      ],
    });
    root.append(bar.el);

    const offSuspend = ctx.on('suspend', () => save());
    // Focus a fresh empty document so the keyboard opens right away
    setTimeout(() => {
      const empty = rich ? !editor.innerText.trim() : !editor.value;
      if (empty) editor.focus();
    }, 420);

    page.el.append(root);
    return {
      onBack: async () => { await save(); return false; },
      onHide: () => save(),
      onDestroy: () => { save(); offSuspend(); document.removeEventListener('selectionchange', onSelChange); },
    };
  };
}
