// Generates the app icons in public/ (no dependencies): PNGs for the manifest / Apple touch icon,
// and a multi-size favicon.ico (16, 32, 48 — PNG-encoded entries) for Google Search and older browsers.
//   node scripts/gen-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';

const BG = [0x1b, 0xa1, 0xe2]; // cyan accent
// Windows Phone logo (4 panes) in a 24x24 coordinate space — same shape as public/icon.svg
const PANES = [
  [[2, 4.7], [9.8, 3.6], [9.8, 11.2], [2, 11.2]],
  [[10.8, 3.5], [22, 2], [22, 11.2], [10.8, 11.2]],
  [[2, 12.2], [9.8, 12.2], [9.8, 19.8], [2, 18.7]],
  [[10.8, 12.2], [22, 12.2], [22, 22], [10.8, 20.5]],
];
const inside = (x, y, p) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** Render the icon at size S (4x supersampled) and return a PNG buffer. */
function png(S) {
  const raw = Buffer.alloc(S * (S * 3 + 1));
  const off = S * 0.1875, scale = (S * 0.625) / 24;
  const samples = [0.125, 0.375, 0.625, 0.875];
  for (let y = 0; y < S; y++) {
    raw[y * (S * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < S; x++) {
      let hit = 0;
      for (const dy of samples) for (const dx of samples) if (PANES.some((p) => inside((x + dx - off) / scale, (y + dy - off) / scale, p))) hit++;
      const a = hit / 16, i = y * (S * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round(BG[k] + (255 - BG[k]) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** ICO container holding PNG-encoded images. */
function ico(sizes) {
  const images = sizes.map((s) => ({ s, data: png(s) }));
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ s, data }) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; // width, height
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);  // planes, bit count
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

for (const s of [180, 192, 512]) fs.writeFileSync(`public/icon-${s}.png`, png(s));
fs.writeFileSync('public/favicon.ico', ico([16, 32, 48]));
console.log('wrote public/icon-180.png, icon-192.png, icon-512.png, favicon.ico');
