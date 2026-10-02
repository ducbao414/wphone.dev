// Minimal ID3v2.2/2.3/2.4 reader: title, artist, album, album artist, track, year, genre, length and APIC cover art.
// Works on an ArrayBuffer containing at least the tag (first ~10 bytes + tag size).

const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

function decodeText(enc, b) {
  try {
    if (enc === 0) return latin1(b);
    if (enc === 3) return new TextDecoder('utf-8').decode(b);
    if (enc === 1) {
      if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
      if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
      return new TextDecoder('utf-16le').decode(b);
    }
    if (enc === 2) return new TextDecoder('utf-16be').decode(b);
  } catch {}
  return latin1(b);
}
const clean = (s) => s.replace(/\u0000+$/g, '').split('\u0000')[0].trim();

/** Find terminator index for encoding (1 byte for latin1/utf8, 2 aligned bytes for utf16). */
function termIndex(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  for (let i = start; i < b.length; i++) if (b[i] === 0) return i;
  return b.length;
}

function unsync(b) {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) { out[j++] = b[i]; if (b[i] === 0xff && b[i + 1] === 0x00) i++; }
  return out.subarray(0, j);
}

const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

/** Size in bytes needed to read the whole tag (header included), or 0 if no ID3v2 tag. */
export function id3Size(head) {
  const b = new Uint8Array(head);
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  return 10 + synchsafe(b, 6) + (b[5] & 0x10 ? 10 : 0);
}

const MAP = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TPE2: 'albumArtist', TP2: 'albumArtist',
  TRCK: 'track', TRK: 'track', TYER: 'year', TYE: 'year', TDRC: 'year', TCON: 'genre', TCO: 'genre', TLEN: 'length', TLE: 'length', TPOS: 'disc', TPA: 'disc',
};

/** Parse ID3v2 tag. Returns { title, artist, album, albumArtist, track, year, genre, duration, picture: { mime, data: Uint8Array } } or null. */
export function parseID3(buf) {
  let b = new Uint8Array(buf);
  if (b.length < 10 || latin1(b.subarray(0, 3)) !== 'ID3') return null;
  const ver = b[3], flags = b[5];
  const size = synchsafe(b, 6);
  let body = b.subarray(10, Math.min(b.length, 10 + size));
  if (flags & 0x80 && ver < 4) body = unsync(body);
  let pos = 0;
  if (flags & 0x40) { // extended header
    const ext = ver === 4 ? synchsafe(body, 0) : be32(body, 0) + 4;
    pos = ext;
  }
  const out = {};
  const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
  while (pos + hdrLen <= body.length) {
    const id = latin1(body.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsz;
    if (ver === 2) fsz = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5];
    else if (ver === 4) fsz = synchsafe(body, pos + 4);
    else fsz = be32(body, pos + 4);
    const fflags = ver === 2 ? 0 : (body[pos + 8] << 8) | body[pos + 9];
    pos += hdrLen;
    if (fsz <= 0 || pos + fsz > body.length) break;
    let f = body.subarray(pos, pos + fsz);
    pos += fsz;
    if (ver === 4) {
      if (fflags & 0x0001) f = f.subarray(4); // data length indicator
      if (fflags & 0x0002) f = unsync(f);
      if (fflags & 0x000c) continue; // compressed/encrypted: skip
    }
    if (MAP[id] && id[0] === 'T') {
      const v = clean(decodeText(f[0], f.subarray(1)));
      if (v && !out[MAP[id]]) out[MAP[id]] = v;
    } else if ((id === 'APIC' || id === 'PIC') && !out.picture) {
      const enc = f[0];
      let i = 1, mime;
      if (id === 'PIC') { const fmt = latin1(f.subarray(1, 4)).toLowerCase(); mime = fmt === 'png' ? 'image/png' : 'image/jpeg'; i = 4; }
      else { const e = termIndex(f, 1, 0); mime = latin1(f.subarray(1, e)) || 'image/jpeg'; i = e + 1; }
      i += 1; // picture type
      const d = termIndex(f, i, enc);
      i = d + (enc === 1 || enc === 2 ? 2 : 1);
      if (!mime.includes('/')) mime = 'image/' + (mime.toLowerCase() === 'png' ? 'png' : 'jpeg');
      if (i < f.length) out.picture = { mime, data: f.slice(i) };
    }
  }
  if (out.track) out.track = parseInt(out.track, 10) || undefined;
  if (out.disc) out.disc = parseInt(out.disc, 10) || undefined;
  if (out.year) out.year = String(out.year).slice(0, 4);
  if (out.genre) out.genre = out.genre.replace(/^\((\d+)\)$/, (_, n) => GENRES[n] || n).replace(/^\(\d+\)/, '');
  if (out.length) { out.duration = parseInt(out.length, 10) / 1000 || undefined; delete out.length; }
  return out;
}

const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'Alt. Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic'];

/** Fallback metadata from a file name like "Artist - Title.mp3" or "01 Title.mp3". */
export function fromFilename(name) {
  const stem = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = /^(.+?)\s+-\s+(.+)$/.exec(stem);
  if (m) return { artist: m[1].trim(), title: m[2].replace(/^\d{1,3}[.\s-]+/, '').trim() };
  return { title: stem.replace(/^\d{1,3}[.\s-]+(?=\D)/, '').trim() || stem };
}
