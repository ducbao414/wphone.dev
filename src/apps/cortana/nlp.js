// Cortana language understanding: pure functions (no DOM / OS access) so they can be unit-tested in node.
// parseIntent(text, { now, apps }) -> { type, ...slots }

const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100,
};
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = (s) => MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3)));

/** Lowercase, unify punctuation, a.m./p.m., number words ("twenty five" -> 25). */
export function normalize(text) {
  let s = ' ' + String(text || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"') + ' ';
  s = s.replace(/\b([ap])\.\s?m\.?/g, '$1m').replace(/(\d)\s*([ap])m\b/g, '$1 $2m').replace(/\bo'clock\b/g, ':00');
  s = s.replace(/(\d+)\s*:00\b(?!\d)/g, '$1:00');
  // tens + units ("twenty five")
  s = s.replace(/\b(twenty|thirty|forty|fifty)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(WORDS[a] + WORDS[b]));
  s = s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety)\b/g, (w) => String(WORDS[w]));
  s = s.replace(/\s+/g, ' ');
  return s.trim().replace(/[?!.]+$/, '').trim();
}

/** Find a clock time in s. Returns { hours, minutes, match, meridiem } (hours 0-23) or null. */
export function parseClock(s) {
  let m;
  if ((m = /\b(?:at\s+)?(noon|midday|midnight)\b/.exec(s))) return { hours: m[1] === 'midnight' ? 0 : 12, minutes: 0, match: m[0], meridiem: true };
  if ((m = /\b(?:at\s+)?(half|quarter)\s+past\s+(\d{1,2})\b(\s*[ap]m)?/.exec(s))) {
    let h = +m[2]; const mer = m[3]?.trim();
    if (mer) h = (h % 12) + (mer === 'pm' ? 12 : 0);
    return { hours: h, minutes: m[1] === 'half' ? 30 : 15, match: m[0], meridiem: !!mer };
  }
  if ((m = /\b(?:at\s+)?quarter\s+to\s+(\d{1,2})\b(\s*[ap]m)?/.exec(s))) {
    let h = (+m[1] + 11) % 12 || 12; const mer = m[2]?.trim();
    if (mer) h = (h % 12) + (mer === 'pm' ? 12 : 0);
    return { hours: h, minutes: 45, match: m[0], meridiem: !!mer };
  }
  if ((m = /\b(?:at\s+)?(\d{1,2})(?:[:.\s](\d{2}))?\s*([ap]m)\b/.exec(s))) {
    const h = +m[1], min = +(m[2] || 0);
    if (h <= 12 && min < 60) return { hours: (h % 12) + (m[3] === 'pm' ? 12 : 0), minutes: min, match: m[0], meridiem: true };
  }
  if ((m = /\b(?:at\s+)?(\d{1,2})[:h](\d{2})\b/.exec(s))) {
    const h = +m[1], min = +m[2];
    if (h < 24 && min < 60) return { hours: h, minutes: min, match: m[0], meridiem: h > 12 || /^0/.test(m[1]) };
  }
  if ((m = /\b(?:at|for|by|around)\s+(\d{1,2})\b(?!\s*(?:%|percent|minutes?|mins?|hours?|hrs?|days?|weeks?|seconds?|secs?|people|of|th|st|nd|rd|[/.,]\d))/.exec(s))) {
    const h = +m[1];
    if (h < 24) return { hours: h, minutes: 0, match: m[0], meridiem: h > 12 || h === 0 };
  }
  return null;
}

const UNIT_MS = { s: 1e3, m: 60e3, h: 3600e3, d: 864e5, w: 6048e5 };
const unitKey = (u) => (u.startsWith('s') ? 's' : u.startsWith('mi') ? 'm' : u.startsWith('h') ? 'h' : u.startsWith('d') ? 'd' : u.startsWith('w') ? 'w' : 'm');

/** Parse a duration like "5 minutes", "an hour and a half", "1 hour 30 minutes". Returns { ms, match } or null. */
export function parseDuration(s) {
  let m;
  if ((m = /\b(?:half an?|a half)\s+hour\b/.exec(s))) return { ms: 30 * 60e3, match: m[0] };
  if ((m = /\b(an?|\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)\b(?:\s+and\s+(?:a\s+half|(\d+)\s*(seconds?|secs?|minutes?|mins?)))?/.exec(s))) {
    const n = /^an?$/.test(m[1]) ? 1 : parseFloat(m[1]);
    let ms = n * UNIT_MS[unitKey(m[2])];
    if (/and a half/.test(m[0])) ms += 0.5 * UNIT_MS[unitKey(m[2])];
    else if (m[3]) ms += +m[3] * UNIT_MS[unitKey(m[4])];
    return { ms, match: m[0] };
  }
  return null;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Parse a "when" expression: "in 10 minutes", "tomorrow at 3pm", "on friday", "tonight", "at 7:30", "october 12 at noon".
 * Returns { date: Date, hasTime, hasDay, matches: [strings] } or null.
 */
export function parseWhen(s, now = new Date()) {
  const matches = [];
  let m;
  // relative "in X"
  if ((m = /\bin\s+((?:half an?|a half)\s+hour|(?:an?|\d+(?:\.\d+)?)\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)(?:\s+and\s+(?:a\s+half|\d+\s*(?:seconds?|secs?|minutes?|mins?)))?)\b/.exec(s))) {
    const d = parseDuration(m[1]);
    if (d) {
      const date = new Date(now.getTime() + d.ms);
      const big = d.ms >= 864e5;
      // "in 2 days at 5pm"
      const rest = s.replace(m[0], ' ');
      const clk = big ? parseClock(rest) : null;
      if (clk) { date.setHours(clk.hours, clk.minutes, 0, 0); matches.push(clk.match); }
      return { date, hasTime: !big || !!clk, hasDay: big, relative: true, matches: [m[0], ...matches] };
    }
  }
  let day = null, hasDay = false;
  let partOfDay = null;
  if ((m = /\b(?:the\s+)?day after tomorrow\b/.exec(s))) { day = startOfDay(new Date(now.getTime() + 2 * 864e5)); matches.push(m[0]); }
  else if ((m = /\btomorrow(?:\s+(morning|afternoon|evening|night))?\b/.exec(s))) { day = startOfDay(new Date(now.getTime() + 864e5)); partOfDay = m[1] || null; matches.push(m[0]); }
  else if ((m = /\btonight\b/.exec(s))) { day = startOfDay(now); partOfDay = 'night'; matches.push(m[0]); }
  else if ((m = /\bthis\s+(morning|afternoon|evening)\b/.exec(s))) { day = startOfDay(now); partOfDay = m[1]; matches.push(m[0]); }
  else if ((m = /\btoday\b/.exec(s))) { day = startOfDay(now); matches.push(m[0]); }
  else if ((m = /\bnext week\b/.exec(s))) { day = startOfDay(new Date(now.getTime() + 7 * 864e5)); matches.push(m[0]); }
  else if ((m = new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}\\b`).exec(s)) || (m = new RegExp(`\\b(?:on\\s+)?${MON_RE}\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(s))) {
    const a = /^\d/.test(m[1]) ? m[1] : m[2], mon = /^\d/.test(m[1]) ? m[2] : m[1];
    const mi = monthIndex(mon);
    let d = new Date(now.getFullYear(), mi, +a);
    if (d < startOfDay(now)) d = new Date(now.getFullYear() + 1, mi, +a);
    day = d; matches.push(m[0]);
  } else if ((m = /\b(?:on\s+)?(?:(next|this|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(morning|afternoon|evening|night))?\b/.exec(s))) {
    const target = DAYS.indexOf(m[2]);
    let diff = (target - now.getDay() + 7) % 7;
    if (diff === 0 && m[1] !== 'this') diff = 7;
    if (m[1] === 'next' && diff < 7 && diff <= 0) diff += 7;
    day = startOfDay(new Date(now.getTime() + diff * 864e5));
    partOfDay = m[3] || null;
    matches.push(m[0]);
  } else if ((m = /\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/.exec(s))) {
    let d = new Date(now.getFullYear(), now.getMonth(), +m[1]);
    if (d < startOfDay(now)) d = new Date(now.getFullYear(), now.getMonth() + 1, +m[1]);
    day = d; matches.push(m[0]);
  }
  if (day) hasDay = true;
  if (!partOfDay && (m = /\b(?:in the\s+)?(morning|afternoon|evening)\b/.exec(s)) && !matches.some((x) => x.includes(m[1]))) { partOfDay = m[1]; matches.push(m[0]); }
  else if (!partOfDay && (m = /\bat night\b/.exec(s))) { partOfDay = 'night'; matches.push(m[0]); }

  const clk = parseClock(s);
  if (!day && !clk && !partOfDay) return null;
  let hours, minutes = 0, hasTime = false;
  if (clk) {
    hours = clk.hours; minutes = clk.minutes; hasTime = true; matches.push(clk.match);
    if (!clk.meridiem && hours < 12) {
      if (partOfDay && partOfDay !== 'morning') hours += 12;
      else if (!partOfDay && hours >= 1 && hours <= 6 && !day) hours += 12; // "at 3" means 3 PM
    }
  } else if (partOfDay) {
    hours = { morning: 9, afternoon: 14, evening: 18, night: 20 }[partOfDay];
    hasTime = true;
  } else hours = 9; // a day with no time -> 9 AM
  let date = new Date(day || startOfDay(now));
  date.setHours(hours, minutes, 0, 0);
  if (!day && date <= now) {
    // bare time already passed today: try PM, else tomorrow
    if (clk && !clk.meridiem && hours < 12 && new Date(date.getTime() + 12 * 3600e3) > now) date = new Date(date.getTime() + 12 * 3600e3);
    else date = new Date(date.getTime() + 864e5);
  }
  return { date, hasTime, hasDay, matches };
}

/** Remove matched fragments (and dangling prepositions) from a phrase. */
export function strip(s, parts) {
  let out = ' ' + s + ' ';
  for (const p of parts.filter(Boolean).sort((a, b) => b.length - a.length)) out = out.replace(p, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) out = out.replace(/^(?:to|that|about|for|at|on|in|by|and)\s+/i, '').replace(/\s+(?:to|at|on|in|by|for|from|and|the|of)$/i, '').trim();
  return out;
}

/* ------------------------------------------------------------------ math */

/** Turn spoken math into an expression ("12 times 7" -> "12*7"). Returns null if it doesn't look like math. */
export function mathFromText(s) {
  let t = s.replace(/^(?:what(?:'s| is| are)?|calculate|compute|how much is|solve|evaluate|whats)\s+/, '').replace(/^(?:the\s+)?(?:result of\s+)?/, '').replace(/[?=]+$/, '').trim();
  t = t.replace(/(\d),(\d{3})/g, '$1$2');
  t = t.replace(/\bsquare root of\s*(\(?[\d.]+\)?)/g, 'sqrt($1)').replace(/\bcube root of\s*([\d.]+)/g, 'cbrt($1)')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:\.\d+)?)/g, '($1/100*$2)')
    .replace(/\b(\d+(?:\.\d+)?)\s+squared\b/g, '($1^2)').replace(/\b(\d+(?:\.\d+)?)\s+cubed\b/g, '($1^3)')
    .replace(/\bto the power of\b|\braised to(?: the)?\b|\bpower\b/g, '^')
    .replace(/\bplus\b|\band\b/g, '+').replace(/\bminus\b|\bless\b/g, '-').replace(/\btimes\b|\bmultiplied by\b|\bx\b|×/g, '*')
    .replace(/\bdivided by\b|\bover\b|÷/g, '/').replace(/\bmod(?:ulo)?\b/g, '%').replace(/\bpi\b/g, 'pi');
  t = t.replace(/\s+/g, '');
  if (!/\d/.test(t) || !/^[\d.+\-*/^%()a-z]+$/.test(t)) return null;
  if (!/[+\-*/^%(]|sqrt|cbrt/.test(t.replace(/^-/, ''))) return null;
  if (/[a-z]/.test(t.replace(/sqrt|cbrt|pi|sin|cos|tan|log|ln/g, ''))) return null;
  return t;
}

/** Safe recursive-descent evaluator: + - * / % ^, parentheses, unary minus, sqrt/cbrt/sin/cos/tan/log/ln, pi. */
export function evalMath(src) {
  let i = 0;
  const s = src.replace(/\s+/g, '');
  const peek = () => s[i];
  const num = () => {
    const m = /^\d*\.?\d+(?:e[+-]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error('num');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const FN = { sqrt: Math.sqrt, cbrt: Math.cbrt, sin: (x) => Math.sin((x * Math.PI) / 180), cos: (x) => Math.cos((x * Math.PI) / 180), tan: (x) => Math.tan((x * Math.PI) / 180), log: Math.log10, ln: Math.log };
  const atom = () => {
    if (peek() === '-') { i++; return -atom(); }
    if (peek() === '+') { i++; return atom(); }
    if (peek() === '(') { i++; const v = expr(); if (s[i] !== ')') throw new Error(')'); i++; return v; }
    const fm = /^(sqrt|cbrt|sin|cos|tan|log|ln|pi)/.exec(s.slice(i));
    if (fm) {
      i += fm[1].length;
      if (fm[1] === 'pi') return Math.PI;
      return FN[fm[1]](atom());
    }
    return num();
  };
  const pow = () => { const b = atom(); if (peek() === '^') { i++; return b ** pow(); } return b; };
  const term = () => {
    let v = pow();
    for (;;) {
      if (peek() === '*') { i++; v *= pow(); } else if (peek() === '/') { i++; v /= pow(); } else if (peek() === '%') { i++; v %= pow(); } else if (peek() === '(') v *= pow();
      else return v;
    }
  };
  const expr = () => { let v = term(); for (;;) { if (peek() === '+') { i++; v += term(); } else if (peek() === '-') { i++; v -= term(); } else return v; } };
  const v = expr();
  if (i !== s.length) throw new Error('trailing');
  if (!isFinite(v)) throw new Error('inf');
  return +v.toPrecision(12);
}

/* ------------------------------------------------------------------ apps */

const ALIASES = {
  browser: 'ie', 'internet explorer': 'ie', internet: 'ie', web: 'ie', edge: 'ie', mail: 'outlook', email: 'outlook', 'e-mail': 'outlook', inbox: 'outlook',
  contacts: 'people', 'address book': 'people', texts: 'messaging', messages: 'messaging', sms: 'messaging', text: 'messaging', dialer: 'phone', 'phone app': 'phone',
  clock: 'alarms', alarm: 'alarms', timer: 'alarms', stopwatch: 'alarms', gallery: 'photos', pictures: 'photos', pics: 'photos', 'camera roll': 'photos',
  videos: 'video', movies: 'video', 'voice recorder': 'recorder', recorder: 'recorder', 'fm radio': 'radio', tunes: 'music', 'groove': 'music', notes: 'onenote', 'one note': 'onenote',
  word: 'office', excel: 'office', powerpoint: 'office', documents: 'office', 'file explorer': 'files', files: 'files', 'file manager': 'files', torch: 'flashlight',
  calculator: 'calculator', calc: 'calculator', map: 'maps', directions: 'maps', 'app store': 'store', marketplace: 'store', 'windows store': 'store',
  settings: 'settings', 'control panel': 'settings', preferences: 'settings', '2048': 'g2048', tetris: 'blocks', wiki: 'wikipedia', 'battery saver': 'battery',
  'storage sense': 'storage', 'unit converter': 'converter', currency: 'converter', 'money': 'money', finance: 'money', stocks: 'money',
};

/** Resolve a spoken app name to an id. apps: [{ id, name, keywords }] */
export function resolveApp(name, apps = []) {
  const n = name.toLowerCase().replace(/^(?:the|my|a)\s+/, '').replace(/\s+(?:app|application|game)$/, '').replace(/[.!?]/g, '').trim();
  if (!n) return null;
  const byId = apps.find((a) => a.id === n);
  if (byId) return byId.id;
  const exact = apps.find((a) => a.name.toLowerCase() === n);
  if (exact) return exact.id;
  if (ALIASES[n] && apps.some((a) => a.id === ALIASES[n])) return ALIASES[n];
  const compact = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const c = compact(n);
  const loose = apps.find((a) => compact(a.name) === c) || apps.find((a) => compact(a.name).startsWith(c) && c.length >= 3) || apps.find((a) => c.length >= 4 && compact(a.name).includes(c));
  if (loose) return loose.id;
  return null;
}

/* ------------------------------------------------------------------ intents */

const SETTING_NAMES = [
  [/^(?:the\s+)?wi-?fi$|^wireless$/, 'wifi'], [/^(?:the\s+)?bluetooth$/, 'bluetooth'], [/^(?:the\s+)?(?:airplane|aeroplane|flight)(?: mode)?$/, 'airplane'],
  [/^(?:the\s+)?location(?: services)?$|^gps$/, 'location'], [/^(?:the\s+)?battery saver$|^power saving(?: mode)?$/, 'batterySaver'],
  [/^(?:the\s+)?(?:flashlight|torch)$/, 'flashlight'], [/^dark (?:mode|theme)$/, 'dark'], [/^light (?:mode|theme)$/, 'light'],
  [/^(?:the\s+)?(?:cellular )?data$|^mobile data$|^cellular$/, 'cellular'], [/^(?:the\s+)?sounds?$/, 'sounds'], [/^(?:the\s+)?vibrat(?:e|ion)$/, 'vibrate'],
  [/^(?:the\s+)?24[- ]hour clock$/, 'h24'],
];

function settingKey(name) {
  const n = name.trim();
  for (const [re, k] of SETTING_NAMES) if (re.test(n)) return k;
  return null;
}

const CURRENCIES = 'usd|eur|gbp|jpy|vnd|aud|cad|chf|cny|inr|krw|sgd|hkd|nzd|sek|nok|dkk|thb|brl|mxn|rub|try|pln|zar|idr|myr|php|twd|czk|huf|ils|aed|sar';
const CUR_WORDS = { dollars: 'usd', dollar: 'usd', bucks: 'usd', euros: 'eur', euro: 'eur', pounds: 'gbp', pound: 'gbp', yen: 'jpy', dong: 'vnd', rupees: 'inr', yuan: 'cny', won: 'krw', francs: 'chf' };

export function parseIntent(raw, { now = new Date(), apps = [] } = {}) {
  const text = String(raw || '').trim();
  const s = normalize(text);
  let m;
  if (!s) return { type: 'empty' };
  const orig = text.replace(/[?!.]+$/, '').trim();

  // media controls
  if (/^(?:pause|stop)(?: the)?(?: music| song| playback| playing)?$/.test(s)) return { type: 'media', action: 'pause' };
  if (/^(?:resume|continue|unpause)(?: the)?(?: music| song| playback)?$/.test(s)) return { type: 'media', action: 'play' };
  if (/^(?:next|skip)(?: the)?(?: song| track)?$|^play (?:the )?next (?:song|track)$/.test(s)) return { type: 'media', action: 'next' };
  if (/^(?:previous|last|go back)(?: song| track)$|^play (?:the )?previous (?:song|track)$/.test(s)) return { type: 'media', action: 'prev' };
  if (/^(?:what(?:'s| is) (?:this|the) song|what(?:'s| is) playing|what song is (?:this|playing))$/.test(s)) return { type: 'media', action: 'what' };

  // settings toggles
  if ((m = /^(?:please\s+)?(?:turn|switch|put)\s+(on|off)\s+(?:the\s+|my\s+)?(.+)$/.exec(s)) || (m = /^(?:please\s+)?(?:turn|switch|put)\s+(?:the\s+|my\s+)?(.+?)\s+(on|off)$/.exec(s))) {
    const onoff = m[1] === 'on' || m[1] === 'off' ? m[1] : m[2];
    const what = m[1] === 'on' || m[1] === 'off' ? m[2] : m[1];
    const key = settingKey(what);
    if (key) return { type: 'setting', key, value: onoff === 'on' };
  }
  if ((m = /^(?:please\s+)?(enable|disable|activate|deactivate)\s+(?:the\s+|my\s+)?(.+)$/.exec(s))) {
    const key = settingKey(m[2]);
    if (key) return { type: 'setting', key, value: m[1] === 'enable' || m[1] === 'activate' };
  }
  if ((m = /^(?:switch|change|set)\s+(?:to|the theme to|theme to)\s+(dark|light)(?: mode| theme)?$/.exec(s))) return { type: 'setting', key: m[1], value: true };
  if ((m = /^(?:set|change)\s+(?:the\s+)?brightness\s+to\s+(\d+)\s*(?:%|percent)?$/.exec(s))) return { type: 'setting', key: 'brightness', value: Math.max(30, Math.min(100, +m[1])) / 100 };
  if (/^(?:lock (?:the |my )?(?:phone|screen|device))$/.test(s)) return { type: 'lock' };
  if (/^(?:take a )?screenshot$/.test(s)) return { type: 'chat', topic: 'screenshot' };

  // lists
  if (/\b(?:show|list|what are|what's|check|see)\b.*\balarms?\b/.test(s) || /^(?:my )?alarms$/.test(s)) return { type: 'alarmList' };
  if (/\b(?:show|list|what are|check|see)\b.*\breminders?\b/.test(s) || /^(?:my )?reminders$/.test(s)) return { type: 'reminderList' };
  if (/\b(?:what(?:'s| is)|show|check|how does)\b.*\b(?:calendar|schedule|agenda|appointments?|meetings?|plans?)\b/.test(s) || /^(?:what do i have|am i free|do i have anything|what's next|my day)\b/.test(s)) {
    const w = parseWhen(s, now);
    return { type: 'agenda', day: w?.hasDay ? w.date : null };
  }

  // timer
  if ((m = /\b(?:set|start|create)?\s*(?:a\s+)?timer\s+(?:for\s+)?(.+)$/.exec(s)) || (m = /^(?:set|start)?\s*(?:a\s+)?(.+?)\s+timer$/.exec(s)) || (m = /^(?:count ?down)\s+(?:from\s+)?(.+)$/.exec(s))) {
    const d = parseDuration(m[1]);
    if (d) return { type: 'timer', ms: d.ms, label: d.match };
    if (/timer/.test(s)) return { type: 'timer', ms: null };
  }

  // alarm
  if (/\b(?:alarm|wake me(?: up)?|wake up call)\b/.test(s) && !/\b(?:delete|remove|cancel|turn off|disable)\b/.test(s)) {
    const rest = s.replace(/\b(?:please|can you|could you|set|create|add|make|new|an?|alarm|for|wake me(?: up)?|wake up call)\b/g, ' ');
    let clk = parseClock(rest) || parseClock(' at ' + rest.trim());
    const dur = /\bin\s+/.test(s) ? parseDuration(s) : null;
    let days = [];
    if (/\b(?:every ?day|daily)\b/.test(s)) days = [0, 1, 2, 3, 4, 5, 6];
    else if (/\b(?:weekdays|every weekday|work days)\b/.test(s)) days = [1, 2, 3, 4, 5];
    else if (/\bweekends?\b/.test(s)) days = [0, 6];
    else for (const [i, d] of DAYS.entries()) if (new RegExp(`\\b(?:every|on)\\s+${d}s?\\b|\\b${d}s\\b`).test(s)) days.push(i);
    const lm = /\b(?:called|labell?ed|named|titled|for|to)\s+(?!\d)(?!the morning|tomorrow|tonight|every|weekdays)([a-z][a-z '’-]{1,40})$/.exec(s);
    let label = lm ? lm[1].trim() : '';
    if (/^(?:me|wake)/.test(label)) label = '';
    if (dur && !clk) {
      const d = new Date(now.getTime() + dur.ms);
      return { type: 'alarm', hours: d.getHours(), minutes: d.getMinutes(), days, label };
    }
    if (clk) {
      let h = clk.hours;
      if (!clk.meridiem && h < 12 && /\b(?:evening|tonight|afternoon|pm|night)\b/.test(s)) h += 12;
      return { type: 'alarm', hours: h, minutes: clk.minutes, days, label };
    }
    return { type: 'alarm', missing: 'time', days, label };
  }

  // reminders
  if ((m = /^(?:please\s+)?(?:remind me|set (?:a |me a )?reminder|create (?:a )?reminder|add (?:a )?reminder|reminder)\b(?:\s+(?:to|that|about|for)\b)?\s*(.*)$/.exec(s))) {
    const body = m[1];
    const w = parseWhen(body, now);
    const origBody = orig.replace(/^(?:please\s+)?(?:remind me|set (?:a |me a )?reminder|create (?:a )?reminder|add (?:a )?reminder|reminder)\b(?:\s+(?:to|that|about|for)\b)?\s*/i, '');
    let what = w ? strip(body, w.matches) : strip(body, []);
    // keep original casing when possible
    const ci = origBody.toLowerCase().indexOf(what);
    if (what && ci >= 0) what = origBody.slice(ci, ci + what.length);
    return { type: 'reminder', text: what, when: w ? w.date.getTime() : null, hasTime: !!w };
  }

  // calls / texts / email
  if ((m = /^(?:please\s+)?(?:call|phone|dial|ring|give)\s+(.+?)(?:\s+a call)?(?:\s+on (?:speaker|mobile|cell|work|home))?(?:\s+(mobile|cell|work|home))?$/.exec(s)) && !/^(?:me|it)\b/.test(m[1])) return { type: 'call', who: m[1].replace(/^(?:to\s+)/, '').trim(), kind: m[2] || null };
  if ((m = /^(?:please\s+)?(?:text|message|sms|send (?:a |an )?(?:text|message|sms)(?: message)? to|send)\s+(.+?)(?:\s*(?:saying|that says|that|and say|:|,)\s+(.+))?$/.exec(s)) && !/^(?:me)\b/.test(m[1])) {
    let body = m[2] || '';
    if (body) { const i = orig.toLowerCase().lastIndexOf(body); if (i >= 0) body = orig.slice(i, i + body.length); }
    return { type: 'text', who: m[1].trim(), body };
  }
  if ((m = /^(?:tell|ask)\s+(?!me\b)([a-z]+(?:\s+[a-z]+)?)\s+(?:that\s+|to\s+)(.+)$/.exec(s))) {
    const i = orig.toLowerCase().lastIndexOf(m[2]);
    return { type: 'text', who: m[1], body: i >= 0 ? orig.slice(i, i + m[2].length) : m[2] };
  }
  if ((m = /^(?:email|e-mail|mail|send (?:an )?(?:email|e-mail) to)\s+(.+?)(?:\s+(?:about|saying|that)\s+(.+))?$/.exec(s))) return { type: 'email', who: m[1], body: m[2] || '' };

  // notes
  if ((m = /^(?:take|make|create|add|write|new)?\s*(?:a\s+)?note(?:\s+to\s+self)?(?:\s*[:,-]\s*|\s+that\s+|\s+saying\s+|\s+)(.+)$/i.exec(text.trim())) || (m = /^(?:remember|note to self)\s*[:,-]?\s*(?:that\s+)?(.+)$/i.exec(text.trim()))) {
    return { type: 'note', text: m[1].trim() };
  }

  // calendar events
  if ((m = /^(?:please\s+)?(?:add|create|schedule|put|book|set up|make|new|plan)\s+(.+)$/.exec(s)) && (/\b(?:event|appointment|meeting|calendar|lunch|dinner|breakfast|call with|party|date with)\b/.test(s) || parseWhen(m[1], now))) {
    const w = parseWhen(m[1], now);
    const dur = /\bfor\s+(\d+|an?|half an?)\s*(hours?|minutes?|mins?)\b/.exec(s);
    let title = strip(m[1], [dur?.[0], ...(w?.matches || []), /\b(?:to|on|in)\s+(?:my\s+)?calendar\b/, /\b(?:an?\s+)?(?:new\s+)?(?:event|appointment)(?:\s+(?:called|titled|named|for))?\b/]);
    title = title.replace(/^(?:an?|the)\s+/, '').trim();
    const ci = orig.toLowerCase().indexOf(title);
    if (title && ci >= 0) title = orig.slice(ci, ci + title.length);
    return { type: 'event', title: title || 'Event', start: w ? w.date.getTime() : null, allDay: w ? !w.hasTime : false, duration: dur ? parseDuration(dur[0].replace(/^for\s+/, ''))?.ms : null };
  }

  // weather
  if (/\b(?:weather|forecast|temperature|rain(?:ing|y)?|snow(?:ing)?|umbrella|sunny|humid(?:ity)?|windy|degrees|how (?:hot|cold|warm) is it|is it (?:hot|cold|warm))\b/.test(s)) {
    let city = null;
    const cm = /\b(?:in|for|at|near)\s+([a-z][a-z .'-]*?)\s*(?:today|tomorrow|tonight|this week|this weekend|right now|now|later|on [a-z]+day)?$/.exec(s);
    if (cm && !/^(?:the (?:morning|afternoon|evening)|here|my area|my location)$/.test(cm[1].trim())) city = cm[1].trim();
    let when = 'now';
    if (/\btomorrow\b/.test(s)) when = 'tomorrow';
    else if (/\b(?:this week|week|weekend|forecast|next few days)\b/.test(s)) when = 'week';
    else if ((m = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(s))) when = m[1];
    return { type: 'weather', city, when };
  }

  // time & date
  if ((m = /\b(?:what(?:'s| is)? the time|what time is it|current time|time is it|tell me the time|time now)\b(?:\s+(?:in|at)\s+(.+))?$/.exec(s)) || (m = /^time in\s+(.+)$/.exec(s))) return { type: 'time', city: m[1] ? m[1].trim() : null };
  if (/\b(?:what(?:'s| is)? (?:the |today's )?date|what day is (?:it|today)|today's date|what is today)\b/.test(s)) return { type: 'date' };
  if ((m = /\bhow many days (?:until|till|to|before)\s+(.+)$/.exec(s))) return { type: 'daysUntil', what: m[1] };

  // play
  if ((m = /^(?:play|listen to|put on|shuffle)\s*(.*)$/.exec(s))) {
    const what = m[1].replace(/^(?:some|me some|me|my|the|a)\s+/, '').trim();
    if (/^(?:a\s+)?game$|^games$/.test(what)) return { type: 'open', app: 'games', name: 'games' };
    if (/^(?:the\s+)?radio\b|^fm\b/.test(what)) return { type: 'open', app: 'radio', name: 'radio' };
    if (/^podcasts?\b/.test(what)) return { type: 'open', app: 'podcasts', name: 'podcasts' };
    if (/^(?:a\s+)?(?:video|movie)s?$/.test(what)) return { type: 'open', app: 'video', name: 'video' };
    const music = !what || /^(?:music|songs?|tunes|something|my music|all music|playlist|my playlist)$/.test(what);
    return { type: 'play', query: music ? '' : what, shuffle: /^shuffle/.test(s) };
  }

  // open apps
  if ((m = /^(?:please\s+)?(?:open|launch|start|run|go to|show(?: me)?|show me my|switch to|bring up|load)\s+(?:up\s+)?(.+)$/.exec(s))) {
    const target = m[1].replace(/\s+(?:app|application|please)$/, '');
    const id = resolveApp(target, apps);
    if (id) return { type: 'open', app: id, name: target };
    if (/^(?:settings? for|the settings for)\s+/.test(target)) return { type: 'open', app: 'settings', name: 'settings' };
    if ((m = /^(.+?)\s+settings$/.exec(target))) {
      const key = settingKey(m[1]);
      const page = { wifi: 'wifi', bluetooth: 'bluetooth', airplane: 'airplane', location: 'location', batterySaver: 'battery' }[key];
      if (page) return { type: 'open', app: 'settings', name: 'settings', args: { page } };
    }
    if (/^(?:https?:\/\/|www\.)|\.[a-z]{2,6}(?:\/|$)/.test(target)) return { type: 'url', url: /^https?:/.test(target) ? target : 'https://' + target };
    if (/^(?:open|launch|start|run)$/.test(s.split(' ')[0])) return { type: 'open', app: null, name: target };
  }

  // navigation / maps
  if ((m = /^(?:navigate|directions|get directions|drive|take me|walk|how do i get|how to get|route)\s+(?:me\s+)?(?:to\s+|home\b)?(.*)$/.exec(s))) return { type: 'maps', query: m[1] || 'home', directions: true };
  if ((m = /^(?:find|show|where (?:is|are)(?: the)?(?: nearest| closest)?|search for)\s+(?:a\s+|an\s+|the\s+|some\s+)?(.+?)\s+(?:near me|nearby|around here|close by)$/.exec(s))) return { type: 'maps', query: m[1] };
  if ((m = /^(?:show|find)\s+(.+?)\s+on (?:a |the )?map$/.exec(s)) || (m = /^map of\s+(.+)$/.exec(s))) return { type: 'maps', query: m[1] };
  if (/^where am i$/.test(s)) return { type: 'whereami' };

  // currency
  if ((m = new RegExp(`^(?:convert\\s+|how much is\\s+|what(?:'s| is)\\s+)?(\\d+(?:[.,]\\d+)?)\\s*(${CURRENCIES}|${Object.keys(CUR_WORDS).join('|')})\\s+(?:to|in|into)\\s+(${CURRENCIES}|${Object.keys(CUR_WORDS).join('|')})$`).exec(s))) {
    const cur = (x) => CUR_WORDS[x] || x;
    return { type: 'currency', amount: parseFloat(m[1].replace(',', '.')), from: cur(m[2]).toUpperCase(), to: cur(m[3]).toUpperCase() };
  }

  // translate
  if ((m = /^translate\s+(.+?)\s+(?:to|into)\s+([a-z]+)$/.exec(s)) || (m = /^how (?:do|would) (?:you|i) say\s+(.+?)\s+in\s+([a-z]+)$/.exec(s)) || (m = /^what(?:'s| is)\s+(.+?)\s+in\s+(spanish|french|german|italian|portuguese|japanese|chinese|korean|vietnamese|russian|arabic|hindi|dutch|swedish|polish|turkish|greek|thai|indonesian)$/.exec(s))) {
    const phrase = m[1].replace(/^["']|["']$/g, '');
    const i = orig.toLowerCase().indexOf(phrase);
    return { type: 'translate', text: i >= 0 ? orig.slice(i, i + phrase.length) : phrase, to: m[2] };
  }

  // news
  if (/\b(?:news|headlines)\b/.test(s)) {
    const cats = { tech: 'technology', technology: 'technology', business: 'business', sports: 'sports', sport: 'sports', science: 'science', world: 'world', entertainment: 'entertainment', health: 'health', football: 'football', soccer: 'football', tennis: 'tennis', 'formula 1': 'f1', f1: 'f1', food: 'food', travel: 'travel' };
    let cat = 'top';
    for (const [k, v] of Object.entries(cats)) if (new RegExp(`\\b${k}\\b`).test(s)) { cat = v; break; }
    return { type: 'news', category: cat };
  }

  // games of chance
  if (/\b(?:flip|toss) a coin\b|\bheads or tails\b/.test(s)) return { type: 'coin' };
  if ((m = /\broll (?:a |the |an? )?(?:(\d+)[- ]sided )?(?:die|dice)\b/.exec(s))) return { type: 'dice', sides: +(m[1] || 6) };
  if ((m = /\b(?:pick|choose) a (?:random )?number between (\d+) and (\d+)\b/.exec(s))) return { type: 'random', min: +m[1], max: +m[2] };

  // math (before "what is" wiki lookups)
  const expr = mathFromText(s);
  if (expr) { try { return { type: 'math', expr, value: evalMath(expr) }; } catch {} }

  // chit-chat / easter eggs
  const chat = chatTopic(s);
  if (chat) return { type: 'chat', topic: chat };

  // knowledge
  if ((m = /^(?:define|definition of|meaning of|what does)\s+(?:the word\s+)?(.+?)(?:\s+mean)?$/.exec(s))) return { type: 'define', term: m[1] };
  if ((m = /^(?:who|what)(?:'s| is| are| was| were)\s+(?:a |an |the )?(.+)$/.exec(s)) || (m = /^(?:tell me about|tell me something about|wiki(?:pedia)?|search wikipedia for|look up|info on|information about)\s+(.+)$/.exec(s)) || (m = /^(?:who|what) (?:invented|discovered|founded|wrote|painted|created)\s+(.+)$/.exec(s))) {
    return { type: 'wiki', term: m[1].replace(/^(?:a|an|the)\s+/, '') , query: orig };
  }
  if ((m = /^(?:search|search the web|search bing|bing|google|find|look for)\s+(?:for\s+)?(.+)$/.exec(s))) {
    const i = orig.toLowerCase().indexOf(m[1]);
    return { type: 'search', query: i >= 0 ? orig.slice(i, i + m[1].length) : m[1] };
  }
  // A lone app name: "calculator"
  const lone = resolveApp(s, apps);
  if (lone && s.split(' ').length <= 3 && apps.find((a) => a.id === lone && (a.name.toLowerCase() === s || a.id === s))) return { type: 'open', app: lone, name: s };
  return { type: 'search', query: orig };
}

/* ------------------------------------------------------------------ chit-chat */

const CHAT = [
  ['hello', /^(?:hi|hello|hey|hiya|howdy|yo|greetings|good (?:morning|afternoon|evening))(?: there)?(?: cortana)?$/],
  ['howareyou', /^(?:how are you|how's it going|how are things|how do you do|what's up|whats up|sup)(?: cortana| today)?$/],
  ['name', /^(?:what(?:'s| is) your name|who are you|what are you|are you cortana|introduce yourself)$/],
  ['masterchief', /\bmaster ?chief\b|\bjohn[- ]117\b|\bspartan\b/],
  ['halo', /\bhalo\b/],
  ['siri', /\b(?:siri|alexa|google assistant|ok google)\b/],
  ['clippy', /\bclippy\b|\bclippit\b/],
  ['love', /^(?:i love you|do you love me|will you marry me|marry me|do you like me|be my (?:girlfriend|valentine)|are you single)$/],
  ['thanks', /^(?:thanks?(?: you)?(?: so much| very much)?(?: cortana)?|thx|ty|cheers|much appreciated)$/],
  ['joke', /\b(?:tell me a joke|joke|make me laugh|say something funny|funny)\b/],
  ['sing', /\b(?:sing(?: me)?(?: a song)?|can you sing)\b/],
  ['story', /\btell me a story\b/],
  ['age', /^(?:how old are you|when were you born|what(?:'s| is) your (?:age|birthday))$/],
  ['where', /^(?:where (?:are you from|do you come from|do you live)|where are you)$/],
  ['creator', /^(?:who (?:made|created|built|designed) you|who is your (?:creator|maker|father|mother|boss))$/],
  ['meaning', /\bmeaning of life\b|\b42\b.*\banswer\b/],
  ['bored', /^(?:i'm|i am) (?:bored|sad|lonely|tired|hungry|happy)$/],
  ['sorry', /^(?:sorry|my bad|oops)$/],
  ['bye', /^(?:bye|goodbye|good night|see you|see ya|later|goodnight)(?: cortana)?$/],
  ['help', /^(?:help|what can you do|what can i (?:say|ask)|commands|how do i use you|what do you do)$/],
  ['bill', /\bbill gates\b.*\b(?:think|opinion)\b|\bwhat do you think (?:of|about) (?:microsoft|windows)\b/],
  ['rock', /^(?:rock paper scissors|let's play rock paper scissors|rock,? paper,? scissors)$/],
  ['beatbox', /\bbeat ?box\b/],
  ['windowsphone', /\bwindows phone\b|\blumia\b/],
  ['awesome', /^(?:you(?:'re| are) (?:awesome|great|smart|cool|the best|amazing|funny))$/],
  ['insult', /^(?:you(?:'re| are) (?:stupid|dumb|useless|annoying|bad)|i hate you|shut up)$/],
  ['real', /^(?:are you (?:real|human|alive|a robot|an ai|sentient))$/],
  ['dinner', /^(?:what should i (?:have|eat|cook) for (?:dinner|lunch|breakfast)|i'm hungry|what should i eat)$/],
  ['fox', /\bwhat does the fox say\b/],
  ['knock', /^knock,? knock$/],
  ['color', /^(?:what(?:'s| is) your favou?rite colou?r)$/],
];

export function chatTopic(s) {
  for (const [k, re] of CHAT) if (re.test(s)) return k;
  return null;
}

/** Next occurrence of an alarm { hours, minutes, days } after `now`. */
export function nextAlarmTime(a, now = new Date()) {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, a.hours, a.minutes, 0, 0);
    if (d <= now) continue;
    if (!a.days?.length || a.days.includes(d.getDay())) return d;
  }
  return null;
}
