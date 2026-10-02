// Unit Converter: WP-style big number entry with a custom keypad. Currency uses live rates via os.net.rates.
import './style.css';
import { ArrowUpDown, List, RefreshCw } from 'lucide';

const lin = (list) => list.map(([id, name, f]) => ({ id, name, to: (v) => v * f, from: (v) => v / f }));
const CATS = {
  length: lin([['mm', 'millimeters', 0.001], ['cm', 'centimeters', 0.01], ['m', 'meters', 1], ['km', 'kilometers', 1000], ['in', 'inches', 0.0254], ['ft', 'feet', 0.3048], ['yd', 'yards', 0.9144], ['mi', 'miles', 1609.344], ['nmi', 'nautical miles', 1852]]),
  weight: lin([['mg', 'milligrams', 1e-6], ['g', 'grams', 0.001], ['kg', 'kilograms', 1], ['t', 'metric tons', 1000], ['oz', 'ounces', 0.028349523125], ['lb', 'pounds', 0.45359237], ['st', 'stone', 6.35029318]]),
  temperature: [
    { id: '°C', name: 'Celsius', to: (v) => v, from: (v) => v },
    { id: '°F', name: 'Fahrenheit', to: (v) => (v - 32) * 5 / 9, from: (v) => v * 9 / 5 + 32 },
    { id: 'K', name: 'Kelvin', to: (v) => v - 273.15, from: (v) => v + 273.15 },
  ],
  volume: lin([['ml', 'milliliters', 0.001], ['l', 'liters', 1], ['m³', 'cubic meters', 1000], ['tsp', 'teaspoons (US)', 0.00492892159375], ['tbsp', 'tablespoons (US)', 0.01478676478125], ['fl oz', 'fluid ounces (US)', 0.0295735295625], ['cup', 'cups (US)', 0.2365882365], ['pt', 'pints (US)', 0.473176473], ['qt', 'quarts (US)', 0.946352946], ['gal', 'gallons (US)', 3.785411784], ['gal UK', 'gallons (UK)', 4.54609]]),
  area: lin([['cm²', 'square centimeters', 1e-4], ['m²', 'square meters', 1], ['ha', 'hectares', 1e4], ['km²', 'square kilometers', 1e6], ['in²', 'square inches', 0.00064516], ['ft²', 'square feet', 0.09290304], ['yd²', 'square yards', 0.83612736], ['ac', 'acres', 4046.8564224], ['mi²', 'square miles', 2589988.110336]]),
  speed: lin([['m/s', 'meters per second', 1], ['km/h', 'kilometers per hour', 1 / 3.6], ['mph', 'miles per hour', 0.44704], ['kn', 'knots', 1852 / 3600], ['ft/s', 'feet per second', 0.3048], ['mach', 'mach (sea level)', 340.29]]),
  data: lin([['bit', 'bits', 0.125], ['B', 'bytes', 1], ['KB', 'kilobytes', 1e3], ['MB', 'megabytes', 1e6], ['GB', 'gigabytes', 1e9], ['TB', 'terabytes', 1e12], ['KiB', 'kibibytes', 1024], ['MiB', 'mebibytes', 1024 ** 2], ['GiB', 'gibibytes', 1024 ** 3], ['TiB', 'tebibytes', 1024 ** 4]]),
  time: lin([['ms', 'milliseconds', 0.001], ['s', 'seconds', 1], ['min', 'minutes', 60], ['h', 'hours', 3600], ['d', 'days', 86400], ['wk', 'weeks', 604800], ['mo', 'months', 2629746], ['yr', 'years', 31556952]]),
  currency: [],
};
const ORDER = Object.keys(CATS);
const DEFAULTS = {
  metric: { length: ['m', 'ft'], weight: ['kg', 'lb'], temperature: ['°C', '°F'], volume: ['l', 'gal'], area: ['m²', 'ft²'], speed: ['km/h', 'mph'], data: ['MB', 'GB'], time: ['h', 'min'], currency: ['USD', 'EUR'] },
  imperial: { length: ['ft', 'm'], weight: ['lb', 'kg'], temperature: ['°F', '°C'], volume: ['gal', 'l'], area: ['ft²', 'm²'], speed: ['mph', 'km/h'], data: ['MB', 'GB'], time: ['h', 'min'], currency: ['USD', 'EUR'] },
};
const CUR_NAMES = { USD: 'US dollar', EUR: 'euro', GBP: 'British pound', JPY: 'Japanese yen', CNY: 'Chinese yuan', INR: 'Indian rupee', VND: 'Vietnamese dong', AUD: 'Australian dollar', CAD: 'Canadian dollar', CHF: 'Swiss franc', HKD: 'Hong Kong dollar', SGD: 'Singapore dollar', KRW: 'South Korean won', SEK: 'Swedish krona', NOK: 'Norwegian krone', DKK: 'Danish krone', NZD: 'New Zealand dollar', MXN: 'Mexican peso', BRL: 'Brazilian real', ZAR: 'South African rand', RUB: 'Russian ruble', TRY: 'Turkish lira', PLN: 'Polish złoty', THB: 'Thai baht', IDR: 'Indonesian rupiah', MYR: 'Malaysian ringgit', PHP: 'Philippine peso', CZK: 'Czech koruna', HUF: 'Hungarian forint', ILS: 'Israeli shekel', ISK: 'Icelandic króna', RON: 'Romanian leu', BGN: 'Bulgarian lev' };

export default async function launch(ctx) {
  const { root, os, storage } = ctx;
  const { el, iconSVG, appBar } = os.ui;

  const sys = os.settings.get('units') === 'imperial' ? 'imperial' : 'metric';
  const st = await storage.get('state', { cat: 'length', units: {}, value: '1', active: 0 });
  let cat = CATS[st.cat] ? st.cat : 'length';
  let units = { ...st.units };
  let entry = st.value || '1';      // text being typed into the active field
  let active = st.active || 0;      // 0 = top field is the input, 1 = bottom
  let rateInfo = '';

  const pair = () => units[cat] || DEFAULTS[sys][cat];
  const unitById = (id) => CATS[cat].find((u) => u.id === id) || CATS[cat][0];
  const save = () => storage.set('state', { cat, units, value: entry, active });

  /* ---- currency rates */
  async function loadRates(force) {
    let cached = await storage.get('rates', null);
    const fresh = cached && Date.now() - cached.at < 6 * 3600e3;
    if (!fresh || force) {
      try {
        const r = await os.net.rates('USD');
        if (r?.rates) { cached = { at: Date.now(), date: r.date, base: r.base || 'USD', rates: r.rates }; storage.set('rates', cached); }
      } catch { if (!cached) { rateInfo = 'Couldn’t load exchange rates. Check your connection.'; return false; } }
    }
    const rates = { [cached.base]: 1, ...cached.rates };
    CATS.currency = Object.keys(rates).sort().map((code) => {
      const per = rates[code]; // units of code per 1 base
      return { id: code, name: CUR_NAMES[code] || code, to: (v) => v / per, from: (v) => v * per, cur: true };
    });
    rateInfo = 'Rates from ' + (cached.date || new Date(cached.at).toLocaleDateString()) + (fresh || force ? '' : ' (offline)');
    return true;
  }

  /* ---- formatting */
  const fmt = (v, cur) => {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e15 || a < 1e-7)) return v.toExponential(6).replace(/\.?0+e/, 'e');
    const digits = cur ? (a >= 1 ? 2 : 6) : 10;
    return Number(v.toPrecision(12)).toLocaleString(undefined, { maximumFractionDigits: digits });
  };
  const entryDisplay = () => {
    const [i, d] = entry.replace('-', '').split('.');
    const n = (i || '0').replace(/^0+(?=\d)/, '');
    return (entry.startsWith('-') ? '−' : '') + Number(n).toLocaleString() + (d !== undefined ? (1.1).toLocaleString().charAt(1) + d : '');
  };

  /* ---- DOM */
  const tabs = el('div.converter-tabs.no-swipe');
  const fields = [0, 1].map((i) => {
    const unitBtn = el('button.converter-unit.tilt', { onclick: (e) => { e.stopPropagation(); chooseUnit(i); } });
    const value = el('div.converter-value');
    const f = el('div.converter-field', { onclick: () => setActive(i) }, unitBtn, value);
    return { f, unitBtn, value };
  });
  const swapBtn = el('button.converter-swap.tilt', { 'aria-label': 'swap', onclick: swap, html: iconSVG(ArrowUpDown, { size: 22, stroke: 2 }) });
  const info = el('div.converter-info');
  const keys = el('div.converter-keys');
  const view = el('div.converter',
    el('div.converter-head', el('div.wp-app-title', 'UNIT CONVERTER'), tabs),
    el('div.converter-fields', fields[0].f, swapBtn, fields[1].f, info),
    keys);
  root.append(view);

  ORDER.forEach((c) => tabs.append(el('button.converter-tab', { dataset: { c }, onclick: () => setCat(c) }, c)));
  const KEYS = ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '±', '0', '00', '.', '⇅'];
  keys.append(...KEYS.map((k) => el('button.converter-key' + (/^\d/.test(k) ? '.num' : '') + (k === '⇅' ? '.accent' : ''), { onclick: () => press(k) }, k)));

  function render() {
    tabs.querySelectorAll('.converter-tab').forEach((t) => t.classList.toggle('active', t.dataset.c === cat));
    const [a, b] = pair();
    const ua = unitById(a), ub = unitById(b);
    const inUnit = active === 0 ? ua : ub, outUnit = active === 0 ? ub : ua;
    const v = parseFloat(entry) || 0;
    const out = outUnit.from(inUnit.to(v));
    fields[active].value.textContent = entryDisplay();
    fields[1 - active].value.textContent = fmt(out, cat === 'currency');
    [ua, ub].forEach((u, i) => {
      fields[i].unitBtn.replaceChildren(el('span.converter-unit-id', u.id), el('span.converter-unit-name', u.name));
      fields[i].f.classList.toggle('active', i === active);
      const len = fields[i].value.textContent.length;
      fields[i].value.style.fontSize = len > 16 ? '30px' : len > 11 ? '40px' : '';
    });
    info.textContent = cat === 'currency' ? rateInfo : `1 ${inUnit.id} = ${fmt(outUnit.from(inUnit.to(1)))} ${outUnit.id}`;
    save();
  }

  async function setCat(c) {
    if (c === cat) return;
    cat = c;
    if (c === 'currency' && !CATS.currency.length) {
      info.textContent = 'loading rates…';
      fields.forEach((f) => (f.value.textContent = '…'));
      tabs.querySelector(`[data-c="${c}"]`)?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
      if (!(await loadRates())) { info.textContent = rateInfo; return; }
      if (cat !== 'currency') return;
    }
    tabs.querySelector(`[data-c="${c}"]`)?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    render();
  }

  function setActive(i) {
    if (i === active) return;
    // carry the currently displayed result into the new input field
    const shown = fields[i].value.textContent.replace(/[^\d.,eE+\-−]/g, '');
    const dec = (1.1).toLocaleString().charAt(1);
    const raw = shown.replace(/−/g, '-').split(dec).map((p) => p.replace(/[^\d\-eE+]/g, '')).join('.');
    entry = isFinite(parseFloat(raw)) ? String(parseFloat(raw)) : '0';
    active = i; os.sounds.tap?.(); render();
  }

  function swap() {
    const [a, b] = pair();
    units[cat] = [b, a];
    os.sounds.tap?.();
    view.classList.remove('converter-spin'); void view.offsetWidth; view.classList.add('converter-spin');
    render();
  }

  async function chooseUnit(i) {
    if (!CATS[cat].length) return;
    const cur = pair()[i];
    const r = await os.ui.pickFromList({ title: cat === 'currency' ? 'CHOOSE CURRENCY' : 'CHOOSE UNIT', options: CATS[cat].map((u) => ({ value: u.id, label: u.cur ? `${u.id} — ${u.name}` : `${u.name} (${u.id})` })), value: cur });
    if (!r) return;
    const p = [...pair()];
    p[i] = r;
    units[cat] = p;
    render();
  }

  function press(k) {
    os.sounds.key?.();
    if (k === 'C') entry = '0';
    else if (k === '⌫') entry = entry.length > 1 && !(entry.length === 2 && entry.startsWith('-')) ? entry.slice(0, -1) : '0';
    else if (k === '±') entry = entry.startsWith('-') ? entry.slice(1) : entry === '0' ? '0' : '-' + entry;
    else if (k === '⇅') return swap();
    else if (k === '.') { if (!entry.includes('.')) entry += '.'; }
    else {
      if (entry.replace(/[-.]/g, '').length >= 15) return;
      entry = entry === '0' ? (k === '00' ? '0' : k) : entry === '-0' ? '-' + k : entry + k;
    }
    render();
  }

  /* ---- all conversions page */
  function allPage(page) {
    const p = os.ui.page({ app: 'UNIT CONVERTER', title: cat });
    const [a, b] = pair();
    const inUnit = unitById(active === 0 ? a : b);
    const v = parseFloat(entry) || 0;
    p.content.append(os.ui.desc(`${entryDisplay()} ${inUnit.id} (${inUnit.name}) is`),
      os.ui.list(CATS[cat].filter((u) => u.id !== inUnit.id), {
        render: (u) => os.ui.listItem({ title: fmt(u.from(inUnit.to(v)), cat === 'currency') + ' ' + u.id, subtitle: u.name }),
        onClick: (u) => { units[cat] = active === 0 ? [inUnit.id, u.id] : [u.id, inUnit.id]; render(); ctx.back(); },
      }));
    page.el.append(p.el);
  }

  const bar = appBar({
    minimized: true,
    menu: [
      { label: 'show all conversions', onClick: () => ctx.navigate(allPage) },
      { label: 'copy result', onClick: () => os.device.copy(fields[1 - active].value.textContent).then(() => os.toast('Copied')) },
      { label: 'refresh exchange rates', onClick: async () => { await loadRates(true); if (cat === 'currency') render(); os.toast(rateInfo); } },
    ],
  });
  view.append(bar.el);

  // keyboard entry on desktop
  const onKey = (e) => {
    if (!root.isConnected || root.closest('.app-frame:not(.active)') || e.target.closest?.('input,textarea')) return;
    const map = { Backspace: '⌫', Delete: 'C', Escape: 'C', ',': '.', '-': '±' };
    const k = map[e.key] || e.key;
    if (/^[\d.]$/.test(k) || ['⌫', 'C', '±'].includes(k)) { e.preventDefault(); e.stopPropagation(); press(k); }
  };
  window.addEventListener('keydown', onKey, true);

  if (cat === 'currency') { const c = cat; cat = ''; await setCat(c); } else render();
  setTimeout(() => tabs.querySelector('.converter-tab.active')?.scrollIntoView({ inline: 'center', block: 'nearest' }), 0);
  return { onDestroy: () => window.removeEventListener('keydown', onKey, true) };
}
