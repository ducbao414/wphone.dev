// Outlook Mail — local Outlook.com-style mailbox with folders, read/compose, flags, attachments,
// multi-select, and hand-off to the real device mail client.
import './style.css';
import { Flag, FlagOff, Paperclip, Reply, ReplyAll, Forward, MailOpen, Mail, ListChecks, FolderInput, UserPlus } from 'lucide';
import { FOLDERS, DEFAULT_PREFS, loadMail, tileData, ownerAddress, newId } from './store.js';

const EMAIL_RE = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I, esc, iconSVG } = os.ui;
  const U = os.util;

  let mail = await loadMail(storage);
  let prefs = { ...DEFAULT_PREFS, ...(await storage.get('prefs', {})) };
  let contacts = await loadContacts();
  let folder = 'inbox';
  const listeners = new Set();

  async function loadContacts() {
    try { const c = await os.storage('people').get('contacts', []); return Array.isArray(c) ? c : []; } catch { return []; }
  }
  const me = () => {
    const name = prefs.name || os.settings.get('ownerName') || 'Lumia owner';
    return { name, address: (prefs.address || ownerAddress(name)).toLowerCase() };
  };
  const changed = () => listeners.forEach((f) => f());
  const pushTile = () => os.tiles.set('outlook', tileData(mail, esc));
  async function save() { await storage.set('mail', mail); pushTile(); changed(); }
  const savePrefs = () => storage.set('prefs', prefs);
  pushTile();
  // background.js delivers simulated mail into storage; pick it up while the app is open
  const onExternal = async () => { mail = await loadMail(storage); pushTile(); changed(); };
  window.addEventListener('wp:mail', onExternal);
  ctx.on('destroy', () => window.removeEventListener('wp:mail', onExternal));

  /* ------------------------------------------------------------ helpers */
  const contactName = (c) => c.name || [c.first, c.last].filter(Boolean).join(' ');
  function nameFor(addr) {
    if (!addr) return '';
    const a = addr.toLowerCase();
    if (a === me().address) return me().name;
    const c = contacts.find((x) => (x.emails || []).some((e) => (e.address || '').toLowerCase() === a));
    return c ? contactName(c) : '';
  }
  const display = (p) => (p ? nameFor(p.address) || p.name || p.address || '' : '');
  const folderLabel = (id) => FOLDERS.find((f) => f.id === id)?.label || id;
  const preview = (m) => String(m.body || '').replace(/\s+/g, ' ').trim().slice(0, 140) || '(no text)';
  const fullDate = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + U.formatTime(new Date(ts));
  const stripPrefix = (s) => String(s || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '');

  /** Parse "a@b.com; Name <c@d.com>" into [{name,address}]. Returns { list, bad }. */
  function parseRecipients(text) {
    const list = [], bad = [];
    for (let tok of String(text || '').split(/[;,]/)) {
      tok = tok.trim();
      if (!tok) continue;
      const m = /^(.*)<([^>]+)>$/.exec(tok);
      const address = (m ? m[2] : tok).trim(), name = m ? m[1].trim().replace(/^"|"$/g, '') : '';
      if (EMAIL_RE.test(address)) list.push({ name: name || nameFor(address), address });
      else if (/^[^@]+$/.test(tok)) {
        // a bare contact name typed in full
        const c = contacts.find((x) => contactName(x).toLowerCase() === tok.toLowerCase() && x.emails?.length);
        if (c) list.push({ name: contactName(c), address: c.emails[0].address }); else bad.push(tok);
      } else bad.push(tok);
    }
    return { list, bad };
  }
  function toList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? { name: nameFor(x), address: x } : x));
    return parseRecipients(v).list;
  }
  const recipientsText = (arr) => (arr || []).map((p) => p.address).join('; ') + ((arr || []).length ? '; ' : '');

  /** Known addresses for suggestions: contacts first, then everyone we've mailed with. */
  function knownAddresses() {
    const seen = new Map();
    for (const c of contacts) for (const e of c.emails || []) if (e.address && !seen.has(e.address.toLowerCase())) seen.set(e.address.toLowerCase(), { name: contactName(c), address: e.address, contact: true, photo: c.photo });
    for (const m of mail) for (const p of [m.from, ...(m.to || []), ...(m.cc || [])]) {
      if (p?.address && !seen.has(p.address.toLowerCase()) && p.address.toLowerCase() !== me().address) seen.set(p.address.toLowerCase(), { name: p.name || '', address: p.address });
    }
    return [...seen.values()];
  }

  function linkify(text) {
    const frag = document.createDocumentFragment();
    const re = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(www\.[^\s<>()]+[^\s<>().,;:!?'"])|([^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,})/gi;
    let last = 0, m;
    const s = String(text || '');
    while ((m = re.exec(s))) {
      if (m.index > last) frag.append(s.slice(last, m.index));
      const t = m[0];
      if (m[3]) frag.append(el('a.outlook-link', { href: '#', onclick: (e) => { e.preventDefault(); ctx.navigate(composePage, { to: [{ name: '', address: t }] }); } }, t));
      else {
        const url = m[2] ? 'http://' + t : t;
        frag.append(el('a.outlook-link', { href: url, onclick: (e) => { e.preventDefault(); openUrl(url); } }, t));
      }
      last = m.index + t.length;
    }
    if (last < s.length) frag.append(s.slice(last));
    return frag;
  }
  function openUrl(url) {
    if (os.apps.get('ie') && os.apps.isInstalled('ie')) os.launch('ie', { url });
    else os.device.openUrl(url);
  }

  async function deleteMails(ids) {
    const items = mail.filter((m) => ids.includes(m.id));
    if (!items.length) return false;
    const permanent = items.filter((m) => m.folder === 'deleted');
    if (permanent.length) {
      const ok = await os.ui.confirm(permanent.length === 1 ? 'This message will be permanently deleted.' : `${permanent.length} messages will be permanently deleted.`, 'delete?', 'delete', 'cancel');
      if (!ok) return false;
    }
    const perm = new Set(permanent.map((m) => m.id));
    mail = mail.filter((m) => !perm.has(m.id));
    for (const m of items) if (!perm.has(m.id)) { m.prevFolder = m.folder; m.folder = 'deleted'; }
    await save();
    return true;
  }
  async function moveMails(ids, exclude) {
    const to = await os.ui.pickFromList({ title: 'move to', options: FOLDERS.filter((f) => f.id !== exclude && f.id !== 'drafts').map((f) => ({ value: f.id, label: f.label })) });
    if (!to) return false;
    for (const m of mail) if (ids.includes(m.id)) m.folder = to;
    await save();
    os.toast(`Moved to ${folderLabel(to)}`, 'outlook');
    return true;
  }
  async function setFlag(ids, v) { for (const m of mail) if (ids.includes(m.id)) m.flagged = v; await save(); }
  async function setRead(ids, v) { for (const m of mail) if (ids.includes(m.id)) m.read = v; await save(); }

  /* ------------------------------------------------------------ sync (daily news digest) */
  async function sync({ silent = false } = {}) {
    let added = 0;
    if (prefs.digest && Date.now() - (prefs.lastDigest || 0) > 6 * 3600e3) {
      try {
        if (!os.device.online) throw new Error('offline');
        const r = await os.net.news('technology');
        const items = (r?.items || []).slice(0, 6);
        if (items.length) {
          const body = 'Here are today\'s top technology stories, picked for you.\n\n'
            + items.map((it) => `• ${it.title}\n${it.description ? it.description.replace(/\s+/g, ' ').trim() + '\n' : ''}${it.link}`).join('\n\n')
            + `\n\nSource: ${r.title || 'MSN News'}\nYou're receiving this because "daily digest" is on in Outlook mail settings.`;
          mail.push({ id: newId(), folder: 'inbox', from: { name: 'MSN News', address: 'msnnews@microsoft.com' }, to: [me()], cc: [], subject: 'Your tech digest: ' + items[0].title, body, date: Date.now(), read: false, flagged: false, attachments: [] });
          added++;
          prefs.lastDigest = Date.now();
          savePrefs();
        }
      } catch {
        if (!silent) os.toast('Couldn\'t sync. Check your connection.', 'outlook');
        return -1;
      }
    }
    if (added) await save();
    if (!silent) os.toast(added ? `${added} new message${added > 1 ? 's' : ''}` : 'Up to date', 'outlook');
    return added;
  }

  /* ------------------------------------------------------------ mail row */
  function mailRow(m, { checkable = false, checked = false } = {}) {
    const out = m.folder === 'sent' || m.folder === 'drafts';
    const who = out ? (m.to || []).map(display).join('; ') || '(no recipients)' : display(m.from) || '(unknown sender)';
    const marks = [
      m.flagged ? el('span.outlook-mark.outlook-flag', { html: iconSVG(Flag, { size: 14, stroke: 2 }) }) : null,
      m.attachments?.length ? el('span.outlook-mark', { html: iconSVG(Paperclip, { size: 14, stroke: 2 }) }) : null,
      m.replied ? el('span.outlook-mark', { html: iconSVG(m.replied === 'forward' ? Forward : Reply, { size: 14, stroke: 2 }) }) : null,
    ];
    return el('div.outlook-row.tilt' + (m.read ? '' : '.unread') + (checked ? '.checked' : ''), { dataset: { id: m.id } },
      checkable ? el('div.outlook-check', { html: iconSVG(I.check, { size: 18, stroke: 3 }) }) : null,
      el('div.outlook-row-main',
        el('div.outlook-row-top',
          el('div.outlook-from', m.folder === 'drafts' ? el('span.outlook-draft', '[Draft] ') : null, who),
          el('div.outlook-date', U.formatRelative(m.date))),
        el('div.outlook-subject', el('span.outlook-subject-text', m.subject || '(no subject)'), ...marks),
        prefs.preview ? el('div.outlook-preview', preview(m)) : null));
  }

  function openMail(m) {
    if (m.folder === 'drafts') ctx.navigate(composePage, draftParams(m));
    else ctx.navigate(readPage, { id: m.id });
  }
  const draftParams = (m) => ({ draftId: m.id, to: m.to, cc: m.cc, subject: m.subject, body: m.body, attachments: m.attachments, replyTo: m.replyTo, mode: m.mode, raw: true });

  function rowMenu(m, row, after) {
    os.ui.contextMenu(row, [
      { label: m.read ? 'mark as unread' : 'mark as read', onClick: () => setRead([m.id], !m.read) },
      m.folder !== 'drafts' ? { label: m.flagged ? 'clear flag' : 'flag', onClick: () => setFlag([m.id], !m.flagged) } : null,
      m.folder !== 'drafts' ? { label: 'move…', onClick: () => moveMails([m.id], m.folder) } : null,
      m.folder === 'deleted' && m.prevFolder ? { label: 'restore', onClick: async () => { m.folder = m.prevFolder || 'inbox'; delete m.prevFolder; await save(); } } : null,
      { label: 'delete', onClick: async () => { await deleteMails([m.id]); after?.(); } },
    ]);
  }

  /* ------------------------------------------------------------ main page */
  function mainPage(page) {
    let selecting = false;
    const selected = new Set();
    const views = [
      { header: 'all', filter: () => true, empty: 'no messages' },
      { header: 'unread', filter: (m) => !m.read, empty: 'no unread messages' },
      { header: 'flagged', filter: (m) => m.flagged, empty: 'no flagged messages\n\nTap and hold a message to flag it.' },
    ];
    const containers = [];
    const syncing = el('div.outlook-syncing');
    const pv = os.ui.pivot({
      app: '',
      items: views.map((v, i) => ({ header: v.header, render: (c) => { containers[i] = c; renderList(i); } })),
    });
    const title = pv.el.querySelector('.wp-app-title');
    title.classList.add('outlook-acct', 'tilt');
    title.addEventListener('click', chooseFolder);
    pv.el.insertBefore(syncing, pv.el.children[1]);

    function setTitle() {
      const n = mail.filter((m) => m.folder === folder && !m.read).length;
      title.replaceChildren(el('span', 'OUTLOOK'), el('span.outlook-acct-folder', folderLabel(folder).toUpperCase() + (n && folder !== 'sent' ? ` (${n})` : '')),
        el('span.outlook-acct-caret', { html: iconSVG(I.down, { size: 14, stroke: 2.5 }) }));
    }

    function renderList(i) {
      const c = containers[i];
      if (!c) return;
      const items = mail.filter((m) => m.folder === folder && views[i].filter(m)).sort((a, b) => b.date - a.date);
      const st = c.scrollTop;
      c.replaceChildren();
      if (!items.length) { c.append(el('div.wp-empty.outlook-empty', views[i].empty)); return; }
      for (const m of items) {
        const r = mailRow(m, { checkable: selecting, checked: selected.has(m.id) });
        r.addEventListener('click', () => {
          if (selecting) {
            selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id);
            r.classList.toggle('checked', selected.has(m.id));
            updateBar();
          } else openMail(m);
        });
        U.onLongPress(r, () => { if (!selecting) rowMenu(m, r); });
        c.append(r);
      }
      c.scrollTop = st;
    }
    const refresh = () => {
      for (const id of [...selected]) if (!mail.some((m) => m.id === id && m.folder === folder)) selected.delete(id);
      setTitle();
      views.forEach((_, i) => renderList(i));
      updateBar();
    };
    listeners.add(refresh);

    async function chooseFolder() {
      if (selecting) return;
      const f = await os.ui.pickFromList({
        title: 'folders',
        options: FOLDERS.map((x) => {
          const n = mail.filter((m) => m.folder === x.id && (x.id === 'drafts' || !m.read)).length;
          return { value: x.id, label: x.label + (n && x.id !== 'sent' ? ` (${n})` : '') };
        }),
        value: folder,
      });
      if (f && f !== folder) { folder = f; pv.select(0); refresh(); views.forEach((_, i) => containers[i] && (containers[i].scrollTop = 0)); }
    }

    const setSelecting = (v) => {
      selecting = v;
      selected.clear();
      pv.el.classList.toggle('outlook-selecting', v);
      refresh();
    };
    const visibleIds = () => mail.filter((m) => m.folder === folder && views[Math.max(0, pv.index)].filter(m)).map((m) => m.id);

    const bar = os.ui.appBar({});
    function updateBar() {
      if (selecting) {
        const ids = [...selected], none = !ids.length;
        bar.setButtons([
          { icon: I.delete, label: 'delete', disabled: none, onClick: async () => { if (await deleteMails(ids)) setSelecting(false); } },
          { icon: MailOpen, label: 'mark read', disabled: none, onClick: async () => { await setRead(ids, true); setSelecting(false); } },
          { icon: Mail, label: 'mark unread', disabled: none, onClick: async () => { await setRead(ids, false); setSelecting(false); } },
          { icon: Flag, label: 'flag', disabled: none || folder === 'drafts', onClick: async () => { const allFlagged = mail.filter((m) => selected.has(m.id)).every((m) => m.flagged); await setFlag(ids, !allFlagged); setSelecting(false); } },
        ]);
        bar.setMenu([
          { label: 'select all', onClick: () => { visibleIds().forEach((id) => selected.add(id)); views.forEach((_, i) => renderList(i)); updateBar(); } },
          { label: 'move…', disabled: none || folder === 'drafts', onClick: async () => { if (await moveMails(ids, folder)) setSelecting(false); } },
          { label: 'cancel', onClick: () => setSelecting(false) },
        ]);
      } else {
        bar.setButtons([
          { icon: I.add, label: 'new', onClick: () => ctx.navigate(composePage, {}) },
          { icon: ListChecks, label: 'select', onClick: () => setSelecting(true) },
          { icon: I.search, label: 'search', onClick: () => ctx.navigate(searchPage) },
          { icon: I.refresh, label: 'sync', onClick: doSync },
        ]);
        bar.setMenu([
          { label: 'folders', onClick: chooseFolder },
          { label: 'mark all as read', onClick: () => setRead(mail.filter((m) => m.folder === folder).map((m) => m.id), true) },
          folder === 'deleted' ? { label: 'empty deleted items', onClick: emptyDeleted } : null,
          { label: 'settings', onClick: () => ctx.navigate(settingsPage) },
        ].filter(Boolean));
      }
    }
    async function doSync() {
      syncing.replaceChildren(os.ui.loadingDots());
      const t0 = Date.now();
      await sync();
      await U.sleep(Math.max(0, 900 - (Date.now() - t0)));
      syncing.replaceChildren();
    }
    async function emptyDeleted() {
      const n = mail.filter((m) => m.folder === 'deleted').length;
      if (!n) return os.toast('Deleted items is already empty', 'outlook');
      if (!(await os.ui.confirm(`Permanently delete ${n} message${n > 1 ? 's' : ''}?`, 'empty deleted items', 'delete', 'cancel'))) return;
      mail = mail.filter((m) => m.folder !== 'deleted');
      await save();
    }
    setTitle();
    updateBar();
    page.el.append(pv.el, bar.el);

    return {
      onBack: () => { if (selecting) { setSelecting(false); return true; } return false; },
      onShow: refresh,
      onDestroy: () => listeners.delete(refresh),
    };
  }

  /* ------------------------------------------------------------ read page */
  function readPage(page) {
    const m = mail.find((x) => x.id === page.params.id);
    const root = el('div.wp-page.outlook-read');
    if (!m) { root.append(el('div.wp-page-header', el('div.wp-app-title', 'OUTLOOK'), el('div.wp-page-title', 'not found')), el('div.wp-page-content', os.ui.empty('This message was deleted.'))); return root; }
    if (!m.read) { m.read = true; save(); }

    const head = el('div.outlook-read-head');
    const content = el('div.wp-page-content.outlook-read-content');
    root.append(el('div.wp-page-header', el('div.wp-app-title', 'OUTLOOK · ' + folderLabel(m.folder).toUpperCase())), content);

    function render() {
      const out = m.folder === 'sent';
      const sender = out ? me() : m.from;
      const toLine = (m.to || []).map(display).join('; ') || (out ? '' : me().name);
      const flagEl = m.flagged ? el('div.outlook-read-flag', { html: iconSVG(Flag, { size: 14, stroke: 2 }) + '<span>flagged</span>' }) : null;
      head.replaceChildren(
        el('div.outlook-read-from.tilt', { onclick: () => senderMenu(sender) }, display(sender) || sender?.address || '(unknown)'),
        el('div.outlook-read-addr', sender?.address || ''),
        el('div.outlook-read-subject', m.subject || '(no subject)'),
        el('div.outlook-read-meta', fullDate(m.date)),
        toLine ? el('div.outlook-read-meta', 'To: ' + toLine) : null,
        m.cc?.length ? el('div.outlook-read-meta', 'Cc: ' + m.cc.map(display).join('; ')) : null,
        flagEl);
      const atts = el('div.outlook-atts', (m.attachments || []).map(attachmentEl));
      content.replaceChildren(head, atts, el('div.outlook-body', linkify(m.body)));
    }
    async function senderMenu(p) {
      if (!p?.address) return;
      const known = !!nameFor(p.address);
      const v = await os.ui.pickFromList({
        title: display(p) || p.address,
        options: [
          { value: 'mail', label: 'send email' },
          { value: 'copy', label: 'copy address' },
          ...(known ? [{ value: 'people', label: 'view contact' }] : [{ value: 'add', label: 'save to people' }]),
        ],
      });
      if (v === 'mail') ctx.navigate(composePage, { to: [p] });
      else if (v === 'copy') { try { await os.device.copy(p.address); os.toast('Copied', 'outlook'); } catch { os.toast('Couldn\'t copy', 'outlook'); } }
      else if (v === 'people') { const c = contacts.find((x) => (x.emails || []).some((e) => (e.address || '').toLowerCase() === p.address.toLowerCase())); os.launch('people', { contact: c?.id }); }
      else if (v === 'add') addToPeople(p);
    }
    async function addToPeople(p) {
      const name = p.name || p.address.split('@')[0];
      const parts = name.split(/\s+/);
      const c = { id: newId(), first: parts[0] || '', last: parts.slice(1).join(' '), name, phones: [], emails: [{ type: 'personal', address: p.address }], photo: null, birthday: '', company: '', notes: '', favorite: false };
      const ps = os.storage('people');
      const list = await ps.get('contacts', []);
      await ps.set('contacts', [...(Array.isArray(list) ? list : []), c]);
      contacts = await loadContacts();
      os.toast(`${name} saved to People`, 'outlook');
      render();
    }
    render();

    const respond = async () => {
      const v = await os.ui.pickFromList({ title: 'respond', options: [{ value: 'reply', label: 'reply' }, { value: 'all', label: 'reply all' }, { value: 'forward', label: 'forward' }] });
      if (v) ctx.navigate(composePage, replyParams(m, v));
    };
    const bar = os.ui.appBar({});
    const updateBar = () => {
      bar.setButtons([
        { icon: Reply, label: 'respond', onClick: respond },
        { icon: m.flagged ? FlagOff : Flag, label: m.flagged ? 'clear flag' : 'flag', onClick: async () => { await setFlag([m.id], !m.flagged); render(); updateBar(); } },
        { icon: I.delete, label: 'delete', onClick: async () => { if (await deleteMails([m.id])) page.close(); } },
      ]);
      bar.setMenu([
        { label: 'reply all', onClick: () => ctx.navigate(composePage, replyParams(m, 'all')) },
        { label: 'forward', onClick: () => ctx.navigate(composePage, replyParams(m, 'forward')) },
        { label: 'mark as unread', onClick: async () => { await setRead([m.id], false); page.close(); } },
        { label: 'move…', onClick: async () => { if (await moveMails([m.id], m.folder)) render(); } },
        m.folder === 'deleted' ? { label: 'restore', onClick: async () => { m.folder = m.prevFolder || 'inbox'; delete m.prevFolder; await save(); page.close(); } } : null,
        { label: 'share', onClick: () => os.share({ title: m.subject, text: `${m.subject}\n\n${m.body}` }) },
      ].filter(Boolean));
    };
    updateBar();
    root.append(bar.el);
    return root;
  }

  function attachmentEl(a, { onClick } = {}) {
    const isImg = (a.mime || '').startsWith('image/');
    const thumb = el('div.outlook-att-icon', { html: iconSVG(isImg ? I.image : Paperclip, { size: 22 }) });
    if (isImg && a.path) os.fs.thumb(a.path).then((u) => { if (u) { thumb.style.backgroundImage = `url("${u}")`; thumb.classList.add('img'); thumb.innerHTML = ''; } }).catch(() => {});
    return el('div.outlook-att.tilt', {
      onclick: onClick || (async () => {
        if (!a.path || !(await os.fs.exists(a.path))) return os.ui.alert(`"${a.name}" isn't on this phone any more.`, 'attachment');
        os.openFile(a.path);
      }),
    }, thumb, el('div.outlook-att-text', el('div.outlook-att-name', a.name || 'attachment'), el('div.outlook-att-size', a.size != null ? U.formatBytes(a.size) : '')));
  }

  function replyParams(m, mode) {
    const sender = m.folder === 'sent' ? (m.to || [])[0] : m.from;
    const quote = `\n\n${prefs.signature ? prefs.signature + '\n\n' : ''}________________________________\nFrom: ${display(m.folder === 'sent' ? me() : m.from)}${(m.folder === 'sent' ? me() : m.from)?.address ? ' <' + (m.folder === 'sent' ? me() : m.from).address + '>' : ''}\nSent: ${fullDate(m.date)}\nTo: ${(m.to || []).map((p) => display(p) || p.address).join('; ') || me().name}\nSubject: ${m.subject || ''}\n\n${m.body || ''}`;
    if (mode === 'forward') return { subject: 'FW: ' + stripPrefix(m.subject), body: quote, attachments: m.attachments || [], replyTo: m.id, mode, raw: true };
    const to = sender ? [sender] : [];
    let cc = [];
    if (mode === 'all') {
      const mine = me().address;
      const others = [...(m.to || []), ...(m.cc || [])].filter((p) => p.address && p.address.toLowerCase() !== mine && p.address.toLowerCase() !== sender?.address?.toLowerCase());
      cc = others;
    }
    return { to, cc, subject: 'RE: ' + stripPrefix(m.subject), body: quote, replyTo: m.id, mode: 'reply', raw: true };
  }

  /* ------------------------------------------------------------ compose page */
  async function composePage(page) {
    const P = page.params || {};
    let draftId = P.draftId || null;
    let sent = false;
    let attachments = [];
    for (const a of P.attachments || []) {
      if (typeof a === 'string') { const st = await os.fs.stat(a).catch(() => null); if (st) attachments.push({ path: st.path || a, name: st.name, size: st.size, mime: st.mime }); }
      else attachments.push(a);
    }
    const initialBody = P.raw ? (P.body || '') : `${P.body || ''}${prefs.signature ? '\n\n' + prefs.signature : ''}`;

    const inp = (cls, props) => el('input.outlook-input' + (cls ? '.' + cls : ''), { autocomplete: 'off', spellcheck: false, ...props });
    const toInp = inp('', { type: 'email', multiple: true, placeholder: '' });
    const ccInp = inp('', { type: 'email', multiple: true });
    const subjInp = inp('', { type: 'text', spellcheck: true });
    const bodyInp = el('textarea.outlook-input.outlook-bodyinp', { spellcheck: true });
    toInp.type = 'text'; ccInp.type = 'text';
    toInp.value = recipientsText(toList(P.to));
    ccInp.value = recipientsText(toList(P.cc));
    subjInp.value = P.subject || '';
    bodyInp.value = initialBody;
    const snapshot = () => [toInp.value, ccInp.value, subjInp.value, bodyInp.value, attachments.map((a) => a.path).join('|')].join('\u0000');
    const initial = snapshot();

    const suggest = el('div.outlook-suggest');
    let suggestFor = null;
    const ccRow = el('div.outlook-field', el('div.outlook-field-label', 'Cc:'), ccInp);
    ccRow.hidden = !ccInp.value;
    const pickBtn = (target) => el('button.outlook-field-add.tilt', { 'aria-label': 'choose contact', html: iconSVG(UserPlus, { size: 20 }), onclick: () => pickContact(target) });
    const attList = el('div.outlook-atts');
    const autosize = () => { bodyInp.style.height = 'auto'; bodyInp.style.height = Math.max(180, bodyInp.scrollHeight) + 'px'; };

    const root = el('div.wp-page.outlook-compose',
      el('div.wp-page-header', el('div.wp-app-title', 'OUTLOOK'), el('div.outlook-compose-from', 'From: ' + me().address)),
      el('div.wp-page-content.outlook-compose-content',
        el('div.outlook-field', el('div.outlook-field-label', 'To:'), toInp, pickBtn(toInp)),
        suggest,
        ccRow,
        el('div.outlook-field', el('div.outlook-field-label', 'Subject:'), subjInp),
        attList,
        bodyInp));

    function renderAtts() {
      attList.replaceChildren(...attachments.map((a, i) => attachmentEl(a, {
        onClick: async () => {
          const v = await os.ui.pickFromList({ title: a.name, options: [{ value: 'open', label: 'open' }, { value: 'remove', label: 'remove attachment' }] });
          if (v === 'remove') { attachments.splice(i, 1); renderAtts(); } else if (v === 'open' && a.path) os.openFile(a.path);
        },
      })));
    }
    renderAtts();

    function showSuggest(target) {
      suggestFor = target;
      const parts = target.value.split(/[;,]/);
      const q = parts[parts.length - 1].trim().toLowerCase();
      if (!q) { suggest.replaceChildren(); return; }
      const already = new Set(parts.slice(0, -1).map((s) => s.trim().toLowerCase()));
      const hits = knownAddresses().filter((k) => !already.has(k.address.toLowerCase()) && (k.name.toLowerCase().includes(q) || k.address.toLowerCase().includes(q))).slice(0, 5);
      suggest.replaceChildren(...hits.map((k) => el('div.outlook-suggest-item.tilt', {
        onpointerdown: (e) => e.preventDefault(),
        onclick: () => {
          parts[parts.length - 1] = ' ' + k.address;
          target.value = parts.map((s) => s.trim()).filter(Boolean).join('; ') + '; ';
          suggest.replaceChildren();
          target.focus();
        },
      }, el('div.outlook-suggest-name', k.name || k.address), k.name ? el('div.outlook-suggest-addr', k.address) : null)));
      // place under the field being edited
      (target === ccInp ? ccRow : toInp.parentElement).after(suggest);
    }
    for (const t of [toInp, ccInp]) {
      t.addEventListener('input', () => showSuggest(t));
      t.addEventListener('focus', () => showSuggest(t));
      t.addEventListener('blur', () => setTimeout(() => { if (suggestFor === t) suggest.replaceChildren(); }, 150));
    }
    bodyInp.addEventListener('input', autosize);

    async function pickContact(target) {
      const opts = [];
      for (const c of [...contacts].sort((a, b) => contactName(a).localeCompare(contactName(b)))) for (const e of c.emails || []) if (e.address) opts.push({ value: e.address, label: `${contactName(c)} (${e.address})` });
      if (!opts.length) return os.ui.alert('None of your contacts have an email address yet. Add one in People.', 'no contacts');
      const v = await os.ui.pickFromList({ title: 'choose a contact', options: opts });
      if (!v) return;
      const cur = parseRecipients(target.value).list.map((p) => p.address);
      if (!cur.includes(v)) target.value = recipientsText([...cur, v].map((a) => ({ address: a })));
    }

    async function attach() {
      const paths = await os.pick.file({ multiple: true, title: 'attach a file' });
      for (const p of paths) {
        if (attachments.some((a) => a.path === p)) continue;
        const st = await os.fs.stat(p).catch(() => null);
        if (st) attachments.push({ path: p, name: st.name, size: st.size, mime: st.mime });
      }
      renderAtts();
    }

    function buildMessage() {
      const to = parseRecipients(toInp.value), cc = parseRecipients(ccInp.value);
      return { to, cc };
    }

    async function saveDraft() {
      const { to, cc } = buildMessage();
      const d = { id: draftId || newId(), folder: 'drafts', from: me(), to: to.list, cc: cc.list, subject: subjInp.value, body: bodyInp.value, date: Date.now(), read: true, flagged: false, attachments, replyTo: P.replyTo, mode: P.mode };
      const i = mail.findIndex((x) => x.id === d.id);
      if (i >= 0) mail[i] = d; else mail.push(d);
      draftId = d.id;
      await save();
      os.toast('Saved to drafts', 'outlook');
    }

    async function send() {
      const { to, cc } = buildMessage();
      const bad = [...to.bad, ...cc.bad];
      if (bad.length) return os.ui.alert(`"${bad[0]}" doesn't look like an email address. Check it and try again.`, 'can\'t send');
      if (!to.list.length) { toInp.focus(); return os.ui.alert('Add at least one recipient in the To: box.', 'can\'t send'); }
      if (!subjInp.value.trim() && !(await os.ui.confirm('Send this message without a subject?', 'no subject', 'send', 'cancel'))) return;
      const msg = { id: newId(), folder: 'sent', from: me(), to: to.list, cc: cc.list, subject: subjInp.value.trim(), body: bodyInp.value, date: Date.now(), read: true, flagged: false, attachments };
      if (draftId) mail = mail.filter((x) => x.id !== draftId);
      mail.push(msg);
      if (P.replyTo) { const o = mail.find((x) => x.id === P.replyTo); if (o) o.replied = P.mode === 'forward' ? 'forward' : 'reply'; }
      // mail to yourself lands in your inbox too
      const mine = me().address;
      if ([...to.list, ...cc.list].some((p) => p.address.toLowerCase() === mine)) mail.push({ ...msg, id: newId(), folder: 'inbox', read: false, date: Date.now() + 1000 });
      sent = true;
      await save();
      os.sounds.tap?.();
      os.toast('Message sent', 'outlook');
      page.close();
    }

    const bar = os.ui.appBar({
      buttons: [
        { icon: I.send, label: 'send', onClick: send },
        { icon: Paperclip, label: 'attach', onClick: attach },
        { icon: I.delete, label: 'discard', onClick: async () => {
          if (snapshot() !== initial || draftId) {
            if (!(await os.ui.confirm(draftId ? 'Delete this draft?' : 'Discard this message?', 'discard', 'discard', 'cancel'))) return;
          }
          if (draftId) { mail = mail.filter((x) => x.id !== draftId); await save(); }
          sent = true;
          page.close();
        } },
      ],
      menu: [
        { label: 'save draft', onClick: saveDraft },
        { label: 'show cc', onClick: () => { ccRow.hidden = false; ccInp.focus(); } },
        { label: 'insert my signature', onClick: () => { if (prefs.signature) { bodyInp.value += '\n\n' + prefs.signature; autosize(); } } },
      ],
    });
    root.append(bar.el);
    setTimeout(() => { autosize(); (toInp.value ? (subjInp.value ? bodyInp : subjInp) : toInp).focus(); if (toInp.value && subjInp.value) bodyInp.setSelectionRange(0, 0); }, 380);

    return {
      el: root,
      onBack: async () => {
        if (sent || snapshot() === initial) return false;
        const i = await os.ui.messageBox({ title: 'save draft?', message: 'Do you want to save this message to your drafts folder?', buttons: ['save', 'discard', 'cancel'] });
        if (i === 0) { await saveDraft(); return false; }
        if (i === 1) return false;
        return true;
      },
    };
  }

  /* ------------------------------------------------------------ search */
  function searchPage(page) {
    const p = os.ui.page({ app: 'OUTLOOK', title: 'search' });
    const results = el('div.outlook-results');
    const box = os.ui.textbox({ placeholder: 'search all mail', onInput: U.debounce(run, 150) });
    box.classList.add('outlook-searchbox');
    function run() {
      const q = box.value.trim().toLowerCase();
      results.replaceChildren();
      if (!q) return;
      const hits = mail.filter((m) => [m.subject, m.body, m.from?.name, m.from?.address, ...(m.to || []).map((t) => t.address + ' ' + (t.name || ''))].join(' ').toLowerCase().includes(q)).sort((a, b) => b.date - a.date);
      if (!hits.length) { results.append(os.ui.empty('no results')); return; }
      let lastF = null;
      for (const m of hits) {
        if (m.folder !== lastF) { results.append(os.ui.header(folderLabel(m.folder))); lastF = m.folder; }
        const r = mailRow(m);
        r.addEventListener('click', () => openMail(m));
        U.onLongPress(r, () => rowMenu(m, r, run));
        results.append(r);
      }
    }
    listeners.add(run);
    p.content.append(box, results);
    setTimeout(() => box.focus(), 380);
    return { el: p.el, onDestroy: () => listeners.delete(run) };
  }

  /* ------------------------------------------------------------ settings */
  function settingsPage() {
    const p = os.ui.page({ app: 'OUTLOOK', title: 'settings' });
    const persist = U.debounce(savePrefs, 300);
    const nameBox = os.ui.textbox({ label: 'Your name', value: prefs.name, placeholder: os.settings.get('ownerName') || 'Lumia owner', onInput: (v) => { prefs.name = v.trim(); persist(); } });
    const addrBox = os.ui.textbox({ label: 'Email address', value: prefs.address, placeholder: ownerAddress(prefs.name || os.settings.get('ownerName')), type: 'email', onInput: (v) => { prefs.address = EMAIL_RE.test(v.trim()) ? v.trim() : ''; persist(); } });
    const sigBox = os.ui.textbox({ label: 'Signature', value: prefs.signature, multiline: true, rows: 3, onInput: (v) => { prefs.signature = v; persist(); } });
    p.content.append(
      os.ui.header('account'), nameBox, addrBox,
      os.ui.header('sending'),
      sigBox,
      os.ui.header('reading'),
      os.ui.toggle({ label: 'Show message preview', value: prefs.preview, onChange: (v) => { prefs.preview = v; savePrefs(); changed(); } }).el,
      os.ui.toggle({ label: 'Daily tech digest', value: prefs.digest, description: 'When you sync, get a daily email with the top technology headlines from MSN News.', onChange: (v) => { prefs.digest = v; savePrefs(); } }).el,
      os.ui.header('storage'),
      os.ui.desc(`${mail.length} messages in this mailbox.`),
      os.ui.button('reset mailbox', async () => {
        if (!(await os.ui.confirm('Delete all mail and restore the welcome messages?', 'reset mailbox', 'reset', 'cancel'))) return;
        await storage.del('mail');
        mail = await loadMail(storage);
        await save();
        os.toast('Mailbox reset', 'outlook');
      }),
    );
    return p.el;
  }

  /* ------------------------------------------------------------ args + lifecycle */
  function handleArgs(a = {}) {
    if (!a || typeof a !== 'object') return;
    if (a.message) {
      const m = mail.find((x) => x.id === a.message);
      if (m) { folder = m.folder === 'drafts' ? folder : m.folder; changed(); openMail(m); }
      return;
    }
    if (a.share) {
      const s = a.share;
      ctx.navigate(composePage, { subject: s.title || '', body: [s.text, s.url && s.url !== s.text ? s.url : ''].filter(Boolean).join('\n'), attachments: s.path ? [s.path] : [] });
      return;
    }
    if (a.to || a.subject || a.body) ctx.navigate(composePage, { to: a.to, subject: a.subject, body: a.body });
  }

  await ctx.navigate(mainPage);
  handleArgs(ctx.args);
  ctx.on('args', handleArgs);
  ctx.on('resume', async () => {
    contacts = await loadContacts();
    const fresh = await storage.get('mail', null);
    if (Array.isArray(fresh) && JSON.stringify(fresh) !== JSON.stringify(mail)) { mail = fresh; pushTile(); }
    changed();
  });
  // background daily digest on launch (quiet)
  if (prefs.digest && Date.now() - (prefs.lastDigest || 0) > 6 * 3600e3) setTimeout(() => sync({ silent: true }), 2500);

  return {};
}
