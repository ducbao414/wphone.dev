// Article reader shared by the news app (duplicated from news — apps stay self-contained).
// Remote content is ALWAYS rendered via textContent — never innerHTML.
import { ExternalLink, Bookmark, BookmarkCheck, ALargeSmall } from 'lucide';

export const bigImage = (u) => (u ? u.replace(/\/(standard|ace\/standard)\/\d+\//, (m) => m.replace(/\/\d+\/$/, '/800/')) : u);

export function timeAgo(os, date) {
  const t = date ? new Date(date).getTime() : NaN;
  return isFinite(t) ? os.util.formatRelative(t) : '';
}

/**
 * Build a reader page builder for ctx.navigate.
 * opts: { app: 'MSN SPORTS', storage, savedKey = 'saved', cls prefix }
 */
export function makeReader({ app, storage, savedKey = 'saved', prefix = 'news' }) {
  return function readerPage(page) {
    const { os } = page;
    const { el, appBar, I } = os.ui;
    const it = page.params.item;
    const p = os.ui.page({ app, cls: prefix + '-reader' });
    const body = el(`div.${prefix}-article`);
    const hero = it.image ? el(`img.${prefix}-rhero`, { src: bigImage(it.image), alt: '', onerror: (e) => { if (e.target.src !== it.image) e.target.src = it.image; else e.target.remove(); } }) : null;
    p.content.append(
      el(`div.${prefix}-rsource`, (it.source || '').toUpperCase()),
      el(`h1.${prefix}-rtitle`, it.title || ''),
      el(`div.${prefix}-rmeta`, [timeAgo(os, it.date), it.date ? new Date(it.date).toLocaleDateString() : ''].filter(Boolean).join(' · ')),
      hero || '',
      body);
    body.append(os.ui.loadingDots({ inline: true }));
    let big = false;
    storage.get('readerBig', false).then((v) => { big = v; body.classList.toggle('big', big); });

    const fallback = (msg) => {
      body.replaceChildren(
        it.description ? el('p', it.description) : '',
        el(`div.${prefix}-rnote`, msg),
        os.ui.button('open in browser', () => os.launch('ie', { url: it.link }), { accent: true }));
    };
    os.net.readable(it.link).then((r) => {
      const blocks = (r.blocks || []).filter((b, i) => b && b.text && b.text.trim() && !(i < 3 && /^(Published|Updated|Share|Image (source|caption))/i.test(b.text)));
      if (blocks.length < 2) { fallback('We couldn’t format this story for reading.'); return; }
      if (!hero && r.image && /^https?:/.test(r.image)) body.before(el(`img.${prefix}-rhero`, { src: r.image, alt: '', onerror: (e) => e.target.remove() }));
      const byline = r.byline && !/^https?:/i.test(r.byline) ? r.byline : '';
      body.replaceChildren(byline ? el(`div.${prefix}-rbyline`, byline) : '');
      let ul = null;
      for (const b of blocks) {
        if (b.type === 'li') {
          if (!ul) { ul = el('ul'); body.append(ul); }
          ul.append(el('li', b.text));
          continue;
        }
        ul = null;
        const tag = { h2: 'h2', h3: 'h3', blockquote: 'blockquote' }[b.type] || 'p';
        body.append(el(tag, b.text));
      }
      body.append(el(`div.${prefix}-rnote`, 'Source: ' + (it.source || new URL(it.link).hostname)), os.ui.button('view original', () => os.launch('ie', { url: it.link })));
    }).catch(() => fallback(navigator.onLine ? 'This story couldn’t be loaded in the reader.' : 'You’re offline. Connect to read this story.'));

    const bar = appBar({ buttons: [], menu: [] });
    const setBar = async () => {
      const saved = (await storage.get(savedKey, [])).some((x) => x.link === it.link);
      bar.setButtons([
        { icon: saved ? BookmarkCheck : Bookmark, label: saved ? 'saved' : 'save', onClick: toggleSave },
        { icon: I.share, label: 'share', onClick: () => os.share({ title: it.title, url: it.link }) },
        { icon: ExternalLink, label: 'browser', onClick: () => os.launch('ie', { url: it.link }) },
        { icon: ALargeSmall, label: 'text size', onClick: () => { big = !big; body.classList.toggle('big', big); storage.set('readerBig', big); } },
      ]);
      bar.setMenu([
        { label: 'copy link', onClick: async () => { try { await os.device.copy(it.link); os.toast('Link copied'); } catch {} } },
        { label: 'open in real browser', onClick: () => os.device.openUrl(it.link) },
      ]);
    };
    const toggleSave = async () => {
      let list = await storage.get(savedKey, []);
      if (list.some((x) => x.link === it.link)) { list = list.filter((x) => x.link !== it.link); os.toast('Removed from reading list'); } else {
        list = [{ title: it.title, link: it.link, image: it.image, source: it.source, date: it.date, description: it.description, savedAt: Date.now() }, ...list];
        os.toast('Saved to reading list');
      }
      await storage.set(savedKey, list);
      setBar();
      page.params.onSavedChange?.();
    };
    setBar();
    page.el.append(p.el, bar.el);
  };
}
