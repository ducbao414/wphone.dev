// Settings — Windows Phone 8.1 style. "system" / "applications" pivot; every page edits live os.settings keys.
import './style.css';
import {
  Palette, LockKeyhole, BellRing, Wifi, Bluetooth, Plane, Signal, MapPin, BatteryCharging, HardDrive, Clock, Monitor,
  Accessibility, LayoutGrid, Info, RefreshCw, Baby, Globe, Cpu, Flashlight, Sun, RotateCcw,
} from 'lucide';

const AUTOLOCK = [
  { value: 30000, label: '30 seconds' }, { value: 60000, label: '1 minute' }, { value: 120000, label: '2 minutes' },
  { value: 180000, label: '3 minutes' }, { value: 300000, label: '5 minutes' }, { value: 600000, label: '10 minutes' },
  { value: 0, label: 'never' },
];

export const QUICK = {
  wifi: { label: 'Wi-Fi', icon: Wifi },
  bluetooth: { label: 'Bluetooth', icon: Bluetooth },
  airplane: { label: 'airplane mode', icon: Plane },
  rotation: { label: 'rotation lock', icon: RotateCcw },
  location: { label: 'location', icon: MapPin },
  saver: { label: 'battery saver', icon: BatteryCharging },
  brightness: { label: 'brightness', icon: Sun },
  flashlight: { label: 'flashlight', icon: Flashlight },
};

export default async function launch(ctx) {
  const { os, storage } = ctx;
  const ui = os.ui;
  const { el, I } = ui;
  const S = os.settings;
  const U = os.util;
  const APP = 'SETTINGS';
  const onOff = (v) => (v ? 'on' : 'off');
  const accentName = () => {
    const a = S.get('accent');
    return os.theme.ACCENTS[a] ? a : String(a || 'cyan');
  };

  /* ---------------------------------------------------------------- helpers */

  /** Build a sub page: build(content, env) may return { bar, onShow, onHide, onDestroy }. */
  const sub = (title, build) => async (page) => {
    const p = ui.page({ app: APP, title, cls: 'settings-page' });
    if (title.length > 14) p.header.querySelector('.wp-page-title')?.classList.add('settings-title-long');
    const offs = [];
    page.el.append(p.el);
    const r = (await build(p.content, { offs, p, page })) || {};
    if (r.bar) p.el.append(r.bar.el);
    return {
      onShow: r.onShow, onHide: r.onHide,
      onDestroy: () => { offs.forEach((f) => { try { f(); } catch {} }); r.onDestroy?.(); },
    };
  };

  /** Toggle bound to a settings key (kept in sync when changed elsewhere, e.g. Action Center). */
  const bindToggle = (offs, key, label, description, onChange) => {
    const t = ui.toggle({ label, description, value: !!S.get(key), onChange: async (v) => { await S.set(key, v); onChange?.(v); } });
    offs.push(S.on('change:' + key, (v) => t.set(!!v)));
    return t;
  };

  const info = (label, value) => el('div.settings-info', el('div.settings-info-label', label), el('div.settings-info-value.selectable', value ?? '—'));
  const link = (title, subtitle, onClick) => el('div.settings-link.tilt', { onclick: onClick }, el('div.settings-link-title', title), subtitle ? el('div.settings-link-sub', subtitle) : null);
  const thumbBox = async (path, cls = '') => {
    const box = el('div.settings-thumb' + (cls ? '.' + cls : ''));
    if (path && (await os.fs.exists(path))) box.style.backgroundImage = `url("${await os.fs.thumb(path, 400).catch(() => os.fs.url(path))}")`;
    else box.classList.add('empty');
    return box;
  };
  const sizeOf = (bytes) => U.formatBytes(bytes || 0);

  /* ---------------------------------------------------------------- pages */

  const startTheme = sub('start+theme', async (c, { offs }) => {
    // preview
    const preview = el('div.settings-preview', ...['medium', 'small', 'small', 'small', 'small', 'medium', 'medium'].map((s, i) => el('div.settings-preview-tile.' + s, { html: ui.iconSVG([I.phone, I.message, I.mail, I.camera, I.music, I.calendar, I.image][i], { size: s === 'small' ? 16 : 26 }) })));
    const bgPicker = ui.listPicker({ label: 'Background', value: S.get('theme'), options: [{ value: 'dark', label: 'dark' }, { value: 'light', label: 'light' }], onChange: (v) => S.set('theme', v) });
    const accentRow = el('div.settings-field.tilt', { onclick: () => ctx.navigate(accentPage) },
      el('div.wp-field-label', 'Accent color'),
      el('div.settings-accent-row', el('div.settings-accent-swatch'), el('div.settings-accent-name', accentName())));
    offs.push(S.on('change', (k) => {
      if (k === 'accent') accentRow.querySelector('.settings-accent-name').textContent = accentName();
      if (k === 'theme') bgPicker.value = S.get('theme');
    }));
    const more = bindToggle(offs, 'moreTiles', 'Show more tiles', 'Fit more tiles on Start by using six columns of small tiles.');

    const bgHolder = el('div');
    const renderBg = async () => {
      const p = S.get('startBackground');
      bgHolder.replaceChildren(
        ui.header('start background'),
        ui.desc('Choose a photo to show through the tiles on Start, with a parallax effect as you scroll.'),
        await thumbBox(p, 'tall'),
        el('div',
          ui.button('choose photo', async () => {
            const [path] = await os.pick.file({ accept: 'image/*', start: '/Pictures', title: 'choose a photo' });
            if (path) { await S.set('startBackground', path); renderBg(); }
          }),
          p ? ui.button('remove', async () => { await S.set('startBackground', null); renderBg(); }) : null));
    };
    await renderBg();
    c.append(preview, bgPicker, accentRow, more.el, bgHolder);
  });

  function accentPage(page) {
    const p = ui.page({ app: APP, title: 'accents', cls: 'settings-page' });
    const grid = el('div.settings-accents');
    for (const [name, hex] of Object.entries(os.theme.ACCENTS)) {
      grid.append(el('div.settings-accent-cell.tilt' + (S.get('accent') === name ? '.sel' : ''), {
        style: { background: hex }, title: name,
        onclick: async () => { await S.set('accent', name); os.sounds.tap(); page.close(); },
      }, el('span', name)));
    }
    p.content.append(grid);
    page.el.append(p.el);
  }

  const lockScreen = sub('lock screen', async (c, { offs }) => {
    const wallHolder = el('div');
    const renderWall = async () => {
      const w = S.get('lockWallpaper') || 'bing';
      const kind = w === 'bing' || w === 'accent' ? w : 'photo';
      const picker = ui.listPicker({
        label: 'Background', value: kind,
        options: [{ value: 'bing', label: 'Bing' }, { value: 'accent', label: 'accent color' }, { value: 'photo', label: 'photo' }],
        onChange: async (v) => {
          if (v === 'photo') {
            const [path] = await os.pick.file({ accept: 'image/*', start: '/Pictures', title: 'choose a photo' });
            if (path) await S.set('lockWallpaper', path);
          } else await S.set('lockWallpaper', v);
          renderWall();
        },
      });
      let thumb;
      if (kind === 'photo') thumb = await thumbBox(w, 'tall');
      else if (kind === 'accent') thumb = el('div.settings-thumb.tall', { style: { background: 'var(--accent)' } });
      else {
        thumb = el('div.settings-thumb.tall.empty');
        os.net.bing().then((b) => { thumb.classList.remove('empty'); thumb.style.backgroundImage = `url("${b.url}")`; thumb.title = b.copyright || ''; }).catch(() => {});
      }
      wallHolder.replaceChildren(picker, el('div.settings-lock-preview', thumb, el('div.settings-lock-clock', U.formatTime(new Date())), el('div.settings-lock-date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))),
        kind === 'photo' ? ui.button('change photo', async () => {
          const [path] = await os.pick.file({ accept: 'image/*', start: '/Pictures', title: 'choose a photo' });
          if (path) { await S.set('lockWallpaper', path); renderWall(); }
        }) : null);
    };
    await renderWall();

    const artist = bindToggle(offs, 'lockShowArtist', 'Show artist when playing music');
    const timeout = ui.listPicker({
      label: 'Screen times out after',
      value: S.get('autoLock') ?? 120000,
      options: AUTOLOCK.some((o) => o.value === S.get('autoLock')) ? AUTOLOCK : [...AUTOLOCK, { value: S.get('autoLock'), label: Math.round(S.get('autoLock') / 1000) + ' seconds' }],
      onChange: (v) => S.set('autoLock', v),
    });

    const pinHolder = el('div');
    const askPin = async (msg, title = 'password') => {
      const v = await ui.prompt(msg, '', title, { type: 'password', placeholder: '4–8 digits' });
      return v == null ? null : v.trim();
    };
    const verify = async () => {
      const cur = await askPin('Enter your current PIN.');
      if (cur == null) return false;
      if (cur !== S.get('lockPin')) { os.sounds.error(); await ui.alert('That PIN isn’t correct.', 'password'); return false; }
      return true;
    };
    const setNew = async () => {
      const a = await askPin('Choose a new PIN (4 to 8 digits).', 'new password');
      if (a == null) return false;
      if (!/^\d{4,8}$/.test(a)) { await ui.alert('Your PIN has to be 4 to 8 digits.', 'password'); return false; }
      const b = await askPin('Confirm your new PIN.', 'confirm password');
      if (b == null) return false;
      if (a !== b) { await ui.alert('The PINs don’t match. Try again.', 'password'); return false; }
      await S.set('lockPin', a);
      os.toast('Password set');
      return true;
    };
    const renderPin = () => {
      const has = !!S.get('lockPin');
      const t = ui.toggle({
        label: 'Password', value: has, description: has ? 'A PIN is required to unlock your phone.' : 'Require a PIN to unlock your phone.',
        onChange: async (v) => {
          if (v) await setNew();
          else if (await verify()) { await S.set('lockPin', null); os.toast('Password removed'); }
          renderPin();
        },
      });
      pinHolder.replaceChildren(t.el, has ? ui.button('change password', async () => { if (await verify()) await setNew(); renderPin(); }) : null);
      if (has && S.get('autoLock') === 0) pinHolder.append(ui.desc('Tip: your screen never times out, so the password only applies when you lock the phone yourself.'));
    };
    renderPin();

    c.append(wallHolder, artist.el, timeout, ui.header('security'), pinHolder,
      el('div.settings-gap'), ui.button('preview lock screen', () => os.lock()));
  });

  const ringtones = sub('ringtones+sounds', async (c, { offs }) => {
    const mkRow = (key, label) => {
      const row = el('div.settings-field.tilt', { onclick: () => ctx.navigate(tonePage, { key, label }) },
        el('div.wp-field-label', label), el('div.wp-listpicker', S.get(key)));
      offs.push(S.on('change:' + key, (v) => (row.querySelector('.wp-listpicker').textContent = v)));
      return row;
    };
    const snd = bindToggle(offs, 'sounds', 'Sounds', 'Key presses, notifications and other system sounds.');
    const vib = bindToggle(offs, 'vibrate', 'Vibrate', 'Vibrate for calls, notifications and taps (on devices that support it).', (v) => v && os.device.vibrate([40, 60, 40]));
    c.append(snd.el, vib.el, mkRow('ringtone', 'Ringtone'), mkRow('notificationSound', 'New text message / notification'),
      ui.desc('Tap a sound to hear a preview.'));
  });

  function tonePage(page) {
    const { key, label } = page.params;
    const p = ui.page({ app: APP, title: label.toLowerCase().startsWith('ring') ? 'ringtone' : 'sound', cls: 'settings-page' });
    let playing = null;
    const stop = () => { playing?.stop(); playing = null; };
    const render = () => {
      p.content.replaceChildren(...os.sounds.ringtones.map((name) => el('div.settings-tone.tilt' + (S.get(key) === name ? '.sel' : ''), {
        onclick: async () => {
          stop();
          await S.set(key, name);
          render();
          playing = os.sounds.play(name, { volume: 0.3 });
        },
      }, el('span.settings-tone-dot'), el('span', name), el('span.settings-tone-play', { html: ui.iconSVG(I.play, { size: 18 }) }))));
    };
    render();
    page.el.append(p.el);
    return { onHide: stop, onDestroy: stop };
  }

  const wifiPage = sub('Wi-Fi', async (c, { offs }) => {
    const t = bindToggle(offs, 'wifi', 'Wi-Fi networking', null, () => draw());
    const body = el('div');
    const conn = navigator.connection;
    const draw = () => {
      const on = S.get('wifi'), online = navigator.onLine;
      const nc = navigator.connection;
      body.replaceChildren(
        S.get('airplane') ? ui.desc('Airplane mode is on. You can still turn on Wi-Fi.') : null,
        on ? ui.header('available networks') : null,
        on ? el('div.settings-net.tilt', el('div.settings-net-icon', { html: ui.iconSVG(online ? I.wifi : I.wifiOff, { size: 26 }) }),
          el('div', el('div.settings-net-name', online ? 'Internet' : 'no connection'),
            el('div.settings-net-sub.accent', online ? 'connected' : 'not connected — your device is offline'))) : ui.desc('Turn on Wi-Fi to see available networks.'),
        ui.header('connection details'),
        info('Status', online ? 'online' : 'offline'),
        info('Connection type', nc?.type || (nc ? 'unknown' : 'not reported by this browser')),
        nc?.effectiveType ? info('Effective speed', nc.effectiveType.toUpperCase()) : null,
        nc?.downlink != null ? info('Estimated bandwidth', nc.downlink + ' Mbps') : null,
        nc?.rtt != null ? info('Round-trip time', nc.rtt + ' ms') : null,
        nc ? info('Data saver', nc.saveData ? 'on' : 'off') : null,
        ui.desc('Details come from your real device’s network connection.'));
    };
    draw();
    const upd = () => draw();
    window.addEventListener('online', upd); window.addEventListener('offline', upd);
    conn?.addEventListener?.('change', upd);
    offs.push(() => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); conn?.removeEventListener?.('change', upd); });
    offs.push(S.on('change:airplane', upd));
    c.append(t.el, body);
  });

  const bluetoothPage = sub('bluetooth', async (c, { offs }) => {
    const body = el('div');
    const draw = async () => {
      const on = S.get('bluetooth');
      const devices = await storage.get('btDevices', []);
      body.replaceChildren(
        on ? el('div', ui.desc('Searching for devices… Your phone is discoverable as “' + S.get('deviceName') + '”.'), ui.loadingDots({ inline: true })) : ui.desc('Turn on Bluetooth to connect headsets, speakers and other devices.'),
        ui.header('paired devices'),
        devices.length ? ui.list(devices, {
          render: (d) => ui.listItem({ title: d.name, subtitle: on ? 'paired' : 'not connected', icon: Bluetooth }),
          onHold: (d, row) => ui.contextMenu(row, [{ label: 'unpair', onClick: async () => { await storage.set('btDevices', devices.filter((x) => x.id !== d.id)); draw(); } }]),
        }) : ui.empty('no paired devices'),
        on && navigator.bluetooth ? ui.button('pair a real device', async () => {
          try {
            const d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
            const list = await storage.get('btDevices', []);
            if (!list.some((x) => x.id === d.id)) list.push({ id: d.id, name: d.name || 'Unknown device' });
            await storage.set('btDevices', list);
            os.toast('Paired with ' + (d.name || 'device'));
            draw();
          } catch (e) { if (e.name !== 'NotFoundError') ui.alert(e.message, 'bluetooth'); }
        }) : on ? ui.desc('This browser doesn’t support Web Bluetooth, so real devices can’t be paired.') : null);
    };
    const t = bindToggle(offs, 'bluetooth', 'Status', null, draw);
    offs.push(S.on('change:bluetooth', draw));
    await draw();
    c.append(t.el, body);
  });

  const airplanePage = sub('airplane mode', async (c, { offs }) => {
    const t = bindToggle(offs, 'airplane', 'Status', 'Turn on airplane mode to stop all wireless communication. Wi-Fi and Bluetooth can be turned back on separately.', async (v) => {
      if (v) {
        await storage.set('preAirplane', { wifi: S.get('wifi'), bluetooth: S.get('bluetooth'), cellular: S.get('cellular') });
        await S.set({ wifi: false, bluetooth: false, cellular: false });
      } else {
        const prev = await storage.get('preAirplane', { wifi: true, bluetooth: false, cellular: true });
        await S.set({ wifi: prev.wifi ?? true, bluetooth: prev.bluetooth ?? false, cellular: true });
      }
    });
    c.append(t.el);
  });

  const cellularPage = sub('cellular+SIM', async (c, { offs }) => {
    const t = bindToggle(offs, 'cellular', 'Data connection', 'Use cellular data when Wi-Fi isn’t available.');
    const speed = ui.listPicker({ label: 'Highest connection speed', value: await storage.get('cellSpeed', '4G'), options: ['4G', '3G', '2G'], onChange: (v) => storage.set('cellSpeed', v) });
    const roam = ui.listPicker({ label: 'Data roaming options', value: await storage.get('roaming', 'off'), options: [{ value: 'off', label: 'don’t roam' }, { value: 'on', label: 'roam' }], onChange: (v) => storage.set('roaming', v) });
    const nc = navigator.connection;
    c.append(t.el, speed, roam, ui.header('SIM'),
      info('Network', navigator.onLine ? 'Simulated network' : 'no service'),
      info('Network type', nc?.effectiveType ? nc.effectiveType.toUpperCase() : 'unknown'),
      info('SIM', 'SIM 1 (virtual)'),
      ui.desc('This is a simulated cellular radio. Calls and texts use your real device when available.'));
    offs.push(S.on('change:airplane', (v) => t.setDisabled(!!v)));
    t.setDisabled(!!S.get('airplane'));
  });

  const locationPage = sub('location', async (c, { offs }) => {
    const out = el('div.settings-loc');
    const t = bindToggle(offs, 'location', 'Location services', 'Lets apps like Maps, Weather and Cortana use your city. This phone never uses your precise GPS position — it uses an approximate city from your network, or a city you pick below.', () => show());
    const custom = () => S.get('customLocation');
    const modeLabel = el('div');
    const show = async () => {
      const cl = custom();
      modeLabel.replaceChildren(info('My location', cl ? `${cl.city}${cl.country ? ', ' + cl.country : ''} (chosen)` : 'automatic (approximate, from your network)'));
      out.replaceChildren();
      if (!S.get('location')) return;
      out.append(ui.loadingDots({ inline: true }));
      try {
        const loc = await os.device.getLocation();
        out.replaceChildren(
          el('div.settings-loc-place', [loc.city, loc.country].filter(Boolean).join(', ') || 'unknown place'),
          el('div.settings-loc-coords', `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`),
          info('Source', { custom: 'city you chose', network: 'approximate, from your IP address', default: 'default (Redmond, WA)' }[loc.source] || 'approximate'),
          ui.button('show on map', () => os.launch('maps', { lat: loc.lat, lon: loc.lon, label: loc.city })));
      } catch (e) { out.replaceChildren(ui.desc('Couldn’t find your location: ' + e.message)); }
    };
    const choose = ui.button('choose a city', async () => {
      const q = await ui.prompt('Type a city name', '', 'my location');
      if (!q) return;
      let results = [];
      try { results = await os.net.geocode(q); } catch {}
      if (!results.length) { ui.alert('No places found for “' + q + '”.'); return; }
      const pick = await ui.pickFromList({ title: 'choose a city', options: results.map((r, i) => ({ value: i, label: [r.name, r.admin1, r.country].filter(Boolean).join(', ') })) });
      if (pick === undefined) return;
      const r = results[pick];
      await S.set('customLocation', { lat: r.lat, lon: r.lon, city: r.name, country: r.country, countryCode: r.countryCode });
      show();
    });
    const auto = ui.button('use automatic', async () => { await S.set('customLocation', null); show(); });
    c.append(t.el, modeLabel, el('div', choose, auto), out);
    show();
  });

  const batteryPage = sub('battery saver', async (c, { offs }) => {
    const big = el('div.settings-battery');
    let bat = null;
    try { bat = await navigator.getBattery?.(); } catch {}
    const draw = () => {
      const b = os.device.battery;
      const pct = Math.round((b.level ?? 1) * 100);
      let est = '';
      if (bat && b.supported) {
        if (b.charging && isFinite(bat.chargingTime) && bat.chargingTime > 0) est = `fully charged in ${U.formatDuration(bat.chargingTime).replace(/:\d\d$/, '')} h`;
        else if (!b.charging && isFinite(bat.dischargingTime)) est = `about ${Math.round(bat.dischargingTime / 3600)} hours remaining`;
      }
      big.replaceChildren(
        el('div.settings-battery-pct', pct + '%'),
        el('div.settings-battery-bar', el('div', { style: { width: pct + '%' } })),
        el('div.settings-battery-sub', b.supported ? (b.charging ? 'charging' : 'on battery') + (est ? ' · ' + est : '') : 'Your browser doesn’t report the battery level.'));
    };
    draw();
    offs.push(os.device.on('battery', draw));
    const saver = bindToggle(offs, 'batterySaver', 'Battery Saver', 'Pauses simulated texts, emails and calls, refreshes live tiles less often and dims the screen a little. Apps, alarms, music and notifications keep working.');
    // The Battery Saver app owns the automatic switch-on (its background service); share its settings.
    const batStore = os.storage('battery');
    const pctLow = Math.round((await batStore.get('threshold', 0.2)) * 100);
    const auto = ui.checkbox({ label: `Turn on automatically if my battery falls below ${pctLow}%`, checked: await batStore.get('auto', true), onChange: (v) => batStore.set('auto', v) });
    c.append(big, saver.el, auto, el('div.settings-gap'), link('battery use', 'see which apps use the most battery', () => os.launch('battery')));
  });

  const storagePage = sub('storage sense', async (c) => {
    c.append(ui.loadingDots({ inline: true }));
    let u = { total: 0 }, est = { usage: 0, quota: 0 }, persisted = false;
    try { u = await os.fs.usage(); } catch {}
    try { est = await os.device.storageEstimate(); } catch {}
    try { persisted = await navigator.storage?.persisted?.(); } catch {}
    const cats = [
      ['pictures', 'Photos'], ['music', 'Music'], ['videos', 'Videos'], ['documents', 'Documents'], ['other', 'Other files'],
    ];
    const quota = est.quota || 0;
    const appsData = Math.max(0, (est.usage || 0) - (u.total || 0));
    const used = est.usage || u.total || 0;
    // Composition bar: share of what's used (a browser quota is often hundreds of GB, which would make the bar invisible)
    const base = Math.max(1, (u.total || 0) + appsData);
    const bar = el('div.settings-store-bar', ...cats.map(([k], i) => el('div', { style: { width: ((u[k] || 0) / base) * 100 + '%', opacity: 1 - i * 0.15 } })),
      el('div.settings-store-apps', { style: { width: (appsData / base) * 100 + '%' } }));
    const pt = ui.toggle({
      label: 'Keep my data', value: !!persisted,
      description: 'Ask the browser to keep this phone’s storage even when your device is low on space.',
      onChange: async (v) => {
        if (!v) { pt.set(true); return ui.alert('Once storage is persistent, the browser decides when to release it.', 'storage'); }
        const ok = await os.device.persistStorage().catch(() => false);
        pt.set(!!ok);
        if (!ok) ui.alert('The browser didn’t grant persistent storage. Installing the site or bookmarking it can help.', 'storage');
      },
    });
    c.replaceChildren(
      el('div.settings-store-head', el('div.settings-store-name', 'phone'), el('div.settings-store-free', quota ? `${sizeOf(Math.max(0, quota - used))} free of ${sizeOf(quota)}` : `${sizeOf(used)} used`)),
      bar,
      ...cats.map(([k, label], i) => el('div.settings-store-row', el('span', el('i.settings-swatch', { style: { opacity: 1 - i * 0.15 } }), label), el('span.subtle', sizeOf(u[k])))),
      el('div.settings-store-row', el('span', el('i.settings-swatch.apps'), 'Apps & system data'), el('span.subtle', sizeOf(appsData))),
      el('div.settings-store-row.total', el('span', 'Total used'), el('span', sizeOf(used))),
      el('div.settings-gap'),
      pt.el,
      link('manage storage', 'browse and clean up files by category', () => os.launch('storage')),
      link('files', 'open File Explorer', () => os.launch('files')));
  });

  const dateTimePage = sub('date+time', async (c, { offs }) => {
    const h24 = bindToggle(offs, 'h24', '24-hour clock');
    const now = el('div.settings-clock');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = -new Date().getTimezoneOffset();
    const offStr = `UTC${off >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
    const tick = () => {
      const d = new Date();
      now.replaceChildren(el('div.settings-clock-time', d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: !S.get('h24') })),
        el('div.settings-clock-date', d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })));
    };
    tick();
    const iv = setInterval(tick, 1000);
    offs.push(() => clearInterval(iv));
    const auto = ui.toggle({ label: 'Set automatically', value: true, description: 'Date and time come from your device.', disabled: true });
    c.append(now, h24.el, auto.el, info('Time zone', `(${offStr}) ${tz.replace(/_/g, ' ')}`));
  });

  const regionPage = sub('region', async (c, { offs }) => {
    const units = ui.listPicker({ label: 'Units', value: S.get('units'), options: [{ value: 'metric', label: 'metric (°C, km)' }, { value: 'imperial', label: 'imperial (°F, mi)' }], onChange: (v) => S.set('units', v) });
    offs.push(S.on('change:units', (v) => (units.value = v)));
    const loc = new Intl.NumberFormat().resolvedOptions().locale;
    let region = loc;
    try { region = new Intl.DisplayNames([loc], { type: 'region' }).of(loc.split('-')[1] || '') || loc; } catch {}
    const d = new Date();
    c.append(units, ui.header('regional format'), info('Locale', loc), info('Country/region', region), info('Browser languages', (navigator.languages || [navigator.language]).join(', ')),
      info('Short date', d.toLocaleDateString()), info('Long date', d.toLocaleDateString([], { dateStyle: 'full' })), info('Number', (1234567.89).toLocaleString()),
      ui.desc('Regional format follows your browser’s language settings.'));
  });

  const displayPage = sub('display', async (c, { offs }) => {
    const pct = el('div.settings-big-value');
    const setPct = (v) => (pct.textContent = Math.round(v * 100) + '%');
    const v0 = S.get('brightness') || 1;
    setPct(v0);
    const sl = ui.slider({ min: 0.3, max: 1, step: 0.05, value: v0, onInput: (v) => { setPct(v); S.set('brightness', v); } });
    sl.classList.add('no-swipe');
    offs.push(S.on('change:brightness', (v) => { if (Number(sl.value) !== v) { sl.value = v; sl.dispatchEvent(new Event('input')); } }));
    c.append(el('div.wp-field-label', 'Brightness'), pct, sl, ui.desc('Lower the brightness to save battery. Battery Saver dims the screen too.'),
      el('div', ['low', 'medium', 'high'].map((l, i) => ui.button(l, () => { const v = [0.4, 0.7, 1][i]; sl.value = v; sl.dispatchEvent(new Event('input')); }))));
  });

  const easePage = sub('ease of access', async (c, { offs }) => {
    const val = el('div.settings-big-value');
    const sample = el('div.settings-ease-sample', 'This is how text looks in messages, email and other apps.');
    const set = (v) => { val.textContent = Math.round(v * 100) + '%'; sample.style.fontSize = `calc(var(--fs-medium) * ${v})`; };
    const v0 = S.get('fontScale') || 1;
    set(v0);
    const sl = ui.slider({ min: 0.9, max: 1.3, step: 0.05, value: v0, onInput: set, onChange: (v) => S.set('fontScale', v) });
    sl.classList.add('no-swipe');
    offs.push(S.on('change:fontScale', (v) => { sl.value = v; set(v); }));
    c.append(el('div.wp-field-label', 'Text size'), val, sl, sample, ui.button('reset', () => { sl.value = 1; set(1); S.set('fontScale', 1); }),
      ui.header('more'), ui.desc('Cortana can read text aloud and listen to you — tap the microphone in Cortana.'),
      link('Cortana', 'speech and voice commands', () => os.launch('cortana')));
  });

  const notifPage = sub('notifications+actions', async (c, { offs }) => {
    const grid = el('div.settings-quick');
    const draw = () => {
      const q = [...(S.get('quickActions') || [])].slice(0, 4);
      while (q.length < 4) q.push(null);
      grid.replaceChildren(...q.map((k, i) => el('div.settings-quick-cell.tilt' + (k ? '' : '.empty'), {
        onclick: async () => {
          const v = await ui.pickFromList({ title: 'choose quick action', value: k, options: Object.entries(QUICK).map(([key, d]) => ({ value: key, label: d.label })) });
          if (!v) return;
          const cur = [...(S.get('quickActions') || [])].slice(0, 4);
          while (cur.length < 4) cur.push(null);
          const j = cur.indexOf(v);
          if (j >= 0) cur[j] = cur[i];
          cur[i] = v;
          await S.set('quickActions', cur.filter(Boolean));
        },
      }, k ? el('span', { html: ui.iconSVG(QUICK[k]?.icon, { size: 26 }) }) : null, el('span.settings-quick-label', k ? QUICK[k]?.label || k : 'empty'))));
    };
    draw();
    offs.push(S.on('change:quickActions', draw));
    const counts = new Map();
    for (const n of os.notifications.items) if (n.appId) counts.set(n.appId, (counts.get(n.appId) || 0) + 1);
    const apps = os.apps.list().filter((m) => !m.external);
    c.append(ui.header('quick actions'), ui.desc('Choose the quick actions shown at the top of Action Center. Tap one to change it.'), grid,
      ui.header('notifications'),
      bindToggle(offs, 'simActivity', 'Simulated friends', 'Your (fictional) contacts text, email and call you now and then, so the phone feels alive.').el,
      el('div', ui.button('clear action center', () => { os.notifications.clear(); os.toast('Action Center cleared'); draw2(); })),
      ui.desc('Apps that have sent notifications recently:'));
    const lst = el('div');
    const draw2 = () => {
      counts.clear();
      for (const n of os.notifications.items) if (n.appId) counts.set(n.appId, (counts.get(n.appId) || 0) + 1);
      const shown = apps.filter((m) => counts.has(m.id)).sort((a, b) => counts.get(b.id) - counts.get(a.id));
      lst.replaceChildren(shown.length ? ui.list(shown, { render: (m) => appRow(m, `${counts.get(m.id)} in Action Center`), onClick: (m) => os.launch(m.id) }) : ui.empty('no notifications'));
    };
    draw2();
    c.append(lst);
  });

  const aboutPage = sub('about', async (c, { offs }) => {
    const body = el('div');
    const draw = async () => {
      const est = await os.device.storageEstimate().catch(() => ({}));
      const vp = ctx.root.getBoundingClientRect();
      body.replaceChildren(
        el('div.settings-about-name.tilt', {
          onclick: async () => {
            const v = await ui.prompt('Your phone shows this name to other devices.', S.get('deviceName'), 'phone name');
            if (v != null && v.trim()) { await S.set('deviceName', v.trim().slice(0, 40)); draw(); }
          },
        }, el('div.wp-field-label', 'Phone name (tap to edit)'), el('div.settings-about-big', S.get('deviceName'))),
        el('div.settings-about-name.tilt', {
          onclick: async () => {
            const v = await ui.prompt('What’s your name? Cortana and the lock screen use it.', S.get('ownerName'), 'owner');
            if (v != null && v.trim()) { await S.set('ownerName', v.trim().slice(0, 40)); draw(); }
          },
        }, el('div.wp-field-label', 'Owner (tap to edit)'), el('div.settings-about-big', S.get('ownerName'))),
        ui.header('more info'),
        info('Model', 'Lumia Web (RM-' + (920 + (screen.width % 80)) + ')'),
        info('Software', 'Windows Phone 8.1 Update'),
        info('OS version', os.version),
        info('Screen', `${screen.width} × ${screen.height} @ ${window.devicePixelRatio || 1}x · viewport ${Math.round(vp.width)} × ${Math.round(vp.height)}`),
        navigator.hardwareConcurrency ? info('Processor', `${navigator.hardwareConcurrency} cores`) : null,
        navigator.deviceMemory ? info('RAM', `${navigator.deviceMemory} GB`) : null,
        est.quota ? info('Storage', `${sizeOf(est.usage)} used of ${sizeOf(est.quota)}`) : null,
        info('Language', navigator.language),
        info('User agent', navigator.userAgent),
        ui.header('reset'),
        ui.desc('Restore your phone to factory settings. All apps, settings, photos, music, documents and other content will be erased.'),
        ui.button('reset your phone', resetPhone));
    };
    await draw();
    offs.push(S.on('change:deviceName', draw));
    c.append(body);
  });

  async function resetPhone() {
    if (!(await ui.confirm('This will erase all your content and settings and restore your phone to factory settings. Do you want to continue?', 'reset your phone', 'yes', 'no'))) return;
    if (!(await ui.confirm('Are you sure? This can’t be undone.', 'Last warning', 'reset', 'cancel'))) return;
    const overlay = el('div.settings-resetting', el('div.settings-resetting-gear', { html: ui.iconSVG(I.settings, { size: 64, stroke: 1.4 }) }), el('div', 'resetting…'));
    document.getElementById('overlay-layer')?.append(overlay);
    try { speechSynthesis?.cancel(); os.media.stop?.(); } catch {}
    // Clear every store through a fresh connection (works even while the OS keeps its own connection open),
    // then request deletion of the whole database and reload.
    try {
      await new Promise((res) => {
        const req = indexedDB.open('wphone');
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          if (!names.length) { db.close(); return res(); }
          const t = db.transaction(names, 'readwrite');
          names.forEach((n) => t.objectStore(n).clear());
          t.oncomplete = t.onerror = t.onabort = () => { db.close(); res(); };
        };
        req.onerror = () => res();
      });
    } catch {}
    await new Promise((res) => {
      try {
        const del = indexedDB.deleteDatabase('wphone');
        del.onsuccess = del.onerror = () => res();
        del.onblocked = () => setTimeout(res, 300);
      } catch { res(); }
      setTimeout(res, 2000);
    });
    try { const keys = await caches?.keys(); await Promise.all((keys || []).map((k) => caches.delete(k))); } catch {}
    await U.sleep(600);
    location.reload();
  }

  const updatePage = sub('phone update', async (c) => {
    const status = el('div.settings-update');
    const draw = async (checking) => {
      const last = await storage.get('lastUpdateCheck', null);
      status.replaceChildren(
        checking ? el('div', el('div.settings-update-title', 'Checking for updates…'), ui.loadingDots({ inline: true }))
          : el('div.settings-update-title', 'Your phone is up to date.'),
        el('div.subtle', 'Current version: ' + os.version),
        last ? el('div.subtle', 'Last checked: ' + new Date(last).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : null);
    };
    await draw(false);
    const autoDl = ui.checkbox({ label: 'Automatically download updates if my data settings allow it', checked: await storage.get('autoUpdate', true), onChange: (v) => storage.set('autoUpdate', v) });
    const btn = ui.button('check for updates', async () => {
      btn.disabled = true;
      await draw(true);
      await U.sleep(1800 + Math.random() * 1200);
      await storage.set('lastUpdateCheck', Date.now());
      await draw(false);
      btn.disabled = false;
    });
    c.append(status, btn, autoDl);
  });

  const kidsPage = sub('kid’s corner', async (c) => {
    c.append(el('div.settings-kids', { html: ui.iconSVG(Baby, { size: 72, stroke: 1.2 }) }),
      el('p', 'Kid’s Corner is a place on your phone where kids can play only the games, music, videos and apps you choose.'),
      ui.desc('Kid’s Corner isn’t available on this phone because the simulator runs as a single user. Use your browser’s own profiles or parental controls instead.'),
      ui.toggle({ label: 'Kid’s Corner', value: false, disabled: true }).el);
  });

  /* ---------------------------------------------------------------- applications */

  const appIcon = (m, size = 26) => el('div.settings-app-icon', { style: { background: m.color || 'var(--accent)' }, html: ui.iconSVG(m.icon, { size, stroke: 1.6 }) });
  const appRow = (m, subtitle) => el('div.wp-row', appIcon(m), el('div.wp-row-text', el('div.wp-row-title', m.name), subtitle ? el('div.wp-row-sub', subtitle) : null));

  function appInfoPage(page) {
    const m = os.apps.get(page.params.id);
    const p = ui.page({ app: APP, title: m.name.toLowerCase(), cls: 'settings-page' });
    const draw = () => {
      const installed = os.apps.isInstalled(m.id);
      const pinned = os.tiles.isPinned(m.id);
      p.content.replaceChildren(
        el('div.settings-appinfo', appIcon(m, 48), el('div', el('div.settings-appinfo-name', m.name), el('div.subtle', m.publisher || 'Unknown publisher'))),
        info('Version', m.version || '1.0.0.0'),
        info('Type', m.category === 'game' ? 'game' : m.category === 'system' ? 'system app' : 'app'),
        m.size ? info('Size', m.size) : null,
        m.description ? info('Description', m.description) : null,
        el('div.settings-gap'),
        installed ? ui.button('open', () => os.launch(m.id)) : null,
        installed ? ui.button(pinned ? 'unpin from start' : 'pin to start', async () => { pinned ? await os.tiles.unpin(m.id) : await os.tiles.pin(m.id, { size: m.pin?.size || 'medium' }); draw(); }) : null,
        installed && m.category !== 'system' && m.removable !== false ? ui.button('uninstall', async () => {
          if (!(await ui.confirm(`Uninstall ${m.name}? Its data stays on the phone until you reset.`, 'uninstall', 'uninstall', 'cancel'))) return;
          try { await os.apps.uninstall(m.id); os.toast(m.name + ' uninstalled'); page.close(); } catch (e) { ui.alert(e.message); }
        }) : null,
        os.apps.get('store') ? ui.button('view in store', () => os.launch('store', { app: m.id })) : null,
        m.category === 'system' ? ui.desc('This is a system app and can’t be uninstalled.') : null);
    };
    draw();
    page.el.append(p.el);
  }

  const bgTasksPage = sub('background tasks', async (c) => {
    const draw = () => {
      const run = os.apps.running().map((id) => os.apps.get(id)).filter(Boolean);
      c.replaceChildren(
        ui.desc('Apps can run tasks in the background, like ringing alarms, checking reminders or playing music. Battery Saver limits background activity.'),
        info('Battery Saver', onOff(S.get('batterySaver'))),
        ui.header('open apps'),
        run.length ? ui.list(run, { render: (m) => appRow(m, 'suspended in the background'), onClick: (m) => os.launch(m.id) }) : ui.empty('no apps running'),
        os.media.current ? el('div', ui.header('playing audio'), info(os.media.current.title || 'Unknown', os.media.current.artist || '')) : null,
        ui.header('scheduled'),
        ui.desc('Alarms, Cortana reminders and calendar notifications run on schedule, even when their apps are closed.'));
    };
    draw();
  });

  /* ---------------------------------------------------------------- home */

  const SYSTEM = [
    { id: 'start', title: 'start+theme', icon: Palette, sub: () => `${S.get('theme')} · ${accentName()}`, page: startTheme },
    { id: 'notifications', title: 'notifications+actions', icon: LayoutGrid, sub: () => (S.get('quickActions') || []).slice(0, 4).map((k) => QUICK[k]?.label || k).join(', '), page: notifPage },
    { id: 'ringtones', title: 'ringtones+sounds', icon: BellRing, sub: () => S.get('ringtone'), page: ringtones },
    { id: 'lock', title: 'lock screen', icon: LockKeyhole, sub: () => { const w = S.get('lockWallpaper'); return (w === 'bing' ? 'Bing' : w === 'accent' ? 'accent color' : 'photo') + (S.get('lockPin') ? ' · password' : ''); }, page: lockScreen },
    { id: 'airplane', title: 'airplane mode', icon: Plane, sub: () => onOff(S.get('airplane')), page: airplanePage },
    { id: 'wifi', title: 'Wi-Fi', icon: Wifi, sub: () => (S.get('wifi') ? (navigator.onLine ? 'connected' : 'on, not connected') : 'off'), page: wifiPage },
    { id: 'bluetooth', title: 'bluetooth', icon: Bluetooth, sub: () => onOff(S.get('bluetooth')), page: bluetoothPage },
    { id: 'cellular', title: 'cellular+SIM', icon: Signal, sub: () => (S.get('cellular') ? 'data on' : 'data off'), page: cellularPage },
    { id: 'location', title: 'location', icon: MapPin, sub: () => onOff(S.get('location')), page: locationPage },
    { id: 'battery', title: 'battery saver', icon: BatteryCharging, sub: () => { const b = os.device.battery; return (b.supported ? Math.round(b.level * 100) + '% · ' : '') + (S.get('batterySaver') ? 'on' : 'off'); }, page: batteryPage },
    { id: 'storage', title: 'storage sense', icon: HardDrive, sub: () => 'see what’s using space', page: storagePage },
    { id: 'datetime', title: 'date+time', icon: Clock, sub: () => (S.get('h24') ? '24-hour clock' : '12-hour clock') + ' · ' + Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' '), page: dateTimePage },
    { id: 'region', title: 'region', icon: Globe, sub: () => (S.get('units') === 'imperial' ? 'imperial units' : 'metric units'), page: regionPage },
    { id: 'display', title: 'display', icon: Monitor, sub: () => 'brightness ' + Math.round((S.get('brightness') || 1) * 100) + '%', page: displayPage },
    { id: 'ease', title: 'ease of access', icon: Accessibility, sub: () => 'text size ' + Math.round((S.get('fontScale') || 1) * 100) + '%', page: easePage },
    { id: 'kids', title: 'kid’s corner', icon: Baby, sub: () => 'not available', page: kidsPage },
    { id: 'update', title: 'phone update', icon: RefreshCw, sub: () => 'your phone is up to date', page: updatePage },
    { id: 'about', title: 'about', icon: Info, sub: () => S.get('deviceName') + ' · ' + os.version, page: aboutPage },
  ];
  const APPS = [
    { id: 'bgtasks', title: 'background tasks', icon: Cpu, sub: () => 'see what runs in the background', page: bgTasksPage },
    { id: 'store-link', title: 'store', sub: () => 'app updates, downloads', run: () => os.launch('store', { updates: true }) },
    { id: 'cortana-link', title: 'Cortana', sub: () => 'speech, notebook, reminders', run: () => os.launch('cortana', { notebook: true }) },
  ];
  const ALL = [...SYSTEM, ...APPS];

  let homeOffs = [];
  function home(page) {
    const renderSys = (cont) => {
      const lst = el('div.settings-list');
      const draw = () => lst.replaceChildren(...SYSTEM.map((it) => el('div.settings-item.tilt', { onclick: () => open(it) },
        el('div.settings-item-title', it.title), el('div.settings-item-sub', safe(it.sub)))));
      draw();
      homeOffs.push(S.on('change', draw), os.device.on('battery', draw));
      cont.append(lst);
    };
    const renderApps = (cont) => {
      const top = el('div.settings-list', ...APPS.map((it) => el('div.settings-item.tilt', { onclick: () => open(it) },
        el('div.settings-item-title', it.title), el('div.settings-item-sub', safe(it.sub)))));
      const lst = el('div');
      const draw = () => {
        const apps = os.apps.list().filter((m) => m.id !== 'settings');
        lst.replaceChildren(ui.header(`installed apps (${apps.length})`), ui.list(apps, {
          render: (m) => appRow(m, m.category === 'system' ? 'system' : m.category === 'game' ? 'game' : m.publisher || 'app'),
          onClick: (m) => ctx.navigate(appInfoPage, { id: m.id }),
          onHold: (m, row) => ui.contextMenu(row, [
            { label: 'open', onClick: () => os.launch(m.id) },
            { label: 'pin to start', disabled: os.tiles.isPinned(m.id), onClick: () => os.tiles.pin(m.id, { size: m.pin?.size || 'medium' }) },
            { label: 'uninstall', disabled: m.category === 'system' || m.removable === false, onClick: async () => {
              if (await ui.confirm(`Uninstall ${m.name}?`, 'uninstall', 'uninstall', 'cancel')) { try { await os.apps.uninstall(m.id); } catch (e) { ui.alert(e.message); } }
            } },
          ]),
        }));
      };
      draw();
      homeOffs.push(os.apps.on('installed', draw), os.apps.on('uninstalled', draw));
      cont.append(top, lst);
    };
    const pv = ui.pivot({ app: APP, items: [{ header: 'system', render: renderSys }, { header: 'applications', render: renderApps }] });
    page.el.append(pv.el);
    return { onDestroy: () => homeOffs.forEach((f) => f()) };
  }
  function safe(fn) { try { return fn() || ''; } catch { return ''; } }
  function open(it) {
    if (it.run) return it.run();
    ctx.navigate(it.page);
  }
  function openByArgs(a) {
    if (!a) return;
    const key = a.page || a.section;
    if (!key) return;
    const it = ALL.find((x) => x.id === key || x.title === key);
    if (it) open(it);
  }

  await ctx.navigate(home);
  openByArgs(ctx.args);
  ctx.on('args', openByArgs);
}
