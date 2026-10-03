# Windows Phone Web — App SDK

Stack: Vite + vanilla JS (ES modules), no framework. Each app is a folder in `src/apps/<id>/`, auto-discovered — **no registry file to edit**.
Look at `src/apps/calculator/` for a complete minimal example. Read `src/os/ui.js`, `src/os/api.js`, `src/styles/controls.css` before writing an app.

## Files of an app

```
src/apps/<id>/
  manifest.js     (required, tiny, eagerly loaded — keep imports to icons only)
  index.js        (required unless manifest.external) — default export launch(ctx)
  style.css       (optional, import from index.js; PREFIX ALL CLASSES with your app id e.g. .weather-xxx)
  tile.js         (optional) live tile provider, lazily loaded
  background.js   (optional) runs at boot for installed apps (alarms, reminders, etc.)
```

### manifest.js
```js
import { CloudSun } from 'lucide';            // named imports only (tree-shaking)
// or brand icons: import { siFacebook } from 'simple-icons';
export default {
  id: 'weather',                // == folder name
  name: 'Weather',              // display name (app list, tile label)
  icon: CloudSun,               // Lucide IconNode | simple-icons object | '<svg…>' string | image URL
  color: undefined,             // tile/app-list background; omit to use the user's accent color (system apps should omit)
  category: 'app',              // 'system' (can't uninstall) | 'app' | 'game'
  preinstalled: true,           // false => must be installed from the Store
  pin: { size: 'wide', order: 5 }, // default pinned tile on Start (size: 'small'|'medium'|'wide'), or false
  tileSizes: ['small','medium','wide'], // optional allowed sizes
  handles: ['image/*', '.txt'], // optional: file associations for os.openFile(path) — launched with args { file: path }
  shareTarget: true,            // optional: appears in share sheet — launched with args { share: { title, text, url, path } }
  fullscreen: false,            // true hides the status bar (games, camera)
  keepAwake: false,             // true prevents auto-lock while foreground
  external: undefined,          // URL: app has no index.js; launching opens this URL in a new tab (e.g. https://m.facebook.com)
  publisher: 'Microsoft Corporation', description: '…', rating: 4.5, size: '12 MB', keywords: ['…'],  // used by the Store
};
```

### index.js
```js
import './style.css';
export default async function launch(ctx) {
  const { root, os, args, storage } = ctx;
  // Render into root (position:absolute; inset:0). Return optional lifecycle handlers.
  return { onBack, onSuspend, onResume, onDestroy };   // onBack returns true if it consumed Back
}
```

`ctx`:
| member | |
|---|---|
| `root` | HTMLElement to render into (fills the screen below the status bar) |
| `os` | the OS API (below) |
| `args` | launch args, e.g. `{ file }`, `{ share }`, or anything passed to `os.launch(id, args)` or a secondary tile |
| `storage` | per-app async KV: `get(key, fallback)`, `set`, `del`, `keys()`, `update(key, fn, fallback)` (IndexedDB) |
| `navigate(builder, params)` | push an in-app page with turnstile animation. `builder(page)` gets `{ el, params, close, os, ctx }`, may append into `page.el` or return an Element or `{ el, onBack, onShow, onHide, onDestroy }`. Back pops automatically. |
| `back()` / `close()` | go back (pops page or closes app) / close app |
| `onBack(fn)` | register a back handler (return true to consume). Returns unregister fn. |
| `on(ev, fn)` | `'suspend'`, `'resume'`, `'destroy'`, `'args'` (app re-launched with new args while running, e.g. from a notification) |
| `pinTile({ key, title, args, size })` | pin a secondary tile that relaunches this app with `args` |
| `setFullscreen(bool)` | |

Typical multi-page app:
```js
export default function launch(ctx) {
  ctx.navigate(listPage);                      // first page
  function listPage(page) {
    const p = os.ui.page({ app: 'NOTES', title: 'all notes' });
    // ... on item click: ctx.navigate(detailPage, { id })
    page.el.append(p.el, bar.el);
  }
  function detailPage(page) { /* page.params.id */ }
}
```

## OS API (`ctx.os`, also `window.os`)

- **Apps**: `os.launch(id, args)`, `os.home()`, `os.back()`, `os.isLocked()`, `os.lock()`, `os.apps.list()`, `os.apps.get(id)`, `os.apps.install(id)`, `os.apps.uninstall(id)`, `os.apps.isInstalled(id)`, `os.apps.list({ all: true })` (includes not-installed), `os.apps.running()`, `os.apps.close(id)`, `os.apps.on('installed'|'uninstalled'|'launch'|'close', fn)`
- **File system** `os.fs` (IndexedDB, per-browser private storage). Default folders: `/Documents /Downloads /Music /Videos /Ringtones /Pictures /Pictures/Camera Roll /Pictures/Saved Pictures /Pictures/Screenshots`
  - `list(dir)`, `stat(path)`, `exists(path)`, `mkdir(path)`, `write(path, data, { mime })` (string|Blob|ArrayBuffer|object→JSON), `read(path, 'blob'|'text'|'json'|'arraybuffer'|'dataurl')`, `url(path)` (cached objectURL), `thumb(path, max)` (cached JPEG thumbnail objectURL for images; max 256 default, 1024 for crisp live tiles), `setThumb(path, blob)`, `remove(path)`, `copy`, `move`, `rename(path, newName)`, `walk(dir, filter)`, `find('image/', dir)` (newest first), `uniquePath(path)`, `importFiles(FileList, dir)`, `download(path)` (save to real device), `usage()`, `on('change', ({type, path}) => …)`
  - `os.path.join/dirname/basename/extname/mimeOf`
  - simulator document types: `.wdoc` (Word), `.wxls` (Excel), `.one` (OneNote) — JSON content.
- **Settings** `os.settings.get(k)`, `set(k, v)`, `watch(k, fn)`, `on('change', (k, v) => …)`. Keys: theme ('dark'|'light'), accent, moreTiles, h24, units ('metric'|'imperial'), lockWallpaper ('bing'|'accent'|path), startBackground (path|null), ringtone, notificationSound, sounds, vibrate, location, batterySaver, airplane, wifi, bluetooth, cellular, brightness (0.3–1), fontScale, lockPin, autoLock (ms), ownerName, deviceName, quickActions, lockDetail (text on lock screen, e.g. next alarm).
- **Theme** `os.theme.ACCENTS` (name→hex), `os.theme.accentColor()`, `os.theme.isDark()`. In CSS use `var(--accent)`, `var(--bg)`, `var(--fg)`, `var(--fg2)` (subtle), `var(--fg3)`, `var(--chrome)`, `var(--chrome2)`, `var(--m)` (page margin), font vars `--font`, `--font-light`, size vars `--fs-*`.
- **Live tiles** `os.tiles.set(appId, data, key?)`, `os.tiles.refresh(appId)`, `os.tiles.pin(appId, { key, title, args, size })`, `os.tiles.unpin(keyOrId)`, `os.tiles.isPinned(appId, key?)`
- **Notifications** `os.notify({ appId, title, body, args })` → toast + Action Center; tap launches app with args. `os.toast(text)` quick transient toast. `os.notifications.unreadCount(appId)`
- **Media** (global background audio, continues after the app closes; shown on lock screen & volume flyout): `os.media.playQueue([{ path | src, title, artist, album, art }], i)`, `playOne(item)`, `play/pause/toggle/next/prev/seek/stop/setVolume`, `current`, `playing`, `shuffle`, `repeat`, `audio` (HTMLAudioElement), events `'change'|'track'|'time'|'error'`
- **Device** `os.device`: `getLocation()` / `locate()` (simulated: city chosen in Settings → approximate IP city → Redmond; never real GPS), `watchLocation(cb)` (reports once), `getCamera({ facing })` (MediaStream), `getMicrophone()`, `torch(on)`, `vibrate(p)`, `watchOrientation(cb)`, `watchMotion(cb)`, `shareNative()`, `copy(text)`, `paste()`, `speak(text)`, `listen({ onInterim })`, `canListen`, `wakeLock()`, `storageEstimate()`, `battery` {level, charging}, `online`, `call(n)` / `sms(n, body)` / `email(to, subj, body)` (open the simulator's Phone / Messaging / Outlook — never the real device's), `openUrl(url)`, `isMobile`
- **Sounds** `os.sounds.tap() key() shutter() notify() error()`, `os.sounds.play(ringtoneName, { loop })` → promise with `.stop()`, `os.sounds.ringtones` (names)
- **Network (backend, CORS-free)** `os.net.*` all return parsed JSON (cached):
  - `bing(idx)` → `{ url, landscape, title, copyright }`
  - `weather(lat, lon, units)` → Open-Meteo response (`current`, `hourly`, `daily` with WMO `weather_code`; `units`)
  - `geocode(q)` → `[{ name, country, admin1, lat, lon }]`, `reverse(lat, lon)` → `{ name, country, display }`
  - `news(category)` categories: top world business technology science entertainment health sports football tennis f1 food travel wp → `{ title, items: [{ title, link, date, description, image, source }] }`
  - `rss(url)` → same shape (+ `enclosure`, `enclosureType`, `duration` for podcasts)
  - `readable(url)` → `{ title, byline, image, description, blocks: [{ type: 'p'|'h2'|'h3'|'li'|'blockquote', text }] }`
  - `rates(base)` → `{ base, date, rates }`, `quotes(['AAPL','^GSPC'])` → `[{ symbol, name, price, change, changePercent, points }]`
  - `translate(text, from, to)` → `{ text }` (ISO codes)
  - `search(q)` → `{ results: [{ title, url, snippet }] }`, `suggest(q)` → `[string]`
  - `radio({ name, tag, countrycode, limit })` → `[{ id, name, url, favicon, tags, country }]`
  - `podcasts(q)` → `[{ id, title, author, artwork, feedUrl }]`
  - `proxyUrl(url)` → URL string serving any public page/file through the backend (sandboxed, opaque origin) — use for iframes in IE or fetching CORS-blocked images/text.
  - Wikipedia, OpenStreetMap tiles, Open-Meteo etc. support CORS directly; you can `fetch` them yourself.
- **Pickers** `os.pick.file({ accept: 'image/*', multiple, start })` → `[paths]`, `os.pick.save({ name, start })` → path|null, `os.share({ title, text, url, path })`, `os.openFile(path)`, `os.fileIconFor(meta)`
- **UI kit** `os.ui` (see src/os/ui.js) — use these to look like Windows Phone:
  - `page({ app, title })` → `{ el, header, content }`; `pivot({ app, items: [{ header, render(container) }] })`; `panorama({ title, background, sections })`
  - `appBar({ buttons: [{ icon, label, onClick }], menu: [{ label, onClick }], minimized })` → `{ el, setButtons, setMenu }` — append `bar.el` to your page element (it's absolutely positioned at the bottom). Max 4 buttons.
  - `button(label, onClick, { accent })`, `toggle({ label, value, onChange, description })` → `{ el, value, set }`, `textbox({ label, value, placeholder, multiline, onInput, onEnter, type })`, `checkbox`, `radioGroup`, `slider`, `listPicker({ label, options, value, onChange })`
  - `list(items, { render, onClick, onHold, empty })` (`.update(items)`), `listItem({ title, subtitle, icon, image, right })`, `jumpList(items, { key, render, onClick })`, `header(text)` (accent section header), `desc(text)`, `empty(text)`
  - `loadingDots()`, `progressBar(v)` (`.set(v)`)
  - `messageBox({ title, message, buttons, content })` → index, `alert`, `confirm(msg, title, ok, cancel)` → bool, `prompt(msg, value, title)` → string|null
  - `contextMenu(anchorEl, [{ label, onClick }])` (use for tap-and-hold via `os.util.onLongPress(el, cb)`)
  - `pickTime({ hours, minutes })` → `{hours, minutes}`|null, `pickDate({ date })` → Date|null, `pickFromList({ title, options, value })`
  - `el(tag, props, ...children)` DOM helper (`'div.cls#id'`, `onclick`, `style`, `html`, `dataset`), `esc(html)`, `icon(src, { size })`, `iconSVG(src, opts)`, `I` (common icons: back search home add check close more delete edit share save refresh folder file doc image music video right left down up settings star pin unpin wifi bluetooth airplane play pause prev next volume mute lock camera mic copy paste download upload send smile user users phone mail message calendar clock globe info alert rotate filter location sun moon minus)
  - add class `tilt` to any tappable element for the WP press-tilt effect.
- **Util** `os.util`: `el, frag, $, $$, esc, sleep, uid, clamp, debounce, formatBytes, formatDuration, formatTime, formatRelative, onLongPress(el, cb), onSwipe(el, cb), blobToDataURL, makeThumbnail(blob, max)`

## Live tile provider (tile.js)
```js
export default {
  interval: 30 * 60e3,                 // refresh period
  async update(os, { size, key, args }) {
    return {
      faces: [                          // rotated with WP flip animation (first face = iconic icon unless iconFirst:false)
        { html: '<div class="t-big">24°</div><div class="t-sub">Sunny</div>' },
        { image: url, title: 'caption' },
      ],
      badge: 3,                         // count next to icon
      title: 'Label override', noLabel: false, iconFirst: true, color: '#hex',
    };
  },
};
```
Tile CSS helpers available inside faces: `.t-big`, `.t-mid`, `.t-sub`, `.t-clip`. Text is white on accent/color. Apps can also push data any time with `os.tiles.set(appId, data)`.

## background.js
```js
export default function start(os, { storage, app }) { /* setInterval checks, os.notify(...), etc. Keep cheap. */ }
```

## Design rules (Windows Phone 8.1 Metro)
- Black (dark) or white (light) background, flat, no shadows/gradients/rounded corners. Accent color for highlights.
- Typography: lowercase big light page/pivot titles, UPPERCASE small app title. Use `os.ui.page`/`pivot`.
- Content left-aligned with `var(--m)` margin. Generous whitespace. Lists with big light titles + subtle subtitles.
- App bar at bottom for actions (round outline icon buttons), "…" menu for secondary actions.
- Must work at 320–430px wide on touch, and with mouse on desktop. Use pointer events. Never use `alert()/confirm()` — use os.ui.
- Never use localStorage; use `ctx.storage` / `os.fs`. Handle offline/API errors gracefully (show a message, not a crash).
- Keep each app self-contained in its folder. Do NOT modify files outside your app folders (src/os, src/shell, other apps). If you need an OS feature that's missing, work around it inside your app and mention it in your final report.
- No new npm dependencies. Available: `lucide` (icons), `simple-icons` (brand icons), `leaflet` (maps; import 'leaflet/dist/leaflet.css').
