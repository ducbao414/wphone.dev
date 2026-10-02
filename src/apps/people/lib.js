// People data layer: contacts storage (shared contract), seeding, avatars, vCard.
// Storage contract (other apps read/write this):
//   os.storage('people').get('contacts') => [{ id, first, last, name, phones:[{type, number}], emails:[{type, address}],
//     photo (dataURL|null), birthday ('YYYY-MM-DD'), company, notes, favorite }]
// Extra optional fields used here: address, demo, created, updated.

export const PALETTE = ['#1BA1E2', '#A200FF', '#E51400', '#F09609', '#339933', '#00ABA9', '#D80073', '#0050EF', '#8CBF26', '#A05000', '#6A00FF', '#647687'];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function hashColor(s = '') {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function displayName(c) {
  if (!c) return '';
  const n = [c.first, c.last].filter(Boolean).join(' ').trim();
  return n || c.name || c.company || c.phones?.[0]?.number || c.emails?.[0]?.address || '(no name)';
}

export function initials(c) {
  const n = typeof c === 'string' ? c : displayName(c);
  const parts = n.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '#';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** SVG data URL with initials on a colored square (used for tiles/mosaics when there's no photo). */
export function initialsDataURL(c, size = 200) {
  const ini = initials(c);
  const bg = hashColor(c?.id || ini);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="300" font-size="${ini.length > 1 ? 40 : 48}" fill="#fff">${ini.replace(/[<&>]/g, '')}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export const normNum = (n) => String(n || '').replace(/[^\d+]/g, '');
/** Loose phone match: compares the last 9 digits. */
export function sameNumber(a, b) {
  const x = normNum(a).replace(/^\+/, ''), y = normNum(b).replace(/^\+/, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const k = Math.min(9, x.length, y.length);
  return k >= 6 && x.slice(-k) === y.slice(-k);
}

/** Fill derived fields and defaults so every contact obeys the schema. */
export function normalize(c) {
  const out = {
    id: c.id || uid(),
    first: (c.first || '').trim(),
    last: (c.last || '').trim(),
    name: '',
    phones: (c.phones || []).map((p) => (typeof p === 'string' ? { number: p } : p)).filter((p) => p && normNum(p.number)).map((p) => ({ type: p.type || 'mobile', number: String(p.number).trim() })),
    emails: (c.emails || []).map((e) => (typeof e === 'string' ? { address: e } : e)).filter((e) => e && e.address).map((e) => ({ type: e.type || 'personal', address: String(e.address).trim() })),
    photo: c.photo || null,
    birthday: c.birthday || '',
    company: (c.company || '').trim(),
    notes: c.notes || '',
    favorite: !!c.favorite,
  };
  if (c.address) out.address = c.address;
  if (c.demo) out.demo = true;
  out.created = c.created || Date.now();
  out.updated = Date.now();
  if (!out.first && !out.last && c.name) {
    const parts = c.name.trim().split(/\s+/);
    out.first = parts.shift() || '';
    out.last = parts.join(' ');
  }
  out.name = displayName(out);
  return out;
}

export const SEED = [
  { first: 'Mom', last: '', phones: [{ type: 'mobile', number: '+1 425 555 0100' }, { type: 'home', number: '+1 425 555 0199' }], emails: [{ type: 'personal', address: 'mom@outlook.com' }], birthday: '1962-05-12', notes: 'Call every Sunday!', favorite: true, demo: true, address: '1 Microsoft Way, Redmond, WA' },
  { first: 'Anna', last: 'Bell', phones: [{ type: 'mobile', number: '+1 206 555 0134' }], emails: [{ type: 'personal', address: 'anna.bell@outlook.com' }], company: 'Contoso', birthday: '1990-11-03', favorite: true, demo: true },
  { first: 'Chris', last: 'Diaz', phones: [{ type: 'mobile', number: '+1 206 555 0187' }, { type: 'work', number: '+1 425 555 0142' }], emails: [{ type: 'work', address: 'chris.diaz@fabrikam.com' }], company: 'Fabrikam', birthday: '1987-02-21', demo: true },
  { first: 'Dad', last: '', phones: [{ type: 'mobile', number: '+1 425 555 0111' }], emails: [], birthday: '1960-08-30', favorite: true, address: '1 Microsoft Way, Redmond, WA' },
  { first: 'Emma', last: 'Nguyen', phones: [{ type: 'mobile', number: '+1 415 555 0123' }], emails: [{ type: 'personal', address: 'emma.nguyen@hotmail.com' }], company: 'Northwind Traders' },
  { first: 'Jordan', last: 'Lee', phones: [{ type: 'mobile', number: '+1 312 555 0176' }], emails: [{ type: 'work', address: 'jordan@adatum.com' }], company: 'A. Datum', notes: 'Met at //build/ 2014' },
  { first: 'Maria', last: 'Garcia', phones: [{ type: 'home', number: '+34 91 555 0102' }], emails: [{ type: 'personal', address: 'maria.garcia@live.com' }], address: 'Gran Vía 1, Madrid' },
  { first: 'Sam', last: 'Taylor', phones: [{ type: 'mobile', number: '+44 20 7946 0958' }], emails: [], company: 'Nokia', birthday: '1993-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(Math.min(28, new Date().getDate() + 3)).padStart(2, '0') },
  { first: 'Liam', last: 'O’Brien', phones: [{ type: 'mobile', number: '+1 425 555 0161' }], emails: [{ type: 'personal', address: 'liam.obrien@outlook.com' }], company: 'Litware', birthday: '1989-04-17', demo: true, notes: 'Plays 5-a-side on Thursdays' },
  { first: 'Sofia', last: 'Rossi', phones: [{ type: 'mobile', number: '+39 02 5555 0147' }], emails: [{ type: 'personal', address: 'sofia.rossi@live.it' }], birthday: '1992-09-09', demo: true, address: 'Via Dante 7, Milano' },
  { first: 'Kenji', last: 'Tanaka', phones: [{ type: 'mobile', number: '+81 3 5555 0193' }], emails: [{ type: 'work', address: 'kenji.tanaka@tailspintoys.jp' }], company: 'Tailspin Toys', demo: true },
  { first: 'Priya', last: 'Sharma', phones: [{ type: 'mobile', number: '+1 650 555 0119' }], emails: [{ type: 'personal', address: 'priya.sharma@hotmail.com' }], company: 'Wingtip Toys', birthday: '1994-01-26', favorite: true, demo: true },
  { first: 'Grandma', last: '', phones: [{ type: 'home', number: '+1 425 555 0177' }], emails: [], birthday: '1938-12-01', notes: 'Loves crossword puzzles', demo: true },
  { first: 'Lucas', last: 'Martin', phones: [{ type: 'mobile', number: '+33 1 55 55 01 28' }], emails: [{ type: 'personal', address: 'lucas.martin@outlook.fr' }], company: 'Fourth Coffee', demo: true },
  { first: 'Olivia', last: 'Brown', phones: [{ type: 'mobile', number: '+1 206 555 0145' }], emails: [{ type: 'work', address: 'olivia@proseware.com' }], company: 'Proseware (boss)', demo: true },
  { first: 'Ben', last: 'Carter', phones: [{ type: 'mobile', number: '+1 503 555 0108' }], emails: [{ type: 'personal', address: 'ben.carter@live.com' }], notes: 'Roommate from college', demo: true },
];

/** Seed sample contacts once (called from background.js at boot and from the app as a fallback). */
export const SEED_VERSION = 2;
export async function ensureSeeded(os) {
  const st = os.storage('people');
  if (await st.get('seeded', false)) {
    // v2 added more sample people; add them once to phones seeded with v1
    if ((await st.get('seedVersion', 1)) < SEED_VERSION) {
      const cur = (await st.get('contacts', [])) || [];
      const t = Date.now();
      const have = new Set(cur.map((c) => c.id));
      const extra = SEED.map((c, i) => ({ c, id: 'seed' + (i + 1) })).filter(({ id, c }) => !have.has(id) && Number(id.slice(4)) > 8).map(({ c, id }) => normalize({ ...c, id, created: t - 864e5 }));
      if (extra.length) await st.set('contacts', [...cur, ...extra]);
      await st.set('seedVersion', SEED_VERSION);
    }
    return;
  }
  const cur = await st.get('contacts', null);
  if (!cur || !cur.length) {
    const t = Date.now();
    const list = SEED.map((c, i) => normalize({ ...c, id: 'seed' + (i + 1), created: t - (SEED.length - i) * 864e5 }));
    await st.set('contacts', list);
    await st.set('activity', list.slice(-3).reverse().map((c) => ({ id: uid(), type: 'added', contact: c.id, time: c.created })));
  }
  await st.set('seeded', true);
  await st.set('seedVersion', SEED_VERSION);
}

/* ------------------------------------------------------------------ vCard */

const vEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const vUnesc = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const TEL_TYPES = { mobile: 'CELL', home: 'HOME', work: 'WORK', other: 'VOICE' };

export function toVCard(c) {
  const L = ['BEGIN:VCARD', 'VERSION:3.0'];
  L.push(`N:${vEsc(c.last)};${vEsc(c.first)};;;`);
  L.push(`FN:${vEsc(displayName(c))}`);
  if (c.company) L.push(`ORG:${vEsc(c.company)}`);
  for (const p of c.phones || []) L.push(`TEL;TYPE=${TEL_TYPES[p.type] || 'VOICE'}:${p.number}`);
  for (const e of c.emails || []) L.push(`EMAIL;TYPE=${e.type === 'work' ? 'WORK' : 'HOME'}:${e.address}`);
  if (c.birthday) L.push(`BDAY:${c.birthday}`);
  if (c.address) L.push(`ADR;TYPE=HOME:;;${vEsc(c.address)};;;;`);
  if (c.notes) L.push(`NOTE:${vEsc(c.notes)}`);
  if (c.photo && c.photo.startsWith('data:image/jpeg;base64,')) L.push(`PHOTO;ENCODING=b;TYPE=JPEG:${c.photo.slice(23)}`);
  else if (c.photo && c.photo.startsWith('data:image/png;base64,')) L.push(`PHOTO;ENCODING=b;TYPE=PNG:${c.photo.slice(22)}`);
  L.push('END:VCARD');
  // Fold long lines at 75 chars (RFC 6350)
  return L.map((l) => l.length <= 75 ? l : l.match(/.{1,74}/g).join('\r\n ')).join('\r\n');
}

export function parseVCards(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^BEGIN:VCARD$/i.test(line)) { cur = { phones: [], emails: [] }; continue; }
    if (/^END:VCARD$/i.test(line)) { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i), val = line.slice(i + 1);
    const [nameRaw, ...params] = head.split(';');
    const name = nameRaw.replace(/^item\d+\./i, '').toUpperCase();
    const p = params.join(';').toUpperCase();
    switch (name) {
      case 'N': { const [last, first] = val.split(/(?<!\\);/); cur.last = vUnesc(last); cur.first = vUnesc(first); break; }
      case 'FN': cur.name = vUnesc(val); break;
      case 'ORG': cur.company = vUnesc(val.split(/(?<!\\);/)[0]); break;
      case 'TEL': cur.phones.push({ type: /CELL|MOBILE|IPHONE/.test(p) ? 'mobile' : /HOME/.test(p) ? 'home' : /WORK/.test(p) ? 'work' : 'mobile', number: val.replace(/^tel:/i, '') }); break;
      case 'EMAIL': cur.emails.push({ type: /WORK/.test(p) ? 'work' : 'personal', address: val }); break;
      case 'BDAY': { const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(val); if (m) cur.birthday = `${m[1]}-${m[2]}-${m[3]}`; break; }
      case 'NOTE': cur.notes = vUnesc(val); break;
      case 'ADR': cur.address = val.split(/(?<!\\);/).map(vUnesc).filter(Boolean).join(', '); break;
      case 'PHOTO': {
        if (/^data:image/.test(val)) cur.photo = val;
        else if (/ENCODING=B|BASE64/.test(p)) cur.photo = `data:image/${/PNG/.test(p) ? 'png' : 'jpeg'};base64,${val}`;
        break;
      }
    }
  }
  return out;
}

/** Days until next occurrence of a 'YYYY-MM-DD' birthday (0 = today), or null. */
export function daysToBirthday(bday, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bday || '');
  if (!m) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), +m[2] - 1, +m[3]);
  if (next < today) next = new Date(now.getFullYear() + 1, +m[2] - 1, +m[3]);
  return Math.round((next - today) / 864e5);
}
