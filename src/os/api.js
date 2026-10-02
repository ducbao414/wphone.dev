// The public `os` object handed to every app as ctx.os (also available as window.os for debugging).
import { kernel } from './kernel.js';
import { fs } from './fs.js';
import * as fsPath from './fs.js';
import { settings, storage } from './settings.js';
import { tiles } from './tiles.js';
import { notifications } from './notifications.js';
import { media } from './media.js';
import { device } from './device.js';
import { api as net, getJSON } from './net.js';
import { sounds } from './sounds.js';
import * as ui from './ui.js';
import * as util from './util.js';
import * as theme from './theme.js';
import { I, icon, iconSVG } from './icons.js';
import { install } from './install.js';
import { pickFile, pickSave, share, openFile, appsForFile, fileIconFor } from './pickers.js';

export const os = {
  version: '8.1.2 (web)',
  // apps
  launch: (id, args, opts) => kernel.launch(id, args, opts),
  home: () => kernel.home(),
  back: () => kernel.back(),
  apps: {
    list: (o) => kernel.list(o),
    get: (id) => kernel.get(id),
    install: (id) => kernel.install(id),
    uninstall: (id) => kernel.uninstall(id),
    isInstalled: (id) => kernel.isInstalled(id),
    running: () => kernel.running.map((i) => i.appId),
    close: (id) => kernel.close(id),
    on: (ev, fn) => kernel.on(ev, fn),
  },
  // storage
  fs, path: { join: fsPath.join, dirname: fsPath.dirname, basename: fsPath.basename, extname: fsPath.extname, normalize: fsPath.normalize, mimeOf: fsPath.mimeOf },
  settings, storage,
  // shell services
  tiles, notifications,
  notify: (o) => notifications.notify(o),
  toast: (text, appId) => notifications.toast(text, appId),
  media, device, sounds,
  net, getJSON,
  // ui
  ui, util, theme, icons: { I, icon, iconSVG },
  pick: { file: pickFile, save: pickSave },
  /** Add-to-home-screen: install.prompt(os), install.installed, install.canPrompt, install.isIOS */
  install,
  share, openFile, appsForFile, fileIconFor,
  /** Lock the phone (shows lock screen). */
  lock: () => kernel.shell?.lock?.(),
  /** True while the lock screen is showing. */
  isLocked: () => !!kernel.shell?.isLocked?.(),
};

kernel.os = os;
window.os = os;
