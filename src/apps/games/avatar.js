// Procedural Xbox-360-style avatar drawn as SVG, deterministic from a seed string.
const SKIN = ['#f6d3b3', '#eabf98', '#d7a173', '#b97c4f', '#8d5a36', '#5e3a22'];
const HAIR = ['#1b1b1b', '#3b2416', '#6b3f1f', '#a5652b', '#d9a441', '#c94a24', '#7c7c7c', '#2d3e8f'];
const SHIRT = ['#107C10', '#1BA1E2', '#E51400', '#F09609', '#A200FF', '#00ABA9', '#D80073', '#3a3a3a', '#FFC40D', '#2D89EF'];
const BG = ['#0f3d0f', '#123b52', '#3d1a0f', '#2a1240', '#0d3b3a', '#3b3b0f'];

export function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let a = seed || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Returns an SVG string. opts: { size, bg (bool), full (bool: draw body to bottom) } */
export function avatarSVG(seed, { size = 120, bg = true } = {}) {
  const r = rng(hash(seed));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const skin = pick(SKIN), hair = pick(HAIR), shirt = pick(SHIRT), back = pick(BG);
  const hairStyle = Math.floor(r() * 5);
  const eyeStyle = Math.floor(r() * 3);
  const glasses = r() < 0.25;
  const beard = r() < 0.2;
  const smile = Math.floor(r() * 3);
  const parts = [];
  if (bg) parts.push(`<rect width="100" height="100" fill="${back}"/>`, `<circle cx="50" cy="40" r="44" fill="#fff" opacity=".06"/>`);
  // body / shirt
  parts.push(`<path d="M14 100 C16 78 30 70 50 70 C70 70 84 78 86 100 Z" fill="${shirt}"/>`);
  parts.push(`<path d="M40 71 L50 82 L60 71" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="2"/>`);
  // neck
  parts.push(`<rect x="43" y="58" width="14" height="14" rx="5" fill="${skin}"/>`);
  // hair back
  if (hairStyle === 3) parts.push(`<path d="M24 40 C22 70 30 74 34 74 L66 74 C70 74 78 70 76 40 Z" fill="${hair}"/>`);
  // head
  parts.push(`<ellipse cx="50" cy="40" rx="23" ry="25" fill="${skin}"/>`);
  parts.push(`<ellipse cx="27" cy="43" rx="4" ry="6" fill="${skin}"/><ellipse cx="73" cy="43" rx="4" ry="6" fill="${skin}"/>`);
  // hair front
  const hairs = [
    `<path d="M27 38 C26 18 40 12 50 12 C62 12 75 18 73 38 C68 28 60 24 50 25 C40 24 31 30 27 38 Z" fill="${hair}"/>`,
    `<path d="M26 40 C24 16 44 10 54 13 C68 15 77 24 74 40 C70 30 64 22 46 26 C38 28 30 32 26 40 Z" fill="${hair}"/>`,
    `<path d="M30 30 C34 14 66 14 70 30 C64 24 36 24 30 30 Z" fill="${hair}"/>`,
    `<path d="M26 44 C22 16 42 10 50 10 C60 10 78 16 74 44 C72 30 62 22 50 22 C38 22 28 30 26 44 Z" fill="${hair}"/>`,
    `<path d="M28 34 C28 18 40 10 52 11 C66 12 74 22 72 34 L66 26 L60 30 L54 24 L48 30 L42 24 L36 30 Z" fill="${hair}"/>`,
  ];
  parts.push(hairs[hairStyle]);
  // eyes
  if (eyeStyle === 0) parts.push(`<circle cx="41" cy="42" r="3" fill="#222"/><circle cx="59" cy="42" r="3" fill="#222"/><circle cx="42" cy="41" r="1" fill="#fff"/><circle cx="60" cy="41" r="1" fill="#fff"/>`);
  else if (eyeStyle === 1) parts.push(`<ellipse cx="41" cy="42" rx="4" ry="4.5" fill="#fff"/><ellipse cx="59" cy="42" rx="4" ry="4.5" fill="#fff"/><circle cx="41.5" cy="43" r="2.4" fill="#2a4a7a"/><circle cx="59.5" cy="43" r="2.4" fill="#2a4a7a"/>`);
  else parts.push(`<path d="M37 43 Q41 39 45 43 M55 43 Q59 39 63 43" stroke="#222" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
  // brows
  parts.push(`<path d="M36 35 L45 34 M55 34 L64 35" stroke="${hair}" stroke-width="2.4" stroke-linecap="round"/>`);
  if (glasses) parts.push(`<g fill="none" stroke="#111" stroke-width="1.8"><rect x="34" y="37" width="13" height="10" rx="3"/><rect x="53" y="37" width="13" height="10" rx="3"/><path d="M47 41 L53 41"/></g>`);
  // nose
  parts.push(`<path d="M50 45 Q48 51 51 52" stroke="#000" stroke-opacity=".25" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
  if (beard) parts.push(`<path d="M30 46 C32 64 42 66 50 66 C58 66 68 64 70 46 C66 56 60 58 50 58 C40 58 34 56 30 46 Z" fill="${hair}"/>`);
  // mouth
  const mouths = [
    `<path d="M42 55 Q50 62 58 55" stroke="#7a2a1a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    `<path d="M41 54 Q50 64 59 54 Z" fill="#7a2a1a"/><path d="M43 55 L57 55 L56 57 L44 57 Z" fill="#fff"/>`,
    `<path d="M44 56 L56 56" stroke="#7a2a1a" stroke-width="2.2" stroke-linecap="round"/>`,
  ];
  parts.push(mouths[smile]);
  // cheeks
  parts.push(`<circle cx="35" cy="51" r="3.5" fill="#ff6a6a" opacity=".18"/><circle cx="65" cy="51" r="3.5" fill="#ff6a6a" opacity=".18"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${parts.join('')}</svg>`;
}
