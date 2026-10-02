// Music library: scans audio files in the virtual FS, reads tags (cached in app storage), stores cover art as fs thumbs.
import { parseID3, id3Size, fromFilename } from './id3.js';

const EXCLUDE = ['/Music/Recordings/', '/Music/Podcasts/', '/Ringtones/'];
export const UNKNOWN_ARTIST = 'Unknown artist';
export const UNKNOWN_ALBUM = 'Unknown album';

export const FREE_TRACKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
  id: 'sh' + n,
  src: `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`,
  title: `SoundHelix Song ${n}`,
  artist: 'SoundHelix',
  album: 'SoundHelix Examples',
}));

export async function readTags(os, path) {
  const blob = await os.fs.read(path);
  const name = os.path.basename(path);
  let tags = null;
  try {
    const head = await blob.slice(0, 10).arrayBuffer();
    const size = id3Size(head);
    if (size) tags = parseID3(await blob.slice(0, Math.min(blob.size, size)).arrayBuffer());
  } catch { tags = null; }
  const fb = fromFilename(name);
  const out = {
    title: tags?.title || fb.title,
    artist: tags?.artist || fb.artist || tags?.albumArtist || UNKNOWN_ARTIST,
    album: tags?.album || UNKNOWN_ALBUM,
    albumArtist: tags?.albumArtist || tags?.artist || fb.artist || UNKNOWN_ARTIST,
    track: tags?.track || 0,
    disc: tags?.disc || 0,
    year: tags?.year || '',
    genre: tags?.genre || '',
    duration: tags?.duration || 0,
    hasArt: false,
  };
  if (tags?.picture?.data?.length > 100) {
    try {
      const art = await os.util.makeThumbnail(new Blob([tags.picture.data], { type: tags.picture.mime }), 600, 0.88);
      await os.fs.setThumb(path, art);
      out.hasArt = true;
    } catch {}
  }
  return out;
}

/** Returns sorted song list [{ path, name, size, modified, title, artist, album, albumArtist, track, hasArt, ... }]. */
export async function scan(os, storage, { onProgress } = {}) {
  const files = (await os.fs.find('audio/')).filter((m) => !EXCLUDE.some((x) => m.path.startsWith(x)));
  const cache = await storage.get('tags', {});
  let changed = false, done = 0;
  const live = new Set();
  const songs = [];
  for (const f of files) {
    live.add(f.path);
    let t = cache[f.path];
    if (!t || t.m !== f.modified) {
      try { t = { ...(await readTags(os, f.path)), m: f.modified }; } catch { t = { ...fromFilename(f.name), artist: UNKNOWN_ARTIST, album: UNKNOWN_ALBUM, albumArtist: UNKNOWN_ARTIST, m: f.modified }; }
      cache[f.path] = t;
      changed = true;
      onProgress?.(++done, files.length);
    }
    songs.push({ ...t, path: f.path, name: f.name, size: f.size, modified: f.modified, created: f.created });
  }
  for (const k of Object.keys(cache)) if (!live.has(k)) { delete cache[k]; changed = true; }
  if (changed) await storage.set('tags', cache);
  songs.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  return songs;
}

export async function setDuration(storage, path, duration) {
  if (!isFinite(duration) || !duration) return;
  await storage.update('tags', (c) => { if (c[path] && !c[path].duration) c[path].duration = duration; return c; }, {});
}

export function groupAlbums(songs) {
  const m = new Map();
  for (const s of songs) {
    const k = s.album + '\u0000' + (s.album === UNKNOWN_ALBUM ? '' : s.albumArtist);
    if (!m.has(k)) m.set(k, { key: k, title: s.album, artist: s.albumArtist, year: s.year, songs: [] });
    const a = m.get(k);
    a.songs.push(s);
    if (!a.cover && s.hasArt) a.cover = s.path;
    if (!a.year && s.year) a.year = s.year;
  }
  for (const a of m.values()) a.songs.sort((x, y) => (x.disc || 0) - (y.disc || 0) || (x.track || 999) - (y.track || 999) || x.title.localeCompare(y.title));
  return [...m.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

export function groupArtists(songs) {
  const m = new Map();
  for (const s of songs) {
    if (!m.has(s.artist)) m.set(s.artist, { name: s.artist, songs: [] });
    const a = m.get(s.artist);
    a.songs.push(s);
    if (!a.cover && s.hasArt) a.cover = s.path;
  }
  return [...m.values()];
}

/** Queue item for os.media from a song. */
export async function toItem(os, s) {
  const art = s.hasArt ? await os.fs.thumb(s.path).catch(() => null) : null;
  return { path: s.path, title: s.title, artist: s.artist, album: s.album, art: art || undefined, appId: 'music' };
}
