// Store — browse, search, install, review apps & games. Catalog = every app manifest (os.apps.list({ all: true })).
import './style.css';
import { Star, Gamepad2, Sparkles, Download, AppWindow } from 'lucide';

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const ui = os.ui;
  const { el, I } = ui;
  const APP = 'STORE';

  /* ---------------------------------------------------------------- catalog */
  const catalog = () => os.apps.list({ all: true }).filter((m) => m.id !== 'store' && !m.hidden);
  const isGame = (m) => m.category === 'game';
  const browsable = () => catalog().filter((m) => m.category !== 'system');
  const ratingOf = (m) => (typeof m.rating === 'number' ? m.rating : 3.5 + (hash(m.id) % 14) / 10);
  const countOf = (m) => 120 + (hash(m.id + 'n') % 48000);
  const sizeOf = (m) => m.size || `${(2 + (hash(m.id + 's') % 380) / 10).toFixed(1)} MB`;
  const sizeMB = (m) => { const x = /([\d.]+)\s*(KB|MB|GB)/i.exec(sizeOf(m)); if (!x) return 10; return Number(x[1]) * ({ KB: 1 / 1024, MB: 1, GB: 1024 }[x[2].toUpperCase()]); };
  const publisherOf = (m) => m.publisher || (m.category === 'system' ? 'Microsoft Corporation' : 'Independent developer');
  const installed = (id) => os.apps.isInstalled(id);

  let reviews = await storage.get('reviews', {});
  const myReviews = (id) => reviews[id] || [];
  const avgRating = (m) => {
    const mine = myReviews(m.id);
    const n = countOf(m);
    return (ratingOf(m) * n + mine.reduce((s, r) => s + r.stars, 0)) / (n + mine.length);
  };

  /* ---------------------------------------------------------------- live refresh */
  const refreshers = new Set();
  const live = (fn) => { refreshers.add(fn); return () => refreshers.delete(fn); };
  const refreshAll = () => refreshers.forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
  const offApps = [os.apps.on('installed', refreshAll), os.apps.on('uninstalled', refreshAll)];

  /* installs in progress: id -> { phase, progress, listeners } */
  const jobs = new Map();

  /* ---------------------------------------------------------------- bits */
  const tileIcon = (m, size = 52, iconSize = 28) => el('div.store-icon', { style: { width: size + 'px', height: size + 'px', background: m.color || 'var(--accent)' }, html: ui.iconSVG(m.icon, { size: iconSize, stroke: 1.6 }) });
  const stars = (v, big = false) => el('span.store-stars' + (big ? '.big' : ''), { title: v.toFixed(1) + ' out of 5' },
    el('span.store-stars-bg', '★★★★★'), el('span.store-stars-fg', { style: { width: (Math.max(0, Math.min(5, v)) / 5) * 100 + '%' } }, '★★★★★'));
  const statusText = (m) => (jobs.has(m.id) ? jobs.get(m.id).phase + '…' : installed(m.id) ? 'installed' : 'free');

  const appRow = (m) => el('div.store-row',
    tileIcon(m),
    el('div.store-row-text',
      el('div.store-row-name', m.name),
      el('div.store-row-meta', stars(avgRating(m)), el('span.store-row-status' + (installed(m.id) ? '.accent' : ''), statusText(m)))));

  const appList = (items, { empty = 'no apps here' } = {}) => ui.list(items, {
    empty,
    render: appRow,
    onClick: (m) => openApp(m.id),
    onHold: (m, row) => ui.contextMenu(row, [
      { label: 'view details', onClick: () => openApp(m.id) },
      installed(m.id) ? { label: 'open', onClick: () => os.launch(m.id) } : { label: 'install', onClick: () => install(m) },
      installed(m.id) && m.category !== 'system' ? { label: 'uninstall', onClick: () => uninstall(m) } : null,
      installed(m.id) ? { label: 'pin to start', disabled: os.tiles.isPinned(m.id), onClick: () => os.tiles.pin(m.id, { size: m.pin?.size || 'medium' }) } : null,
    ]),
  });

  /* ---------------------------------------------------------------- install / uninstall */
  async function install(m) {
    if (installed(m.id) || jobs.has(m.id)) return;
    if (!navigator.onLine) os.toast('Offline — installing from the phone’s cache');
    const job = { phase: 'pending', progress: 0, listeners: new Set() };
    jobs.set(m.id, job);
    const emit = () => job.listeners.forEach((f) => f(job));
    refreshAll(); emit();
    await os.util.sleep(500);
    job.phase = 'downloading'; emit(); refreshAll();
    const total = 1400 + Math.min(1600, sizeMB(m) * 25);
    const t0 = performance.now();
    await new Promise((res) => {
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / total);
        // a little jitter like a real download
        job.progress = Math.min(1, p * (0.92 + 0.08 * Math.sin(p * 9)) + (p >= 1 ? 1 : 0));
        emit();
        if (p >= 1) res(); else setTimeout(step, 70);
      };
      step();
    });
    job.phase = 'installing'; job.progress = 1; emit(); refreshAll();
    await os.util.sleep(600);
    try {
      await os.apps.install(m.id);
      os.notify({ appId: 'store', title: m.name, body: 'was installed. Tap to open.', args: { open: m.id }, icon: m.icon });
    } catch (e) {
      ui.alert('Couldn’t install ' + m.name + '. ' + e.message, 'store');
    }
    jobs.delete(m.id);
    job.phase = 'done'; emit();
    refreshAll();
  }

  async function uninstall(m) {
    if (!(await ui.confirm(`Uninstall ${m.name}? You can reinstall it from the Store any time.`, 'uninstall', 'uninstall', 'cancel'))) return;
    try { await os.apps.uninstall(m.id); os.toast(m.name + ' uninstalled'); } catch (e) { ui.alert(e.message, 'store'); }
  }

  /* ---------------------------------------------------------------- home (panorama) */
  function home(page) {
    const offs = [];
    const daySeed = Math.floor(Date.now() / 864e5);
    const featuredPicks = () => {
      const all = browsable();
      const notInst = all.filter((m) => !installed(m.id));
      const pool = (notInst.length >= 3 ? notInst : all).slice().sort((a, b) => (hash(a.id + daySeed) % 997) - (hash(b.id + daySeed) % 997));
      return pool.slice(0, 5);
    };

    const sections = [
      {
        header: 'featured',
        render: (c) => {
          const banner = el('div.store-banner.tilt');
          const dots = el('div.store-banner-dots');
          let picks = featuredPicks(), idx = 0;
          const show = () => {
            const m = picks[idx % Math.max(1, picks.length)];
            if (!m) { banner.replaceChildren(ui.empty('nothing featured')); return; }
            banner.style.background = m.color || 'var(--accent)';
            banner.onclick = () => openApp(m.id);
            banner.replaceChildren(
              el('div.store-banner-icon', { html: ui.iconSVG(m.icon, { size: 92, stroke: 1.2 }) }),
              el('div.store-banner-text', el('div.store-banner-name', m.name), el('div.store-banner-desc', m.description || publisherOf(m)),
                el('div.store-banner-meta', stars(avgRating(m)), ' ', installed(m.id) ? 'installed' : 'free')));
            banner.classList.remove('store-flip'); void banner.offsetWidth; banner.classList.add('store-flip');
            dots.replaceChildren(...picks.map((_, i) => el('i' + (i === idx % picks.length ? '.on' : ''))));
          };
          show();
          const iv = setInterval(() => { if (!banner.isConnected || page.el.hidden) return; idx++; show(); }, 6000);
          offs.push(() => clearInterval(iv), live(() => { picks = featuredPicks(); show(); }));
          const tiles = el('div.store-cats',
            catTile('apps', AppWindow, () => ctx.navigate(browsePage, { kind: 'apps' })),
            catTile('games', Gamepad2, () => ctx.navigate(browsePage, { kind: 'games' })),
            catTile('new + rising', Sparkles, () => ctx.navigate(browsePage, { kind: 'apps', tab: 1 })),
            catTile('updates', Download, () => ctx.navigate(updatesPage)));
          c.append(banner, dots, tiles);
        },
      },
      {
        header: 'top free',
        render: (c) => {
          const draw = () => c.replaceChildren(appList(browsable().filter((m) => !isGame(m)).sort((a, b) => avgRating(b) - avgRating(a)).slice(0, 12)),
            ui.button('see all apps', () => ctx.navigate(browsePage, { kind: 'apps' })));
          draw(); offs.push(live(draw));
        },
      },
      {
        header: 'games',
        render: (c) => {
          const draw = () => c.replaceChildren(appList(browsable().filter(isGame).sort((a, b) => avgRating(b) - avgRating(a)).slice(0, 12), { empty: 'no games yet' }),
            ui.button('see all games', () => ctx.navigate(browsePage, { kind: 'games' })));
          draw(); offs.push(live(draw));
        },
      },
      {
        header: 'new + rising',
        render: (c) => {
          const draw = () => c.replaceChildren(appList(newRising().slice(0, 12)));
          draw(); offs.push(live(draw));
        },
      },
      {
        header: 'my apps',
        render: (c) => {
          const draw = () => {
            const mine = catalog().filter((m) => installed(m.id) && m.category !== 'system');
            c.replaceChildren(ui.desc(`${mine.length} apps and games installed`), appList(mine, { empty: 'you haven’t installed anything yet' }));
          };
          draw(); offs.push(live(draw));
        },
      },
    ];
    const pano = ui.panorama({ title: 'store', sections });
    pano.el.classList.add('store-pano');
    const bar = ui.appBar({
      buttons: [
        { icon: I.search, label: 'search', onClick: () => ctx.navigate(searchPage, {}) },
        { icon: I.download, label: 'updates', onClick: () => ctx.navigate(updatesPage) },
      ],
      menu: [
        { label: 'my apps', onClick: () => ctx.navigate(browsePage, { kind: 'mine' }) },
        { label: 'all games', onClick: () => ctx.navigate(browsePage, { kind: 'games' }) },
        { label: 'about store', onClick: () => ui.alert(`${catalog().length} apps and games in the catalog.\nApps download instantly from this phone’s built-in catalog.`, 'Store') },
      ],
    });
    page.el.append(pano.el, bar.el);
    return { onDestroy: () => offs.forEach((f) => f()) };
  }

  function catTile(label, icon, onClick) {
    return el('div.store-cat.tilt', { onclick: onClick }, el('span', { html: ui.iconSVG(icon, { size: 28 }) }), el('span.store-cat-label', label));
  }

  function newRising() {
    // Store-only apps first (not preinstalled), then the rest, shuffled weekly
    const week = Math.floor(Date.now() / 6048e5);
    return browsable().slice().sort((a, b) => (a.preinstalled === false ? 0 : 1) - (b.preinstalled === false ? 0 : 1) || (hash(a.id + week) % 1000) - (hash(b.id + week) % 1000));
  }

  /* ---------------------------------------------------------------- browse (pivot) */
  function browsePage(page) {
    const { kind, tab = 0 } = page.params;
    const offs = [];
    const filter = kind === 'games' ? isGame : kind === 'mine' ? (m) => installed(m.id) && m.category !== 'system' : (m) => !isGame(m);
    const items = (sort) => {
      const list = (kind === 'mine' ? catalog() : browsable()).filter(filter);
      if (sort === 'top') return list.sort((a, b) => avgRating(b) - avgRating(a));
      if (sort === 'new') { const order = newRising().map((m) => m.id); return list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); }
      return list.sort((a, b) => a.name.localeCompare(b.name));
    };
    const tabRender = (sort) => (c) => {
      const draw = () => {
        const arr = items(sort);
        c.replaceChildren(sort === 'all' && arr.length > 12
          ? ui.jumpList(arr, { key: (m) => m.name, render: appRow, onClick: (m) => openApp(m.id) })
          : appList(arr, { empty: kind === 'mine' ? 'you haven’t installed any apps yet' : 'nothing here' }));
      };
      draw(); offs.push(live(draw));
    };
    const title = kind === 'games' ? 'STORE · GAMES' : kind === 'mine' ? 'STORE · MY APPS' : 'STORE · APPS';
    const pv = ui.pivot({
      app: title, index: tab,
      items: kind === 'mine' ? [{ header: 'installed', render: tabRender('all') }]
        : [{ header: 'top free', render: tabRender('top') }, { header: 'new + rising', render: tabRender('new') }, { header: 'all', render: tabRender('all') }],
    });
    const bar = ui.appBar({ buttons: [{ icon: I.search, label: 'search', onClick: () => ctx.navigate(searchPage, {}) }] });
    page.el.append(pv.el, bar.el);
    return { onDestroy: () => offs.forEach((f) => f()) };
  }

  /* ---------------------------------------------------------------- details */
  function openApp(id) {
    if (!os.apps.get(id)) { ui.alert('That app isn’t available in your region.', 'store'); return; }
    ctx.navigate(detailsPage, { id });
  }

  function detailsPage(page) {
    const m = os.apps.get(page.params.id);
    const offs = [];

    const renderDetails = (c) => {
      const actions = el('div.store-actions');
      const progress = el('div.store-progress');
      const drawActions = () => {
        const job = jobs.get(m.id);
        progress.replaceChildren();
        if (job) {
          const label = job.phase === 'downloading' ? `downloading ${(sizeMB(m) * job.progress).toFixed(1)} MB of ${sizeOf(m)}` : job.phase === 'pending' ? 'pending…' : 'installing…';
          progress.append(el('div.store-progress-label', label));
          if (job.phase === 'downloading') progress.append(ui.progressBar(job.progress));
          else progress.append(ui.loadingDots());
          actions.replaceChildren();
          return;
        }
        if (installed(m.id)) {
          actions.replaceChildren(
            ui.button('open', () => os.launch(m.id), { accent: true }),
            m.category !== 'system' && m.removable !== false ? ui.button('uninstall', () => uninstall(m)) : null,
            !os.tiles.isPinned(m.id) ? ui.button('pin to start', async () => { await os.tiles.pin(m.id, { size: m.pin?.size || 'medium' }); os.toast('Pinned to Start'); drawActions(); }) : null);
        } else {
          actions.replaceChildren(ui.button('install', () => install(m), { accent: true }));
        }
      };
      const onJob = () => drawActions();
      const subscribe = () => { const j = jobs.get(m.id); if (j) { j.listeners.add(onJob); offs.push(() => j.listeners.delete(onJob)); } };
      subscribe();
      offs.push(live(() => { subscribe(); drawActions(); head.querySelector('.store-d-rating').replaceChildren(stars(avgRating(m)), ` ${avgRating(m).toFixed(1)} (${(countOf(m) + myReviews(m.id).length).toLocaleString()})`); }));
      drawActions();

      const head = el('div.store-d-head',
        tileIcon(m, 104, 56),
        el('div.store-d-headtext',
          el('div.store-d-name', m.name),
          el('div.store-d-pub', publisherOf(m)),
          el('div.store-d-rating', stars(avgRating(m)), ` ${avgRating(m).toFixed(1)} (${(countOf(m) + myReviews(m.id).length).toLocaleString()})`),
          el('div.store-d-price', 'free')));
      c.append(head, actions, progress,
        el('div.store-d-desc.selectable', m.description || 'No description provided.'),
        el('div.store-d-facts',
          fact('Publisher', publisherOf(m)),
          fact('Category', m.category === 'game' ? 'games' : m.category === 'system' ? 'system' : 'apps'),
          fact('Size', sizeOf(m)),
          fact('Version', m.version || '1.0.0.0'),
          m.external ? fact('Opens', new URL(m.external).hostname) : null,
          m.keywords?.length ? fact('Tags', m.keywords.slice(0, 6).join(', ')) : null),
        ui.button('rate and review', () => rate(m)),
        ui.button('share', () => os.share({ title: m.name, text: `Check out ${m.name} in the Windows Phone Store: ${m.description || ''}`.trim() })));
    };

    const renderReviews = (c) => {
      const draw = () => {
        const mine = myReviews(m.id).slice().sort((a, b) => b.time - a.time);
        const v = avgRating(m);
        c.replaceChildren(
          el('div.store-r-summary', el('div.store-r-big', v.toFixed(1)), el('div', stars(v, true), el('div.subtle', `${(countOf(m) + mine.length).toLocaleString()} ratings`))),
          ui.button('rate and review', () => rate(m), { accent: true }),
          ui.header('your reviews'),
          mine.length ? el('div', mine.map((r) => el('div.store-review',
            el('div.store-review-top', stars(r.stars), el('span.subtle', new Date(r.time).toLocaleDateString())),
            r.text ? el('div.store-review-text.selectable', r.text) : null,
            el('div.store-review-by', r.name || 'You')))) : ui.empty('you haven’t reviewed this app yet'));
      };
      draw(); offs.push(live(draw));
    };

    const renderRelated = (c) => {
      const draw = () => {
        const kw = new Set(m.keywords || []);
        const rel = browsable().filter((x) => x.id !== m.id && (isGame(x) === isGame(m)))
          .map((x) => ({ x, s: (x.keywords || []).filter((k) => kw.has(k)).length * 2 + (x.publisher && x.publisher === m.publisher ? 3 : 0) + (hash(x.id + m.id) % 10) / 10 }))
          .sort((a, b) => b.s - a.s).slice(0, 8).map((r) => r.x);
        c.replaceChildren(appList(rel, { empty: 'nothing related' }));
      };
      draw(); offs.push(live(draw));
    };

    const pv = ui.pivot({
      app: 'STORE · ' + m.name.toUpperCase(),
      items: [{ header: 'details', render: renderDetails }, { header: 'reviews', render: renderReviews }, { header: 'related', render: renderRelated }],
    });
    const bar = ui.appBar({
      buttons: [{ icon: I.star, label: 'rate', onClick: () => rate(m) }, { icon: I.share, label: 'share', onClick: () => os.share({ title: m.name, text: `Check out ${m.name} in the Store` }) }],
      minimized: false,
    });
    page.el.append(pv.el, bar.el);
    return { onDestroy: () => offs.forEach((f) => f()) };
  }

  const fact = (k, v) => el('div.store-fact', el('div.store-fact-k', k), el('div.store-fact-v', v));

  async function rate(m) {
    let value = myReviews(m.id)[0]?.stars || 0;
    const starRow = el('div.store-rate-stars');
    const drawStars = () => starRow.replaceChildren(...[1, 2, 3, 4, 5].map((n) => el('button.store-rate-star' + (n <= value ? '.on' : ''), {
      'aria-label': n + ' stars', onclick: () => { value = n; drawStars(); },
    }, el('span', { html: ui.iconSVG(Star, { size: 34, stroke: 1.6 }) }))));
    drawStars();
    const text = ui.textbox({ multiline: true, rows: 3, placeholder: 'write a review (optional)' });
    const content = el('div', starRow, text);
    const r = await ui.messageBox({ title: 'rate and review', message: `How would you rate ${m.name}?`, content, buttons: ['submit', 'cancel'] });
    if (r !== 0) return;
    if (!value) { os.toast('Pick 1 to 5 stars to rate'); return; }
    reviews = await storage.update('reviews', (all) => {
      const list = all[m.id] || [];
      list.unshift({ stars: value, text: text.value.trim().slice(0, 1000), name: os.settings.get('ownerName') || 'You', time: Date.now() });
      return { ...all, [m.id]: list.slice(0, 20) };
    }, {});
    os.toast('Thanks for your review');
    refreshAll();
  }

  /* ---------------------------------------------------------------- search */
  function searchPage(page) {
    const offs = [];
    const p = ui.page({ app: APP, title: 'search', cls: 'store-search-page' });
    const results = el('div.store-search-results');
    const box = ui.textbox({ placeholder: 'search apps and games', type: 'search', value: page.params.q || '', onInput: () => run(), onEnter: () => box.blur() });
    box.classList.add('store-search-box');
    const run = () => {
      const q = box.value.trim().toLowerCase();
      if (!q) { results.replaceChildren(ui.desc('Search by name, publisher or what the app does.'), ui.header('popular'), appList(browsable().sort((a, b) => avgRating(b) - avgRating(a)).slice(0, 6))); return; }
      const words = q.split(/\s+/);
      const scored = catalog().map((m) => {
        const name = m.name.toLowerCase();
        const hay = [m.description, m.publisher, m.category, m.id].join(' ').toLowerCase();
        const kws = (m.keywords || []).map((k) => k.toLowerCase());
        let s = 0;
        if (name === q) s += 10;
        if (name.startsWith(q)) s += 6;
        else if (name.includes(q)) s += 4;
        for (const w of words) {
          if (name.split(/\s+/).some((x) => x.startsWith(w))) s += 2;
          if (kws.some((k) => k.startsWith(w))) s += 1.5;
          if (hay.includes(w)) s += 0.5;
        }
        if (words.some((w) => w.startsWith('game')) && isGame(m)) s += 1;
        return { m, s };
      }).filter((r) => r.s > 0).sort((a, b) => b.s - a.s || a.m.name.localeCompare(b.m.name));
      const apps = scored.filter((r) => !isGame(r.m)).map((r) => r.m);
      const games = scored.filter((r) => isGame(r.m)).map((r) => r.m);
      results.replaceChildren(
        !scored.length ? ui.empty(`no results for “${box.value.trim()}”`) : null,
        apps.length ? ui.header(`apps (${apps.length})`) : null, apps.length ? appList(apps) : null,
        games.length ? ui.header(`games (${games.length})`) : null, games.length ? appList(games) : null);
    };
    offs.push(live(run));
    run();
    p.content.append(box, results);
    page.el.append(p.el);
    setTimeout(() => { if (!page.params.q) box.focus(); }, 380);
    return { onDestroy: () => offs.forEach((f) => f()) };
  }

  /* ---------------------------------------------------------------- updates */
  function updatesPage(page) {
    const p = ui.page({ app: APP, title: 'updates' });
    const body = el('div');
    const draw = async (checking) => {
      const last = await storage.get('lastCheck', null);
      body.replaceChildren(
        checking ? el('div', el('div.store-upd-title', 'Checking for updates…'), ui.loadingDots({ inline: true })) : el('div.store-upd-title', 'No updates available'),
        el('div.subtle', checking ? '' : 'Your apps and games are up to date.'),
        last ? el('div.subtle', 'Last checked ' + os.util.formatRelative(last) + (new Date(last).toDateString() === new Date().toDateString() ? ' today' : '')) : null);
    };
    draw(false);
    const autoUpd = ui.toggle({ label: 'Update apps automatically', value: true, onChange: (v) => storage.set('autoUpdate', v) });
    storage.get('autoUpdate', true).then((v) => autoUpd.set(v));
    const bar = ui.appBar({
      buttons: [{
        icon: I.refresh, label: 'check', onClick: async () => {
          await draw(true);
          await os.util.sleep(1600 + Math.random() * 900);
          await storage.set('lastCheck', Date.now());
          draw(false);
        },
      }],
    });
    p.content.append(body, el('div', { style: { height: '20px' } }), autoUpd.el, ui.header('download history'));
    const mine = catalog().filter((m) => installed(m.id) && m.preinstalled === false);
    p.content.append(mine.length ? appList(mine) : ui.empty('no apps downloaded yet'));
    page.el.append(p.el, bar.el);
  }

  /* ---------------------------------------------------------------- boot */
  await ctx.navigate(home);
  const handleArgs = (a = {}) => {
    if (a.open && os.apps.get(a.open)) { os.launch(a.open); return; }
    if (a.app) openApp(a.app);
    else if (a.q != null) ctx.navigate(searchPage, { q: String(a.q) });
    else if (a.updates) ctx.navigate(updatesPage);
  };
  handleArgs(ctx.args);
  ctx.on('args', handleArgs);

  return { onDestroy: () => { offApps.forEach((f) => f()); refreshers.clear(); } };
}
