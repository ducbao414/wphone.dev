// People live tile: iconic mosaic of contact photos / initials that cycles. Secondary tiles show one contact or a group.
import { displayName, initials, hashColor, initialsDataURL } from './lib.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function cell(c, big) {
  const base = 'overflow:hidden;display:flex;align-items:flex-end;justify-content:flex-start;color:#fff;font-weight:300;line-height:1;';
  if (c.photo) return `<div style="${base}${big ? 'grid-column:span 2;grid-row:span 2;' : ''}background:#333 url('${c.photo}') center/cover"></div>`;
  return `<div style="${base}${big ? 'grid-column:span 2;grid-row:span 2;font-size:30px;' : 'font-size:15px;'}background:${hashColor(c.id)};padding:0 0 4px 5px">${esc(initials(c))}</div>`;
}

function mosaic(list, cols, rows) {
  const slots = cols * rows - 4; // one 2x2 cell takes four slots
  const pick = [];
  for (let i = 0; i < slots + 1; i++) pick.push(list[i % list.length]);
  const bigAt = Math.floor(Math.random() * Math.min(4, slots));
  const cells = pick.map((c, i) => cell(c, i === bigAt)).join('');
  return `<div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);gap:2px;grid-auto-flow:dense;overflow:hidden">${cells}</div>`;
}

export default {
  interval: 2 * 60e3,
  async update(os, { size, key, args }) {
    const contacts = await os.storage('people').get('contacts', []);
    if (key && args?.contact) {
      const c = contacts.find((x) => x.id === args.contact);
      if (!c) return { title: 'contact', faces: [] };
      return { iconFirst: size === 'small', title: displayName(c), faces: [{ image: c.photo || initialsDataURL(c, 300) }] };
    }
    if (key && args?.group) {
      const groups = await os.storage('people').get('groups', []);
      const g = groups.find((x) => x.id === args.group);
      if (!g) return { title: 'group', faces: [] };
      const members = contacts.filter((c) => g.members.includes(c.id));
      if (!members.length) return { title: g.name, faces: [] };
      return { iconFirst: size === 'small', title: g.name, faces: [0, 1].map(() => ({ html: mosaic(shuffle(members), size === 'wide' ? 6 : 3, 3) })) };
    }
    if (!contacts.length || size === 'small') return { faces: [] };
    const cols = size === 'wide' ? 6 : 3;
    // Prefer contacts with photos, then favorites, then the rest
    const ranked = [...shuffle(contacts.filter((c) => c.photo)), ...shuffle(contacts.filter((c) => !c.photo))];
    return {
      iconFirst: false,
      faces: [0, 1, 2].map(() => ({ html: mosaic(shuffle(ranked), cols, 3) })),
    };
  },
};
