import './style.css';
import { makeReader, bigImage, timeAgo } from './reader.js';

const FEEDS = [['sports', 'headlines'], ['football', 'football'], ['tennis', 'tennis'], ['f1', 'formula 1']];
const LEAGUES = [
  ['soccer/eng.1', 'Premier League'], ['soccer/esp.1', 'La Liga'], ['soccer/ita.1', 'Serie A'], ['soccer/ger.1', 'Bundesliga'],
  ['soccer/fra.1', 'Ligue 1'], ['soccer/uefa.champions', 'Champions League'], ['basketball/nba', 'NBA'], ['football/nfl', 'NFL'],
  ['baseball/mlb', 'MLB'], ['hockey/nhl', 'NHL'],
];

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, appBar, I } = os.ui;
  const readerPage = makeReader({ app: 'MSN SPORTS', storage, prefix: 'sports' });
  let league = await storage.get('league', 'soccer/eng.1');
  let pv, bar;
  const reloaders = new Map();
  let savedRender = null;
  const openItem = (it) => ctx.navigate(readerPage, { item: it, onSavedChange: () => savedRender?.() });

  const items = [
    { header: 'scores', render: (c) => { const r = (f) => renderScores(c, f); reloaders.set(0, r); r(); } },
    ...FEEDS.map(([id, label], i) => ({ header: label, render: (c) => { const r = (f) => loadFeed(c, id, f); reloaders.set(i + 1, r); r(); } })),
    { header: 'saved', render: (c) => { savedRender = () => renderSaved(c); savedRender(); } },
  ];

  await ctx.navigate((page) => {
    pv = os.ui.pivot({ app: 'MSN SPORTS', items, index: 1, onChange: () => updateBar() });
    bar = appBar({});
    page.el.append(pv.el, bar.el);
    updateBar();
  });

  function updateBar() {
    if (!bar || !pv) return;
    const btns = [{ icon: I.refresh, label: 'refresh', onClick: () => reloaders.get(pv.index)?.(true) }];
    if (pv.index === 0) btns.push({ icon: I.filter, label: 'league', onClick: chooseLeague });
    bar.setButtons(btns);
    bar.setMenu(pv.index === 0 ? LEAGUES.map(([id, n]) => ({ label: (id === league ? '• ' : '') + n, onClick: () => setLeague(id) })) : []);
  }
  async function chooseLeague() {
    const v = await os.ui.pickFromList({ title: 'league', options: LEAGUES.map(([value, label]) => ({ value, label })), value: league });
    if (v) setLeague(v);
  }
  function setLeague(id) {
    league = id; storage.set('league', id);
    reloaders.get(0)?.(true);
    updateBar();
  }

  /* ------------------------------------------------------------ scores (ESPN public scoreboard, CORS-enabled) */

  async function renderScores(c) {
    const name = LEAGUES.find(([id]) => id === league)?.[1] || league;
    const head = el('div.sports-league.tilt', { onclick: chooseLeague }, name.toLowerCase(), el('span', ' ▾'));
    const body = el('div');
    c.replaceChildren(head, body);
    const key = 'scores:' + league;
    const cached = await storage.get(key, null);
    if (cached) drawEvents(body, cached);
    else body.append(os.ui.loadingDots({ inline: true }));
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const events = (d.events || []).map((e) => {
        const comp = e.competitions?.[0] || {};
        const team = (ha) => {
          const t = (comp.competitors || []).find((x) => x.homeAway === ha) || {};
          return { name: t.team?.shortDisplayName || t.team?.displayName || '?', logo: t.team?.logo || '', score: t.score ?? '', winner: !!t.winner, record: t.records?.[0]?.summary || '' };
        };
        return { id: e.id, date: e.date, state: e.status?.type?.state, detail: e.status?.type?.shortDetail || '', home: team('home'), away: team('away'), venue: comp.venue?.fullName || '', link: e.links?.[0]?.href || '' };
      });
      const data = { events, t: Date.now(), season: d.leagues?.[0]?.season?.displayName || '' };
      storage.set(key, data);
      if (league === key.slice(7)) drawEvents(body, data);
    } catch {
      if (!cached) body.replaceChildren(el('div.sports-msg', navigator.onLine ? 'Scores aren’t available right now.' : 'You’re offline. Connect to see the latest scores.'));
      else body.prepend(el('div.sports-msg', 'Couldn’t refresh scores. Showing earlier results.'));
    }
  }

  function drawEvents(body, data) {
    if (!data.events.length) { body.replaceChildren(el('div.wp-empty', 'no games scheduled this week')); return; }
    const groups = new Map();
    for (const e of [...data.events].sort((a, b) => new Date(a.date) - new Date(b.date))) {
      const d = new Date(e.date);
      const k = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const nodes = [];
    for (const [k, list] of groups) {
      nodes.push(os.ui.header(k.toLowerCase()));
      for (const e of list) {
        const pre = e.state === 'pre';
        const status = pre ? os.util.formatTime(new Date(e.date)) : e.detail;
        const side = (t) => el('div.sports-team' + (e.state === 'post' && t.winner ? '.win' : ''),
          t.logo ? el('img.sports-logo', { src: t.logo, alt: '', loading: 'lazy', onerror: (ev) => (ev.target.style.visibility = 'hidden') }) : el('span.sports-logo'),
          el('span.sports-tname', t.name),
          el('span.sports-score', pre ? '' : String(t.score)));
        const row = el('div.sports-game.tilt' + (e.state === 'in' ? '.live' : ''),
          el('div.sports-teams', side(e.away), side(e.home)),
          el('div.sports-status', e.state === 'in' ? el('b', 'LIVE') : '', el('div', status), e.venue ? el('div.sports-venue', e.venue) : ''));
        if (e.link) row.addEventListener('click', () => os.launch('ie', { url: e.link }));
        nodes.push(row);
      }
    }
    nodes.push(el('div.sports-src', `Scores from ESPN · updated ${os.util.formatTime(new Date(data.t))}`));
    body.replaceChildren(...nodes);
  }

  /* ------------------------------------------------------------ headlines */

  async function loadFeed(c, id, force) {
    const key = 'feed:' + id;
    const cached = await storage.get(key, null);
    if (cached?.items?.length) renderFeed(c, cached);
    if (!cached || force) c.prepend(el('div.sports-loading', os.ui.loadingDots()));
    try {
      const feed = await os.net.news(id);
      if (!feed?.items?.length) throw new Error('empty');
      storage.set(key, { title: feed.title, items: feed.items.slice(0, 40) });
      renderFeed(c, feed);
    } catch {
      c.querySelector('.sports-loading')?.remove();
      if (cached?.items?.length) c.prepend(el('div.sports-msg', 'Couldn’t refresh. Showing stories from earlier.'));
      else c.replaceChildren(el('div.sports-msg', navigator.onLine ? 'We couldn’t get the latest stories.' : 'You’re offline. Connect to get the latest sports news.'), os.ui.button('try again', () => loadFeed(c, id, true)));
    }
  }

  function renderFeed(c, feed) {
    const items = feed.items.filter((x) => x.title);
    const hi = items.findIndex((x) => x.image);
    const hero = hi >= 0 ? items[hi] : null;
    const rest = items.filter((_, i) => i !== hi);
    c.replaceChildren(
      hero ? el('div.sports-hero.tilt', { onclick: () => openItem(hero) },
        el('div.sports-hero-img', { style: { backgroundImage: `url("${bigImage(hero.image)}"), url("${hero.image}")` } }),
        el('div.sports-hero-text', el('div.sports-hero-title', hero.title), el('div.sports-hero-meta', [hero.source, timeAgo(os, hero.date)].filter(Boolean).join(' · ')))) : '',
      os.ui.list(rest, {
        render: (it) => el('div.sports-item',
          el('div.sports-item-text', el('div.sports-item-title', it.title), el('div.sports-item-meta', [it.source, timeAgo(os, it.date)].filter(Boolean).join(' · '))),
          it.image ? el('div.sports-thumb', { style: { backgroundImage: `url("${it.image}")` } }) : null),
        onClick: openItem,
        onHold: (it, row) => os.ui.contextMenu(row, [
          { label: 'save for later', onClick: () => save(it) },
          { label: 'share', onClick: () => os.share({ title: it.title, url: it.link }) },
          { label: 'open in browser', onClick: () => os.launch('ie', { url: it.link }) },
        ]),
      }));
  }

  async function save(it) {
    const list = await storage.get('saved', []);
    if (list.some((x) => x.link === it.link)) { os.toast('Already saved'); return; }
    await storage.set('saved', [{ title: it.title, link: it.link, image: it.image, source: it.source, date: it.date, description: it.description, savedAt: Date.now() }, ...list]);
    os.toast('Saved for later');
    savedRender?.();
  }

  async function renderSaved(c) {
    const list = await storage.get('saved', []);
    c.replaceChildren(os.ui.list(list, {
      empty: 'nothing saved yet. Tap and hold a story to save it for later.',
      render: (it) => el('div.sports-item',
        el('div.sports-item-text', el('div.sports-item-title', it.title), el('div.sports-item-meta', [it.source, 'saved ' + timeAgo(os, it.savedAt)].filter(Boolean).join(' · '))),
        it.image ? el('div.sports-thumb', { style: { backgroundImage: `url("${it.image}")` } }) : null),
      onClick: openItem,
      onHold: (it, row) => os.ui.contextMenu(row, [{ label: 'remove', onClick: async () => { await storage.set('saved', (await storage.get('saved', [])).filter((x) => x.link !== it.link)); savedRender?.(); } }]),
    }));
  }

  return { onResume: () => { if (pv?.index === 0) reloaders.get(0)?.(); } };
}
