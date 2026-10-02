// Global background media player (keeps playing when the app that started it is closed).
// Shown on the lock screen and in the volume flyout; integrated with the browser Media Session API.
import { Emitter } from './util.js';
import { fs } from './fs.js';

class Media extends Emitter {
  audio = new Audio();
  queue = [];     // [{ path?, src?, title, artist, album, art, appId, live? }]
  index = -1;
  shuffle = false;
  repeat = 'none'; // 'none' | 'all' | 'one'

  constructor() {
    super();
    this.audio.preload = 'metadata';
    const a = this.audio;
    a.addEventListener('play', () => this.emit('change'));
    a.addEventListener('pause', () => this.emit('change'));
    a.addEventListener('timeupdate', () => this.emit('time', a.currentTime, a.duration));
    a.addEventListener('ended', () => this.#ended());
    a.addEventListener('error', () => this.emit('error', a.error));
    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => this.play());
      ms.setActionHandler('pause', () => this.pause());
      ms.setActionHandler('previoustrack', () => this.prev());
      ms.setActionHandler('nexttrack', () => this.next());
    }
  }

  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.audio.paused && !!this.current; }

  /** Replace the queue and start playing at startIndex. */
  async playQueue(list, startIndex = 0) {
    this.queue = list.slice();
    await this.#load(startIndex);
    return this.play();
  }
  /** Play a single item (e.g. a radio stream: { src, title, artist, live: true }). */
  playOne(item) { return this.playQueue([item], 0); }
  enqueue(item) { this.queue.push(item); this.emit('change'); }

  async #load(i) {
    this.index = i;
    const t = this.current;
    if (!t) return;
    this.audio.src = t.src || (await fs.url(t.path));
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || 'Unknown', artist: t.artist || '', album: t.album || '', artwork: t.art ? [{ src: t.art }] : [] });
    }
    this.emit('track', t);
    this.emit('change');
  }

  play() { return this.audio.play().catch((e) => this.emit('error', e)); }
  pause() { this.audio.pause(); }
  toggle() { return this.audio.paused ? this.play() : this.pause(); }
  stop() { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.queue = []; this.index = -1; this.emit('track', null); this.emit('change'); }
  seek(t) { if (isFinite(t)) this.audio.currentTime = t; }
  setVolume(v) { this.audio.volume = Math.max(0, Math.min(1, v)); this.emit('volume', this.audio.volume); }
  get volume() { return this.audio.volume; }

  async next(auto = false) {
    if (!this.queue.length) return;
    let i;
    if (this.shuffle) i = Math.floor(Math.random() * this.queue.length);
    else i = this.index + 1;
    if (i >= this.queue.length) { if (this.repeat === 'all' || !auto) i = 0; else { this.pause(); return; } }
    await this.#load(i);
    this.play();
  }
  async prev() {
    if (this.audio.currentTime > 4) return this.seek(0);
    await this.#load((this.index - 1 + this.queue.length) % this.queue.length);
    this.play();
  }
  #ended() {
    if (this.repeat === 'one') { this.seek(0); this.play(); return; }
    this.next(true);
  }
}

export const media = new Media();
