// Live tile: unread badge + latest message. Secondary tiles (pinned threads) show that thread only.
export function buildTile(os, threads, contacts, { key, args } = {}) {
  const esc = os.util.esc;
  const norm = (n) => String(n || '').replace(/[^\d+]/g, '');
  const nameFor = (t) => {
    const n = norm(t.key);
    if (n) {
      const c = contacts.find((c) => (c.phones || []).some((p) => { const q = norm(p.number); return q && (q === n || (q.length >= 9 && n.length >= 9 && q.slice(-9) === n.slice(-9))); }));
      if (c) return c.name || [c.first, c.last].filter(Boolean).join(' ');
    }
    return t.name || t.key;
  };
  const snippet = (m) => (m.text ? m.text : m.image ? '📷 photo' : '');
  const face = (t) => {
    const m = t.messages[t.messages.length - 1];
    if (!m) return null;
    return { html: `<div class="t-mid">${esc(nameFor(t))}</div><div class="t-sub t-clip">${m.from === 'me' ? 'You: ' : ''}${esc(snippet(m))}</div>` };
  };
  if (key && args?.thread) {
    const t = threads.find((x) => x.key === args.thread);
    if (!t) return { faces: [] };
    const f = face(t);
    return { faces: f ? [f] : [], badge: t.unread || 0, title: nameFor(t) };
  }
  const unread = threads.reduce((s, t) => s + (t.unread || 0), 0);
  const sorted = [...threads].filter((t) => t.messages.length).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const list = unread ? sorted.filter((t) => t.unread) : sorted.slice(0, 1);
  return { faces: list.slice(0, 3).map(face).filter(Boolean), badge: unread };
}

export default {
  interval: 15 * 60e3,
  async update(os, opts) {
    const threads = await os.storage('messaging').get('threads', []);
    const contacts = await os.storage('people').get('contacts', []);
    return buildTile(os, threads || [], contacts || [], opts);
  },
};
