// Wikipedia reader: featured feed, search, sanitized article view with in-app link navigation, saved (offline) articles.
import './style.css';
import { Bookmark, BookmarkCheck, Globe, Shuffle } from 'lucide';

const API = 'https://en.wikipedia.org/w/api.php';
const REST = 'https://en.wikipedia.org/api/rest_v1';
const enc = (t) => encodeURIComponent(String(t).replace(/ /g, '_'));
const norm = (t) => String(t).replace(/_/g, ' ');

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'Api-User-Agent': 'wphone.dev Wikipedia app' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ------------------------------------------------------------ sanitizer */
const ALLOWED = new Set(['p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'sup', 'sub', 'br', 'span', 'div', 'figure', 'figcaption', 'img', 'dl', 'dt', 'dd', 'small', 'abbr', 'cite', 'code', 'pre', 's', 'u', 'q', 'hr', 'bdi', 'var', 'kbd', 'mark', 'section', 'big', 'center', 'wbr']);
const DROP = new Set(['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'noscript', 'template', 'audio', 'video', 'source', 'track', 'svg', 'math', 'map', 'area', 'base', 'frame', 'frameset', 'applet']);
const DROP_CLASS = /\b(navbox|vertical-navbox|mw-editsection|metadata|ambox|ombox|tmbox|cmbox|fmbox|noprint|mw-empty-elt|shortdescription|sistersitebox|portalbox|portal-bar|side-box|mbox-small|navigation-not-searchable|mw-jump-link|toc|catlinks|printfooter|mw-indicators|reflist-upper-alpha-hidden)\b/;
const KEEP_CLASS = /^(infobox|infobox-.*|wikitable|thumb|thumbinner|thumbcaption|tright|tleft|hatnote|reference|references|reflist|mw-references-wrap|gallery|gallerybox|gallerytext|quotebox|mwe-math-fallback-image-inline|mwe-math-fallback-image-display|mw-heading|mw-heading2|mw-heading3|nowrap)$/;
const NS = /^(File|Image|Special|Help|Wikipedia|Talk|User|Template|Category|Portal|Draft|Module|MediaWiki|Media|TimedText|Book)(_talk)?:/i;

function sanitize(html) {
  const doc = new DOMParser().parseFromString('<div id="wk-root">' + html + '</div>', 'text/html');
  const rootEl = doc.getElementById('wk-root');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; } // comments
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      const style = child.getAttribute('style') || '';
      const cls = child.getAttribute('class') || '';
      if (DROP.has(tag) || DROP_CLASS.test(cls) || /display\s*:\s*none/i.test(style) || child.hasAttribute('hidden')) { child.remove(); continue; }
      walk(child);
      if (!ALLOWED.has(tag)) { child.replaceWith(...child.childNodes); continue; }
      // Rebuild attributes from a whitelist
      const keep = {};
      if (tag === 'a') {
        const href = child.getAttribute('href') || '';
        if (/^#/.test(href)) keep['data-anchor'] = href.slice(1);
        else if (/^(\.\/|\/wiki\/)/.test(href)) {
          const t = decodeURIComponent(href.replace(/^(\.\/|\/wiki\/)/, '').split('#')[0]);
          if (NS.test(t)) keep['data-ext'] = 'https://en.m.wikipedia.org/wiki/' + enc(t);
          else keep['data-wiki'] = norm(t);
        } else if (/^(https?:)?\/\//i.test(href)) keep['data-ext'] = href.startsWith('//') ? 'https:' + href : href;
        else if (/^\/w\/index\.php/.test(href)) keep['data-ext'] = 'https://en.m.wikipedia.org' + href;
        keep.href = '#';
      }
      if (tag === 'img') {
        let src = child.getAttribute('src') || child.getAttribute('data-src') || '';
        if (src.startsWith('//')) src = 'https:' + src;
        else if (src.startsWith('/')) src = 'https://en.wikipedia.org' + src;
        if (!/^https:\/\/(upload\.wikimedia\.org|en\.wikipedia\.org|wikimedia\.org)/.test(src)) { child.remove(); continue; }
        keep.src = src; keep.alt = child.getAttribute('alt') || ''; keep.loading = 'lazy'; keep.decoding = 'async';
        const w = +child.getAttribute('width'), h = +child.getAttribute('height');
        if (w) keep.width = w; if (h) keep.height = h;
      }
      if (tag === 'td' || tag === 'th') {
        for (const k of ['colspan', 'rowspan']) { const v = child.getAttribute(k); if (v && /^\d+$/.test(v)) keep[k] = v; }
      }
      if (/^h[2-6]$/.test(tag) && child.id) keep.id = 'wk-' + child.id;
      if (child.id && /^cite_note/.test(child.id)) keep.id = 'wk-' + child.id;
      const kc = cls.split(/\s+/).filter((c) => KEEP_CLASS.test(c));
      if (kc.length) keep.class = kc.map((c) => 'wk-' + c).join(' ');
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      for (const [k, v] of Object.entries(keep)) child.setAttribute(k, v);
      if (tag === 'table') {
        const wrap = doc.createElement('div'); wrap.className = 'wk-table-wrap';
        child.replaceWith(wrap); wrap.append(child);
      }
    }
  };
  walk(rootEl);
  return rootEl.innerHTML;
}

/* ------------------------------------------------------------ app */
export default async function launch(ctx) {
  const { root, os } = ctx;
  const { el, appBar, esc } = os.ui;

  let saved = await ctx.storage.get('saved', []);
  let recent = await ctx.storage.get('recent', []);
  const isSaved = (t) => saved.some((s) => s.title === t);
  const savedListeners = new Set();
  const persistSaved = () => { ctx.storage.set('saved', saved); savedListeners.forEach((f) => f()); };

  const errorBox = (msg, retry) => el('div.wikipedia-error', el('div', msg), retry ? os.ui.button('try again', retry) : null);

  let recentList = null;

  /* ---------------- hub (pivot) */
  ctx.navigate(hubPage);

  function hubPage(page) {
    const pv = os.ui.pivot({
      app: 'WIKIPEDIA',
      items: [
        { header: 'explore', render: renderExplore },
        { header: 'search', render: renderSearch },
        { header: 'saved', render: renderSaved },
        { header: 'recent', render: renderRecent },
      ],
    });
    let searchInput = null;
    const bar = appBar({
      buttons: [
        { icon: os.ui.I.search, label: 'search', onClick: () => { pv.select(1); setTimeout(() => searchInput?.focus(), 50); } },
        { icon: Shuffle, label: 'random', onClick: openRandom },
      ],
      menu: [{ label: 'refresh', onClick: () => { exploreLoad?.(); } }],
    });
    page.el.append(pv.el, bar.el);

    var exploreLoad = null; // var: assigned by the pivot's synchronous first render
    function renderExplore(c) {
      exploreLoad = async () => {
        c.replaceChildren(os.ui.loadingDots());
        const d = new Date();
        const ymd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        try {
          const f = await getJSON(`${REST}/feed/featured/${ymd}`);
          c.replaceChildren();
          if (f.tfa) {
            const t = f.tfa;
            c.append(os.ui.header('featured article'),
              el('div.wikipedia-feature.tilt', { onclick: () => openArticle(t.titles?.normalized || norm(t.title)) },
                t.thumbnail ? el('div.wikipedia-feature-img', { style: { backgroundImage: `url("${t.thumbnail.source}")` } }) : null,
                el('div.wikipedia-feature-title', t.titles?.normalized || norm(t.title)),
                t.description ? el('div.wikipedia-feature-desc', t.description) : null,
                el('div.wikipedia-feature-extract', t.extract || '')));
          }
          if (f.mostread?.articles?.length) {
            c.append(os.ui.header('trending'), os.ui.list(f.mostread.articles.slice(0, 8), {
              render: (a) => articleRow({ title: a.titles?.normalized || norm(a.title), description: a.description, thumb: a.thumbnail?.source }, (a.views || 0).toLocaleString() + ' views'),
              onClick: (a) => openArticle(a.titles?.normalized || norm(a.title)),
            }));
          }
          if (f.image) {
            const im = f.image;
            c.append(os.ui.header('picture of the day'),
              el('div.wikipedia-potd.tilt', { onclick: () => os.launch('ie', { url: 'https://commons.m.wikimedia.org/wiki/' + enc(im.title) }) },
                el('img', { src: im.thumbnail?.source, alt: '', loading: 'lazy' }),
                el('div.wikipedia-potd-cap', { html: im.description?.html ? sanitizeInline(im.description.html) : esc(im.description?.text || '') })));
          }
          if (f.news?.length) {
            c.append(os.ui.header('in the news'));
            for (const n of f.news.slice(0, 5)) {
              const node = el('div.wikipedia-news', { html: sanitize(n.story) });
              node.addEventListener('click', onArticleClick);
              c.append(node);
            }
          }
          if (f.onthisday?.length) {
            c.append(os.ui.header('on this day'));
            for (const o of f.onthisday.slice(0, 6)) {
              c.append(el('div.wikipedia-otd.tilt', { onclick: () => o.pages?.[0] && openArticle(o.pages[0].titles?.normalized || norm(o.pages[0].title)) },
                el('div.wikipedia-otd-year', String(o.year)), el('div.wikipedia-otd-text', o.text)));
            }
          }
          if (!c.children.length) c.append(os.ui.empty('Nothing featured today.'));
        } catch (e) {
          c.replaceChildren(errorBox('Couldn’t load today’s featured content. Check your connection.', exploreLoad));
        }
      };
      exploreLoad();
    }

    function renderSearch(c) {
      const results = el('div.wikipedia-results');
      let seq = 0;
      const run = os.util.debounce(async (q) => {
        const my = ++seq;
        if (!q.trim()) { results.replaceChildren(os.ui.desc('Search over 6 million English Wikipedia articles.')); return; }
        results.replaceChildren(os.ui.loadingDots());
        try {
          const [, titles, descs] = await getJSON(`${API}?action=opensearch&format=json&origin=*&limit=15&namespace=0&search=${encodeURIComponent(q)}`);
          if (my !== seq) return;
          results.replaceChildren(os.ui.list(titles.map((t, i) => ({ title: t, description: descs?.[i] })), {
            empty: 'No articles match “' + q + '”.',
            render: (a) => os.ui.listItem({ title: a.title, subtitle: a.description || '' }),
            onClick: (a) => openArticle(a.title),
          }));
        } catch { if (my === seq) results.replaceChildren(errorBox('Search failed. Check your connection.')); }
      }, 250);
      const tb = os.ui.textbox({ placeholder: 'search Wikipedia', type: 'search', onInput: (v) => run(v), onEnter: (v) => v.trim() && openArticle(v.trim(), { search: true }) });
      searchInput = tb;
      c.append(tb, results);
      run('');
    }

    function renderSaved(c) {
      const lst = os.ui.list(saved, {
        empty: 'Articles you save show up here, and you can read them offline.',
        render: (a) => articleRow(a),
        onClick: (a) => openArticle(a.title),
        onHold: (a, row) => os.ui.contextMenu(row, [
          { label: 'remove', onClick: () => { saved = saved.filter((s) => s.title !== a.title); ctx.storage.del('html:' + a.title); persistSaved(); } },
          { label: 'pin to start', onClick: () => ctx.pinTile({ key: 'wiki:' + a.title, title: a.title, args: { article: a.title }, size: 'medium' }) },
        ]),
      });
      savedListeners.add(() => lst.update(saved));
      c.append(lst);
    }

    function renderRecent(c) {
      const lst = os.ui.list(recent, {
        empty: 'Articles you read show up here.',
        render: (a) => articleRow(a, os.util.formatRelative(a.time)),
        onClick: (a) => openArticle(a.title),
      });
      recentList = lst;
      c.append(lst, os.ui.button('clear recent', () => { recent = []; ctx.storage.set('recent', recent); lst.update(recent); }));
    }
    return { onShow: () => recentList?.update(recent) };
  }

  function sanitizeInline(html) { return sanitize(html).replace(/<\/?(div|p|table|tbody|tr|td|th|ul|ol|li|h\d)[^>]*>/g, ' '); }

  function articleRow(a, right) {
    return el('div.wp-row',
      a.thumb ? el('div.wp-row-image', { style: { backgroundImage: `url("${a.thumb}")` } }) : el('div.wp-row-image.wikipedia-noimg', 'W'),
      el('div.wp-row-text', el('div.wp-row-title', a.title), el('div.wp-row-sub', [a.description, right].filter(Boolean).join(' · '))));
  }

  async function openRandom() {
    try { const r = await getJSON(`${REST}/page/random/summary`); openArticle(r.titles?.normalized || norm(r.title)); }
    catch { os.toast('Couldn’t get a random article'); }
  }

  function openArticle(title, opts = {}) { ctx.navigate(articlePage, { title: norm(title), ...opts }); }

  // Delegate clicks inside rendered wiki HTML.
  function onArticleClick(e) {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.wiki) openArticle(a.dataset.wiki);
    else if (a.dataset.ext) os.launch('ie', { url: a.dataset.ext });
    else if (a.dataset.anchor) {
      const scroller = a.closest('.wikipedia-scroll');
      const tgt = scroller?.querySelector('#wk-' + CSS.escape(a.dataset.anchor));
      if (tgt) {
        const sec = tgt.closest('.wikipedia-section');
        sec?.classList.add('open');
        tgt.scrollIntoView({ behavior: 'smooth', block: 'center' });
        tgt.classList.add('wikipedia-flash'); setTimeout(() => tgt.classList.remove('wikipedia-flash'), 1400);
      }
    }
  }

  /* ---------------- article */
  function articlePage(page) {
    let title = page.params.title;
    const scroll = el('div.wikipedia-scroll');
    const wrap = el('div.wikipedia-article-page', el('div.wikipedia-app-title.wp-app-title', 'WIKIPEDIA'), scroll);
    page.el.append(wrap);
    scroll.addEventListener('click', onArticleClick);
    let summary = null;

    const bar = appBar({ buttons: [], menu: [] });
    wrap.append(bar.el);
    const setBar = () => {
      const s = isSaved(title);
      bar.setButtons([
        { icon: s ? BookmarkCheck : Bookmark, label: s ? 'saved' : 'save', onClick: toggleSave },
        { icon: os.ui.I.share, label: 'share', onClick: () => os.share({ title, url: 'https://en.wikipedia.org/wiki/' + enc(title) }) },
        { icon: Globe, label: 'web', onClick: () => os.launch('ie', { url: 'https://en.m.wikipedia.org/wiki/' + enc(title) }) },
      ]);
      bar.setMenu([
        { label: 'expand all sections', onClick: () => scroll.querySelectorAll('.wikipedia-section').forEach((s) => s.classList.add('open')) },
        { label: 'collapse all sections', onClick: () => scroll.querySelectorAll('.wikipedia-section').forEach((s) => s.classList.remove('open')) },
        { label: 'pin to start', onClick: () => ctx.pinTile({ key: 'wiki:' + title, title, args: { article: title }, size: 'medium' }) },
        { label: 'copy link', onClick: () => os.device.copy('https://en.wikipedia.org/wiki/' + enc(title)).then(() => os.toast('Link copied')) },
      ]);
    };
    setBar();

    let bodyHTML = '';
    async function toggleSave() {
      if (isSaved(title)) {
        saved = saved.filter((s) => s.title !== title);
        ctx.storage.del('html:' + title);
        os.toast('Removed from saved');
      } else {
        saved = [{ title, description: summary?.description || '', thumb: summary?.thumbnail?.source || '' }, ...saved];
        if (bodyHTML) ctx.storage.set('html:' + title, { html: bodyHTML, summary });
        os.toast('Saved for offline reading');
      }
      persistSaved(); setBar();
    }

    const renderHead = (s) => {
      const head = el('div.wikipedia-head',
        s?.originalimage || s?.thumbnail ? el('div.wikipedia-hero', { style: { backgroundImage: `url("${(s.originalimage && s.originalimage.width <= 1600 ? s.originalimage : s.thumbnail || s.originalimage).source}")` } }) : null,
        el('h1.wikipedia-title', { html: s?.displaytitle ? sanitizeInline(s.displaytitle) : esc(title) }),
        s?.description ? el('div.wikipedia-desc', s.description) : null);
      return head;
    };

    const renderBody = (html) => {
      const body = el('div.wikipedia-article', { html });
      // Group into collapsible sections at each h2.
      const container = body.firstElementChild?.matches?.('div') && body.children.length === 1 ? body.firstElementChild : body;
      const kids = [...container.childNodes];
      const out = el('div.wikipedia-article');
      let sec = null;
      for (const k of kids) {
        const h2 = k.nodeType === 1 && (k.tagName === 'H2' ? k : (k.classList?.contains('wk-mw-heading2') ? k.querySelector('h2') : null));
        if (h2) {
          const label = h2.textContent.trim();
          const content = el('div.wikipedia-section-body');
          sec = el('section.wikipedia-section', el('div.wikipedia-section-head.tilt', { id: h2.id || null, onclick: (e) => e.currentTarget.parentElement.classList.toggle('open') }, el('span.wikipedia-chev'), label), content);
          out.append(sec);
          continue;
        }
        (sec ? sec.lastElementChild : out).append(k);
      }
      return out;
    };

    async function load() {
      scroll.replaceChildren(renderHead({ displaytitle: '' }), os.ui.loadingDots());
      const cached = await ctx.storage.get('html:' + title, null);
      try {
        const [s, p] = await Promise.all([
          getJSON(`${REST}/page/summary/${enc(title)}`).catch(() => null),
          getJSON(`${API}?action=parse&format=json&formatversion=2&origin=*&prop=text&redirects=1&disableeditsection=1&disabletoc=1&page=${enc(title)}`),
        ]);
        if (p.error) {
          if (page.params.search) { scroll.replaceChildren(renderHead(null), errorBox('No article called “' + title + '”. Try the search suggestions instead.')); return; }
          throw new Error(p.error.info);
        }
        if (p.parse?.title && p.parse.title !== title) { title = p.parse.title; setBar(); }
        summary = s;
        bodyHTML = sanitize(p.parse.text);
        if (isSaved(title)) ctx.storage.set('html:' + title, { html: bodyHTML, summary });
      } catch (e) {
        if (cached) { summary = cached.summary; bodyHTML = cached.html; os.toast('Offline — showing saved copy'); }
        else { scroll.replaceChildren(renderHead(null), errorBox('Couldn’t load this article. ' + (navigator.onLine ? '' : 'You’re offline.'), load)); return; }
      }
      scroll.replaceChildren(renderHead(summary), renderBody(bodyHTML));
      recent = [{ title, description: summary?.description || '', thumb: summary?.thumbnail?.source || '', time: Date.now() }, ...recent.filter((r) => r.title !== title)].slice(0, 40);
      ctx.storage.set('recent', recent);
    }
    load();
  }

  /* ---------------- launch args (secondary tiles, os.launch('wikipedia', { article | q })) */
  const handleArgs = (a) => {
    if (!a) return;
    if (a.article) openArticle(a.article);
    else if (a.q) openArticle(a.q, { search: true });
    else if (a.share?.url && /wikipedia\.org\/wiki\//.test(a.share.url)) openArticle(decodeURIComponent(a.share.url.split('/wiki/')[1]));
  };
  handleArgs(ctx.args);
  ctx.on('args', handleArgs);
}
