// Music (Xbox Music era, WP 8.1): collection pivot (artists/albums/songs/playlists/explore), now playing, queue, playlists.
import './style.css';
import { Shuffle, Repeat, Repeat1, ListMusic, ListPlus, Disc3, Upload, Music2, Download } from 'lucide';
import { scan, groupAlbums, groupArtists, toItem, setDuration, FREE_TRACKS, UNKNOWN_ARTIST } from './library.js';

export default async function launch(ctx) {
  const { os, storage, args } = ctx;
  const { el, I, iconSVG } = os.ui;
  const media = os.media;

  let songs = [];
  let playlists = await storage.get('playlists', []);
  const listeners = new Set();
  const onLib = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  let scanning = null;
  async function reload() {
    if (scanning) return scanning;
    scanning = (async () => {
      songs = await scan(os, storage);
      listeners.forEach((fn) => fn());
    })().finally(() => (scanning = null));
    return scanning;
  }
  const reloadSoon = os.util.debounce(reload, 400);
  const offFs = os.fs.on('change', ({ path }) => { if (/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|weba)$/i.test(path) || !/\.[a-z0-9]{2,4}$/i.test(path)) reloadSoon(); });
  const savePlaylists = async () => { await storage.set('playlists', playlists); listeners.forEach((fn) => fn()); };

  // Remember durations of local tracks once the player knows them.
  let durSaved = null;
  const offTime = media.on('time', (t, d) => {
    const c = media.current;
    if (c?.path && c.appId === 'music' && durSaved !== c.path && isFinite(d) && d > 0) { durSaved = c.path; setDuration(storage, c.path, d); const s = songs.find((x) => x.path === c.path); if (s && !s.duration) s.duration = d; }
  });

  /* ---------------- playback helpers ---------------- */
  async function playSongs(list, i = 0, { shuffle = false } = {}) {
    if (!list.length) return;
    if (shuffle) media.shuffle = true;
    const items = await Promise.all(list.map((s) => (s.src ? { ...s, appId: 'music' } : toItem(os, s))));
    if (shuffle) i = Math.floor(Math.random() * items.length);
    await media.playQueue(items, i);
  }
  async function playNext(s) {
    const it = await toItem(os, s);
    if (!media.current) return media.playOne(it);
    media.queue.splice(media.index + 1, 0, it);
    media.emit('change');
    os.toast('Playing next: ' + s.title);
  }
  async function enqueue(s) {
    const it = await toItem(os, s);
    if (!media.current) return media.playOne(it);
    media.enqueue(it);
    os.toast('Added to now playing');
  }
  async function addToPlaylist(paths) {
    const opts = [{ value: '__new', label: '+ new playlist' }, ...playlists.map((p) => ({ value: p.id, label: p.name }))];
    const v = await os.ui.pickFromList({ title: 'add to playlist', options: opts });
    if (!v) return;
    let pl;
    if (v === '__new') { pl = await createPlaylist(); if (!pl) return; } else pl = playlists.find((p) => p.id === v);
    for (const p of paths) if (!pl.items.includes(p)) pl.items.push(p);
    await savePlaylists();
    os.toast(`Added to ${pl.name}`);
  }
  async function createPlaylist() {
    const name = (await os.ui.prompt('Playlist name', '', 'new playlist'))?.trim();
    if (!name) return null;
    const pl = { id: os.util.uid(), name, items: [], created: Date.now() };
    playlists.push(pl);
    await savePlaylists();
    return pl;
  }
  async function deleteSongs(list) {
    const ok = await os.ui.confirm(list.length === 1 ? `Delete "${list[0].title}" from your phone?` : `Delete ${list.length} songs from your phone?`, 'delete', 'delete', 'cancel');
    if (!ok) return false;
    const paths = new Set(list.map((s) => s.path));
    if (media.current?.path && paths.has(media.current.path)) {
      if (media.queue.length > 1) { const q = media.queue.filter((x) => !paths.has(x.path)); if (q.length) await media.playQueue(q, 0); else media.stop(); } else media.stop();
    }
    for (const p of paths) await os.fs.remove(p);
    let ch = false;
    for (const pl of playlists) { const n = pl.items.filter((x) => !paths.has(x)); if (n.length !== pl.items.length) { pl.items = n; ch = true; } }
    if (ch) await savePlaylists();
    await reload();
    return true;
  }
  function importMusic() {
    const inp = el('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.flac,.ogg,.wav', multiple: true, style: { display: 'none' } });
    document.body.append(inp);
    inp.onchange = async () => {
      const files = [...inp.files];
      inp.remove();
      if (!files.length) return;
      os.toast(`Adding ${files.length} song${files.length > 1 ? 's' : ''}…`);
      await os.fs.importFiles(files, '/Music');
      await reload();
      os.toast('Music added to your collection');
    };
    inp.click();
    setTimeout(() => inp.remove(), 120000);
  }
  async function saveFree(t) {
    os.toast('Downloading ' + t.title + '…');
    try {
      const r = await fetch(os.net.proxyUrl(t.src));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const p = await os.fs.uniquePath(`/Music/${t.artist}/${t.title}.mp3`);
      await os.fs.write(p, new Blob([blob], { type: 'audio/mpeg' }), { mime: 'audio/mpeg' });
      await reload();
      os.toast('Saved to your collection');
    } catch (e) { os.toast('Download failed: ' + e.message); }
  }

  const isCurrent = (s) => { const c = media.current; return !!c && (s.path ? c.path === s.path : c.src === s.src); };

  /* ---------------- shared rendering ---------------- */
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) {
      io.unobserve(e.target);
      os.fs.thumb(e.target._art).then((u) => { if (u) { e.target.style.backgroundImage = `url("${u}")`; e.target.classList.add('has-art'); } });
    }
  }, { rootMargin: '200px' });
  const artBox = (cls, path, size = 34) => {
    const n = el('div.' + cls, { html: iconSVG(Music2, { size, stroke: 1.4 }) });
    if (path) { n._art = path; io.observe(n); }
    return n;
  };

  function songRow(s, { showAlbum = true, num } = {}) {
    const sub = [s.artist, showAlbum ? s.album : null].filter(Boolean).join(' • ');
    const n = el('div.music-song' + (isCurrent(s) ? '.playing' : ''), { dataset: { path: s.path || s.src } },
      num != null ? el('div.music-song-num', String(num)) : null,
      el('div.music-song-text', el('div.music-song-title', s.title), el('div.music-song-sub', sub)),
      s.duration ? el('div.music-song-dur', os.util.formatDuration(s.duration)) : null);
    return n;
  }
  function songMenu(s, anchor, extra = []) {
    os.ui.contextMenu(anchor, [
      { label: 'play next', onClick: () => playNext(s) },
      { label: 'add to now playing', onClick: () => enqueue(s) },
      { label: 'add to playlist', onClick: () => addToPlaylist([s.path]) },
      ...extra,
      { label: 'share', onClick: () => os.share({ path: s.path, title: s.title }) },
      { label: 'delete', onClick: () => deleteSongs([s]) },
    ]);
  }
  function songList(list, { showAlbum = true, numbered = false, extraMenu } = {}) {
    const root = el('div.music-songs');
    list.forEach((s, i) => {
      const r = songRow(s, { showAlbum, num: numbered ? s.track || i + 1 : null });
      r.classList.add('tilt');
      r.addEventListener('click', () => playSongs(list, i));
      os.util.onLongPress(r, () => songMenu(s, r, extraMenu ? extraMenu(s) : []));
      root.append(r);
    });
    return root;
  }
  // keep "playing" highlight in sync everywhere
  const offTrack = media.on('track', () => {
    for (const n of ctx.root.querySelectorAll('.music-song')) {
      const c = media.current;
      n.classList.toggle('playing', !!c && (c.path === n.dataset.path || c.src === n.dataset.path));
    }
  });

  /* ---------------- mini "now playing" bar ---------------- */
  function miniBar() {
    const art = el('div.music-mini-art');
    const title = el('div.music-mini-title'), artist = el('div.music-mini-artist');
    const btn = el('button.music-mini-play', { 'aria-label': 'play/pause', onclick: (e) => { e.stopPropagation(); media.toggle(); } });
    const prog = el('div.music-mini-prog', el('i'));
    const n = el('div.music-mini.tilt', { onclick: () => ctx.navigate(nowPlayingPage) }, prog, art, el('div.music-mini-text', title, artist), btn);
    const draw = () => {
      const c = media.current;
      n.hidden = !c;
      if (!c) return;
      title.textContent = c.title || 'Unknown';
      artist.textContent = c.artist || '';
      art.style.backgroundImage = c.art ? `url("${c.art}")` : '';
      art.innerHTML = c.art ? '' : iconSVG(Music2, { size: 20 });
      btn.innerHTML = iconSVG(media.playing ? I.pause : I.play, { size: 20, stroke: 2 });
    };
    const t = (cur, dur) => { prog.firstChild.style.width = (isFinite(dur) && dur ? (cur / dur) * 100 : 0) + '%'; };
    const offs = [media.on('change', draw), media.on('track', draw), media.on('time', t)];
    draw();
    n.dispose = () => offs.forEach((f) => f());
    return n;
  }

  /* ---------------- hub ---------------- */
  function hubPage() {
    const views = {};
    const render = {
      artists(c) {
        if (!songs.length) return emptyState(c);
        const artists = groupArtists(songs);
        c.replaceChildren(os.ui.jumpList(artists, {
          key: (a) => a.name === UNKNOWN_ARTIST ? '#' + a.name : a.name,
          render: (a) => el('div.music-artist-row', el('div.music-artist-name', a.name.toLowerCase()), el('div.music-song-sub', `${a.songs.length} song${a.songs.length > 1 ? 's' : ''}`)),
          onClick: (a) => ctx.navigate(artistPage, { name: a.name }),
          onHold: (a, n) => os.ui.contextMenu(n, [
            { label: 'play', onClick: () => playSongs(a.songs) },
            { label: 'shuffle', onClick: () => playSongs(a.songs, 0, { shuffle: true }) },
            { label: 'add to playlist', onClick: () => addToPlaylist(a.songs.map((s) => s.path)) },
          ]),
        }));
      },
      albums(c) {
        if (!songs.length) return emptyState(c);
        const albums = groupAlbums(songs);
        const grid = el('div.music-album-grid');
        for (const a of albums) {
          const t = el('div.music-album-tile.tilt', artBox('music-album-art', a.cover, 40), el('div.music-album-name', a.title), el('div.music-album-artist', a.artist));
          t.addEventListener('click', () => ctx.navigate(albumPage, { key: a.key }));
          os.util.onLongPress(t, () => os.ui.contextMenu(t, [
            { label: 'play', onClick: () => playSongs(a.songs) },
            { label: 'add to now playing', onClick: async () => { for (const s of a.songs) await enqueue(s); } },
            { label: 'add to playlist', onClick: () => addToPlaylist(a.songs.map((s) => s.path)) },
            { label: 'delete', onClick: () => deleteSongs(a.songs) },
          ]));
          grid.append(t);
        }
        c.replaceChildren(grid);
      },
      songs(c) {
        if (!songs.length) return emptyState(c);
        const root = os.ui.jumpList(songs, {
          key: (s) => s.title,
          render: (s) => songRow(s),
          onClick: (s) => playSongs(songs, songs.indexOf(s)),
          onHold: (s, n) => songMenu(s, n),
        });
        c.replaceChildren(el('div.music-shuffle-all.tilt', { onclick: () => playSongs(songs, 0, { shuffle: true }), html: iconSVG(Shuffle, { size: 20 }) + '<span>shuffle all</span>' }), root);
      },
      playlists(c) {
        const rows = playlists.map((p) => {
          const r = el('div.music-pl-row.tilt', el('div.music-pl-icon', { html: iconSVG(ListMusic, { size: 28, stroke: 1.5 }) }),
            el('div.music-song-text', el('div.music-song-title', p.name), el('div.music-song-sub', `${p.items.length} song${p.items.length === 1 ? '' : 's'}`)));
          r.addEventListener('click', () => ctx.navigate(playlistPage, { id: p.id }));
          os.util.onLongPress(r, () => os.ui.contextMenu(r, [
            { label: 'play', onClick: () => playSongs(resolve(p.items)) },
            { label: 'rename', onClick: async () => { const n = (await os.ui.prompt('Playlist name', p.name, 'rename'))?.trim(); if (n) { p.name = n; savePlaylists(); } } },
            { label: 'delete', onClick: async () => { if (await os.ui.confirm(`Delete playlist "${p.name}"? Songs stay in your collection.`, 'delete', 'delete', 'cancel')) { playlists = playlists.filter((x) => x !== p); savePlaylists(); } } },
          ]));
          return r;
        });
        c.replaceChildren(el('div.music-new-pl.tilt', { onclick: async () => { const p = await createPlaylist(); if (p) ctx.navigate(playlistPage, { id: p.id }); }, html: iconSVG(I.add, { size: 22 }) + '<span>new playlist</span>' }), ...rows);
        if (!rows.length) c.append(os.ui.desc('Playlists you create appear here. Tap and hold a song to add it to a playlist.'));
      },
      explore(c) {
        c.replaceChildren(
          os.ui.header('free music'),
          os.ui.desc('Royalty-free instrumental tracks generated by SoundHelix (soundhelix.com), streamed over the internet. Tap and hold to save one to your collection.'),
          songList(FREE_TRACKS.map((t) => ({ ...t, path: undefined })), { showAlbum: false }),
        );
        // free tracks have no path: replace hold menus
        c.querySelectorAll('.music-song').forEach((r, i) => {
          const t = FREE_TRACKS[i];
          const clone = r.cloneNode(true);
          r.replaceWith(clone);
          clone.addEventListener('click', () => playSongs(FREE_TRACKS, i));
          os.util.onLongPress(clone, () => os.ui.contextMenu(clone, [
            { label: 'play', onClick: () => playSongs(FREE_TRACKS, i) },
            { label: 'save to collection', onClick: () => saveFree(t) },
          ]));
        });
      },
    };
    function emptyState(c) {
      c.replaceChildren(el('div.music-empty',
        el('div.music-empty-title', 'no music yet'),
        os.ui.desc('Add songs from your device to build your collection, or check out free music in explore.'),
        os.ui.button('add music', importMusic, { accent: true }),
        os.ui.button('explore free music', () => pv.select(4))));
    }
    const pv = os.ui.pivot({
      app: 'MUSIC',
      items: ['artists', 'albums', 'songs', 'playlists', 'explore'].map((h) => ({ header: h, render: (c) => { views[h] = c; if (h === 'explore' || h === 'playlists' || songs.length || !scanning) render[h](c); else c.replaceChildren(os.ui.loadingDots({ inline: true })); } })),
      index: songs.length || !(args?.tab === 'explore') ? 0 : 4,
    });
    const mini = miniBar();
    const bar = os.ui.appBar({
      buttons: [
        { icon: Shuffle, label: 'shuffle all', onClick: () => songs.length ? playSongs(songs, 0, { shuffle: true }) : playSongs(FREE_TRACKS, 0, { shuffle: true }) },
        { icon: Upload, label: 'add music', onClick: importMusic },
        { icon: Disc3, label: 'now playing', onClick: () => media.current ? ctx.navigate(nowPlayingPage) : os.toast('Nothing is playing') },
      ],
      menu: [
        { label: 'new playlist', onClick: async () => { const p = await createPlaylist(); if (p) ctx.navigate(playlistPage, { id: p.id }); } },
        { label: 'refresh collection', onClick: async () => { await storage.set('tags', {}); await reload(); os.toast(`${songs.length} songs`); } },
      ],
    });
    const off = onLib(() => { for (const [h, c] of Object.entries(views)) render[h](c); });
    return { el: el('div.music-hub', pv.el, mini, bar.el), onDestroy() { off(); mini.dispose(); } };
  }

  const resolve = (paths) => paths.map((p) => songs.find((s) => s.path === p)).filter(Boolean);

  /* ---------------- album / artist / playlist pages ---------------- */
  function albumPage(page) {
    const p = os.ui.page({ app: 'MUSIC', title: '' });
    const wrap = el('div');
    p.content.append(wrap);
    let album;
    const draw = () => {
      album = groupAlbums(songs).find((a) => a.key === page.params.key);
      if (!album) { wrap.replaceChildren(os.ui.empty('album not found')); return; }
      p.setTitle(album.title.toLowerCase());
      const meta = [album.artist, album.year, `${album.songs.length} song${album.songs.length > 1 ? 's' : ''}`].filter(Boolean).join(' • ');
      wrap.replaceChildren(
        el('div.music-album-head', artBox('music-album-hero', album.cover, 48), el('div.music-album-meta', el('div.music-album-hartist', album.artist), el('div.music-song-sub', meta),
          os.ui.button('play', () => playSongs(album.songs), { icon: I.play }))),
        songList(album.songs, { showAlbum: false, numbered: true }));
    };
    const bar = os.ui.appBar({
      buttons: [
        { icon: I.play, label: 'play', onClick: () => playSongs(album.songs) },
        { icon: Shuffle, label: 'shuffle', onClick: () => playSongs(album.songs, 0, { shuffle: true }) },
        { icon: ListPlus, label: 'add to', onClick: () => addToPlaylist(album.songs.map((s) => s.path)) },
      ],
      menu: [{ label: 'pin to start', onClick: () => { ctx.pinTile({ key: 'music:album:' + page.params.key, title: album.title, args: { album: page.params.key } }); os.toast('Pinned'); } },
        { label: 'delete album', onClick: async () => { if (await deleteSongs(album.songs)) ctx.back(); } }],
    });
    p.el.append(bar.el);
    draw();
    return { el: p.el, onDestroy: onLib(draw) };
  }

  function artistPage(page) {
    const name = page.params.name;
    const p = os.ui.page({ app: 'MUSIC', title: name.toLowerCase() });
    const draw = () => {
      const list = songs.filter((s) => s.artist === name);
      const albums = groupAlbums(list);
      p.content.replaceChildren();
      if (!list.length) { p.content.append(os.ui.empty('no songs')); return; }
      p.content.append(os.ui.header('albums'));
      const grid = el('div.music-album-grid');
      for (const a of albums) {
        const t = el('div.music-album-tile.tilt', artBox('music-album-art', a.cover, 40), el('div.music-album-name', a.title), el('div.music-album-artist', a.year || `${a.songs.length} songs`));
        t.addEventListener('click', () => ctx.navigate(albumPage, { key: a.key }));
        grid.append(t);
      }
      p.content.append(grid, os.ui.header('songs'), songList(list));
    };
    const bar = os.ui.appBar({
      buttons: [
        { icon: I.play, label: 'play all', onClick: () => playSongs(songs.filter((s) => s.artist === name)) },
        { icon: Shuffle, label: 'shuffle', onClick: () => playSongs(songs.filter((s) => s.artist === name), 0, { shuffle: true }) },
        { icon: I.search, label: 'web', onClick: () => os.launch('ie', { url: 'https://en.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(name) }) },
      ],
    });
    p.el.append(bar.el);
    draw();
    return { el: p.el, onDestroy: onLib(draw) };
  }

  function playlistPage(page) {
    const p = os.ui.page({ app: 'MUSIC · PLAYLIST', title: '' });
    const pl = () => playlists.find((x) => x.id === page.params.id);
    const draw = () => {
      const l = pl();
      if (!l) { p.content.replaceChildren(os.ui.empty('playlist deleted')); return; }
      p.setTitle(l.name.toLowerCase());
      const list = resolve(l.items);
      p.content.replaceChildren(el('div.music-song-sub.music-pl-count', `${list.length} song${list.length === 1 ? '' : 's'}`));
      if (!list.length) { p.content.append(os.ui.empty('this playlist is empty'), os.ui.button('add songs', addSongs)); return; }
      p.content.append(songList(list, { extraMenu: (s) => [{ label: 'remove from playlist', onClick: () => { l.items = l.items.filter((x) => x !== s.path); savePlaylists(); } }] }));
    };
    async function addSongs() {
      if (!songs.length) return os.toast('Your collection is empty');
      const l = pl();
      const v = await os.ui.pickFromList({ title: 'add a song', options: songs.filter((s) => !l.items.includes(s.path)).map((s) => ({ value: s.path, label: `${s.title} — ${s.artist}` })) });
      if (v) { l.items.push(v); savePlaylists(); }
    }
    const bar = os.ui.appBar({
      buttons: [
        { icon: I.play, label: 'play', onClick: () => playSongs(resolve(pl()?.items || [])) },
        { icon: Shuffle, label: 'shuffle', onClick: () => playSongs(resolve(pl()?.items || []), 0, { shuffle: true }) },
        { icon: I.add, label: 'add songs', onClick: addSongs },
      ],
      menu: [
        { label: 'rename', onClick: async () => { const l = pl(); const n = (await os.ui.prompt('Playlist name', l.name, 'rename'))?.trim(); if (n) { l.name = n; savePlaylists(); } } },
        { label: 'delete playlist', onClick: async () => { const l = pl(); if (await os.ui.confirm(`Delete playlist "${l.name}"?`, 'delete', 'delete', 'cancel')) { playlists = playlists.filter((x) => x !== l); await savePlaylists(); ctx.back(); } } },
      ],
    });
    p.el.append(bar.el);
    draw();
    return { el: p.el, onDestroy: onLib(draw) };
  }

  /* ---------------- now playing ---------------- */
  function nowPlayingPage() {
    const art = el('div.music-np-art');
    const artist = el('div.music-np-artist'), title = el('div.music-np-title'), album = el('div.music-np-album');
    const fill = el('div.music-np-fill'), knob = el('div.music-np-knob');
    const barEl = el('div.music-np-bar', el('div.music-np-track', fill, knob));
    const tCur = el('span', '0:00'), tDur = el('span', '0:00');
    const btn = (icon, label, fn, cls = '') => el('button.music-np-btn' + cls, { 'aria-label': label, onclick: fn, html: iconSVG(icon, { size: cls ? 30 : 24, stroke: 2 }) });
    const playBtn = btn(I.play, 'play', () => media.toggle(), '.big');
    const nextUp = el('div.music-np-next');
    const root = el('div.music-np',
      el('div.wp-app-title.music-np-apptitle', 'NOW PLAYING'),
      el('div.music-np-body', art,
        el('div.music-np-info', artist, title, album),
        barEl, el('div.music-np-times', tCur, tDur),
        el('div.music-np-controls', btn(I.prev, 'previous', () => media.prev()), playBtn, btn(I.next, 'next', () => media.next())),
        nextUp));
    const bar = os.ui.appBar({});
    root.append(bar.el);
    let seeking = false;
    const setBar = () => bar.setButtons([
      { icon: Shuffle, label: media.shuffle ? 'shuffle on' : 'shuffle off', onClick: () => { media.shuffle = !media.shuffle; media.emit('change'); os.toast(media.shuffle ? 'Shuffle on' : 'Shuffle off'); } },
      { icon: media.repeat === 'one' ? Repeat1 : Repeat, label: 'repeat ' + media.repeat, onClick: () => { media.repeat = media.repeat === 'none' ? 'all' : media.repeat === 'all' ? 'one' : 'none'; media.emit('change'); os.toast('Repeat: ' + media.repeat); } },
      { icon: ListMusic, label: 'queue', onClick: () => ctx.navigate(queuePage) },
      { icon: ListPlus, label: 'add to', disabled: !media.current?.path, onClick: () => media.current?.path && addToPlaylist([media.current.path]) },
    ]);
    const draw = () => {
      const c = media.current;
      if (!c) { title.textContent = 'nothing playing'; artist.textContent = album.textContent = ''; art.style.backgroundImage = ''; art.innerHTML = iconSVG(Music2, { size: 80, stroke: 1 }); setBar(); return; }
      artist.textContent = (c.artist || '').toUpperCase();
      title.textContent = c.title || 'Unknown';
      album.textContent = c.album || '';
      art.style.backgroundImage = c.art ? `url("${c.art}")` : '';
      art.innerHTML = c.art ? '' : iconSVG(Music2, { size: 80, stroke: 1 });
      playBtn.innerHTML = iconSVG(media.playing ? I.pause : I.play, { size: 30, stroke: 2 });
      root.classList.toggle('live', !!c.live);
      const n = media.queue[media.index + 1];
      nextUp.textContent = n && !media.shuffle ? `next: ${n.title}${n.artist ? ' – ' + n.artist : ''}` : '';
      setBar();
      bar.el.querySelectorAll('.wp-appbar-btn').forEach((b, i) => b.classList.toggle('music-on', (i === 0 && media.shuffle) || (i === 1 && media.repeat !== 'none')));
    };
    const time = (cur, dur) => {
      if (seeking) return;
      const f = isFinite(dur) && dur ? cur / dur : 0;
      fill.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%';
      tCur.textContent = os.util.formatDuration(cur);
      tDur.textContent = isFinite(dur) ? os.util.formatDuration(dur) : 'live';
    };
    const frac = (e) => { const r = barEl.getBoundingClientRect(); return os.util.clamp((e.clientX - r.left) / r.width, 0, 1); };
    barEl.addEventListener('pointerdown', (e) => {
      const d = media.audio.duration;
      if (!isFinite(d) || !d) return;
      seeking = true; barEl.setPointerCapture(e.pointerId);
      const upd = (ev) => { const f = frac(ev); fill.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%'; tCur.textContent = os.util.formatDuration(f * d); };
      upd(e);
      const mv = (ev) => upd(ev);
      const up = (ev) => { seeking = false; media.seek(frac(ev) * d); barEl.removeEventListener('pointermove', mv); barEl.removeEventListener('pointerup', up); barEl.removeEventListener('pointercancel', up); };
      barEl.addEventListener('pointermove', mv); barEl.addEventListener('pointerup', up); barEl.addEventListener('pointercancel', up);
    });
    // swipe album art to skip
    os.util.onSwipe(art, (d) => { if (d === 'left') media.next(); else if (d === 'right') media.prev(); });
    const offs = [media.on('change', draw), media.on('track', draw), media.on('time', time)];
    draw(); time(media.audio.currentTime, media.audio.duration);
    return { el: root, onDestroy: () => offs.forEach((f) => f()) };
  }

  function queuePage() {
    const p = os.ui.page({ app: 'NOW PLAYING', title: 'queue' });
    const draw = () => {
      const q = media.queue;
      if (!q.length) { p.content.replaceChildren(os.ui.empty('the queue is empty')); return; }
      const root = el('div.music-songs');
      q.forEach((it, i) => {
        const r = el('div.music-song.tilt' + (i === media.index ? '.playing' : ''), el('div.music-song-text', el('div.music-song-title', it.title || 'Unknown'), el('div.music-song-sub', it.artist || '')));
        r.addEventListener('click', () => media.playQueue(media.queue, i));
        os.util.onLongPress(r, () => os.ui.contextMenu(r, [
          { label: 'play', onClick: () => media.playQueue(media.queue, i) },
          i !== media.index ? { label: 'remove from queue', onClick: () => { media.queue.splice(i, 1); if (i < media.index) media.index--; media.emit('change'); } } : null,
        ]));
        root.append(r);
      });
      p.content.replaceChildren(root);
      root.children[media.index]?.scrollIntoView({ block: 'center' });
    };
    const bar = os.ui.appBar({ buttons: [
      { icon: I.delete, label: 'clear', onClick: () => { const c = media.current; if (c) { media.queue.splice(0, media.queue.length, c); media.index = 0; media.emit('change'); } } },
    ] });
    p.el.append(bar.el);
    const offs = [media.on('change', draw), media.on('track', draw)];
    draw();
    return { el: p.el, onDestroy: () => offs.forEach((f) => f()) };
  }

  /* ---------------- start ---------------- */
  reload();
  await ctx.navigate(hubPage);
  async function openArgs(a) {
    if (!a) return;
    if (a.file) {
      await (scanning || reload());
      const s = songs.find((x) => x.path === a.file);
      if (s) { const dirSongs = songs.filter((x) => x.path.slice(0, x.path.lastIndexOf('/')) === s.path.slice(0, s.path.lastIndexOf('/'))); await playSongs(dirSongs, dirSongs.indexOf(s)); }
      else { const m = await os.fs.stat(a.file); if (m) await media.playOne({ path: a.file, title: m.name.replace(/\.[^.]+$/, ''), artist: '', appId: 'music' }); }
      ctx.navigate(nowPlayingPage);
    } else if (a.album) {
      await (scanning || reload());
      ctx.navigate(albumPage, { key: a.album });
    } else if (a.nowPlaying && media.current) ctx.navigate(nowPlayingPage);
  }
  openArgs(args);
  ctx.on('args', openArgs);

  return { onDestroy() { offFs(); offTime(); offTrack(); io.disconnect(); } };
}

export { Download };
