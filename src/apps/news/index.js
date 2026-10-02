import './style.css';
import { Rss } from 'lucide';
import { makeReader, bigImage, timeAgo } from './reader.js';

const CATS = [
  ['top', 'top stories'], ['world', 'world'], ['business', 'business'], ['technology', 'technology'], ['science', 'science'],
  ['entertainment', 'entertainment'], ['health', 'health'], ['sports', 'sports'],
];

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, appBar, I } = os.ui;
  const readerPage = makeReader({ app: 'MSN NEWS', storage, prefix: 'news' });

  let topics = await storage.get('topics', []);       // [{ title, url }]
  let hidden = await storage.get('hiddenCats', []);    // category ids hidden by the user
  let pv, bar, mainPage;
  const loaded = new Map();                            // pivot index -> reload fn
  let savedRender = null;

  const openItem = (it) => ctx.navigate(readerPage, { item: it, onSavedChange: () => savedRender?.() });

  function sections() {
    return [
      ...CATS.filter(([id]) => !hidden.includes(id)).map(([id, label]) => ({ header: label, kind: 'cat', id })),
      ...topics.map((t) => ({ header: t.title.toLowerCase(), kind: 'rss', id: t.url, topic: t })),
      { header: 'saved', kind: 'saved' },
    ];
  }

  function buildPivot(index = 0) {
    loaded.clear();
    const secs = sections();
    pv = os.ui.pivot({
      app: 'MSN NEWS',
      index: Math.min(index, secs.length - 1),
      items: secs.map((s, i) => ({
        header: s.header,
        render: (c) => {
          if (s.kind === 'saved') { savedRender = () => renderSaved(c); savedRender(); return; }
          const load = (force) => loadFeed(c, s, force);
          loaded.set(i, load);
          load();
        },
      })),
      onChange: () => updateBar(),
    });
    return pv;
  }

  function updateBar() {
    if (!bar || !pv) return;
    const s = sections()[pv.index];
    bar.setButtons([
      { icon: I.refresh, label: 'refresh', onClick: () => loaded.get(pv.index)?.(true) },
      { icon: I.add, label: 'add topic', onClick: addTopic },
    ]);
    bar.setMenu([
      s?.kind === 'rss' ? { label: `remove “${s.topic.title}”`, onClick: () => removeTopic(s.topic) } : null,
      s?.kind === 'cat' && s.id !== 'top' ? { label: `hide ${s.header}`, onClick: () => hideCat(s.id) } : null,
      { label: 'manage topics', onClick: () => ctx.navigate(topicsPage) },
    ].filter(Boolean));
  }

  function rebuild(index) {
    const n = buildPivot(index);
    mainPage.querySelector('.wp-pivot')?.replaceWith(n.el);
    updateBar();
  }

  await ctx.navigate((page) => {
    mainPage = page.el;
    bar = appBar({});
    page.el.append(buildPivot(0).el, bar.el);
    updateBar();
  });

  /* ------------------------------------------------------------ feeds */

  async function loadFeed(c, s, force) {
    const key = 'feed:' + s.id;
    const cached = await storage.get(key, null);
    if (cached?.items?.length) renderFeed(c, cached, s);
    if (!cached || force) c.prepend(el('div.news-loading', os.ui.loadingDots()));
    try {
      const feed = s.kind === 'cat' ? await os.net.news(s.id) : await os.net.rss(s.id);
      if (!feed?.items?.length) throw new Error('empty');
      storage.set(key, { title: feed.title, items: feed.items.slice(0, 40), t: Date.now() });
      renderFeed(c, feed, s);
      if (s.id === 'top') os.tiles.refresh('news');
    } catch {
      c.querySelector('.news-loading')?.remove();
      const msg = !navigator.onLine ? 'You’re offline. Connect to the internet to get the latest news.' : 'We couldn’t get the latest stories. Pull down… or tap refresh to try again.';
      if (cached?.items?.length) c.prepend(el('div.news-msg', !navigator.onLine ? 'You’re offline — showing stories from earlier.' : 'Couldn’t refresh. Showing stories from earlier.'));
      else c.replaceChildren(el('div.news-msg', msg.replace(' Pull down…', '')), os.ui.button('try again', () => loadFeed(c, s, true)));
    }
  }

  function renderFeed(c, feed, s) {
    const items = feed.items.filter((x) => x.title);
    const heroIdx = items.findIndex((x) => x.image);
    const hero = heroIdx >= 0 ? items[heroIdx] : null;
    const rest = items.filter((_, i) => i !== heroIdx);
    const nodes = [];
    if (hero) {
      nodes.push(el('div.news-hero.tilt', { onclick: () => openItem(hero) },
        el('div.news-hero-img', { style: { backgroundImage: `url("${bigImage(hero.image)}"), url("${hero.image}")` } }),
        el('div.news-hero-text',
          el('div.news-hero-title', hero.title),
          el('div.news-hero-meta', [hero.source || feed.title, timeAgo(os, hero.date)].filter(Boolean).join(' · ')))));
    }
    nodes.push(os.ui.list(rest, {
      render: (it) => el('div.news-item',
        el('div.news-item-text',
          el('div.news-item-title', it.title),
          el('div.news-item-meta', [it.source || feed.title, timeAgo(os, it.date)].filter(Boolean).join(' · '))),
        it.image ? el('div.news-thumb', { style: { backgroundImage: `url("${it.image}")` } }) : null),
      onClick: openItem,
      onHold: (it, row) => itemMenu(it, row),
    }));
    c.replaceChildren(...nodes);
  }

  async function itemMenu(it, row) {
    const saved = (await storage.get('saved', [])).some((x) => x.link === it.link);
    os.ui.contextMenu(row, [
      { label: saved ? 'remove from reading list' : 'save for later', onClick: () => toggleSaved(it) },
      { label: 'share', onClick: () => os.share({ title: it.title, url: it.link }) },
      { label: 'open in browser', onClick: () => os.launch('ie', { url: it.link }) },
    ]);
  }

  async function toggleSaved(it) {
    let list = await storage.get('saved', []);
    if (list.some((x) => x.link === it.link)) { list = list.filter((x) => x.link !== it.link); os.toast('Removed from reading list'); } else {
      list = [{ title: it.title, link: it.link, image: it.image, source: it.source, date: it.date, description: it.description, savedAt: Date.now() }, ...list];
      os.toast('Saved for later');
    }
    await storage.set('saved', list);
    savedRender?.();
  }

  async function renderSaved(c) {
    const list = await storage.get('saved', []);
    c.replaceChildren(
      list.length ? el('div.news-msg.plain', `${list.length} saved ${list.length === 1 ? 'story' : 'stories'} · available offline`) : '',
      os.ui.list(list, {
        empty: 'nothing saved yet. Tap and hold a story, or tap save while reading, to keep it for later.',
        render: (it) => el('div.news-item',
          el('div.news-item-text', el('div.news-item-title', it.title), el('div.news-item-meta', [it.source, 'saved ' + timeAgo(os, it.savedAt)].filter(Boolean).join(' · '))),
          it.image ? el('div.news-thumb', { style: { backgroundImage: `url("${it.image}")` } }) : null),
        onClick: openItem,
        onHold: (it, row) => os.ui.contextMenu(row, [
          { label: 'remove', onClick: () => toggleSaved(it) },
          { label: 'share', onClick: () => os.share({ title: it.title, url: it.link }) },
        ]),
      }));
  }

  /* ------------------------------------------------------------ topics */

  async function addTopic() {
    const SUGGEST = [
      ['The Verge', 'https://www.theverge.com/rss/index.xml'], ['Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index'],
      ['NASA', 'https://www.nasa.gov/news-release/feed/'], ['Windows Central', 'https://www.windowscentral.com/feeds.xml'],
      ['Hacker News', 'https://hnrss.org/frontpage'], ['NPR News', 'https://feeds.npr.org/1001/rss.xml'],
    ].filter(([, u]) => !topics.some((t) => t.url === u));
    const opts = [{ value: '__custom', label: 'enter a feed address…' }, ...SUGGEST.map(([t, u]) => ({ value: u, label: t }))];
    let url = await os.ui.pickFromList({ title: 'add a topic', options: opts });
    if (!url) return;
    let title = SUGGEST.find(([, u]) => u === url)?.[0];
    if (url === '__custom') {
      url = (await os.ui.prompt('Paste the address of an RSS or Atom feed.', 'https://', 'add topic', { type: 'url' }) || '').trim();
      if (!url || url === 'https://') return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    }
    if (topics.some((t) => t.url === url)) { os.toast('You already follow that feed'); return; }
    os.toast('Checking feed…');
    try {
      const f = await os.net.rss(url);
      if (!f?.items?.length) throw new Error('empty');
      title = title || (f.title || new URL(url).hostname).slice(0, 30);
      topics = [...topics, { title, url }];
      await storage.set('topics', topics);
      storage.set('feed:' + url, { title: f.title, items: f.items.slice(0, 40), t: Date.now() });
      const idx = sections().findIndex((s) => s.id === url);
      rebuild(idx);
      os.toast(`Added ${title}`);
    } catch {
      os.ui.alert('We couldn’t read a news feed at that address. Check the address and try again.', 'can’t add topic');
    }
  }
  async function removeTopic(t) {
    if (!(await os.ui.confirm(`Remove “${t.title}” from your topics?`, 'remove topic', 'remove', 'cancel'))) return;
    topics = topics.filter((x) => x.url !== t.url);
    await storage.set('topics', topics);
    storage.del('feed:' + t.url);
    rebuild(0);
  }
  async function hideCat(id) {
    hidden = [...hidden, id];
    await storage.set('hiddenCats', hidden);
    rebuild(0);
  }

  function topicsPage(page) {
    const p = os.ui.page({ app: 'MSN NEWS', title: 'topics' });
    const draw = () => {
      p.content.replaceChildren(
        os.ui.header('categories'),
        ...CATS.map(([id, label]) => {
          const t = os.ui.toggle({ label, value: !hidden.includes(id), onChange: async (v) => { hidden = v ? hidden.filter((x) => x !== id) : [...hidden, id]; await storage.set('hiddenCats', hidden); rebuild(0); } });
          if (id === 'top') t.setDisabled(true);
          return t.el;
        }),
        os.ui.header('your feeds'),
        os.ui.list(topics, {
          empty: 'no custom feeds yet',
          render: (t) => os.ui.listItem({ title: t.title.toLowerCase(), subtitle: t.url, icon: Rss }),
          onHold: (t, row) => os.ui.contextMenu(row, [{ label: 'remove', onClick: async () => { await removeTopic(t); draw(); } }]),
          onClick: (t, row) => os.ui.contextMenu(row, [{ label: 'remove', onClick: async () => { await removeTopic(t); draw(); } }]),
        }),
        os.ui.desc('Add any RSS or Atom feed as a topic. Tap a feed to remove it.'));
    };
    draw();
    const b = appBar({ buttons: [{ icon: I.add, label: 'add feed', onClick: async () => { await addTopic(); draw(); } }] });
    page.el.append(p.el, b.el);
  }

  ctx.on('args', (a) => { if (a?.item) openItem(a.item); });
  if (ctx.args?.item) openItem(ctx.args.item);
}
