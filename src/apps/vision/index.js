// Bing Vision: QR & barcode scanner using the BarcodeDetector API (Chrome Android / macOS).
import './style.css';
import { Zap, ImagePlus, History, Link, Wifi, Contact, Type, Barcode, Mail, Phone, MessageSquare, MapPin } from 'lucide';

const MAX_HISTORY = 60;

/* ------------------------------------------------------------ parsing */
function unesc(s = '') { return s.replace(/\\([\;,:"])/g, '$1'); }
function parseWifi(raw) {
  const body = raw.replace(/^WIFI:/i, '');
  const out = {};
  const re = /([TSPH]):((?:\\.|[^;])*);/gi;
  let m;
  while ((m = re.exec(body))) out[m[1].toUpperCase()] = unesc(m[2]);
  return { ssid: out.S || '', password: out.P || '', security: (out.T || 'nopass').toUpperCase(), hidden: /true/i.test(out.H || '') };
}
function parseVCard(raw) {
  const lines = raw.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  const c = { first: '', last: '', name: '', phones: [], emails: [], company: '', url: '' };
  for (const line of lines) {
    const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0, i).toUpperCase(), val = unesc(line.slice(i + 1).trim());
    if (key === 'FN') c.name = val;
    else if (key.startsWith('N') && (key === 'N' || key.startsWith('N;'))) { const [l, f] = val.split(';'); c.last = l || ''; c.first = f || ''; }
    else if (key.startsWith('TEL')) c.phones.push({ type: /WORK/.test(key) ? 'work' : /HOME/.test(key) ? 'home' : 'mobile', number: val });
    else if (key.startsWith('EMAIL')) c.emails.push({ type: /WORK/.test(key) ? 'work' : 'personal', address: val });
    else if (key.startsWith('ORG')) c.company = val.split(';')[0];
    else if (key.startsWith('URL')) c.url = val;
  }
  if (!c.name) c.name = [c.first, c.last].filter(Boolean).join(' ');
  if (!c.first && !c.last && c.name) { const p = c.name.split(' '); c.first = p.shift(); c.last = p.join(' '); }
  return c;
}
function parseMeCard(raw) {
  const out = { phones: [], emails: [] };
  const re = /([A-Z-]+):((?:\\.|[^;])*);/g; let m;
  while ((m = re.exec(raw.replace(/^MECARD:/i, '')))) {
    const v = unesc(m[2]);
    if (m[1] === 'N') { const [l, f] = v.split(','); out.last = l || ''; out.first = f || ''; }
    if (m[1] === 'TEL') out.phones.push({ type: 'mobile', number: v });
    if (m[1] === 'EMAIL') out.emails.push({ type: 'personal', address: v });
    if (m[1] === 'ORG') out.company = v;
  }
  out.name = [out.first, out.last].filter(Boolean).join(' ');
  return out;
}

export function classify(raw, format = '') {
  try { return classifyRaw(String(raw || '').trim(), format); } catch { return { type: 'text', title: 'text' }; }
}
function classifyRaw(s, format) {
  if (/^https?:\/\//i.test(s) || /^www\.[^\s]+\.[a-z]{2,}/i.test(s)) return { type: 'url', title: 'website', url: /^www\./i.test(s) ? 'https://' + s : s };
  if (/^WIFI:/i.test(s)) { const w = parseWifi(s); return { type: 'wifi', title: 'Wi-Fi network', wifi: w }; }
  if (/^BEGIN:VCARD/i.test(s)) return { type: 'contact', title: 'contact', contact: parseVCard(s) };
  if (/^MECARD:/i.test(s)) return { type: 'contact', title: 'contact', contact: parseMeCard(s) };
  if (/^mailto:/i.test(s) || /^MATMSG:/i.test(s)) {
    let to = '', sub = '', body = '';
    if (/^mailto:/i.test(s)) { const u = new URL(s); to = decodeURIComponent(u.pathname); sub = u.searchParams.get('subject') || ''; body = u.searchParams.get('body') || ''; }
    else { to = (s.match(/TO:([^;]*)/i) || [])[1] || ''; sub = (s.match(/SUB:([^;]*)/i) || [])[1] || ''; body = (s.match(/BODY:([^;]*)/i) || [])[1] || ''; }
    return { type: 'email', title: 'email', to, sub, body };
  }
  if (/^tel:/i.test(s)) return { type: 'tel', title: 'phone number', number: s.slice(4) };
  if (/^(smsto|sms):/i.test(s)) { const [, n, b] = s.split(':'); return { type: 'sms', title: 'text message', number: n || '', body: b || '' }; }
  if (/^geo:/i.test(s)) { const [lat, lon] = s.slice(4).split(/[,?;]/).map(Number); return { type: 'geo', title: 'location', lat, lon }; }
  if (/^(ean|upc|itf|codabar|code_)/i.test(format) || /^\d{8,14}$/.test(s)) return { type: 'product', title: 'product barcode' };
  return { type: 'text', title: 'text' };
}

const ICONS = { url: Link, wifi: Wifi, contact: Contact, text: Type, product: Barcode, email: Mail, tel: Phone, sms: MessageSquare, geo: MapPin };

/* ------------------------------------------------------------ app */
export default async function launch(ctx) {
  const { root, os } = ctx;
  const { el, iconSVG, appBar, I } = os.ui;
  const supported = 'BarcodeDetector' in window;
  let detector = null;
  let history = await ctx.storage.get('history', []);

  const video = el('video.vision-video', { playsInline: true, muted: true, autoplay: true });
  video.setAttribute('playsinline', '');
  const status = el('div.vision-status');
  const result = el('div.vision-result', { hidden: true });
  const frame = el('div.vision-frame', el('i'), el('i'), el('i'), el('i'), el('div.vision-laser'));
  const view = el('div.vision',
    video,
    el('div.vision-shade'),
    el('div.vision-top', el('div.wp-app-title', 'BING VISION'), el('div.vision-sub', 'point at a QR code or barcode')),
    frame,
    status,
    result);
  root.append(view);

  let stream = null, running = false, timer = 0, busy = false, lastRaw = '', lastAt = 0, torchOn = false, suspended = false, inHistory = false;

  const setStatus = (t, cls = '') => { status.textContent = t; status.className = 'vision-status' + (cls ? ' ' + cls : ''); status.hidden = !t; };

  async function initDetector() {
    if (!supported) return null;
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.() || ['qr_code'];
      return new window.BarcodeDetector(formats.length ? { formats } : undefined);
    } catch { try { return new window.BarcodeDetector(); } catch { return null; } }
  }

  async function startCamera() {
    if (stream || suspended || inHistory) return;
    setStatus('starting camera…');
    try {
      stream = await os.device.getCamera({ facing: 'environment', width: 1280, height: 720 });
      if (suspended) { stopCamera(); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      view.classList.add('live');
      if (!detector) detector = await initDetector();
      if (!detector) {
        setStatus('Barcode scanning isn’t supported in this browser. Try Chrome on Android or macOS — the camera preview still works.', 'warn');
        view.classList.add('unsupported');
      } else { setStatus(''); scanLoop(); }
      const caps = stream.getVideoTracks()[0]?.getCapabilities?.() || {};
      bar.setButtons(buttons(!!caps.torch));
    } catch (e) {
      stream = null;
      setStatus('Can’t use the camera: ' + (e.message || e.name) + '. You can still scan a picture.', 'warn');
    }
  }
  function stopCamera() {
    running = false; clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null; torchOn = false;
    video.srcObject = null;
    view.classList.remove('live');
  }

  function scanLoop() {
    running = true;
    const tick = async () => {
      if (!running) return;
      if (!busy && result.hidden && video.readyState >= 2) {
        busy = true;
        try {
          const codes = await detector.detect(video);
          if (codes.length) onCode(codes[0].rawValue, codes[0].format);
        } catch {}
        busy = false;
      }
      timer = setTimeout(tick, 220);
    };
    tick();
  }

  async function onCode(raw, format, fromImage) {
    if (!raw) return;
    const now = Date.now();
    if (!fromImage && raw === lastRaw && now - lastAt < 4000) return;
    lastRaw = raw; lastAt = now;
    os.device.vibrate(40);
    os.sounds.tap?.();
    const item = { id: os.util.uid(), raw, format: format || 'qr_code', time: now };
    history = [item, ...history.filter((h) => h.raw !== raw)].slice(0, MAX_HISTORY);
    ctx.storage.set('history', history);
    showResult(item);
  }

  /* ---- result card */
  function actionsFor(item) {
    const c = classify(item.raw, item.format);
    const a = [];
    const ie = (url) => os.launch('ie', { url });
    const bing = (q) => ie('https://www.bing.com/search?q=' + encodeURIComponent(q));
    const copy = (t, msg = 'Copied') => os.device.copy(t).then(() => os.toast(msg), () => os.toast('Couldn’t copy'));
    let body = item.raw;
    if (c.type === 'url') { body = c.url; a.push(['open in Internet Explorer', () => ie(c.url)], ['copy link', () => copy(c.url)], ['share link', () => os.share({ title: c.url, url: c.url })]); }
    else if (c.type === 'wifi') {
      const w = c.wifi;
      body = `${w.ssid}\nsecurity: ${w.security === 'NOPASS' ? 'open' : w.security}${w.password ? '\npassword: ' + w.password : ''}`;
      if (w.password) a.push(['copy password', () => copy(w.password, 'Password copied — paste it in Wi-Fi settings')]);
      a.push(['open Wi-Fi settings', () => os.launch('settings', { page: 'wifi' })]);
    } else if (c.type === 'contact') {
      const k = c.contact;
      body = [k.name, k.company, ...k.phones.map((p) => p.number), ...k.emails.map((e) => e.address)].filter(Boolean).join('\n');
      a.push(['save to People', () => os.launch('people', { add: { first: k.first, last: k.last, company: k.company, phones: k.phones, emails: k.emails } })]);
      if (k.phones[0]) a.push(['call ' + k.phones[0].number, () => os.device.call(k.phones[0].number)]);
      if (k.emails[0]) a.push(['email', () => os.device.email(k.emails[0].address)]);
      a.push(['share contact', async () => {
        const name = (k.name || 'contact').replace(/[\\/:*?"<>|]/g, '');
        const p = await os.fs.uniquePath('/Documents/' + name + '.vcf');
        await os.fs.write(p, item.raw, { mime: 'text/vcard' });
        os.share({ title: k.name, text: body, path: p });
      }]);
    } else if (c.type === 'email') { body = c.to + (c.sub ? '\n' + c.sub : ''); a.push(['write email', () => os.device.email(c.to, c.sub, c.body)], ['copy address', () => copy(c.to)]); }
    else if (c.type === 'tel') { body = c.number; a.push(['call', () => os.device.call(c.number)], ['copy number', () => copy(c.number)]); }
    else if (c.type === 'sms') { body = c.number + (c.body ? '\n' + c.body : ''); a.push(['send text', () => os.device.sms(c.number, c.body)], ['copy', () => copy(item.raw)]); }
    else if (c.type === 'geo') { body = `${c.lat}, ${c.lon}`; a.push(['open in maps', () => os.launch('maps', { lat: c.lat, lon: c.lon, query: `${c.lat},${c.lon}` })], ['view on Bing', () => ie(`https://www.bing.com/maps?cp=${c.lat}~${c.lon}&lvl=15`)]); }
    else if (c.type === 'product') { a.push(['search product on Bing', () => bing(item.raw)], ['copy number', () => copy(item.raw)]); }
    else { a.push(['search with Bing', () => bing(item.raw)], ['ask Cortana', () => os.launch('cortana', { query: item.raw })], ['copy text', () => copy(item.raw)], ['share text', () => os.share({ text: item.raw })]); }
    return { c, body, actions: a };
  }

  function resultCard(item, { compact = false } = {}) {
    const { c, body, actions } = actionsFor(item);
    return el('div.vision-card' + (compact ? '.compact' : ''),
      el('div.vision-card-head',
        el('span.vision-card-icon', { html: iconSVG(ICONS[c.type] || Type, { size: 26 }) }),
        el('div', el('div.vision-card-type', c.title), el('div.vision-card-meta', item.format.replace(/_/g, ' ') + ' · ' + os.util.formatRelative(item.time)))),
      el('div.vision-card-body', body),
      el('div.vision-card-actions', ...actions.map(([label, fn]) => el('button.vision-action.tilt', { onclick: fn }, label))));
  }

  let offResultBack = null;
  function showResult(item) {
    result.replaceChildren(resultCard(item), el('button.vision-dismiss.tilt', { onclick: hideResult }, 'scan again'));
    result.hidden = false;
    view.classList.add('has-result');
    offResultBack?.();
    offResultBack = ctx.onBack(() => { hideResult(); return true; });
  }
  function hideResult() {
    result.hidden = true; view.classList.remove('has-result');
    offResultBack?.(); offResultBack = null;
    lastRaw = '';
  }

  /* ---- scan from picture */
  async function scanBlob(blob) {
    if (!detector) detector = await initDetector();
    if (!detector) { os.ui.alert('This browser doesn’t support barcode detection (BarcodeDetector). Try Chrome on Android or macOS.', 'not supported'); return; }
    try {
      const bmp = await createImageBitmap(blob);
      const codes = await detector.detect(bmp);
      if (!codes.length) { os.ui.alert('No QR code or barcode was found in that picture.', 'nothing found'); return; }
      onCode(codes[0].rawValue, codes[0].format, true);
    } catch (e) { os.ui.alert('Couldn’t read that picture. ' + (e.message || ''), 'error'); }
  }
  async function pickPicture() {
    const [p] = (await os.pick.file({ accept: 'image/*', start: '/Pictures' })) || [];
    if (p) scanBlob(await os.fs.read(p, 'blob'));
  }
  function importFromDevice() {
    const inp = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    inp.addEventListener('change', () => { if (inp.files[0]) scanBlob(inp.files[0]); inp.remove(); });
    root.append(inp); inp.click();
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try { torchOn = !torchOn; await track.applyConstraints({ advanced: [{ torch: torchOn }] }); bar.setButtons(buttons(true)); } catch { os.toast('Flash unavailable'); }
  }

  /* ---- history page */
  function historyPage(page) {
    const p = os.ui.page({ app: 'BING VISION', title: 'history' });
    const lst = os.ui.list(history, {
      empty: 'Nothing scanned yet. Codes you scan show up here.',
      render: (h) => { const c = classify(h.raw, h.format); return os.ui.listItem({ icon: ICONS[c.type] || Type, title: h.raw.split('\n')[0].slice(0, 80), subtitle: c.title + ' · ' + os.util.formatRelative(h.time) }); },
      onClick: (h) => ctx.navigate(detailPage, { item: h }),
      onHold: (h, row) => os.ui.contextMenu(row, [
        { label: 'copy', onClick: () => os.device.copy(h.raw).then(() => os.toast('Copied')) },
        { label: 'delete', onClick: () => { history = history.filter((x) => x.id !== h.id); ctx.storage.set('history', history); lst.update(history); } },
      ]),
    });
    p.content.append(lst);
    const hb = appBar({ minimized: true, menu: [{ label: 'clear history', onClick: async () => { if (await os.ui.confirm('Delete all scanned items?', 'clear history', 'delete', 'cancel')) { history = []; ctx.storage.set('history', history); lst.update(history); } } }] });
    page.el.append(p.el, hb.el);
    inHistory = true; stopCamera(); // camera isn't visible while browsing history
    return { onShow: () => lst.update(history), onDestroy: () => { inHistory = false; startCamera(); } };
  }
  function detailPage(page) {
    const p = os.ui.page({ app: 'BING VISION', title: 'result' });
    p.content.append(resultCard(page.params.item));
    page.el.append(p.el);
  }

  /* ---- app bar */
  function buttons(hasTorch) {
    const b = [
      { icon: ImagePlus, label: 'picture', onClick: pickPicture },
      { icon: History, label: 'history', onClick: () => ctx.navigate(historyPage) },
    ];
    if (hasTorch) b.unshift({ icon: Zap, label: torchOn ? 'flash off' : 'flash on', onClick: toggleTorch });
    return b;
  }
  const bar = appBar({ buttons: buttons(false), menu: [{ label: 'scan an image from this device', onClick: importFromDevice }, { label: 'restart camera', onClick: () => { stopCamera(); startCamera(); } }] });
  view.append(bar.el);

  if (!supported) setStatus('Barcode scanning isn’t supported in this browser. Try Chrome on Android or macOS.', 'warn');
  startCamera();

  return {
    onSuspend: () => { suspended = true; stopCamera(); },
    onResume: () => { suspended = false; startCamera(); },
    onDestroy: () => { suspended = true; stopCamera(); },
  };
}
