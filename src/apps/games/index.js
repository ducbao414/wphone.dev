// Games hub (Xbox): gamer profile, collection, achievements, get more games.
import './style.css';
import { avatarSVG } from './avatar.js';

const XBOX = '#107C10';

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, iconSVG, appBar } = os.ui;
  const esc = os.util.esc;

  const data = { achievements: [], catalogs: {}, tag: '' };

  async function load() {
    data.achievements = await storage.get('achievements', []);
    data.tag = (await storage.get('gamertag', null)) || os.settings.get('ownerName') || 'Gamer';
    data.catalogs = {};
    for (const k of await storage.keys()) if (k.startsWith('catalog:')) data.catalogs[k.slice(8)] = await storage.get(k, []);
  }
  const installedGames = () => os.apps.list().filter((m) => m.category === 'game');
  const storeGames = () => os.apps.list({ all: true }).filter((m) => m.category === 'game' && !os.apps.isInstalled(m.id));
  const score = () => data.achievements.reduce((s, a) => s + (a.gamerscore || 0), 0);
  const gameName = (id) => os.apps.get(id)?.name || id;
  const gameIds = () => [...new Set([...installedGames().map((m) => m.id), ...Object.keys(data.catalogs), ...data.achievements.map((a) => a.game)])].filter((id) => os.apps.get(id));
  const gameAch = (id) => {
    const un = data.achievements.filter((a) => a.game === id);
    const cat = data.catalogs[id] || [];
    const all = cat.map((c) => ({ ...c, ...(un.find((u) => u.id === c.id) || {}) }));
    for (const u of un) if (!all.some((a) => a.id === u.id)) all.push(u);
    const total = all.reduce((s, a) => s + (a.gamerscore || 0), 0);
    const got = un.reduce((s, a) => s + (a.gamerscore || 0), 0);
    return { all: all.sort((a, b) => (b.unlocked || 0) - (a.unlocked || 0)), un, total, got };
  };
  const fmtDate = (ms) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const trophy = (on) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${on ? '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>' : '<rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'}</svg>`;
  const xboxLogo = (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M7 6.5c3 2 7.5 7.5 10 11M17 6.5c-3 2-7.5 7.5-10 11"/></svg>`;

  const achRow = (a, { showGame = false } = {}) => el('div.games-ach' + (a.unlocked ? '' : '.locked'),
    el('div.games-ach-icon', { html: trophy(!!a.unlocked) }),
    el('div.games-ach-text',
      el('div.games-ach-title', a.unlocked ? a.title : (a.secret ? 'secret achievement' : a.title)),
      el('div.games-ach-sub', a.unlocked ? `${showGame ? (a.gameName || gameName(a.game)) + ' · ' : ''}${a.description || ''}` : (a.description || 'keep playing to unlock')),
      a.unlocked ? el('div.games-ach-date', 'unlocked ' + fmtDate(a.unlocked)) : null),
    el('div.games-ach-g', `${a.gamerscore || 0}G`));

  const gameTile = (m, { small = false } = {}) => el('div.games-tile.tilt' + (small ? '.small' : ''), {
    style: { background: m.color || 'var(--accent)' },
    onclick: () => os.launch(m.id),
  }, el('div.games-tile-icon', { html: iconSVG(m.icon, { size: small ? 34 : 48, stroke: 1.4 }) }), el('div.games-tile-label', m.name));

  /* ---------------- hub (panorama) ---------------- */
  const bg = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="800" viewBox="0 0 1400 800">
    <rect width="1400" height="800" fill="#0b4d0b"/>
    <circle cx="260" cy="180" r="260" fill="#107C10"/><circle cx="820" cy="640" r="340" fill="#0e6a0e"/>
    <circle cx="1220" cy="160" r="200" fill="#139313"/><circle cx="560" cy="380" r="120" fill="#18a018" opacity=".6"/>
    <g fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="18"><circle cx="1060" cy="520" r="150"/><path d="M970 410c50 30 120 110 180 220M1150 410c-50 30-120 110-180 220"/></g></svg>`);

  await ctx.navigate(hubPage);
  const openFromArgs = (a) => { if (a?.game && os.apps.get(a.game)) ctx.navigate(gamePage, { id: a.game }); };
  openFromArgs(ctx.args);
  ctx.on('args', openFromArgs);

  async function hubPage(page) {
    await load();
    const secs = {};
    const pano = os.ui.panorama({
      title: 'games',
      background: bg,
      sections: [
        { header: 'xbox', render: (c) => (secs.profile = c) },
        { header: 'collection', render: (c) => (secs.collection = c) },
        { header: 'achievements', render: (c) => (secs.ach = c) },
        { header: 'get more games', render: (c) => (secs.more = c) },
      ],
    });
    pano.el.classList.add('games-pano');

    const renderProfile = () => {
      const c = secs.profile;
      const recent = [...data.achievements].sort((a, b) => b.unlocked - a.unlocked).slice(0, 3);
      const total = Object.values(data.catalogs).reduce((s, l) => s + l.length, 0);
      c.replaceChildren(
        el('div.games-profile.tilt', { onclick: editTag },
          el('div.games-avatar', { html: avatarSVG(data.tag, { size: 112 }) }),
          el('div.games-profile-text',
            el('div.games-tag', data.tag),
            el('div.games-score', { html: `<span class="games-g">${xboxLogo(18)}</span>${score()}` }),
            el('div.games-sub', `${data.achievements.length}${total ? ' of ' + total : ''} achievements`))),
        el('div.games-label', 'recent achievements'),
        recent.length ? el('div', recent.map((a) => achRow(a, { showGame: true }))) : el('div.games-empty', 'Play a game to start earning achievements and gamerscore.'),
      );
    };
    const renderCollection = () => {
      const c = secs.collection;
      const games = installedGames();
      c.replaceChildren(
        games.length ? el('div.games-grid', games.map((m) => {
          const t = gameTile(m);
          os.util.onLongPress(t, () => os.ui.contextMenu(t, [
            { label: 'details', onClick: () => ctx.navigate(gamePage, { id: m.id }) },
            os.tiles.isPinned(m.id) ? null : { label: 'pin to start', onClick: () => { os.tiles.pin(m.id); os.toast('Pinned to Start'); } },
            m.preinstalled === false ? { label: 'uninstall', onClick: async () => { if (await os.ui.confirm(`Uninstall ${m.name}?`, '', 'uninstall', 'cancel')) { await os.apps.uninstall(m.id); refresh(); } } } : null,
          ]));
          return t;
        })) : el('div.games-empty', 'No games yet.'),
        el('div.games-link.tilt', { onclick: () => os.launch('store', { category: 'game' }) }, 'get more games'),
      );
    };
    const renderAch = () => {
      const c = secs.ach;
      const ids = gameIds();
      c.replaceChildren(ids.length ? el('div', ids.map((id) => {
        const m = os.apps.get(id);
        const g = gameAch(id);
        const pb = os.ui.progressBar(g.total ? g.got / g.total : 0);
        pb.classList.add('games-pb');
        return el('div.games-achgame.tilt', { onclick: () => ctx.navigate(gamePage, { id }) },
          el('div.games-achgame-icon', { style: { background: m.color || 'var(--accent)' }, html: iconSVG(m.icon, { size: 28, stroke: 1.5 }) }),
          el('div.games-achgame-text', el('div.games-achgame-title', m.name),
            el('div.games-ach-sub', `${g.un.length}${(data.catalogs[id] || []).length ? ' of ' + data.catalogs[id].length : ''} achievements · ${g.got}${g.total ? '/' + g.total : ''}G`), pb));
      })) : el('div.games-empty', 'Your achievements will show up here.'));
    };
    const renderMore = () => {
      const c = secs.more;
      const list = storeGames();
      c.replaceChildren(
        list.length ? el('div', list.map((m) => el('div.games-store.tilt', { onclick: () => os.launch('store', { app: m.id }) },
          el('div.games-achgame-icon', { style: { background: m.color || 'var(--accent)' }, html: iconSVG(m.icon, { size: 28, stroke: 1.5 }) }),
          el('div.games-achgame-text', el('div.games-achgame-title', m.name), el('div.games-ach-sub', m.description || m.publisher || 'Xbox game'))))) : el('div.games-empty', 'You have every game we know about. Nice.'),
        el('div.games-link.tilt', { onclick: () => os.launch('store', { category: 'game' }) }, 'browse the Store'),
      );
    };
    const renderAll = () => { renderProfile(); renderCollection(); renderAch(); renderMore(); };
    async function refresh() { await load(); renderAll(); updateTile(); }
    async function editTag() {
      const v = await os.ui.prompt('Gamertag', data.tag, 'change gamertag');
      if (v == null) return;
      const t = v.trim().slice(0, 15);
      await storage.set('gamertag', t || null);
      refresh();
    }
    renderAll();

    const bar = appBar({
      minimized: true,
      menu: [
        { label: 'get more games', onClick: () => os.launch('store', { category: 'game' }) },
        { label: 'change gamertag', onClick: editTag },
        { label: 'refresh', onClick: refresh },
      ],
    });
    page.el.append(pano.el, bar.el);

    const offs = [os.apps.on('installed', refresh), os.apps.on('uninstalled', refresh)];
    const onResume = () => refresh();
    ctx.on('resume', onResume);
    return {
      onShow: () => refresh(),
      onDestroy: () => offs.forEach((f) => typeof f === 'function' && f()),
    };
  }

  /* ---------------- per-game details ---------------- */
  async function gamePage(page) {
    const id = page.params.id;
    const m = os.apps.get(id);
    await load();
    const g = gameAch(id);
    const stats = await os.storage(id).get('stats', null);
    const p = os.ui.page({ app: 'XBOX GAMES', title: m.name.toLowerCase() });
    const installed = os.apps.isInstalled(id);
    p.content.append(
      el('div.games-hero', { style: { background: m.color || 'var(--accent)' } },
        el('div.games-hero-icon', { html: iconSVG(m.icon, { size: 64, stroke: 1.3 }) }),
        el('div.games-hero-text', el('div.games-hero-g', `${g.got}${g.total ? ' / ' + g.total : ''} G`), el('div', `${g.un.length} achievement${g.un.length === 1 ? '' : 's'} unlocked`))),
      os.ui.button(installed ? 'play' : 'get it in the Store', () => (installed ? os.launch(id) : os.launch('store', { app: id })), { accent: true, cls: 'block' }),
    );
    const statRows = statsView(stats);
    if (statRows) p.content.append(os.ui.header('stats'), statRows);
    p.content.append(os.ui.header('achievements'));
    p.content.append(g.all.length ? el('div', g.all.map((a) => achRow(a))) : os.ui.empty('Launch the game to see its achievements.'));
    return p.el;
  }

  function statsView(stats) {
    if (!stats || typeof stats !== 'object') return null;
    const label = (k) => ({ played: 'games played', won: 'games won', best: 'best score', bestTime: 'best time', streak: 'current streak', bestStreak: 'best streak' }[k] || k.replace(/([A-Z])/g, ' $1').toLowerCase());
    const fmt = (k, v) => {
      if (/time/i.test(k)) { if (!v) return '–'; const s = Math.round(v); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
      return Number.isInteger(v) ? v.toLocaleString() : Math.round(v * 100) / 100;
    };
    const rows = Object.entries(stats).filter(([, v]) => typeof v === 'number' && isFinite(v));
    if (stats.played > 0 && typeof stats.won === 'number') rows.splice(2, 0, ['win rate', Math.round((stats.won / stats.played) * 100)]);
    if (!rows.length) return null;
    return el('div.games-stats', rows.map(([k, v]) => el('div.games-stat', el('div.games-stat-v', k === 'win rate' ? v + '%' : String(fmt(k, v))), el('div.games-stat-k', label(k)))));
  }

  async function updateTile() {
    try { await os.tiles.refresh('games'); } catch { /* not pinned */ }
  }
  updateTile();
  return {};
}
