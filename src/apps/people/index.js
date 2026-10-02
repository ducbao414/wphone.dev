// People hub: all / what's new / together, contact cards, editing, groups, vCard import/export, secondary tiles.
import './style.css';
import { UserPlus, ListChecks, Star, StarOff, Users, Import, FileDown, Camera, Image as ImageIcon, Phone, MessageSquare, Mail, MapPin, Cake, UserPen } from 'lucide';
import { ensureSeeded, normalize, displayName, initials, hashColor, sameNumber, normNum, toVCard, parseVCards, daysToBirthday, uid } from './lib.js';

const PHONE_TYPES = ['mobile', 'home', 'work', 'company', 'other'];
const EMAIL_TYPES = ['personal', 'work', 'other'];

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const { el, I } = os.ui;
  const ui = os.ui;

  await ensureSeeded(os).catch(() => {});
  let contacts = await storage.get('contacts', []);
  let groups = await storage.get('groups', []);
  let activity = await storage.get('activity', []);
  let sortBy = await storage.get('sortBy', 'first');
  const refreshers = new Set();
  const refreshAll = () => refreshers.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  async function reload() {
    contacts = await storage.get('contacts', []);
    groups = await storage.get('groups', []);
    activity = await storage.get('activity', []);
    refreshAll();
  }
  async function saveContacts() {
    await storage.set('contacts', contacts);
    os.tiles.refresh('people');
    refreshAll();
  }
  async function saveGroups() { await storage.set('groups', groups); os.tiles.refresh('people'); refreshAll(); }
  async function log(type, contact, extra = {}) {
    activity = [{ id: uid(), type, contact, time: Date.now(), ...extra }, ...activity].slice(0, 60);
    await storage.set('activity', activity);
  }
  const byId = (id) => contacts.find((c) => c.id === id);
  const sortKey = (c) => (sortBy === 'last' && c.last ? `${c.last} ${c.first}` : displayName(c));

  /* ---------------------------------------------------------------- helpers */
  function avatar(c, size = 52, cls = '') {
    const a = el('div.people-av' + (cls ? '.' + cls : ''), { style: { width: size + 'px', height: size + 'px' } });
    if (c?.photo) a.style.backgroundImage = `url("${c.photo}")`;
    else {
      a.style.background = c?.id === 'me' ? 'var(--accent)' : hashColor(c?.id || '');
      a.append(el('span', { style: { fontSize: Math.round(size * 0.38) + 'px' } }, initials(c)));
    }
    return a;
  }
  const fmtBday = (b) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b || '');
    if (!m) return '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { month: 'long', day: 'numeric', year: +m[1] > 1900 ? 'numeric' : undefined });
  };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  async function cropSquare(blob, max = 320) {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = c.height = Math.min(max, s);
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, c.width, c.height);
    bmp.close?.();
    return c.toDataURL('image/jpeg', 0.85);
  }

  async function choosePhoto(hasPhoto) {
    const opts = [{ value: 'pick', label: 'choose photo' }, { value: 'camera', label: 'take photo' }];
    if (hasPhoto) opts.push({ value: 'remove', label: 'remove photo' });
    const v = await ui.pickFromList({ title: 'photo', options: opts });
    if (!v) return undefined;
    if (v === 'remove') return null;
    try {
      if (v === 'pick') {
        const [p] = await os.pick.file({ accept: 'image/*', start: '/Pictures', title: 'choose a photo' });
        if (!p) return undefined;
        return await cropSquare(await os.fs.read(p, 'blob'));
      }
      return await takePhoto();
    } catch (e) { ui.alert(e.message || String(e), 'photo'); return undefined; }
  }

  function takePhoto() {
    return new Promise(async (resolve) => {
      let stream;
      try { stream = await os.device.getCamera({ facing: 'user', width: 960, height: 960 }); } catch (e) { ui.alert(e.message || 'Camera not available.', 'camera'); return resolve(undefined); }
      const video = el('video.people-cam-video', { autoplay: true, playsInline: true, muted: true });
      video.srcObject = stream;
      const finish = async (snap) => {
        let out;
        if (snap && video.videoWidth) {
          os.sounds.shutter?.();
          const s = Math.min(video.videoWidth, video.videoHeight);
          const c = document.createElement('canvas');
          c.width = c.height = Math.min(320, s);
          c.getContext('2d').drawImage(video, (video.videoWidth - s) / 2, (video.videoHeight - s) / 2, s, s, 0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', 0.85);
        }
        stream.getTracks().forEach((t) => t.stop());
        layer.remove(); off();
        resolve(out);
      };
      const bar = ui.appBar({ buttons: [{ icon: Camera, label: 'capture', onClick: () => finish(true) }, { icon: I.close, label: 'cancel', onClick: () => finish(false) }] });
      const layer = el('div.people-cam', el('div.wp-app-title', 'TAKE PHOTO'), el('div.people-cam-frame', video), bar.el);
      ctx.root.append(layer);
      const off = ctx.onBack(() => { finish(false); return true; });
    });
  }

  function contactRow(c, { sub, checkable } = {}) {
    return el('div.people-row', checkable ? el('div.people-check', { html: ui.iconSVG(I.check, { size: 18, stroke: 3 }) }) : null,
      avatar(c, 52), el('div.people-row-text', el('div.people-row-name', displayName(c)), sub ? el('div.people-row-sub', sub) : null));
  }

  /* ---------------------------------------------------------------- actions */
  function callNumber(number) { os.launch('phone', { number }); }
  function textNumber(number) { os.launch('messaging', { to: number }); }
  function emailTo(address) { os.launch('outlook', { to: address }); }
  async function pinContact(c) {
    const key = 'people:' + c.id;
    if (os.tiles.isPinned('people', key)) { os.toast('Already pinned to Start'); return; }
    await ctx.pinTile({ key, title: displayName(c), args: { contact: c.id }, size: 'medium' });
    os.toast(`${displayName(c)} pinned to Start`);
  }
  async function toggleFavorite(c) {
    c.favorite = !c.favorite;
    await saveContacts();
    os.toast(c.favorite ? 'Added to favorites (speed dial)' : 'Removed from favorites');
  }
  async function deleteContacts(ids, ask = true) {
    if (!ids.length) return false;
    if (ask) {
      const msg = ids.length === 1 ? `${displayName(byId(ids[0]))} will be deleted from your phone.` : `${ids.length} contacts will be deleted from your phone.`;
      if (!(await ui.confirm(msg, 'delete contact?', 'delete', 'cancel'))) return false;
    }
    contacts = contacts.filter((c) => !ids.includes(c.id));
    groups = groups.map((g) => ({ ...g, members: g.members.filter((m) => !ids.includes(m)) }));
    for (const id of ids) os.tiles.unpin('people:' + id);
    await storage.set('groups', groups);
    await saveContacts();
    return true;
  }
  async function shareContact(c) {
    const path = await os.fs.uniquePath(`/Documents/${displayName(c).replace(/[\\/:*?"<>|]/g, '')}.vcf`);
    await os.fs.write(path, toVCard(c), { mime: 'text/vcard' });
    os.share({ title: displayName(c), text: `${displayName(c)}${c.phones[0] ? ' ' + c.phones[0].number : ''}`, path });
  }
  function holdMenu(c, row) {
    ui.contextMenu(row, [
      { label: 'pin to start', onClick: () => pinContact(c) },
      { label: c.favorite ? 'remove from favorites' : 'add to favorites', onClick: () => toggleFavorite(c) },
      { label: 'edit', onClick: () => ctx.navigate(editPage, { id: c.id }) },
      { label: 'delete', onClick: () => deleteContacts([c.id]) },
    ]);
  }

  async function addContacts(list, source) {
    let added = 0;
    for (const raw of list) {
      const n = normalize(raw);
      const dup = contacts.find((c) => displayName(c).toLowerCase() === n.name.toLowerCase()
        && (!n.phones.length || c.phones.some((p) => n.phones.some((q) => sameNumber(p.number, q.number)))));
      if (dup) continue;
      contacts.push(n);
      added++;
      await log(source || 'added', n.id);
    }
    await saveContacts();
    return added;
  }

  // Import from a .vcf file (no access to the device's real address book).
  async function importFromDevice() {
    const [path] = await os.pick.file({ accept: '.vcf', title: 'import contacts (.vcf)', start: '/Documents' });
    if (path) importVcfFile(path);
  }
  async function importVcfFile(path) {
    try {
      const text = await os.fs.read(path, 'text');
      const cards = parseVCards(text);
      if (!cards.length) return ui.alert('No contacts were found in this file.', 'import');
      const ok = await ui.confirm(`Import ${cards.length} contact${cards.length === 1 ? '' : 's'} from ${os.path.basename(path)}?`, 'import contacts', 'import', 'cancel');
      if (!ok) return;
      const n = await addContacts(cards, 'imported');
      os.toast(`Imported ${n} contact${n === 1 ? '' : 's'}${n < cards.length ? ` (${cards.length - n} duplicates skipped)` : ''}`);
    } catch (e) { ui.alert('Couldn’t read this file. ' + (e.message || ''), 'import'); }
  }
  async function importVcfPick() {
    const [p] = await os.pick.file({ accept: '.vcf', start: '/Documents', title: 'choose a vcard file' });
    if (p) importVcfFile(p);
  }
  async function exportAll() {
    if (!contacts.length) return ui.alert('You don’t have any contacts to export.', 'export');
    const path = await os.pick.save({ name: 'contacts.vcf', start: '/Documents', title: 'export contacts' });
    if (!path) return;
    const finalPath = path.toLowerCase().endsWith('.vcf') ? path : path + '.vcf';
    await os.fs.write(finalPath, contacts.map(toVCard).join('\r\n'), { mime: 'text/vcard' });
    const i = await ui.messageBox({ title: 'export complete', message: `${contacts.length} contacts saved to ${finalPath}`, buttons: ['ok', 'save to device'] });
    if (i === 1) os.fs.download(finalPath);
  }

  /* ---------------------------------------------------------------- hub */
  function hubPage(page) {
    let selectMode = false;
    const selected = new Set();
    let query = '';
    let allC, newsC, togetherC;

    const searchBox = ui.textbox({ placeholder: 'search contacts', onInput: (v) => { query = v.trim().toLowerCase(); renderAll(); } });
    const searchWrap = el('div.people-search', searchBox);
    searchWrap.hidden = true;

    const pv = ui.pivot({
      app: 'PEOPLE',
      items: [
        { header: 'all', render: (c) => { allC = c; renderAll(); } },
        { header: 'what’s new', render: (c) => { newsC = c; renderNews(); } },
        { header: 'together', render: (c) => { togetherC = c; renderTogether(); } },
      ],
    });
    pv.el.classList.add('people-hub');
    const bar = ui.appBar({});
    page.el.append(pv.el, bar.el);

    function setBar() {
      const i = pv.index;
      if (selectMode) {
        bar.setButtons([{ icon: I.delete, label: 'delete', disabled: !selected.size, onClick: async () => { if (await deleteContacts([...selected])) exitSelect(); } }]);
        bar.setMenu([{ label: 'select all', onClick: () => { contacts.forEach((c) => selected.add(c.id)); renderAll(); setBar(); } }]);
        return;
      }
      const common = [
        { label: 'import .vcf file', onClick: importFromDevice },
        { label: 'import vcard file', onClick: importVcfPick },
        { label: 'export contacts (.vcf)', onClick: exportAll },
        { label: 'settings', onClick: () => ctx.navigate(settingsPage) },
      ];
      if (i === 0) bar.setButtons([
        { icon: I.add, label: 'add', onClick: () => ctx.navigate(editPage, {}) },
        { icon: I.search, label: 'search', onClick: toggleSearch },
        { icon: ListChecks, label: 'select', onClick: enterSelect },
      ]);
      else if (i === 1) bar.setButtons([{ icon: I.refresh, label: 'refresh', onClick: () => reload() }]);
      else bar.setButtons([{ icon: I.add, label: 'new group', onClick: newGroup }]);
      bar.setMenu(common);
    }
    function toggleSearch() {
      searchWrap.hidden = !searchWrap.hidden;
      if (!searchWrap.hidden) setTimeout(() => searchBox.focus(), 50);
      else { query = ''; searchBox.value = ''; renderAll(); }
    }
    function enterSelect() { selectMode = true; selected.clear(); renderAll(); setBar(); }
    function exitSelect() { selectMode = false; selected.clear(); renderAll(); setBar(); }
    pv.onChange(() => { if (selectMode) exitSelect(); else setBar(); });
    setBar();

    function renderAll() {
      if (!allC) return;
      allC.classList.toggle('people-selecting', selectMode);
      const onClick = (c, row) => {
        if (selectMode) {
          selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id);
          row.classList.toggle('people-sel', selected.has(c.id));
          setBar();
          return;
        }
        ctx.navigate(cardPage, { id: c.id });
      };
      const render = (c) => {
        const r = contactRow(c, { checkable: true });
        if (selected.has(c.id)) r.classList.add('people-sel');
        return r;
      };
      const kids = [searchWrap];
      if (query) {
        const res = contacts.filter((c) => [displayName(c), c.company, ...c.phones.map((p) => p.number), ...c.emails.map((e) => e.address)].join(' ').toLowerCase().includes(query)
          || (normNum(query).length > 2 && c.phones.some((p) => normNum(p.number).includes(normNum(query)))));
        kids.push(ui.list(res.sort((a, b) => sortKey(a).localeCompare(sortKey(b))), {
          render: (c) => contactRow(c, { sub: c.phones[0]?.number || c.emails[0]?.address || c.company }),
          onClick: (c) => ctx.navigate(cardPage, { id: c.id }), onHold: holdMenu, empty: 'no results',
        }));
      } else {
        if (!selectMode) {
          const owner = os.settings.get('ownerName') || 'me';
          const meRow = el('div.people-row.people-me.tilt', { onclick: () => ctx.navigate(mePage) }, avatar({ id: 'me', name: owner, photo: mePhoto }, 52),
            el('div.people-row-text', el('div.people-row-name', owner), el('div.people-row-sub', 'me')));
          kids.push(meRow);
        }
        if (!contacts.length) {
          kids.push(el('div.people-empty', el('div.wp-empty', 'Your contacts will show up here. Add someone, or import contacts from your device or a .vcf file.'),
            ui.button('add contact', () => ctx.navigate(editPage, {})), ui.button('import', importFromDevice)));
        } else {
          kids.push(ui.jumpList(contacts, { key: sortKey, render, onClick, onHold: (c, row) => { if (!selectMode) holdMenu(c, row); } }));
        }
      }
      allC.replaceChildren(...kids);
    }

    async function renderNews() {
      if (!newsC) return;
      const items = [];
      // upcoming birthdays (next 30 days)
      for (const c of contacts) {
        const d = daysToBirthday(c.birthday);
        if (d != null && d <= 30) items.push({ c, sort: -1e15 + d, title: d === 0 ? `🎂 ${displayName(c)}’s birthday is today` : `${displayName(c)}’s birthday is ${d === 1 ? 'tomorrow' : 'in ' + d + ' days'}`, sub: fmtBday(c.birthday), act: 'birthday' });
      }
      // recent calls from Phone
      let calls = [];
      try { calls = (await os.storage('phone').get('history', [])).slice(0, 15); } catch {}
      for (const h of calls) {
        const c = contacts.find((x) => x.phones.some((p) => sameNumber(p.number, h.number)));
        if (!c) continue;
        const verb = h.type === 'missed' ? `You missed a call from ${displayName(c)}` : h.type === 'incoming' ? `${displayName(c)} called you` : `You called ${displayName(c)}`;
        items.push({ c, sort: -h.time, title: verb, sub: os.util.formatRelative(h.time), act: 'call' });
      }
      for (const a of activity.slice(0, 25)) {
        const c = byId(a.contact);
        if (!c) continue;
        const t = { added: `${displayName(c)} was added to your contacts`, edited: `You updated ${displayName(c)}’s profile`, imported: `${displayName(c)} was imported`, photo: `${displayName(c)} has a new profile picture` }[a.type];
        if (t) items.push({ c, sort: -a.time, title: t, sub: os.util.formatRelative(a.time) });
      }
      items.sort((a, b) => a.sort - b.sort);
      if (!items.length) {
        newsC.replaceChildren(el('div.people-empty', el('div.wp-empty', 'Nothing new right now. Birthdays, calls and contact updates will show up here.')));
        return;
      }
      newsC.replaceChildren(ui.list(items, {
        render: (it) => el('div.people-row.people-news', avatar(it.c, 52), el('div.people-row-text', el('div.people-news-title', it.title), el('div.people-row-sub', it.sub))),
        onClick: (it) => ctx.navigate(cardPage, { id: it.c.id }),
      }));
    }

    function renderTogether() {
      if (!togetherC) return;
      const kids = [];
      const favs = contacts.filter((c) => c.favorite);
      kids.push(el('div.people-group-row.tilt', { onclick: () => ctx.navigate(groupPage, { id: '__fav' }) }, groupMosaic(favs), el('div.people-row-text', el('div.people-row-name', 'favorites'), el('div.people-row-sub', `${favs.length} ${favs.length === 1 ? 'person' : 'people'} · speed dial`))));
      for (const g of groups) {
        const members = g.members.map(byId).filter(Boolean);
        const row = el('div.people-group-row.tilt', { onclick: () => ctx.navigate(groupPage, { id: g.id }) }, groupMosaic(members), el('div.people-row-text', el('div.people-row-name', g.name), el('div.people-row-sub', `${members.length} ${members.length === 1 ? 'person' : 'people'}`)));
        os.util.onLongPress(row, () => ui.contextMenu(row, [
          { label: 'pin to start', onClick: () => pinGroup(g) },
          { label: 'rename', onClick: () => renameGroup(g) },
          { label: 'delete', onClick: () => deleteGroup(g) },
        ]));
        kids.push(row);
      }
      if (!groups.length) kids.push(el('div.wp-desc.people-together-tip', 'Groups (rooms) keep the people you talk to most together. Tap “new group” to create one — then text or email everyone at once, or pin the group to Start.'));
      togetherC.replaceChildren(...kids);
    }

    const r1 = () => { renderAll(); renderNews(); renderTogether(); };
    refreshers.add(r1);
    return { el: page.el, onBack: () => { if (selectMode) { exitSelect(); return true; } if (!searchWrap.hidden) { toggleSearch(); return true; } return false; }, onDestroy: () => refreshers.delete(r1) };
  }

  function groupMosaic(members) {
    const m = el('div.people-mosaic');
    const four = members.slice(0, 4);
    if (!four.length) m.append(el('div.people-mosaic-empty', { html: ui.iconSVG(Users, { size: 30 }) }));
    else for (let i = 0; i < 4; i++) m.append(four[i] ? avatar(four[i], 30) : el('div.people-mosaic-blank'));
    return m;
  }

  /* ---------------------------------------------------------------- groups */
  async function newGroup() {
    const name = await ui.prompt('Give your group a name.', '', 'new group', { placeholder: 'e.g. Family' });
    if (!name || !name.trim()) return;
    const g = { id: uid(), name: name.trim(), members: [] };
    groups.push(g);
    await saveGroups();
    ctx.navigate(groupPage, { id: g.id, pickNow: true });
  }
  async function renameGroup(g) {
    const name = await ui.prompt('Group name', g.name, 'rename group');
    if (!name || !name.trim()) return;
    g.name = name.trim();
    await saveGroups();
  }
  async function deleteGroup(g) {
    if (!(await ui.confirm(`Delete the group “${g.name}”? The contacts in it won’t be deleted.`, 'delete group?', 'delete', 'cancel'))) return false;
    groups = groups.filter((x) => x.id !== g.id);
    os.tiles.unpin('people-group:' + g.id);
    await saveGroups();
    return true;
  }
  async function pinGroup(g) {
    await ctx.pinTile({ key: 'people-group:' + g.id, title: g.name, args: { group: g.id }, size: 'wide' });
    os.toast(`${g.name} pinned to Start`);
  }

  function pickContacts(title, preselected = []) {
    return new Promise((resolve) => {
      let done = false;
      ctx.navigate((page) => {
        const sel = new Set(preselected);
        const p = ui.page({ app: 'PEOPLE', title });
        const lst = ui.jumpList(contacts, {
          key: sortKey,
          render: (c) => { const r = contactRow(c, { checkable: true }); if (sel.has(c.id)) r.classList.add('people-sel'); return r; },
          onClick: (c, row) => { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); row.classList.toggle('people-sel', sel.has(c.id)); },
        });
        p.content.classList.add('people-selecting');
        p.content.append(lst);
        const bar = ui.appBar({ buttons: [
          { icon: I.check, label: 'done', onClick: () => { done = true; resolve([...sel]); page.close(); } },
          { icon: I.close, label: 'cancel', onClick: () => page.close() },
        ] });
        page.el.append(p.el, bar.el);
        return { el: page.el, onDestroy: () => { if (!done) resolve(null); } };
      });
    });
  }

  function groupPage(page) {
    const isFav = page.params.id === '__fav';
    const p = ui.page({ app: 'PEOPLE', title: '' });
    const bar = ui.appBar({});
    page.el.append(p.el, bar.el);
    const getG = () => (isFav ? { id: '__fav', name: 'favorites', members: contacts.filter((c) => c.favorite).map((c) => c.id) } : groups.find((g) => g.id === page.params.id));
    async function addMembers() {
      const g = getG();
      const ids = await pickContacts(isFav ? 'favorites' : 'add people', g.members);
      if (!ids) return;
      if (isFav) { contacts.forEach((c) => (c.favorite = ids.includes(c.id))); await saveContacts(); }
      else { g.members = ids; await saveGroups(); }
    }
    function render() {
      const g = getG();
      if (!g) { p.content.replaceChildren(ui.empty('This group was deleted.')); bar.setButtons([]); bar.setMenu([]); return; }
      p.setTitle(g.name);
      const members = g.members.map(byId).filter(Boolean);
      const numbers = members.map((c) => c.phones[0]?.number).filter(Boolean);
      const emails = members.map((c) => c.emails[0]?.address).filter(Boolean);
      p.content.replaceChildren(
        members.length ? ui.list(members, {
          render: (c) => contactRow(c, { sub: c.phones[0]?.number || c.emails[0]?.address || '' }),
          onClick: (c) => ctx.navigate(cardPage, { id: c.id }),
          onHold: (c, row) => ui.contextMenu(row, [
            { label: 'call', disabled: !c.phones[0], onClick: () => callNumber(c.phones[0].number) },
            { label: isFav ? 'remove from favorites' : 'remove from group', onClick: async () => {
              if (isFav) { c.favorite = false; await saveContacts(); } else { g.members = g.members.filter((m) => m !== c.id); await saveGroups(); }
            } },
          ]),
        }) : el('div.people-empty', el('div.wp-empty', isFav ? 'No favorites yet. Favorites appear in Phone’s speed dial.' : 'No one here yet.'), ui.button('add people', addMembers)),
      );
      bar.setButtons([
        { icon: UserPlus, label: isFav ? 'edit' : 'add', onClick: addMembers },
        { icon: MessageSquare, label: 'text', disabled: !numbers.length, onClick: async () => {
          if (numbers.length === 1) return os.launch('messaging', { to: numbers[0] });
          const v = await ui.pickFromList({ title: 'text ' + g.name, options: [...members.filter((c) => c.phones[0]).map((c) => ({ value: c.phones[0].number, label: displayName(c) }))] });
          if (v) os.launch('messaging', { to: v });
        } },
        { icon: Mail, label: 'email', disabled: !emails.length, onClick: () => os.launch('outlook', { to: emails.join('; ') }) },
        ...(isFav ? [] : [{ icon: I.pin, label: 'pin', onClick: () => pinGroup(g) }]),
      ]);
      bar.setMenu(isFav ? [] : [
        { label: 'rename', onClick: () => renameGroup(g) },
        { label: 'delete group', onClick: async () => { if (await deleteGroup(g)) page.close(); } },
      ]);
    }
    render();
    refreshers.add(render);
    if (page.params.pickNow) setTimeout(addMembers, 450);
    return { el: page.el, onDestroy: () => refreshers.delete(render) };
  }

  /* ---------------------------------------------------------------- contact card */
  function cardPage(page) {
    const id = page.params.id;
    let pv;
    const bar = ui.appBar({});
    const wrap = el('div.people-card');
    page.el.append(wrap, bar.el);
    function render() {
      const c = byId(id);
      if (!c) { wrap.replaceChildren(ui.page({ app: 'PEOPLE', title: 'not found' }).el); bar.hide(); return; }
      const keep = pv ? pv.index : 0;
      pv = ui.pivot({
        app: displayName(c),
        index: keep,
        items: [
          { header: 'profile', render: (box) => renderProfile(box, c) },
          { header: 'history', render: (box) => renderHistory(box, c) },
        ],
      });
      bar.setButtons([
        { icon: I.edit, label: 'edit', onClick: () => ctx.navigate(editPage, { id }) },
        { icon: c.favorite ? StarOff : Star, label: c.favorite ? 'unfavorite' : 'favorite', onClick: () => toggleFavorite(c) },
        { icon: I.pin, label: 'pin', onClick: () => pinContact(c) },
      ]);
      bar.setMenu([
        { label: 'share contact', onClick: () => shareContact(c) },
        { label: 'add to group', onClick: () => addToGroup(c) },
        { label: 'delete', onClick: async () => { if (await deleteContacts([c.id])) page.close(); } },
      ]);
      wrap.replaceChildren(pv.el);
    }
    function action(title, sub, onClick, ic) {
      const r = el('div.people-action.tilt', { onclick: onClick || null },
        ic ? el('div.people-action-ic', { html: ui.iconSVG(ic, { size: 22 }) }) : null,
        el('div.people-action-text', el('div.people-action-title', title), sub ? el('div.people-action-sub', sub) : null));
      if (!onClick) r.classList.remove('tilt');
      return r;
    }
    function renderProfile(box, c) {
      const photo = avatar(c, 170, 'people-card-photo');
      if (c.favorite) photo.append(el('div.people-fav-star', { html: ui.iconSVG(Star, { size: 18 }) }));
      const rows = [];
      for (const p of c.phones) {
        const row = action(`call ${p.type}`, p.number, () => callNumber(p.number), Phone);
        os.util.onLongPress(row, () => ui.contextMenu(row, [{ label: 'copy number', onClick: () => os.device.copy(p.number).then(() => os.toast('Copied')) }, { label: 'call using device', onClick: () => os.device.call(p.number) }]));
        rows.push(row);
      }
      const mob = c.phones.find((p) => p.type === 'mobile') || c.phones[0];
      if (mob) rows.push(action('text', mob.number, () => textNumber(mob.number), MessageSquare));
      for (const e of c.emails) rows.push(action(`email ${e.type}`, e.address, () => emailTo(e.address), Mail));
      if (c.address) rows.push(action('map address', c.address, () => os.launch('maps', { q: c.address, query: c.address, search: c.address }), MapPin));
      if (c.birthday) {
        const d = daysToBirthday(c.birthday);
        rows.push(action('birthday', fmtBday(c.birthday) + (d === 0 ? ' · today!' : d != null && d < 31 ? ` · in ${d} day${d === 1 ? '' : 's'}` : ''), () => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.birthday);
          const now = new Date();
          let dt = new Date(now.getFullYear(), +m[2] - 1, +m[3]);
          if (d != null) dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
          os.launch('calendar', { date: dt.getTime() });
        }, Cake));
      }
      if (c.company) rows.push(action('company', c.company));
      if (c.notes) rows.push(action('notes', c.notes));
      if (!c.phones.length && !c.emails.length) rows.push(el('div.wp-desc', 'No phone numbers or email addresses yet. Tap edit to add some.'));
      box.replaceChildren(el('div.people-card-top', photo), ...rows);
    }
    async function renderHistory(box, c) {
      box.replaceChildren(ui.loadingDots({ inline: true }));
      let calls = [];
      try { calls = (await os.storage('phone').get('history', [])).filter((h) => c.phones.some((p) => sameNumber(p.number, h.number))); } catch {}
      const items = [];
      if (c.created) items.push({ time: c.created, title: 'added to contacts', sub: new Date(c.created).toLocaleDateString() });
      for (const h of calls) items.push({ time: h.time, title: { missed: 'missed call', incoming: 'incoming call', outgoing: 'outgoing call' }[h.type] || 'call', sub: `${os.util.formatRelative(h.time)}${h.duration ? ' · ' + os.util.formatDuration(h.duration) : ''}`, missed: h.type === 'missed', number: h.number });
      items.sort((a, b) => b.time - a.time);
      box.replaceChildren(
        items.length ? ui.list(items, {
          render: (it) => el('div.people-hist' + (it.missed ? '.missed' : ''), el('div.people-action-title', it.title), el('div.people-action-sub', it.sub)),
          onClick: (it) => it.number && callNumber(it.number),
        }) : ui.empty('No history with this person yet.'),
      );
    }
    async function addToGroup(c) {
      if (!groups.length) return ui.alert('Create a group first in the “together” section.', 'groups');
      const gid = await ui.pickFromList({ title: 'add to group', options: groups.map((g) => ({ value: g.id, label: g.name + (g.members.includes(c.id) ? ' ✓' : '') })) });
      const g = groups.find((x) => x.id === gid);
      if (!g) return;
      if (!g.members.includes(c.id)) g.members.push(c.id);
      await saveGroups();
      os.toast(`Added to ${g.name}`);
    }
    render();
    refreshers.add(render);
    return { el: page.el, onDestroy: () => refreshers.delete(render) };
  }

  /* ---------------------------------------------------------------- edit */
  function editPage(page) {
    const existing = page.params.id ? byId(page.params.id) : null;
    const pre = page.params.prefill || {};
    const d = structuredClone(existing || { first: '', last: '', phones: [], emails: [], photo: null, birthday: '', company: '', notes: '', address: '', favorite: false, ...pre });
    if (!d.phones.length) d.phones.push({ type: 'mobile', number: '' });
    if (!d.emails.length) d.emails.push({ type: 'personal', address: '' });
    let dirty = false;
    const mark = () => (dirty = true);

    const p = ui.page({ app: 'PEOPLE', title: existing ? 'edit contact' : 'new contact' });
    const photoBox = el('div.people-edit-photo.tilt', { onclick: async () => { const r = await choosePhoto(!!d.photo); if (r !== undefined) { d.photo = r; mark(); drawPhoto(); } } });
    const drawPhoto = () => {
      photoBox.replaceChildren();
      if (d.photo) { photoBox.style.backgroundImage = `url("${d.photo}")`; photoBox.classList.add('has'); }
      else { photoBox.style.backgroundImage = ''; photoBox.classList.remove('has'); photoBox.append(el('div', { html: ui.iconSVG(Camera, { size: 34 }) }), el('div.people-edit-photo-label', 'add photo')); }
    };
    drawPhoto();
    const field = (label, key, opts = {}) => {
      const t = ui.textbox({ label, value: d[key] || '', onInput: (v) => { d[key] = v; mark(); }, ...opts });
      return t;
    };
    const phonesBox = el('div'), emailsBox = el('div');
    const multi = (box, arr, types, key, inputType, placeholder, addLabel) => {
      const draw = () => {
        box.replaceChildren(...arr.map((item, i) => {
          const typeBtn = el('button.people-type.tilt', {
            onclick: async () => { const v = await ui.pickFromList({ title: 'type', options: types, value: item.type }); if (v) { item.type = v; typeBtn.textContent = v; mark(); } },
          }, item.type);
          const inp = ui.textbox({ value: item[key], type: inputType, placeholder, onInput: (v) => { item[key] = v; mark(); } });
          const rm = el('button.people-rm', { 'aria-label': 'remove', onclick: () => { arr.splice(i, 1); mark(); draw(); }, html: ui.iconSVG(I.close, { size: 18 }) });
          return el('div.people-multi', el('div.people-multi-head', typeBtn, rm), inp);
        }), el('div.people-add-link.tilt', { onclick: () => { arr.push({ type: types[0], [key]: '' }); draw(); setTimeout(() => box.querySelectorAll('input')[arr.length - 1]?.focus(), 30); } }, addLabel));
      };
      draw();
    };
    multi(phonesBox, d.phones, PHONE_TYPES, 'number', 'tel', 'phone number', '+ add phone');
    multi(emailsBox, d.emails, EMAIL_TYPES, 'address', 'email', 'email address', '+ add email');

    const bdayBtn = el('div.wp-listpicker.tilt');
    const drawBday = () => (bdayBtn.textContent = d.birthday ? fmtBday(d.birthday) : 'add birthday');
    drawBday();
    bdayBtn.addEventListener('click', async () => {
      if (d.birthday) {
        const v = await ui.pickFromList({ title: 'birthday', options: [{ value: 'change', label: 'change date' }, { value: 'clear', label: 'remove birthday' }] });
        if (!v) return;
        if (v === 'clear') { d.birthday = ''; mark(); drawBday(); return; }
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.birthday || '');
      const r = await ui.pickDate({ date: m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(1990, 0, 1), title: 'BIRTHDAY' });
      if (r) { d.birthday = ymd(r); mark(); drawBday(); }
    });

    const firstF = field('first name', 'first', { placeholder: '' });
    p.content.append(
      el('div.people-edit-top', photoBox),
      firstF, field('last name', 'last'), field('company', 'company'),
      el('div.wp-field-label.people-sec', 'phone'), phonesBox,
      el('div.wp-field-label.people-sec', 'email'), emailsBox,
      field('address', 'address', { placeholder: 'street, city' }),
      el('div.wp-field', el('div.wp-field-label', 'birthday'), bdayBtn),
      field('notes', 'notes', { multiline: true, rows: 3 }),
    );
    async function save() {
      const n = normalize({ ...d, id: existing?.id, created: existing?.created });
      if (!n.first && !n.last && !n.company && !n.phones.length && !n.emails.length) { ui.alert('Add a name, phone number or email address first.', 'can’t save'); return; }
      if (existing) {
        const i = contacts.findIndex((c) => c.id === existing.id);
        if (existing.photo !== n.photo && n.photo) await log('photo', n.id); else await log('edited', n.id);
        contacts[i] = n;
      } else { contacts.push(n); await log('added', n.id); }
      dirty = false;
      await saveContacts();
      os.tiles.refresh('people');
      os.toast(existing ? 'Contact saved' : `${n.name} added`);
      page.close();
      if (!existing && page.params.openAfter !== false) setTimeout(() => ctx.navigate(cardPage, { id: n.id }), 200);
    }
    const bar = ui.appBar({ buttons: [{ icon: I.save, label: 'save', onClick: save }, { icon: I.close, label: 'cancel', onClick: () => { dirty = false; page.close(); } }] });
    page.el.append(p.el, bar.el);
    if (!existing) setTimeout(() => firstF.input?.focus(), 400);
    return {
      el: page.el,
      onBack: async () => {
        if (!dirty) return false;
        const i = await ui.messageBox({ title: 'save changes?', message: 'You have unsaved changes to this contact.', buttons: ['save', 'discard'] });
        if (i === 0) { await save(); return true; }
        if (i === 1) { dirty = false; return false; }
        return true;
      },
    };
  }

  /* ---------------------------------------------------------------- me */
  let mePhoto = await storage.get('mePhoto', null);
  function mePage(page) {
    const p = ui.page({ app: 'PEOPLE', title: 'me' });
    page.el.append(p.el);
    const draw = () => {
      const owner = os.settings.get('ownerName') || 'me';
      p.content.replaceChildren(
        el('div.people-card-top', el('div.tilt', { onclick: async () => { const r = await choosePhoto(!!mePhoto); if (r !== undefined) { mePhoto = r; await storage.set('mePhoto', r); draw(); refreshAll(); } } }, avatar({ id: 'me', name: owner, photo: mePhoto }, 170, 'people-card-photo'))),
        el('div.people-me-name', owner),
        el('div.wp-desc', `${os.settings.get('deviceName') || 'My Lumia'} · ${contacts.length} contacts · ${groups.length} groups`),
        el('div.people-action.tilt', { onclick: async () => { const n = await ui.prompt('Your name is shown on your me card and on this phone.', owner, 'edit name'); if (n && n.trim()) { await os.settings.set('ownerName', n.trim()); draw(); refreshAll(); } } },
          el('div.people-action-ic', { html: ui.iconSVG(UserPen, { size: 22 }) }), el('div.people-action-text', el('div.people-action-title', 'edit name'), el('div.people-action-sub', owner))),
        el('div.people-action.tilt', { onclick: async () => { const r = await choosePhoto(!!mePhoto); if (r !== undefined) { mePhoto = r; await storage.set('mePhoto', r); draw(); refreshAll(); } } },
          el('div.people-action-ic', { html: ui.iconSVG(ImageIcon, { size: 22 }) }), el('div.people-action-text', el('div.people-action-title', 'change profile picture'))),
      );
    };
    draw();
    return page.el;
  }

  /* ---------------------------------------------------------------- settings */
  function settingsPage(page) {
    const p = ui.page({ app: 'PEOPLE', title: 'settings' });
    p.content.append(
      ui.listPicker({ label: 'sort list by', options: [{ value: 'first', label: 'first name' }, { value: 'last', label: 'last name' }], value: sortBy, onChange: async (v) => { sortBy = v; await storage.set('sortBy', v); refreshAll(); } }),
      ui.header('import & export'),
      el('div.people-action.tilt', { onclick: importFromDevice }, el('div.people-action-ic', { html: ui.iconSVG(Import, { size: 22 }) }), el('div.people-action-text', el('div.people-action-title', 'import contacts'), el('div.people-action-sub', 'from a .vcf file'))),
      el('div.people-action.tilt', { onclick: importVcfPick }, el('div.people-action-ic', { html: ui.iconSVG(Import, { size: 22 }) }), el('div.people-action-text', el('div.people-action-title', 'import vcard file'), el('div.people-action-sub', '.vcf from your phone storage'))),
      el('div.people-action.tilt', { onclick: exportAll }, el('div.people-action-ic', { html: ui.iconSVG(FileDown, { size: 22 }) }), el('div.people-action-text', el('div.people-action-title', 'export contacts'), el('div.people-action-sub', 'saves a .vcf file in Documents'))),
      ui.header('about'),
      ui.desc(`${contacts.length} contacts stored on this phone.`),
    );
    page.el.append(p.el);
    return page.el;
  }

  /* ---------------------------------------------------------------- args & lifecycle */
  async function handleArgs(a = {}) {
    if (!a || typeof a !== 'object') return;
    if (a.file) return importVcfFile(a.file);
    if (a.contact) { if (byId(a.contact)) ctx.navigate(cardPage, { id: a.contact }); else os.toast('This contact no longer exists'); return; }
    if (a.group) { ctx.navigate(groupPage, { id: a.group }); return; }
    if (a.edit && byId(a.edit)) { ctx.navigate(editPage, { id: a.edit }); return; }
    if (a.add || a.new) {
      const src = a.add || a.new;
      const prefill = typeof src === 'object' ? src : {};
      const num = prefill.number || prefill.phone || a.number;
      const phones = (prefill.phones || (num ? [num] : [])).map((p) => (typeof p === 'string' ? { type: 'mobile', number: p } : { type: p.type || 'mobile', number: p.number || '' }));
      const emails = (prefill.emails || (prefill.email ? [prefill.email] : [])).map((e) => (typeof e === 'string' ? { type: 'personal', address: e } : { type: e.type || 'personal', address: e.address || '' }));
      ctx.navigate(editPage, { prefill: { ...prefill, phones, emails } });
      return;
    }
    if (a.share) {
      const s = a.share;
      if (s.path && /\.vcf$/i.test(s.path)) return importVcfFile(s.path);
    }
  }

  await ctx.navigate(hubPage);
  handleArgs(ctx.args);
  ctx.on('args', handleArgs);
  ctx.on('resume', reload);
  const offOwner = os.settings.on('change', (k) => { if (k === 'ownerName') refreshAll(); });
  return { onDestroy: () => offOwner() };
}
