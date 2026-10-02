// Internet Explorer Mobile (WP 8.1 style): bottom address bar, tabs, favorites, recent, reading view, Bing-style search.
// Remote pages render in a sandboxed iframe (no allow-same-origin), either directly or through the backend proxy.
// Remote HTML is NEVER injected into the simulator's DOM: search results and reading view are built with textContent.
import './style.css';
import { RotateCw, X, ExternalLink, Search, Globe, Clock, Star, BookOpen, ArrowRight } from 'lucide';

const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
const MAX_TABS = 6;
const DEFAULT_SITES = [
  { url: 'https://www.bing.com/', title: 'Bing' },
  { url: 'https://en.m.wikipedia.org/', title: 'Wikipedia' },
  { url: 'https://www.bbc.com/news', title: 'BBC News' },
  { url: 'https://news.ycombinator.com/', title: 'Hacker News' },
  { url: 'https://www.windowscentral.com/', title: 'Windows Central' },
  { url: 'https://www.msn.com/', title: 'MSN' },
];

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u || ''; } };
const favicon = (u, sz = 64) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(u))}&sz=${sz}`;
const isHttp = (u) => /^https?:\/\//i.test(u || '');

export function parseInput(s) {
  s = (s || '').trim();
  if (!s) return null;
  if (/^about:(start|home|blank)$/i.test(s)) return { kind: 'start' };
  if (isHttp(s)) return { kind: 'web', url: s };
  if (!/\s/.test(s) && /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#].*)?$/i.test(s)) return { kind: 'web', url: 'https://' + s };
  return { kind: 'search', q: s };
}

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I, iconSVG } = os.ui;
  const { debounce, uid, clamp, onLongPress } = os.util;
  const ico = (src, size = 20, stroke = 2) => el('span.ie-ic', { html: iconSVG(src, { size, stroke }) });

  let settings = { mode: 'proxy', suggestions: true, readerSize: 1, newTabForLinks: true, ...(await storage.get('settings', {})) };
  let history = await storage.get('history', []);
  let favorites = await storage.get('favorites', []);
  const savedTabs = await storage.get('tabs', null);
  let curId = await storage.get('cur', null);
  let bingUrl = null;
  os.net.bing().then((b) => { bingUrl = b.url; document.querySelectorAll('.ie-start-bg').forEach((n) => (n.style.backgroundImage = `url("${bingUrl}")`)); }).catch(() => {});

  const saveSettings = () => storage.set('settings', settings);
  const saveHistory = debounce(() => storage.set('history', history), 400);
  const saveFavs = () => storage.set('favorites', favorites);

  /* ------------------------------------------------------------ DOM */
  const stage = el('div.ie-stage');
  const sugg = el('div.ie-sugg', { hidden: true, onpointerdown: (e) => { if (!e.target.closest('input')) e.preventDefault(); } });
  const menu = el('div.ie-menu', { hidden: true });
  const input = el('input.ie-input', { type: 'text', placeholder: 'search or enter address', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterkeyhint: 'go', inputmode: 'url' });
  input.spellcheck = false;
  const reloadBtn = el('button.ie-reload', { type: 'button', 'aria-label': 'refresh', onpointerdown: (e) => e.preventDefault(), onclick: () => reloadOrStop() });
  const form = el('form.ie-addr', { onsubmit: (e) => { e.preventDefault(); const v = input.value; input.blur(); go(v); } }, input, reloadBtn);
  const tabCount = el('span.ie-tabcount', '1');
  const tabsBtn = el('button.ie-barbtn.ie-tabsbtn', { type: 'button', 'aria-label': 'tabs', onclick: () => openTabs() }, tabCount);
  const extBtn = el('button.ie-barbtn', { type: 'button', 'aria-label': 'open in real browser', title: 'open in real browser', onclick: () => openExternal() }, ico(ExternalLink, 20));
  const dotsBtn = el('button.ie-barbtn.ie-dots', { type: 'button', 'aria-label': 'more', onclick: (e) => { e.stopPropagation(); toggleMenu(); } }, el('span'), el('span'), el('span'));
  const progress = el('div.ie-progress', os.ui.loadingDots());
  progress.hidden = true;
  const bar = el('div.ie-bar', progress, el('div.ie-barrow', form, tabsBtn, extBtn, dotsBtn));
  const view = el('div.ie', stage, sugg, menu, bar);

  /* ------------------------------------------------------------ tabs */
  const tabs = [];
  const cur = () => tabs.find((t) => t.id === curId) || tabs[0];
  const entryOf = (t) => t.entries[t.idx];

  function makeTab(data = {}) {
    const entries = Array.isArray(data.entries) && data.entries.length ? data.entries : [{ kind: 'start' }];
    const t = { id: data.id || uid(), entries, idx: clamp(data.idx ?? entries.length - 1, 0, entries.length - 1), view: el('div.ie-view', { hidden: true }), rendered: false, loading: false, token: 0 };
    stage.append(t.view);
    tabs.push(t);
    return t;
  }
  const persist = debounce(() => {
    storage.set('tabs', tabs.map((t) => ({ id: t.id, idx: t.idx, entries: t.entries })));
    storage.set('cur', curId);
  }, 300);

  function switchTab(t) {
    curId = t.id;
    for (const x of tabs) x.view.hidden = x !== t;
    if (!t.rendered) render(t);
    updateBar();
    persist();
  }
  function newTab(entry) {
    if (tabs.length >= MAX_TABS) { os.toast(`You can have up to ${MAX_TABS} tabs open. Close one first.`); return null; }
    const t = makeTab({ entries: [entry || { kind: 'start' }] });
    switchTab(t);
    return t;
  }
  function closeTab(t) {
    t.token++;
    t.view.remove();
    tabs.splice(tabs.indexOf(t), 1);
    if (!tabs.length) makeTab();
    if (curId === t.id || !tabs.some((x) => x.id === curId)) switchTab(tabs[tabs.length - 1]);
    updateBar(); persist();
  }

  function navigate(t, entry) {
    t.entries = t.entries.slice(0, t.idx + 1);
    t.entries.push(entry);
    if (t.entries.length > 30) t.entries.shift();
    t.idx = t.entries.length - 1;
    render(t);
    persist();
  }
  function go(text, { tab } = {}) {
    const e = parseInput(text);
    if (!e) return;
    navigate(tab || cur(), e);
  }
  /** Open an entry from outside (args / share): reuse a blank tab, else open a new one. */
  function openEntry(entry, preferNew = settings.newTabForLinks) {
    const t = cur();
    const blank = t && t.entries.length === 1 && entryOf(t).kind === 'start';
    if (blank || !preferNew || tabs.length >= MAX_TABS) { if (t !== cur()) switchTab(t); navigate(t, entry); } else newTab(entry);
  }

  /* ------------------------------------------------------------ rendering */
  function setLoading(t, v) {
    t.loading = v;
    clearTimeout(t.loadTimer);
    if (v) t.loadTimer = setTimeout(() => setLoading(t, false), 30000);
    if (t === cur()) updateBar();
  }

  function render(t) {
    t.rendered = true;
    const tok = ++t.token;
    const e = entryOf(t);
    setLoading(t, false);
    t.view.replaceChildren();
    t.view.scrollTop = 0;
    if (e.kind === 'web') renderWeb(t, e, tok);
    else if (e.kind === 'search') renderSearch(t, e, tok);
    else if (e.kind === 'reader') renderReader(t, e, tok);
    else if (e.kind === 'file') renderFile(t, e, tok);
    else renderStart(t);
    if (t === cur()) updateBar();
  }

  function makeFrame(t, tok) {
    const f = el('iframe.ie-frame', { sandbox: SANDBOX, referrerpolicy: 'no-referrer', allow: 'fullscreen; autoplay', title: 'web page' });
    f.addEventListener('load', () => { if (tok === t.token) setLoading(t, false); });
    return f;
  }

  function renderWeb(t, e, tok) {
    if (!navigator.onLine) return t.view.append(errorPage(t, e, 'You’re not connected to the Internet. Check your Wi-Fi or cellular connection and try again.'));
    const mode = e.mode || settings.mode;
    const frame = makeFrame(t, tok);
    t.view.append(frame);
    setLoading(t, true);
    frame.src = mode === 'direct' ? e.url : os.net.proxyUrl(e.url);
    addHistory(e.url, e.title);
    // Learn the page title (and detect proxy failures) by peeking at the proxied document.
    fetch(os.net.proxyUrl(e.url)).then(async (r) => {
      if (tok !== t.token) return;
      if (!r.ok && !r.headers.get('x-proxied-url')) {
        if (mode === 'direct') return;
        let msg = '';
        try { msg = (await r.json()).error; } catch {}
        setLoading(t, false);
        t.view.replaceChildren(errorPage(t, e, msg ? `The server said: ${msg}.` : `The page returned an error (${r.status}).`));
        return;
      }
      if (!/html/i.test(r.headers.get('content-type') || '')) { setTitle(t, e, decodeURIComponent(e.url.split(/[?#]/)[0].split('/').pop() || hostOf(e.url))); return; }
      const txt = (await r.text()).slice(0, 600000);
      const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(txt);
      if (m && tok === t.token) {
        const title = new DOMParser().parseFromString(`<title>${m[1].slice(0, 400)}</title>`, 'text/html').title.trim();
        if (title) setTitle(t, e, title);
      }
    }).catch(() => {});
  }

  function setTitle(t, e, title) {
    e.title = title.slice(0, 200);
    const h = history.find((x) => x.url === e.url);
    if (h) { h.title = e.title; saveHistory(); }
    persist();
    if (t === cur()) updateBar();
  }

  function errorPage(t, e, msg) {
    const mode = e.mode || settings.mode;
    return el('div.ie-error',
      el('div.ie-error-title', 'We can’t display this page'),
      el('p', msg || 'The page didn’t load. It may be temporarily unavailable, or it may have moved.'),
      el('p.ie-error-url', e.url || ''),
      el('div.ie-error-btns',
        os.ui.button('try again', () => render(t)),
        e.url ? os.ui.button(mode === 'direct' ? 'use proxy mode' : 'use direct mode', () => { e.mode = mode === 'direct' ? 'proxy' : 'direct'; render(t); }) : null,
        e.url ? os.ui.button('open in real browser', () => os.device.openUrl(e.url)) : null));
  }

  function renderFile(t, e, tok) {
    const frame = makeFrame(t, tok);
    setLoading(t, true);
    os.fs.read(e.path, 'text').then((html) => {
      if (tok !== t.token) return;
      const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      e.title = (m && new DOMParser().parseFromString(`<title>${m[1]}</title>`, 'text/html').title.trim()) || os.path.basename(e.path);
      frame.srcdoc = html;
      t.view.append(frame);
      if (t === cur()) updateBar();
      persist();
    }).catch((err) => {
      if (tok !== t.token) return;
      setLoading(t, false);
      t.view.append(el('div.ie-error', el('div.ie-error-title', 'We can’t open this file'), el('p', err?.message || 'The file may have been moved or deleted.'), el('p.ie-error-url', e.path)));
    });
  }

  /* --- start page */
  function frequentSites() {
    const counts = new Map();
    for (const h of history) {
      const c = counts.get(h.url) || { url: h.url, title: h.title, n: 0 };
      c.n++; if (!c.title && h.title) c.title = h.title;
      counts.set(h.url, c);
    }
    const hidden = new Set(settings.hiddenFrequent || []);
    const list = [...counts.values()].filter((x) => x.n > 1 && !hidden.has(x.url)).sort((a, b) => b.n - a.n).slice(0, 9);
    for (const d of DEFAULT_SITES) if (list.length < 6 && !list.some((x) => hostOf(x.url) === hostOf(d.url)) && !hidden.has(d.url)) list.push(d);
    return list;
  }

  function siteTile(s, t) {
    const n = el('div.ie-site.tilt',
      el('div.ie-site-icon', el('img', { src: favicon(s.url), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: function () { this.remove(); } })),
      el('div.ie-site-title', s.title || hostOf(s.url)));
    n.addEventListener('click', () => navigate(t, { kind: 'web', url: s.url, title: s.title }));
    onLongPress(n, () => os.ui.contextMenu(n, [
      { label: 'open in new tab', onClick: () => newTab({ kind: 'web', url: s.url, title: s.title }) },
      { label: isFav(s.url) ? 'remove from favorites' : 'add to favorites', onClick: () => { toggleFav(s.url, s.title); render(t); } },
      { label: 'pin to start', onClick: () => pinUrl(s.url, s.title) },
      { label: 'remove from frequent', onClick: () => { settings.hiddenFrequent = [...(settings.hiddenFrequent || []), s.url]; saveSettings(); render(t); } },
    ]));
    return n;
  }

  function renderStart(t) {
    const bg = el('div.ie-start-bg', { style: bingUrl ? { backgroundImage: `url("${bingUrl}")` } : {} });
    const grid = el('div.ie-start-grid', frequentSites().map((s) => siteTile(s, t)));
    const favs = favorites.slice(0, 8);
    t.view.append(el('div.ie-start', bg, el('div.ie-start-shade'),
      el('div.ie-start-inner',
        el('div.ie-start-head', 'frequent'), grid,
        favs.length ? el('div.ie-start-head', 'favorites') : null,
        favs.length ? el('div.ie-start-favs', favs.map((f) => el('div.ie-start-fav.tilt', { onclick: () => navigate(t, { kind: 'web', url: f.url, title: f.title }) },
          el('img', { src: favicon(f.url, 32), alt: '', referrerpolicy: 'no-referrer', onerror: function () { this.style.visibility = 'hidden'; } }), el('span', f.title || hostOf(f.url))))) : null)));
  }

  /* --- search results (rendered natively, Bing style) */
  function renderSearch(t, e, tok) {
    e.title = e.q;
    const body = el('div.ie-serp-body', os.ui.loadingDots({ inline: true }));
    const box = el('input.ie-serp-input', { type: 'search', value: e.q, enterkeyhint: 'search' });
    box.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); box.blur(); go(box.value, { tab: t }); } });
    t.view.append(el('div.ie-serp',
      el('div.ie-serp-head', el('div.ie-serp-brand', 'bing'), el('div.ie-serp-box', box, el('button.ie-serp-go', { type: 'button', 'aria-label': 'search', onclick: () => go(box.value, { tab: t }) }, ico(Search, 18)))),
      el('div.ie-serp-tabs', el('span.active', 'web'), el('span', { onclick: () => navigate(t, { kind: 'web', url: 'https://duckduckgo.com/?ia=images&iax=images&q=' + encodeURIComponent(e.q) }) }, 'images'), el('span', { onclick: () => navigate(t, { kind: 'web', url: 'https://duckduckgo.com/?ia=news&iar=news&q=' + encodeURIComponent(e.q) }) }, 'news')),
      body));
    setLoading(t, true);
    os.net.search(e.q).then((r) => {
      if (tok !== t.token) return;
      setLoading(t, false);
      const results = (r.results || []).filter((x) => isHttp(x.url) && !/duckduckgo\.com\/y\.js/.test(x.url));
      body.replaceChildren();
      if (!results.length) { body.append(el('div.ie-serp-empty', `No results found for “${e.q}”.`), el('p.ie-serp-tip', 'Check your spelling or try different keywords.')); }
      else body.append(el('div.ie-serp-count', `${results.length} results`));
      for (const x of results) {
        let short = hostOf(x.url);
        try { const u = new URL(x.url); short = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : ''); } catch {}
        const row = el('div.ie-res.tilt',
          el('div.ie-res-title', x.title || short),
          el('div.ie-res-url', el('img', { src: favicon(x.url, 32), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: function () { this.remove(); } }), el('span', short)),
          x.snippet ? el('div.ie-res-snip', x.snippet) : null);
        row.addEventListener('click', () => navigate(t, { kind: 'web', url: x.url, title: x.title }));
        onLongPress(row, () => os.ui.contextMenu(row, [
          { label: 'open in new tab', onClick: () => newTab({ kind: 'web', url: x.url, title: x.title }) },
          { label: 'reading view', onClick: () => navigate(t, { kind: 'reader', url: x.url, title: x.title }) },
          { label: 'copy link', onClick: () => copy(x.url) },
          { label: 'share link', onClick: () => os.share({ url: x.url, title: x.title }) },
          { label: 'open in real browser', onClick: () => os.device.openUrl(x.url) },
        ]));
        body.append(row);
      }
      os.net.suggest(e.q).then((s) => {
        if (tok !== t.token) return;
        const rel = (s || []).filter((x) => x.toLowerCase() !== e.q.toLowerCase()).slice(0, 8);
        if (rel.length) body.append(el('div.ie-serp-relhead', 'related searches'), el('div.ie-serp-rel', rel.map((q) => el('div.ie-serp-relitem.tilt', { onclick: () => navigate(t, { kind: 'search', q }) }, ico(Search, 16), el('span', q)))));
      }).catch(() => {});
    }).catch(() => {
      if (tok !== t.token) return;
      setLoading(t, false);
      body.replaceChildren(el('div.ie-error.inline', el('div.ie-error-title', 'We can’t search right now'),
        el('p', navigator.onLine ? 'Bing isn’t responding. Please try again in a little while.' : 'You’re not connected to the Internet.'),
        el('div.ie-error-btns', os.ui.button('try again', () => render(t)))));
    });
  }

  /* --- reading view (text only) */
  function renderReader(t, e, tok) {
    const art = el('article.ie-reader', { style: { '--ie-rs': settings.readerSize } }, os.ui.loadingDots({ inline: true }));
    t.view.append(art);
    setLoading(t, true);
    os.net.readable(e.url).then((a) => {
      if (tok !== t.token) return;
      setLoading(t, false);
      art.replaceChildren();
      if (a.title) setTitle(t, e, a.title);
      art.append(el('div.ie-reader-site', hostOf(a.url || e.url)), el('h1', a.title || e.title || hostOf(e.url)));
      if (a.byline && !isHttp(a.byline)) art.append(el('div.ie-reader-by', a.byline));
      if (a.image && isHttp(a.image)) art.append(el('img.ie-reader-img', { src: a.image, alt: '', referrerpolicy: 'no-referrer', onerror: function () { this.remove(); } }));
      const blocks = a.blocks || [];
      if (!blocks.length) art.append(el('p.ie-reader-none', a.description || 'Reading view isn’t available for this page.'));
      let ul = null;
      for (const b of blocks) {
        if (!b.text) continue;
        if (b.type === 'li') { if (!ul) { ul = el('ul'); art.append(ul); } ul.append(el('li', b.text)); continue; }
        ul = null;
        art.append(el(b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3' : b.type === 'blockquote' ? 'blockquote' : 'p', b.text));
      }
      art.append(el('div.ie-reader-foot',
        os.ui.button('view original page', () => exitReader(t)),
        os.ui.button('text size', () => { settings.readerSize = settings.readerSize >= 1.4 ? 0.85 : +(settings.readerSize + 0.15).toFixed(2); saveSettings(); art.style.setProperty('--ie-rs', settings.readerSize); })));
    }).catch(() => {
      if (tok !== t.token) return;
      setLoading(t, false);
      art.replaceChildren(el('div.ie-error.inline', el('div.ie-error-title', 'Reading view isn’t available'),
        el('p', 'We couldn’t get the text of this page.'),
        el('div.ie-error-btns', os.ui.button('try again', () => render(t)), os.ui.button('view original page', () => exitReader(t)))));
    });
  }
  function exitReader(t) {
    const e = entryOf(t), prev = t.entries[t.idx - 1];
    if (prev && prev.kind === 'web' && prev.url === e.url) { t.idx--; render(t); persist(); } else navigate(t, { kind: 'web', url: e.url, title: e.title });
  }

  /* ------------------------------------------------------------ bar */
  function displayText(e, full) {
    if (e.kind === 'web' || e.kind === 'reader') return full ? e.url : hostOf(e.url);
    if (e.kind === 'search') return e.q;
    if (e.kind === 'file') return full ? e.path : os.path.basename(e.path);
    return '';
  }
  function updateBar() {
    const t = cur();
    if (!t) return;
    const e = entryOf(t);
    if (document.activeElement !== input) input.value = displayText(e, false);
    reloadBtn.innerHTML = iconSVG(t.loading ? X : RotateCw, { size: 18, stroke: 2 });
    reloadBtn.setAttribute('aria-label', t.loading ? 'stop' : 'refresh');
    reloadBtn.hidden = e.kind === 'start' && !t.loading;
    tabCount.textContent = String(tabs.length);
    progress.hidden = !t.loading;
    extBtn.classList.toggle('disabled', !(e.kind === 'web' || e.kind === 'reader' || e.kind === 'search'));
    form.classList.toggle('reader', e.kind === 'reader');
  }
  function reloadOrStop() {
    const t = cur();
    if (t.loading) {
      t.token++;
      setLoading(t, false);
      const e = entryOf(t);
      if (e.kind === 'web') { const f = t.view.querySelector('iframe'); if (f) f.src = 'about:blank'; t.view.replaceChildren(errorPage(t, e, 'Navigation was stopped.')); }
    } else render(t);
  }
  function openExternal() {
    const e = entryOf(cur());
    if (e.kind === 'web' || e.kind === 'reader') os.device.openUrl(e.url);
    else if (e.kind === 'search') os.device.openUrl('https://www.bing.com/search?q=' + encodeURIComponent(e.q));
  }

  /* --- suggestions while typing */
  let suggTok = 0;
  const suggestRemote = debounce(async (q, tok) => {
    try {
      const list = await os.net.suggest(q);
      if (tok !== suggTok || document.activeElement !== input) return;
      const box = sugg.querySelector('.ie-sugg-remote');
      box?.replaceChildren(...(list || []).slice(0, 8).map((s) => suggItem(Search, s, null, () => go(s))));
    } catch {}
  }, 180);
  function suggItem(icon, main, sub, onClick) {
    return el('div.ie-sugg-item.tilt', { onclick: () => { input.blur(); onClick(); } }, ico(icon, 18), el('div.ie-sugg-text', el('div.ie-sugg-main', main), sub ? el('div.ie-sugg-sub', sub) : null));
  }
  function renderSugg() {
    const q = input.value.trim().toLowerCase();
    const tok = ++suggTok;
    sugg.replaceChildren();
    const local = [];
    const seen = new Set();
    const pool = [...favorites.map((f) => ({ ...f, fav: true })), ...history];
    for (const h of pool) {
      if (seen.has(h.url)) continue;
      if (q && !(h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q))) continue;
      seen.add(h.url); local.push(h);
      if (local.length >= (q ? 3 : 6)) break;
    }
    const pi = parseInput(input.value);
    if (pi && pi.kind === 'web') sugg.append(suggItem(ArrowRight, 'go to ' + hostOf(pi.url), pi.url, () => go(input.value)));
    if (local.length) {
      sugg.append(el('div.ie-sugg-head', q ? 'from your history and favorites' : 'recent'));
      for (const h of local) sugg.append(suggItem(h.fav ? Star : Clock, h.title || hostOf(h.url), h.url, () => navigate(cur(), { kind: 'web', url: h.url, title: h.title })));
    }
    if (q && settings.suggestions) {
      sugg.append(el('div.ie-sugg-head', 'search suggestions'), el('div.ie-sugg-remote'));
      suggestRemote(q, tok);
    }
    if (!q && !local.length) sugg.append(el('div.ie-sugg-empty', 'Type a web address, or search with Bing.'));
  }
  input.addEventListener('focus', () => {
    closeMenu();
    const e = entryOf(cur());
    input.value = displayText(e, true);
    requestAnimationFrame(() => input.select());
    sugg.hidden = false;
    form.classList.add('focus');
    renderSugg();
  });
  input.addEventListener('input', renderSugg);
  input.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== input) { sugg.hidden = true; form.classList.remove('focus'); updateBar(); } }, 120); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });

  /* ------------------------------------------------------------ menu */
  function menuItems() {
    const t = cur(), e = entryOf(t);
    const page = e.kind === 'web' || e.kind === 'reader';
    const mode = e.mode || settings.mode;
    return [
      t.idx < t.entries.length - 1 && { label: 'forward', onClick: () => { t.idx++; render(t); persist(); } },
      { label: 'tabs', onClick: openTabs },
      { label: 'recent', onClick: () => ctx.navigate(hubPage, { index: 1 }) },
      { label: 'favorites', onClick: () => ctx.navigate(hubPage, { index: 0 }) },
      page && { label: isFav(e.url) ? 'remove from favorites' : 'add to favorites', onClick: () => toggleFav(e.url, e.title) },
      (page || e.kind === 'search') && { label: 'share page', onClick: () => sharePage() },
      (page || e.kind === 'search') && { label: 'pin to start', onClick: () => (e.kind === 'search' ? pinSearch(e.q) : pinUrl(e.url, e.title)) },
      e.kind === 'web' && { label: 'reading view', onClick: () => navigate(t, { kind: 'reader', url: e.url, title: e.title }) },
      e.kind === 'reader' && { label: 'exit reading view', onClick: () => exitReader(t) },
      e.kind === 'web' && { label: mode === 'direct' ? 'load through proxy' : 'load directly (no proxy)', onClick: () => { e.mode = mode === 'direct' ? 'proxy' : 'direct'; render(t); persist(); } },
      page && { label: 'copy link', onClick: () => copy(e.url) },
      page && { label: 'open in real browser', onClick: () => os.device.openUrl(e.url) },
      { label: 'new tab', onClick: () => newTab() },
      { label: 'settings', onClick: () => ctx.navigate(settingsPage) },
    ].filter(Boolean);
  }
  function toggleMenu(force) {
    const open = force ?? menu.hidden;
    if (open) {
      menu.replaceChildren(...menuItems().map((m) => el('div.ie-menuitem.tilt', { onclick: (ev) => { ev.stopPropagation(); closeMenu(); m.onClick(); } }, m.label)));
      menu.hidden = false;
      view.classList.add('menu-open');
    } else closeMenu();
  }
  function closeMenu() { menu.hidden = true; view.classList.remove('menu-open'); }
  const outside = (e) => { if (!menu.hidden && !menu.contains(e.target) && !dotsBtn.contains(e.target)) closeMenu(); };
  document.addEventListener('pointerdown', outside, true);

  /* ------------------------------------------------------------ favorites / history / share / pin */
  const isFav = (url) => favorites.some((f) => f.url === url);
  function toggleFav(url, title) {
    if (isFav(url)) { favorites = favorites.filter((f) => f.url !== url); os.toast('Removed from favorites'); }
    else { favorites.unshift({ url, title: title || hostOf(url), t: Date.now() }); os.toast('Added to favorites'); }
    saveFavs();
  }
  function addHistory(url, title) {
    if (!url) return;
    if (history[0]?.url === url) { history[0].t = Date.now(); if (title) history[0].title = title; }
    else history.unshift({ url, title: title || '', t: Date.now() });
    if (history.length > 400) history.length = 400;
    saveHistory();
  }
  async function copy(text) { try { await os.device.copy(text); os.toast('Link copied'); } catch { os.ui.alert(text, 'Copy this link'); } }
  function sharePage() {
    const e = entryOf(cur());
    if (e.kind === 'search') return os.share({ title: e.q, url: 'https://www.bing.com/search?q=' + encodeURIComponent(e.q) });
    os.share({ url: e.url, title: e.title || hostOf(e.url) });
  }
  async function pinUrl(url, title) {
    const key = 'ie:' + url;
    if (os.tiles.isPinned('ie', key)) return os.toast('Already pinned to Start');
    await ctx.pinTile({ key, title: title || hostOf(url), args: { url }, size: 'medium', icon: favicon(url, 128) });
    os.toast('Pinned to Start');
  }
  async function pinSearch(q) {
    const key = 'ie:search:' + q.toLowerCase();
    if (os.tiles.isPinned('ie', key)) return os.toast('Already pinned to Start');
    await ctx.pinTile({ key, title: q, args: { q }, size: 'medium' });
    os.toast('Pinned to Start');
  }

  /* ------------------------------------------------------------ sub pages */
  function openTabs() { closeMenu(); ctx.navigate(tabsPage); }

  function tabsPage(page) {
    const p = os.ui.page({ app: 'INTERNET EXPLORER', title: 'tabs' });
    const grid = el('div.ie-tabgrid');
    const draw = () => {
      grid.replaceChildren(...tabs.map((t) => {
        const e = entryOf(t);
        const thumb = el('div.ie-tabthumb');
        if (e.kind === 'start') { thumb.classList.add('start'); if (bingUrl) thumb.style.backgroundImage = `url("${bingUrl}")`; }
        else if (e.kind === 'search') thumb.append(ico(Search, 40, 1.5), el('div.ie-tabthumb-host', 'bing'));
        else if (e.kind === 'file') thumb.append(ico(I.doc, 40, 1.5));
        else thumb.append(el('img', { src: favicon(e.url, 64), alt: '', referrerpolicy: 'no-referrer', onerror: function () { this.replaceWith(ico(Globe, 40, 1.5)); } }), el('div.ie-tabthumb-host', hostOf(e.url)));
        if (e.kind === 'reader') thumb.append(el('div.ie-tabthumb-badge', ico(BookOpen, 14)));
        const title = e.kind === 'start' ? 'new tab' : e.title || displayText(e, false);
        const card = el('div.ie-tabcard.tilt' + (t.id === curId ? '.current' : ''),
          thumb, el('div.ie-tabtitle', title),
          el('button.ie-tabclose', { 'aria-label': 'close tab', onclick: (ev) => { ev.stopPropagation(); closeTab(t); draw(); syncBar(); } }, ico(X, 16, 2.5)));
        card.addEventListener('click', () => { switchTab(t); page.close(); });
        return card;
      }));
    };
    const bar = os.ui.appBar({ menu: [{ label: 'close all tabs', onClick: () => { [...tabs].forEach((t) => closeTab(t)); draw(); syncBar(); } }] });
    const syncBar = () => bar.setButtons([{ icon: I.add, label: 'new', disabled: tabs.length >= MAX_TABS, onClick: () => { newTab(); page.close(); } }]);
    draw(); syncBar();
    p.content.append(grid, el('div.wp-desc', `Up to ${MAX_TABS} tabs. Tabs are kept when you close Internet Explorer.`));
    page.el.append(p.el, bar.el);
  }

  function siteRow(item, sub) {
    return el('div.ie-row',
      el('div.ie-row-icon', el('img', { src: favicon(item.url, 64), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: function () { this.replaceWith(ico(Globe, 22)); } })),
      el('div.ie-row-text', el('div.ie-row-title', item.title || hostOf(item.url)), el('div.ie-row-sub', sub || item.url)));
  }
  const openFromList = (page, item) => { page.close(); navigate(cur(), { kind: 'web', url: item.url, title: item.title }); };

  function hubPage(page) {
    let favC, recC;
    const drawFavs = () => {
      favC.replaceChildren(os.ui.list(favorites, {
        empty: 'You haven’t added any favorites yet. Tap ••• and then “add to favorites” on any page.',
        render: (f) => siteRow(f),
        onClick: (f) => openFromList(page, f),
        onHold: (f, row) => os.ui.contextMenu(row, [
          { label: 'open in new tab', onClick: () => { page.close(); newTab({ kind: 'web', url: f.url, title: f.title }); } },
          { label: 'edit', onClick: async () => { const n = await os.ui.prompt('Name', f.title, 'edit favorite'); if (n != null && n.trim()) { f.title = n.trim(); saveFavs(); drawFavs(); } } },
          { label: 'pin to start', onClick: () => pinUrl(f.url, f.title) },
          { label: 'share', onClick: () => os.share({ url: f.url, title: f.title }) },
          { label: 'delete', onClick: () => { favorites = favorites.filter((x) => x !== f); saveFavs(); drawFavs(); } },
        ]),
      }));
    };
    const dayLabel = (ts) => {
      const d = new Date(ts), now = new Date();
      const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
      return days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? d.toLocaleDateString([], { weekday: 'long' }).toLowerCase() : d.toLocaleDateString([], { month: 'long', day: 'numeric' }).toLowerCase();
    };
    const drawRecent = () => {
      recC.replaceChildren();
      if (!history.length) { recC.append(os.ui.empty('Pages you visit will show up here.')); return; }
      let last = '';
      for (const h of history.slice(0, 200)) {
        const L = dayLabel(h.t);
        if (L !== last) { recC.append(os.ui.header(L)); last = L; }
        const row = siteRow(h, `${hostOf(h.url)} · ${os.util.formatTime(new Date(h.t))}`);
        row.classList.add('tilt', 'wp-list-item');
        row.addEventListener('click', () => openFromList(page, h));
        onLongPress(row, () => os.ui.contextMenu(row, [
          { label: 'open in new tab', onClick: () => { page.close(); newTab({ kind: 'web', url: h.url, title: h.title }); } },
          { label: isFav(h.url) ? 'remove from favorites' : 'add to favorites', onClick: () => toggleFav(h.url, h.title) },
          { label: 'copy link', onClick: () => copy(h.url) },
          { label: 'delete', onClick: () => { history = history.filter((x) => x !== h); saveHistory(); drawRecent(); } },
        ]));
        recC.append(row);
      }
    };
    const bar = os.ui.appBar({});
    const setBar = (i) => {
      if (i === 0) {
        const e = entryOf(cur());
        const can = (e.kind === 'web' || e.kind === 'reader') && !isFav(e.url);
        bar.setButtons([{ icon: I.add, label: 'add', disabled: !can, onClick: () => { toggleFav(e.url, e.title); drawFavs(); setBar(0); } }]);
        bar.setMenu([]);
      } else {
        bar.setButtons([{ icon: I.delete, label: 'clear', disabled: !history.length, onClick: async () => {
          if (await os.ui.confirm('Delete your browsing history? Frequent sites will be reset too.', 'delete history', 'delete', 'cancel')) { history = []; saveHistory(); drawRecent(); setBar(1); }
        } }]);
        bar.setMenu([]);
      }
    };
    const pv = os.ui.pivot({
      app: 'INTERNET EXPLORER', index: page.params.index || 0,
      items: [
        { header: 'favorites', render: (c) => { favC = c; drawFavs(); } },
        { header: 'recent', render: (c) => { recC = c; drawRecent(); } },
      ],
      onChange: (i) => setBar(i),
    });
    setBar(pv.index);
    page.el.append(pv.el, bar.el);
  }

  function settingsPage(page) {
    const p = os.ui.page({ app: 'INTERNET EXPLORER', title: 'settings' });
    p.content.append(
      os.ui.listPicker({
        label: 'Load web pages', value: settings.mode,
        options: [{ value: 'proxy', label: 'through proxy (works with most sites)' }, { value: 'direct', label: 'directly (faster, some sites refuse)' }],
        onChange: (v) => { settings.mode = v; saveSettings(); },
      }),
      os.ui.desc('Many sites don’t allow themselves to be shown inside another page. Proxy mode loads them through the simulator’s server in an isolated sandbox. Logins and some interactive sites may still not work — use “open in real browser” for those.'),
      os.ui.toggle({ label: 'Search suggestions', value: settings.suggestions, description: 'Show Bing suggestions while you type in the address bar.', onChange: (v) => { settings.suggestions = v; saveSettings(); } }).el,
      os.ui.toggle({ label: 'Open links from other apps in a new tab', value: settings.newTabForLinks, onChange: (v) => { settings.newTabForLinks = v; saveSettings(); } }).el,
      os.ui.header('privacy'),
      os.ui.button('delete history', async () => {
        if (await os.ui.confirm('Delete your browsing history?', 'delete history', 'delete', 'cancel')) { history = []; saveHistory(); os.toast('History deleted'); }
      }),
      os.ui.button('reset frequent sites', () => { settings.hiddenFrequent = []; saveSettings(); os.toast('Frequent sites reset'); }),
      os.ui.header('about'),
      os.ui.desc(`Internet Explorer Mobile 11\nWindows Phone ${os.version}\nSearch results provided by DuckDuckGo, styled as Bing.`),
    );
    page.el.append(p.el);
  }

  /* ------------------------------------------------------------ boot */
  if (Array.isArray(savedTabs) && savedTabs.length) for (const d of savedTabs.slice(0, MAX_TABS)) makeTab(d);
  else makeTab();
  if (!tabs.some((t) => t.id === curId)) curId = tabs[tabs.length - 1].id;

  function handleArgs(a = {}) {
    const share = a.share || {};
    const fromText = (share.text || '').match(/https?:\/\/\S+/)?.[0];
    const url = a.url || share.url || fromText;
    if (a.file || share.path) openEntry({ kind: 'file', path: a.file || share.path });
    else if (url && isHttp(url)) openEntry({ kind: 'web', url, title: share.title });
    else if (a.q || share.text) openEntry({ kind: 'search', q: a.q || share.text });
    else return false;
    return true;
  }

  ctx.navigate(() => ({
    el: view,
    onShow: () => { const t = cur(); if (t && t.rendered && entryOf(t).kind === 'start') render(t); else updateBar(); },
    onBack: () => {
      if (!menu.hidden) { closeMenu(); return true; }
      if (document.activeElement === input) { input.blur(); return true; }
      const t = cur();
      if (t.idx > 0) { t.idx--; render(t); persist(); return true; }
      return false;
    },
  }));
  switchTab(cur());
  handleArgs(ctx.args);
  ctx.on('args', async (a) => { for (let i = 0; i < 6 && ctx.pageCount > 1; i++) await ctx.back(); handleArgs(a); });

  return {
    onSuspend: () => { closeMenu(); input.blur(); },
    onDestroy: () => document.removeEventListener('pointerdown', outside, true),
  };
}
