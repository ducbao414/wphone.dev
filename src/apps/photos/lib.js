// Shared helpers for the Photos app.
export const PICS = '/Pictures';
export const DEFAULT_ALBUMS = ['/Pictures/Camera Roll', '/Pictures/Saved Pictures', '/Pictures/Screenshots'];

export const isMedia = (m) => m.type === 'file' && (/^image\//.test(m.mime || '') || (/^video\//.test(m.mime || '') && m.path.startsWith(PICS + '/')));
export const isVideo = (m) => /^video\//.test(m.mime || '');
export const takenOf = (m) => m.taken || m.created || m.modified || 0;
export const byNewest = (a, b) => takenOf(b) - takenOf(a);

/** All photos (+ camera roll videos), newest first. */
export async function allMedia(os) {
  const all = await os.fs.walk('/', isMedia);
  return all.sort(byNewest);
}

/** Album key for a file: top-level folder below /Pictures, or its parent folder elsewhere. */
export function albumOf(path) {
  if (path.startsWith(PICS + '/')) {
    const rest = path.slice(PICS.length + 1).split('/');
    return rest.length > 1 ? PICS + '/' + rest[0] : PICS;
  }
  return path.slice(0, path.lastIndexOf('/')) || '/';
}

const posterJobs = new Map();
/** Thumbnail URL for a photo or video (video posters are generated once and stored with fs.setThumb). */
export async function thumbFor(os, meta) {
  if (!isVideo(meta)) return os.fs.thumb(meta.path).catch(() => null);
  const t = await os.fs.thumb(meta.path).catch(() => null);
  if (t) return t;
  if (!posterJobs.has(meta.path)) posterJobs.set(meta.path, makePoster(os, meta.path).finally(() => posterJobs.delete(meta.path)));
  return posterJobs.get(meta.path);
}

export async function makePoster(os, path) {
  const blob = await os.fs.read(path);
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('bad video')); setTimeout(() => rej(new Error('timeout')), 8000); });
    const target = Math.min(1, (v.duration && isFinite(v.duration)) ? v.duration / 3 : 0.1);
    await new Promise((res) => { v.onseeked = res; v.currentTime = target; setTimeout(res, 2500); });
    const s = Math.min(1, 384 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * s)); c.height = Math.max(1, Math.round(v.videoHeight * s));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    if (!b) return null;
    await os.fs.setThumb(path, b);
    return os.fs.thumb(path);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** Shared IntersectionObserver that lazy-loads background thumbnails for elements with ._meta. */
export function lazyThumbs(os) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const n = e.target;
      thumbFor(os, n._meta).then((u) => { if (u) { n.style.backgroundImage = `url("${u}")`; n.classList.add('loaded'); } });
    }
  }, { rootMargin: '300px 0px' });
  return io;
}

export const monthKey = (ts) => { const d = new Date(ts); return d.getFullYear() * 12 + d.getMonth(); };
export const monthLabel = (ts) => new Date(ts).toLocaleDateString([], { month: 'long', year: 'numeric' }).toLowerCase();

/* -------------------- image processing (editor) -------------------- */
export const FILTERS = [
  { id: 'none', name: 'original' },
  { id: 'mono', name: 'mono' },
  { id: 'sepia', name: 'sepia' },
  { id: 'vivid', name: 'vivid' },
  { id: 'cool', name: 'cool' },
  { id: 'warm', name: 'warm' },
  { id: 'fade', name: 'fade' },
];

/** Compute auto-fix levels (luminance 1st/99th percentile) from ImageData. */
export function autoLevels(data) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < data.length; i += 16) { hist[(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0]++; n++; }
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.01) { hi = v; break; } }
  if (hi - lo < 30) { lo = Math.max(0, lo - 15); hi = Math.min(255, hi + 15); }
  // mean brightness → gamma toward mid-grey
  let sum = 0, cnt = 0;
  for (let v = 0; v < 256; v++) { sum += v * hist[v]; cnt += hist[v]; }
  const mean = (sum / Math.max(1, cnt) - lo) / Math.max(1, hi - lo);
  const raw = Math.log(Math.min(0.95, Math.max(0.05, mean))) / Math.log(0.5); // pow(mean, 1/raw) = 0.5
  const gamma = Math.min(1.6, Math.max(0.6, 1 + (raw - 1) * 0.6));
  return { lo, hi, gamma };
}

/** Apply levels + filter to ImageData in place. */
export function processPixels(img, { levels, filter = 'none' }) {
  const d = img.data;
  let lut = null;
  if (levels) {
    lut = new Uint8ClampedArray(256);
    const { lo, hi, gamma } = levels;
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / (hi - lo))), 1 / gamma);
  }
  if (!lut && filter === 'none') return img;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (lut) {
      r = lut[r]; g = lut[g]; b = lut[b];
      const l = 0.299 * r + 0.587 * g + 0.114 * b; // light saturation boost
      r = l + (r - l) * 1.12; g = l + (g - l) * 1.12; b = l + (b - l) * 1.12;
    }
    switch (filter) {
      case 'mono': r = g = b = 0.299 * r + 0.587 * g + 0.114 * b; break;
      case 'sepia': { const nr = 0.393 * r + 0.769 * g + 0.189 * b, ng = 0.349 * r + 0.686 * g + 0.168 * b, nb = 0.272 * r + 0.534 * g + 0.131 * b; r = nr; g = ng; b = nb; break; }
      case 'vivid': { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * 1.6; g = l + (g - l) * 1.6; b = l + (b - l) * 1.6; r = (r - 128) * 1.1 + 128; g = (g - 128) * 1.1 + 128; b = (b - 128) * 1.1 + 128; break; }
      case 'cool': r = r * 0.9; b = b * 1.1 + 10; break;
      case 'warm': r = r * 1.1 + 10; b = b * 0.88; break;
      case 'fade': r = r * 0.8 + 40; g = g * 0.8 + 40; b = b * 0.8 + 45; break;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return img;
}

/** Render source bitmap with rotation (0/90/180/270) and optional centered square crop into a canvas of max size. */
export function renderTransformed(src, { rotate = 0, square = false, max = Infinity }) {
  const sw = src.width, sh = src.height;
  let cw = sw, ch = sh, cx = 0, cy = 0;
  if (square) { const s = Math.min(sw, sh); cx = (sw - s) / 2; cy = (sh - s) / 2; cw = ch = s; }
  const rot = ((rotate % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const scale = Math.min(1, max / Math.max(cw, ch));
  const ow = Math.round((swap ? ch : cw) * scale), oh = Math.round((swap ? cw : ch) * scale);
  const c = document.createElement('canvas');
  c.width = ow; c.height = oh;
  const g = c.getContext('2d');
  g.translate(ow / 2, oh / 2);
  g.rotate((rot * Math.PI) / 180);
  const dw = cw * scale, dh = ch * scale;
  g.drawImage(src, cx, cy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  return c;
}
