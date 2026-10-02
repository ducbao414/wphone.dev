# wphone — Windows Phone 8.1 in the browser

A web-based Windows Phone simulator optimized for mobile browsers (works on desktop too, inside a Lumia-style frame).
Live tiles, lock screen with the Bing image of the day, Action Center, task switcher, a private on-device file system
(IndexedDB — nothing is uploaded), and ~50 apps that use real device APIs (camera, location, microphone, orientation,
vibration, speech, notifications, contacts picker, share).

## Run locally

```bash
npm install
npm run server        # backend API on :8787
npm run dev           # Vite dev server on :5173 (proxies /api to :8787)
```

Open http://localhost:5173. Camera/mic/location require HTTPS or localhost.

Keyboard on desktop: `Esc`/`Backspace` = Back, `Home` = Start, `F2` = task switcher, `F3` = search (Cortana), `F4` = lock.
Long-press Back = task switcher, long-press Search = talk to Cortana, pull down the status bar = Action Center.

## Deploy on a VPS (Node ≥ 20)

```bash
npm ci
npm run build                 # outputs dist/
PORT=8787 node server/index.js  # serves dist/ + /api
```

Put it behind a reverse proxy with HTTPS (required for camera/mic/location/service worker), e.g. Caddy:

```
wphone.example.com {
  reverse_proxy localhost:8787
}
```

Keep it running with pm2: `pm2 start server/index.js --name wphone` (set `PORT` as needed).

## Architecture

```
server/            Hono backend: Bing wallpaper, weather (Open-Meteo), geocoding, news/RSS, FX rates, quotes,
                   translate, search/suggest, internet radio, podcasts, readable articles, sandboxed proxy (SSRF-guarded)
src/os/            the "OS": kernel (app lifecycle/back stack), fs (IndexedDB VFS), settings, theme, tiles (live tiles),
                   notifications, media (background audio), device (Web API wrappers), net, pickers, ui (Metro controls)
src/shell/         status bar, nav bar, lock screen, Start + app list, Action Center, task switcher, volume, OOBE
src/apps/<id>/     apps, auto-discovered (manifest.js, index.js, optional tile.js, background.js)
docs/APP_SDK.md    how to write an app
```

Everything a user creates (files, settings, contacts, notes, messages) lives only in their own browser's IndexedDB.
The proxy serves third-party pages with `Content-Security-Policy: sandbox` so they get an opaque origin and can never read that storage.
