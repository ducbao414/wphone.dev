// Dependency-free parsers: RSS/Atom feeds, readable article extraction, DuckDuckGo HTML results.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™' };
export function decode(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const unCDATA = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const stripTags = (s = '') => decode(unCDATA(s).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = re.exec(block);
  return m ? unCDATA(m[1]).trim() : '';
}
function attr(block, name, at) {
  const re = new RegExp(`<${name}\\b[^>]*\\b${at}=["']([^"']+)["'][^>]*\\/?>`, 'i');
  const m = re.exec(block);
  return m ? decode(m[1]) : '';
}

export function parseFeed(xml, srcUrl) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const channel = isAtom ? xml : (/<channel[^>]*>([\s\S]*?)<\/channel>/i.exec(xml)?.[1] || xml);
  const head = channel.split(isAtom ? /<entry[\s>]/i : /<item[\s>]/i)[0];
  const title = stripTags(tag(head, 'title'));
  const image = attr(head, 'itunes:image', 'href') || tag(tag(head, 'image'), 'url');
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]).slice(0, 100);
  const items = blocks.map((b) => {
    const rawDesc = tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    const descHtml = decode(rawDesc).includes('<') ? decode(rawDesc) : rawDesc;
    let link = isAtom ? (attr(b, 'link[^>]*rel=["\']alternate["\']', 'href') || attr(b, 'link', 'href')) : stripTags(tag(b, 'link')) || attr(b, 'link', 'href');
    const img = attr(b, 'media:thumbnail', 'url') || attr(b, 'media:content', 'url') || attr(b, 'enclosure[^>]*type=["\']image', 'url') || attr(b, 'itunes:image', 'href') ||
      (/<img[^>]+src=["']([^"']+)["']/i.exec(descHtml)?.[1] ? decode(/<img[^>]+src=["']([^"']+)["']/i.exec(descHtml)[1]) : '');
    const enclosure = attr(b, 'enclosure', 'url');
    const enclosureType = attr(b, 'enclosure', 'type');
    return {
      title: stripTags(tag(b, 'title')),
      link,
      date: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'),
      description: stripTags(descHtml).slice(0, 600),
      image: img,
      author: stripTags(tag(b, 'dc:creator') || tag(b, 'author') || tag(b, 'itunes:author')),
      duration: tag(b, 'itunes:duration'),
      enclosure: enclosure || undefined,
      enclosureType: enclosureType || undefined,
      source: title,
    };
  });
  return { title, image, link: srcUrl, items };
}

/** Very small readability: grabs title, og:image, and paragraphs/headings from the main content. Returns safe structured blocks. */
export function extractReadable(html, url) {
  const meta = (p) => decode(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)?.[1] || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i').exec(html)?.[1] || '');
  const title = meta('og:title') || stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  let image = meta('og:image');
  if (image) try { image = new URL(image, url).href; } catch {}
  const byline = meta('author') || meta('article:author');
  let body = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] || /<main[\s\S]*?<\/main>/i.exec(html)?.[0] || html;
  body = body.replace(/<(script|style|noscript|nav|footer|header|aside|form|figure)[\s\S]*?<\/\1>/gi, '');
  const blocks = [];
  for (const m of body.matchAll(/<(p|h2|h3|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(m[2]);
    if (!text) continue;
    if (m[1].toLowerCase() === 'p' && text.length < 30) continue;
    blocks.push({ type: m[1].toLowerCase(), text });
    if (blocks.length > 200) break;
  }
  return { title, byline, image, url, description: meta('og:description') || meta('description'), blocks };
}

export function parseDDG(html) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
  for (const m of html.matchAll(re)) {
    let href = decode(m[1]);
    const u = /[?&]uddg=([^&]+)/.exec(href);
    if (u) href = decodeURIComponent(u[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:/.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    out.push({ title: stripTags(m[2]), url: href, snippet: stripTags(m[3] || '') });
    if (out.length >= 20) break;
  }
  return out;
}
