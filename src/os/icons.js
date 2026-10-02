// Icon rendering. Accepts:
//  - a Lucide IconNode (import { Camera } from 'lucide')
//  - a simple-icons object (import { siFacebook } from 'simple-icons')
//  - a raw '<svg ...>' string
//  - an image URL string (http..., /..., data:...)
// Always import icons by name so the bundler can tree-shake the rest.
import {
  ArrowLeft, Search, House, Plus, Check, X, Ellipsis, Trash2, Pencil, Share2, Save, RefreshCw, Folder, File,
  FileText, Image, Music, Video, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Settings, Star, Pin, PinOff,
  Wifi, WifiOff, Bluetooth, Plane, BatteryFull, BatteryMedium, BatteryLow, BatteryCharging, Signal, Bell,
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Lock, Unlock, Sun, Moon, MapPin, Camera, Mic, Copy,
  Scissors, Clipboard, Download, Upload, Send, Smile, User, Users, Phone, Mail, MessageSquare, Calendar, Clock,
  Globe, Info, CircleAlert, RotateCw, Maximize2, Minimize2, Expand, Minus, Filter, ArrowUp, ArrowDown, ArrowRight,
} from 'lucide';

export const I = {
  back: ArrowLeft, search: Search, home: House, add: Plus, check: Check, close: X, more: Ellipsis, delete: Trash2,
  edit: Pencil, share: Share2, save: Save, refresh: RefreshCw, folder: Folder, file: File, doc: FileText,
  image: Image, music: Music, video: Video, right: ChevronRight, left: ChevronLeft, down: ChevronDown, up: ChevronUp,
  settings: Settings, star: Star, pin: Pin, unpin: PinOff, wifi: Wifi, wifiOff: WifiOff, bluetooth: Bluetooth,
  airplane: Plane, batteryFull: BatteryFull, batteryMed: BatteryMedium, batteryLow: BatteryLow, batteryCharging: BatteryCharging,
  signal: Signal, bell: Bell, play: Play, pause: Pause, prev: SkipBack, next: SkipForward, volume: Volume2, mute: VolumeX,
  lock: Lock, unlock: Unlock, sun: Sun, moon: Moon, location: MapPin, camera: Camera, mic: Mic, copy: Copy, cut: Scissors,
  paste: Clipboard, download: Download, upload: Upload, send: Send, smile: Smile, user: User, users: Users, phone: Phone,
  mail: Mail, message: MessageSquare, calendar: Calendar, clock: Clock, globe: Globe, info: Info, alert: CircleAlert,
  rotate: RotateCw, maximize: Maximize2, minimize: Minimize2, expand: Expand, minus: Minus, filter: Filter,
  arrowUp: ArrowUp, arrowDown: ArrowDown, arrowRight: ArrowRight,
};

const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');

/**
 * Render an icon to an SVG/IMG HTML string.
 * opts: { size = 24, stroke = 1.75, cls = '', color }   (size in px or any CSS length)
 */
export function iconSVG(src, { size = 24, stroke = 1.75, cls = '', color } = {}) {
  const sz = typeof size === 'number' ? size + 'px' : size;
  const style = `width:${sz};height:${sz};${color ? 'color:' + color + ';' : ''}`;
  if (!src) return '';
  if (Array.isArray(src)) {
    // Lucide IconNode: [[tag, attrs], ...]
    const inner = src.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
    return `<svg class="icon ${cls}" style="${style}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }
  if (typeof src === 'object' && src.path) {
    // simple-icons
    return `<svg class="icon brand ${cls}" style="${style}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${src.path}"/></svg>`;
  }
  if (typeof src === 'string' && src.trim().startsWith('<svg')) {
    return src.replace('<svg', `<svg class="icon ${cls}" style="${style}"`);
  }
  if (typeof src === 'string') return `<img class="icon ${cls}" style="${style};object-fit:contain" src="${src}" alt="">`;
  return '';
}

/** Same as iconSVG but returns an Element. */
export function icon(src, opts) {
  const t = document.createElement('template');
  t.innerHTML = iconSVG(src, opts);
  return t.content.firstElementChild || document.createElement('span');
}
