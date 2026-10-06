// Pinterest — branded landing page that hands off to the real app (deep link) or the mobile website.
import './style.css';
import manifest from './manifest.js';

const P = 'pinterest';

export default async function launch(ctx) {
  const { root, os } = ctx;
  const { el, iconSVG, I } = os.ui;

  const firstUrl = (s = '') => (String(s).match(/https?:\/\/\S+/) || [''])[0];
  const withScheme = (u = '') => (/^[a-z][a-z0-9+.-]*:/i.test(u.trim()) ? u.trim() : 'https://' + u.trim());
  void firstUrl; void withScheme;

  const CFG = {
    tagline: "Discover ideas for everything you love.",
    web: "https://www.pinterest.com",
    frame: null, // site shown inside the app when it allows framing; null = landing page only
    deep: 'pinterest://',
    tool: {
    title: "search ideas",
    fields: [{"k":"q","ph":"search Pinterest","type":"search"}],
    go: "search",
    need: "q",
    scheme: false,
    url: (v) => 'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(v.q),
    share: null,
  },
  };

  // Open a URL with a custom scheme via a hidden anchor (works for app deep links on phones).
  const openScheme = (href) => {
    const link = el('a', { href, style: { display: 'none' } });
    root.append(link);
    link.click();
    setTimeout(() => link.remove(), 100);
  };
  const openWeb = (url = CFG.web) => { os.sounds.tap?.(); os.device.openUrl(url); };

  const fallback = el('div.' + P + '-fallback', { hidden: true },
    el('div.' + P + '-fb-text', 'Didn’t open? ' + manifest.name + ' may not be installed on this device.'),
    el('button.' + P + '-fb-btn.tilt', { onclick: () => { fallback.hidden = true; openWeb(); } }, 'use the website instead'));

  let pending = null;
  const tryApp = async () => {
    if (!CFG.deep) return openWeb();
    if (!os.device.isMobile) {
      const i = await os.ui.messageBox({ title: 'open ' + manifest.name, message: 'The ' + manifest.name + ' app can only be opened on a phone or tablet. Open the website instead?', buttons: ['website', 'cancel'] });
      if (i === 0) openWeb();
      return;
    }
    fallback.hidden = true;
    clearTimeout(pending);
    let left = false;
    const mark = () => { left = true; };
    window.addEventListener('blur', mark, { once: true });
    document.addEventListener('visibilitychange', mark, { once: true });
    openScheme(CFG.deep);
    pending = setTimeout(() => {
      window.removeEventListener('blur', mark);
      document.removeEventListener('visibilitychange', mark);
      if (!left && document.visibilityState === 'visible' && root.isConnected) { fallback.hidden = false; os.device.vibrate(30); }
    }, 1200);
  };

  const bigBtn = (label, sub, icon, onclick, primary) => el('button.' + P + '-btn.tilt' + (primary ? '.primary' : ''), { onclick },
    el('span.' + P + '-btn-icon', { html: iconSVG(icon, { size: 22, stroke: 2 }) }),
    el('span.' + P + '-btn-text', el('span.' + P + '-btn-label', label), sub ? el('span.' + P + '-btn-sub', sub) : null));

  const host = (() => { try { return new URL(CFG.web).host.replace(/^www\./, ''); } catch { return ''; } })();

  // Optional native mini-tool
  let toolEl = null;
  let inputs = {};
  const runTool = () => {
    const t = CFG.tool;
    const v = Object.fromEntries(Object.entries(inputs).map(([k, n]) => [k, n.value.trim()]));
    if (t.need && !t.need.split('|').some((k) => v[k])) { inputs[t.need.split('|')[0]]?.focus(); os.sounds.error?.(); return; }
    const url = t.url(v);
    if (t.scheme) {
      if (!os.device.isMobile) os.toast('Opening ' + manifest.name + '…');
      openScheme(url);
    } else openWeb(url);
  };
  if (CFG.tool) {
    const t = CFG.tool;
    const counter = el('span.' + P + '-count');
    const rows = t.fields.map((f) => {
      const input = f.multi
        ? el('textarea.' + P + '-input', { placeholder: f.ph, rows: 3, maxLength: f.max || null })
        : el('input.' + P + '-input', { type: f.type || 'text', placeholder: f.ph, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
      inputs[f.k] = input;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !f.multi) { e.preventDefault(); runTool(); } });
      if (f.max) {
        const upd = () => { const n = f.max - input.value.length; counter.textContent = n; counter.classList.toggle('low', n < 20); };
        input.addEventListener('input', upd); upd();
      }
      return el('label.' + P + '-field', f.prefix ? el('span.' + P + '-prefix', f.prefix) : null, input);
    });
    toolEl = el('section.' + P + '-tool',
      el('div.' + P + '-tool-title', t.title),
      ...rows,
      el('div.' + P + '-tool-row', counter, el('button.' + P + '-go.tilt', { onclick: runTool }, t.go)));
  }

  const applyShare = (share) => {
    if (!share || !CFG.tool?.share) return;
    const vals = CFG.tool.share(share);
    for (const [k, v] of Object.entries(vals)) if (inputs[k]) { inputs[k].value = v; inputs[k].dispatchEvent(new Event('input')); }
    if (share.path && !share.url && !share.text) os.toast('Files can’t be shared to ' + manifest.name + ' from here — sharing the name instead');
    if (share.path && inputs.text && !inputs.text.value) inputs.text.value = os.path.basename(share.path);
    toolEl?.classList.add('flash');
    setTimeout(() => { toolEl?.scrollIntoView({ behavior: 'smooth', block: 'center' }); toolEl?.classList.remove('flash'); }, 450);
  };

  const view = el('div.' + P + '-link',
    el('div.' + P + '-top', el('div.' + P + '-app', manifest.name.toUpperCase())),
    el('div.' + P + '-hero',
      el('div.' + P + '-logo', { html: iconSVG(manifest.icon, { size: 84 }) }),
      el('div.' + P + '-name', manifest.name.toLowerCase()),
      el('div.' + P + '-tagline', CFG.tagline)),
    el('div.' + P + '-actions',
      bigBtn('open app', os.device.isMobile ? 'launch ' + manifest.name + ' on this phone' : 'available on phones', I.expand, tryApp, true),
      bigBtn('open website', host, I.globe, () => openWeb(), false),
      fallback),
    toolEl,
    el('div.' + P + '-foot', manifest.publisher));
  view.style.setProperty('--brand', manifest.color);
  view.style.setProperty('--brand-fg', '#fff');
  if (CFG.frame) {
    // The site allows framing: show it inside the phone. Sandboxed so it can't navigate wphone itself away.
    const frame = el('iframe.' + P + '-frame', {
      src: CFG.frame, title: manifest.name, referrerpolicy: 'no-referrer', allow: 'autoplay; fullscreen; encrypted-media',
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox',
    });
    const loading = os.ui.loadingDots();
    loading.classList.add(P + '-frame-loading');
    frame.addEventListener('load', () => loading.remove());
    const bar = os.ui.appBar({
      minimized: true,
      menu: [
        { label: 'open in browser', onClick: () => openWeb(CFG.web) },
        { label: 'about ' + manifest.name.toLowerCase(), onClick: () => ctx.navigate(() => view) },
      ],
    });
    root.append(el('div.' + P + '-framewrap', frame, loading, bar.el));
  } else {
    root.append(view);
  }

  applyShare(ctx.args?.share);
  ctx.on('args', (a) => applyShare(a?.share));
  // Cancel the pending "didn't open" banner if the user leaves.
  return { onSuspend: () => clearTimeout(pending), onDestroy: () => clearTimeout(pending) };
}
