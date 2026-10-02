import './style.css';
import { ArrowLeftRight, Volume2, Mic, Copy, Languages } from 'lucide';

const LANGS = {
  af: 'Afrikaans', ar: 'Arabic', bg: 'Bulgarian', bn: 'Bengali', ca: 'Catalan', cs: 'Czech', cy: 'Welsh', da: 'Danish',
  de: 'German', el: 'Greek', en: 'English', es: 'Spanish', et: 'Estonian', fa: 'Persian', fi: 'Finnish', fil: 'Filipino',
  fr: 'French', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian', hu: 'Hungarian', id: 'Indonesian', is: 'Icelandic', it: 'Italian',
  ja: 'Japanese', ko: 'Korean', lt: 'Lithuanian', lv: 'Latvian', ms: 'Malay', nl: 'Dutch', no: 'Norwegian', pl: 'Polish',
  pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak', sl: 'Slovenian', sr: 'Serbian', sv: 'Swedish', sw: 'Swahili',
  ta: 'Tamil', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese', 'zh-CN': 'Chinese Simplified', 'zh-TW': 'Chinese Traditional',
};
// BCP-47 tags for speech
const SPEECH = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', ru: 'ru-RU', vi: 'vi-VN', ar: 'ar-SA', hi: 'hi-IN', nl: 'nl-NL', pl: 'pl-PL', sv: 'sv-SE', tr: 'tr-TR', th: 'th-TH', id: 'id-ID', uk: 'uk-UA', el: 'el-GR', he: 'he-IL', cs: 'cs-CZ', da: 'da-DK', fi: 'fi-FI', no: 'nb-NO', hu: 'hu-HU', ro: 'ro-RO' };

/** Very small script/diacritic-based language guess (the backend has no auto-detect). */
function detect(t) {
  if (/[぀-ヿ]/.test(t)) return 'ja';
  if (/[가-힯]/.test(t)) return 'ko';
  if (/[一-鿿]/.test(t)) return 'zh-CN';
  if (/[Ѐ-ӿ]/.test(t)) return /[іїєґ]/i.test(t) ? 'uk' : 'ru';
  if (/[؀-ۿ]/.test(t)) return 'ar';
  if (/[֐-׿]/.test(t)) return 'he';
  if (/[฀-๿]/.test(t)) return 'th';
  if (/[ऀ-ॿ]/.test(t)) return 'hi';
  if (/[Ͱ-Ͽ]/.test(t)) return 'el';
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t)) return 'vi';
  if (/[ñ¿¡]/i.test(t)) return 'es';
  if (/[ß]|\b(der|die|das|und|ist|nicht|ich)\b/i.test(t)) return 'de';
  if (/[çœ]|\b(le|la|les|est|et|je|vous|bonjour)\b/i.test(t)) return 'fr';
  if (/[ãõ]|\b(você|obrigado|não)\b/i.test(t)) return 'pt';
  if (/\b(il|che|sono|ciao|grazie)\b/i.test(t)) return 'it';
  return 'en';
}

export default async function launch(ctx) {
  const { os, storage, args } = ctx;
  const { el, appBar, I, iconSVG } = os.ui;

  let st = await storage.get('state', { from: 'auto', to: (navigator.language || 'en').startsWith('en') ? 'es' : 'en', text: '', result: '' });
  let history = await storage.get('history', []);
  if (args?.share?.text || args?.share?.title || args?.text) st.text = args.share?.text || args.share?.title || args.text;
  let detected = '';
  let busy = false;

  const langLabel = (c) => (c === 'auto' ? (detected ? `detect (${LANGS[detected]})` : 'detect language') : LANGS[c] || c);
  const fromBtn = el('button.translator-lang.tilt');
  const toBtn = el('button.translator-lang.tilt');
  const swapBtn = el('button.translator-swap.tilt', { 'aria-label': 'swap', html: iconSVG(ArrowLeftRight, { size: 18 }) });
  const input = os.ui.textbox({ multiline: true, rows: 4, placeholder: 'type or paste text to translate', cls: 'translator-input' });
  input.maxLength = 500;
  const counter = el('div.translator-count');
  const resultEl = el('div.translator-result.selectable');
  const resultLang = el('div.translator-rlang');
  const statusEl = el('div.translator-status');
  let pv, bar, histEl;

  const save = () => storage.set('state', st);
  const drawLangs = () => {
    fromBtn.replaceChildren(el('span.translator-lang-k', 'from'), el('span.translator-lang-v', langLabel(st.from).toLowerCase()));
    toBtn.replaceChildren(el('span.translator-lang-k', 'to'), el('span.translator-lang-v', langLabel(st.to).toLowerCase()));
    resultLang.textContent = st.result ? LANGS[st.to]?.toUpperCase() : '';
  };
  const drawResult = () => {
    resultEl.textContent = st.result || '';
    resultEl.classList.toggle('empty', !st.result);
    if (!st.result) resultEl.textContent = 'translation will appear here';
    drawLangs();
  };
  const drawCount = () => (counter.textContent = `${input.value.length}/500`);

  const pick = async (which) => {
    const opts = Object.entries(LANGS).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
    if (which === 'from') opts.unshift({ value: 'auto', label: 'detect language' });
    const v = await os.ui.pickFromList({ title: which === 'from' ? 'translate from' : 'translate to', options: opts, value: st[which] });
    if (!v) return;
    st[which] = v; save(); drawLangs();
    if (input.value.trim()) translate();
  };
  fromBtn.onclick = () => pick('from');
  toBtn.onclick = () => pick('to');
  swapBtn.onclick = () => {
    const from = st.from === 'auto' ? detected || 'en' : st.from;
    st.from = st.to; st.to = from;
    if (st.result) { input.value = st.result; st.text = st.result; st.result = ''; }
    save(); drawResult(); drawCount();
    if (input.value.trim()) translate();
  };

  async function translate() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    st.text = text;
    const from = st.from === 'auto' ? (detected = detect(text)) : st.from;
    if (from === st.to) { st.result = text; busy = false; save(); drawResult(); return; }
    statusEl.replaceChildren(os.ui.loadingDots({ inline: true }));
    try {
      // translate up to ~500 chars, splitting into sentences under the provider's limit
      const r = await os.net.translate(text, from, st.to);
      const out = r?.text || '';
      if (!out || /INVALID|MYMEMORY WARNING|QUOTA/i.test(out) && out === out.toUpperCase()) throw new Error(out || 'No translation');
      st.result = decodeEntities(out);
      statusEl.replaceChildren();
      history = [{ text, result: st.result, from, to: st.to, t: Date.now() }, ...history.filter((h) => !(h.text === text && h.to === st.to))].slice(0, 100);
      storage.set('history', history);
      histEl && renderHistory();
    } catch (e) {
      statusEl.replaceChildren(el('div.translator-error', navigator.onLine ? 'Sorry, we couldn’t translate that right now. Try again in a moment.' : 'You’re offline. Connect to the internet to translate.'));
    } finally {
      busy = false;
      save(); drawResult();
    }
  }
  const decodeEntities = (s) => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };

  async function speak() {
    if (!st.result) return;
    if (!('speechSynthesis' in window)) { os.ui.alert('Speech isn’t supported in this browser.'); return; }
    await os.device.speak(st.result, { lang: SPEECH[st.to] || st.to });
  }
  async function listen() {
    if (!os.device.canListen) { os.ui.alert('Speech recognition isn’t supported in this browser. Try Chrome or Edge.', 'speak'); return; }
    const from = st.from === 'auto' ? 'en' : st.from;
    statusEl.replaceChildren(el('div.translator-listening', el('span', { html: iconSVG(Mic, { size: 18 }) }), ` listening (${LANGS[from]})…`));
    try {
      const t = await os.device.listen({ lang: SPEECH[from] || from, onInterim: (x) => { input.value = x; drawCount(); } });
      statusEl.replaceChildren();
      if (t) { input.value = t; drawCount(); translate(); }
    } catch (e) {
      statusEl.replaceChildren(el('div.translator-error', e.message === 'not-allowed' ? 'Microphone permission was denied.' : 'Didn’t catch that. Try again.'));
    }
  }

  input.addEventListener('input', () => { drawCount(); if (!input.value.trim()) { st.result = ''; st.text = ''; save(); drawResult(); } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); translate(); } });

  function renderHistory() {
    histEl.replaceChildren(os.ui.list(history, {
      empty: 'your translations will show up here',
      render: (h) => el('div.translator-hist',
        el('div.translator-hist-langs', `${LANGS[h.from] || h.from} → ${LANGS[h.to] || h.to}`),
        el('div.translator-hist-src', h.text),
        el('div.translator-hist-res', h.result)),
      onClick: (h) => { st.from = h.from; st.to = h.to; input.value = h.text; st.result = h.result; save(); drawCount(); drawResult(); pv.select(0); },
      onHold: (h, row) => os.ui.contextMenu(row, [
        { label: 'copy translation', onClick: () => copy(h.result) },
        { label: 'delete', onClick: () => { history = history.filter((x) => x !== h); storage.set('history', history); renderHistory(); } },
      ]),
    }));
  }
  const copy = async (t) => { try { await os.device.copy(t); os.toast('Copied to clipboard'); } catch { os.toast('Couldn’t copy'); } };

  const updateBar = () => {
    if (!bar) return;
    if ((pv?.index ?? 0) === 0) {
      bar.setButtons([
        { icon: I.check, label: 'translate', onClick: translate },
        { icon: Mic, label: 'speak', onClick: listen },
        { icon: Volume2, label: 'listen', onClick: speak },
        { icon: Copy, label: 'copy', onClick: () => st.result && copy(st.result) },
      ]);
      bar.setMenu([
        { label: 'swap languages', onClick: () => swapBtn.click() },
        { label: 'share translation', onClick: () => st.result && os.share({ title: 'Translation', text: st.result }) },
        { label: 'paste', onClick: async () => { try { input.value = await os.device.paste(); drawCount(); } catch { os.toast('Clipboard not available'); } } },
        { label: 'clear', onClick: () => { input.value = ''; st.text = ''; st.result = ''; save(); drawCount(); drawResult(); } },
      ]);
    } else {
      bar.setButtons([]);
      bar.setMenu([{ label: 'clear history', onClick: async () => { if (await os.ui.confirm('Delete all translation history?', 'history', 'delete', 'cancel')) { history = []; storage.set('history', history); renderHistory(); } } }]);
    }
  };

  await ctx.navigate((page) => {
    pv = os.ui.pivot({
      app: 'BING TRANSLATOR',
      items: [
        {
          header: 'translate', render: (c) => c.append(
            el('div.translator-langs', fromBtn, swapBtn, toBtn),
            input, counter, statusEl,
            el('div.translator-rhead', resultLang),
            resultEl,
            el('div.translator-brand', el('span', { html: iconSVG(Languages, { size: 14 }) }), ' translations by MyMemory')),
        },
        { header: 'history', render: (c) => { histEl = c; renderHistory(); } },
      ],
      onChange: () => updateBar(),
    });
    bar = appBar({});
    page.el.append(pv.el, bar.el);
    updateBar();
  });

  input.value = st.text || '';
  drawCount();
  drawResult();
  if (args?.share?.text || args?.share?.title || args?.text) translate();
  ctx.on('args', (a) => { const t = a?.share?.text || a?.share?.title || a?.text; if (t) { input.value = t; drawCount(); pv.select(0); translate(); } });
}
