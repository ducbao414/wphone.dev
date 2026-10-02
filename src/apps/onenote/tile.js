import { listNotes, loadNote, resolvePath, textOf, displayTitle, firstImage } from './notes.js';

const face = (os, n) => {
  const esc = os.util.esc;
  const snippet = textOf(n.html).split('\n').filter(Boolean);
  const body = (n.title ? snippet : snippet.slice(1)).join(' · ').slice(0, 160);
  return { html: `<div class="t-mid" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(displayTitle(n))}</div><div class="t-sub t-clip">${esc(body)}</div>` };
};

export default {
  interval: 10 * 60e3,
  async update(os, { args }) {
    if (args?.note) {
      const p = await resolvePath(os, args.note);
      const n = p && (await loadNote(os, p));
      if (!n) return { faces: [{ html: '<div class="t-sub">note was deleted</div>' }], iconFirst: false };
      const img = firstImage(n.html);
      return { title: displayTitle(n), color: n.color, iconFirst: false, faces: [face(os, n), ...(img ? [{ image: img }] : [])] };
    }
    const notes = (await listNotes(os)).slice(0, 3);
    if (!notes.length) return { faces: [] };
    return { faces: notes.map((n) => face(os, n)) };
  },
};
