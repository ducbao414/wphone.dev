import './style.css';
import { ArrowLeftRight, ExternalLink, Delete } from 'lucide';

const DEFAULT = ['^GSPC', '^DJI', '^IXIC', 'MSFT', 'AAPL', 'NOK'];
const NAMES = { '^GSPC': 'S&P 500', '^DJI': 'Dow Jones', '^IXIC': 'Nasdaq', '^FTSE': 'FTSE 100', '^N225': 'Nikkei 225', '^GDAXI': 'DAX' };
const curName = (() => { try { const dn = new Intl.DisplayNames(['en'], { type: 'currency' }); return (c) => { try { return dn.of(c); } catch { return c; } }; } catch { return (c) => c; } })();

export function sparkline(points, { w = 100, h = 32, color = 'currentColor', fill = false, base } = {}) {
  if (!points || points.length < 2) return '';
  const min = Math.min(...points, base ?? Infinity), max = Math.max(...points, base ?? -Infinity);
  const sx = (i) => (i / (points.length - 1)) * w, sy = (v) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const area = fill ? `<path d="${d}L${w},${h}L0,${h}Z" fill="${color}" opacity=".18"/>` : '';
  const bl = base != null ? `<line x1="0" x2="${w}" y1="${sy(base)}" y2="${sy(base)}" stroke="currentColor" stroke-dasharray="2 3" opacity=".4" vector-effect="non-scaling-stroke"/>` : '';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="100%">${bl}${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

const fmtNum = (v, d = 2) => (v == null || !isFinite(v) ? '--' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
const UP = '#3dbb3d', DOWN = '#e5413a';

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, appBar, I, iconSVG } = os.ui;

  let symbols = await storage.get('symbols', DEFAULT);
  let quotes = await storage.get('quotes', {}); // symbol -> quote (last good)
  let quotesAt = await storage.get('quotesAt', 0);

  let pv, bar, watchEl, statusEl, convEl, newsEl;

  await ctx.navigate((page) => {
    pv = os.ui.pivot({
      app: 'MSN MONEY',
      items: [
        { header: 'watchlist', render: (c) => { statusEl = el('div.money-status'); watchEl = el('div'); c.append(statusEl, watchEl); renderWatch(); refreshQuotes(); } },
        { header: 'currency', render: (c) => { convEl = c; renderConverter(c); } },
        { header: 'news', render: (c) => { newsEl = c; loadNews(); } },
      ],
      onChange: () => updateBar(),
    });
    bar = appBar({});
    page.el.append(pv.el, bar.el);
    updateBar();
  });

  function updateBar() {
    const i = pv?.index ?? 0;
    if (!bar) return;
    if (i === 0) {
      bar.setButtons([
        { icon: I.add, label: 'add', onClick: addSymbol },
        { icon: I.refresh, label: 'refresh', onClick: () => refreshQuotes(true) },
      ]);
      bar.setMenu([{ label: 'reset watchlist', onClick: async () => { symbols = [...DEFAULT]; await storage.set('symbols', symbols); renderWatch(); refreshQuotes(true); } }]);
    } else if (i === 1) {
      bar.setButtons([{ icon: ArrowLeftRight, label: 'swap', onClick: () => convApi?.swap() }, { icon: I.refresh, label: 'refresh', onClick: () => convApi?.refresh(true) }]);
      bar.setMenu([]);
    } else {
      bar.setButtons([{ icon: I.refresh, label: 'refresh', onClick: () => loadNews(true) }]);
      bar.setMenu([]);
    }
  }

  /* --------------------------------------------------------- watchlist */

  async function refreshQuotes() {
    if (!statusEl) return;
    statusEl.replaceChildren(os.ui.loadingDots({ inline: true }));
    try {
      const r = await os.net.quotes(symbols);
      let ok = 0;
      for (const q of r) if (!q.error && q.price != null) { quotes[q.symbol] = q; ok++; }
      if (ok) { quotesAt = Date.now(); storage.set('quotes', quotes); storage.set('quotesAt', quotesAt); }
      statusEl.replaceChildren();
      if (!ok && symbols.length) statusEl.append(el('div.money-note', 'Quotes are temporarily unavailable from the market data provider.' + (quotesAt ? ` Showing prices from ${new Date(quotesAt).toLocaleString()}.` : ' Try again in a few minutes.')));
      else if (ok < symbols.length) statusEl.append(el('div.money-note', 'Some symbols couldn’t be updated.'));
      else statusEl.append(el('div.money-updated', `Updated ${os.util.formatTime(new Date(quotesAt))}`));
    } catch {
      statusEl.replaceChildren(el('div.money-note', (navigator.onLine ? 'Couldn’t reach the market data service.' : 'You’re offline.') + (quotesAt ? ` Showing prices from ${new Date(quotesAt).toLocaleString()}.` : '')));
    }
    renderWatch();
    pushTile();
  }

  function pushTile() {
    os.tiles.refresh('money');
  }

  function renderWatch() {
    if (!watchEl) return;
    watchEl.replaceChildren(os.ui.list(symbols, {
      empty: 'your watchlist is empty — tap add to track a stock',
      render: (s) => {
        const q = quotes[s];
        const up = (q?.change ?? 0) >= 0;
        return el('div.money-row',
          el('div.money-row-text',
            el('div.money-sym', NAMES[s] || s),
            el('div.money-name', q?.name && q.name !== s ? (NAMES[s] ? s : q.name) : s)),
          el('div.money-spark', { style: { color: up ? UP : DOWN }, html: q?.points ? sparkline(q.points, { color: up ? UP : DOWN, base: q.previousClose }) : '' }),
          el('div.money-vals',
            el('div.money-price', q ? fmtNum(q.price) : '--'),
            el('div.money-chg' + (q ? (up ? '.up' : '.down') : ''), q ? `${sign(q.change)}${fmtNum(Math.abs(q.change))} (${sign(q.change)}${fmtNum(Math.abs(q.changePercent))}%)` : '')));
      },
      onClick: (s) => ctx.navigate(detailPage, { symbol: s }),
      onHold: (s, row) => os.ui.contextMenu(row, [
        { label: 'remove', onClick: () => removeSymbol(s) },
        { label: 'move to top', onClick: async () => { symbols = [s, ...symbols.filter((x) => x !== s)]; await storage.set('symbols', symbols); renderWatch(); } },
      ]),
    }));
  }

  async function addSymbol() {
    const v = await os.ui.prompt('Enter a ticker symbol, e.g. GOOG, TSLA, ^FTSE, EURUSD=X, BTC-USD', '', 'add to watchlist', { placeholder: 'symbol' });
    const s = (v || '').trim().toUpperCase();
    if (!s) return;
    if (!/^[\^A-Z0-9.=\-]{1,15}$/.test(s)) { os.ui.alert('That doesn’t look like a ticker symbol.'); return; }
    if (symbols.includes(s)) { os.toast(`${s} is already in your watchlist`); return; }
    symbols = [...symbols, s];
    await storage.set('symbols', symbols);
    renderWatch();
    refreshQuotes();
  }
  async function removeSymbol(s) {
    symbols = symbols.filter((x) => x !== s);
    await storage.set('symbols', symbols);
    renderWatch();
  }

  function detailPage(page) {
    const s = page.params.symbol;
    const q = quotes[s];
    const p = os.ui.page({ app: 'MSN MONEY', title: (NAMES[s] || s).toLowerCase() });
    const up = (q?.change ?? 0) >= 0;
    if (!q) p.content.append(os.ui.empty('No price data yet for ' + s + '.'));
    else {
      p.content.append(
        el('div.money-dname', q.name || s),
        el('div.money-dprice', fmtNum(q.price), el('span.money-dcur', q.currency || '')),
        el('div.money-chg.big' + (up ? '.up' : '.down'), `${sign(q.change)}${fmtNum(Math.abs(q.change))}  (${sign(q.change)}${fmtNum(Math.abs(q.changePercent))}%)`),
        el('div.money-dchart', { style: { color: up ? UP : DOWN }, html: sparkline(q.points, { w: 300, h: 140, color: up ? UP : DOWN, fill: true, base: q.previousClose }) }),
        el('div.money-dlabel', 'today (15 min intervals)'),
        el('div.money-stats',
          stat('previous close', fmtNum(q.previousClose)),
          stat('day high', q.points?.length ? fmtNum(Math.max(...q.points)) : '--'),
          stat('day low', q.points?.length ? fmtNum(Math.min(...q.points)) : '--'),
          stat('symbol', s)),
        el('div.money-dlabel', quotesAt ? `as of ${new Date(quotesAt).toLocaleString()}` : ''),
      );
    }
    const b = appBar({
      buttons: [
        { icon: I.delete, label: 'remove', onClick: async () => { await removeSymbol(s); page.close(); } },
        { icon: I.search, label: 'web', onClick: () => os.launch('ie', { url: `https://finance.yahoo.com/quote/${encodeURIComponent(s)}` }) },
      ],
    });
    page.el.append(p.el, b.el);
  }
  const stat = (k, v) => el('div.money-stat', el('div.money-stat-k', k), el('div.money-stat-v', v));

  /* --------------------------------------------------------- converter */

  let convApi = null;
  async function renderConverter(c) {
    let conv = await storage.get('conv', { from: 'USD', to: 'EUR', amount: '1' });
    let rates = await storage.get('rates:' + conv.from, null);
    const fromSel = el('button.money-cur.tilt'), toSel = el('button.money-cur.tilt');
    const amountEl = el('div.money-amount'), resultEl = el('div.money-result'), rateEl = el('div.money-rate');
    const save = () => storage.set('conv', conv);
    const draw = () => {
      fromSel.replaceChildren(el('b', conv.from), el('span', curName(conv.from)));
      toSel.replaceChildren(el('b', conv.to), el('span', curName(conv.to)));
      const a = parseFloat(conv.amount || '0') || 0;
      const [ip, dp] = (conv.amount || '0').split('.');
      amountEl.textContent = Number(ip).toLocaleString('en-US') + (dp !== undefined ? '.' + dp : '');
      const r = rates?.rates?.[conv.to];
      resultEl.textContent = r ? fmtNum(a * r, a * r >= 100 ? 2 : 4) : '--';
      rateEl.textContent = r ? `1 ${conv.from} = ${fmtNum(r, 4)} ${conv.to}${rates.date ? ' · ' + new Date(rates.date).toLocaleDateString() : ''}` : (navigator.onLine ? 'loading rates…' : 'rates unavailable offline');
    };
    const refresh = async () => {
      try {
        const r = await os.net.rates(conv.from);
        if (r?.rates) { rates = r; storage.set('rates:' + conv.from, r); }
      } catch { if (!rates) rateEl.textContent = 'Couldn’t load exchange rates.'; }
      draw();
    };
    const pick = async (which) => {
      const codes = Object.keys(rates?.rates || { USD: 1, EUR: 1, GBP: 1, JPY: 1, VND: 1, CNY: 1, AUD: 1, CAD: 1, CHF: 1, INR: 1 }).sort();
      const pop = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'VND', 'AUD', 'CAD', 'CHF', 'INR'];
      const ordered = [...pop.filter((x) => codes.includes(x)), ...codes.filter((x) => !pop.includes(x))];
      const v = await os.ui.pickFromList({ title: 'currency', options: ordered.map((x) => ({ value: x, label: `${x} – ${curName(x)}` })), value: conv[which] });
      if (!v) return;
      conv[which] = v; save();
      if (which === 'from') { rates = await storage.get('rates:' + v, null); draw(); refresh(); } else draw();
    };
    fromSel.onclick = () => pick('from');
    toSel.onclick = () => pick('to');
    const press = (k) => {
      os.sounds.key();
      let a = conv.amount || '0';
      if (k === '⌫') a = a.length > 1 ? a.slice(0, -1) : '0';
      else if (k === 'C') a = '0';
      else if (k === '.') { if (!a.includes('.')) a += '.'; }
      else if (a.replace('.', '').length < 12) a = a === '0' ? k : a + k;
      conv.amount = a; save(); draw();
    };
    const keys = el('div.money-keys', ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map((k) =>
      el('button.money-key', { onclick: () => press(k), oncontextmenu: (e) => { e.preventDefault(); if (k === '⌫') press('C'); } }, k === '⌫' ? el('span', { html: iconSVG(Delete, { size: 24 }) }) : k)));
    c.append(
      el('div.money-convrow', fromSel, amountEl),
      el('button.money-swap.tilt', { onclick: () => convApi.swap(), html: iconSVG(ArrowLeftRight, { size: 18 }) }),
      el('div.money-convrow', toSel, resultEl),
      rateEl, keys);
    convApi = {
      swap: () => { [conv.from, conv.to] = [conv.to, conv.from]; save(); storage.get('rates:' + conv.from, null).then((r) => { rates = r; draw(); refresh(); }); },
      refresh,
    };
    draw();
    refresh();
  }

  /* --------------------------------------------------------- news */

  async function loadNews(force) {
    if (!newsEl) return;
    const cached = await storage.get('news', null);
    const draw = (feed) => {
      newsEl.replaceChildren(os.ui.list(feed.items.slice(0, 30), {
        empty: 'no stories right now',
        render: (it) => el('div.money-news',
          it.image ? el('div.money-news-img', { style: { backgroundImage: `url("${it.image}")` } }) : null,
          el('div.money-news-text', el('div.money-news-title', it.title), el('div.money-news-sub', [it.source, it.date ? os.util.formatRelative(new Date(it.date).getTime()) : ''].filter(Boolean).join(' · ')))),
        onClick: (it) => ctx.navigate(readerPage, { item: it }),
      }));
    };
    if (cached && !force) draw(cached); else newsEl.replaceChildren(os.ui.loadingDots({ inline: true }));
    try {
      const f = await os.net.news('business');
      storage.set('news', f);
      draw(f);
    } catch {
      if (!cached) newsEl.replaceChildren(os.ui.empty(navigator.onLine ? 'Couldn’t load business news.' : 'You’re offline. Connect to get the latest news.'));
    }
  }

  function readerPage(page) {
    const it = page.params.item;
    const p = os.ui.page({ app: 'MSN MONEY', cls: 'money-reader' });
    const body = el('div.money-article');
    p.content.append(
      it.image ? el('img.money-hero', { src: it.image.replace('/standard/240/', '/standard/800/'), alt: '', onerror: (e) => e.target.remove() }) : null,
      el('h1.money-atitle', it.title),
      el('div.money-ameta', [it.source, it.date ? new Date(it.date).toLocaleString() : ''].filter(Boolean).join(' · ')),
      body);
    body.append(os.ui.loadingDots({ inline: true }));
    os.net.readable(it.link).then((r) => {
      body.replaceChildren();
      const blocks = (r.blocks || []).filter((b) => b.text && !/^Published\s*\d/.test(b.text));
      if (!blocks.length) throw new Error('empty');
      for (const b of blocks) {
        const tag = { h2: 'h2', h3: 'h3', li: 'li', blockquote: 'blockquote' }[b.type] || 'p';
        body.append(el(tag + '.money-b-' + tag, b.text));
      }
    }).catch(() => {
      body.replaceChildren(el('p', it.description || ''), os.ui.button('read full story in browser', () => os.launch('ie', { url: it.link })));
    });
    const b = appBar({
      buttons: [
        { icon: ExternalLink, label: 'browser', onClick: () => os.launch('ie', { url: it.link }) },
        { icon: I.share, label: 'share', onClick: () => os.share({ title: it.title, url: it.link }) },
      ],
    });
    page.el.append(p.el, b.el);
  }

  return {
    onResume: () => { if (Date.now() - quotesAt > 5 * 60e3) refreshQuotes(); },
  };
}
