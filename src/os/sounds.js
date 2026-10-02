// Synthesized system sounds (no audio assets needed). Ringtones are note sequences played via WebAudio.
import { settings } from './settings.js';

let ctx;
const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
// Unlock audio on first gesture (mobile autoplay policy)
const unlock = () => { ac().resume?.(); window.removeEventListener('pointerdown', unlock); };
window.addEventListener('pointerdown', unlock);

const NOTE = (n) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  const base = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((base + (Number(m[3]) - 4) * 12) / 12);
};

// [note|null, beats]
export const RINGTONES = {
  'Nokia Tune': { bpm: 180, wave: 'triangle', seq: [['E5', .5], ['D5', .5], ['F#4', 1], ['G#4', 1], ['C#5', .5], ['B4', .5], ['D4', 1], ['E4', 1], ['B4', .5], ['A4', .5], ['C#4', 1], ['E4', 1], ['A4', 3]] },
  'Lumia Calling': { bpm: 140, wave: 'sine', seq: [['E5', .5], ['G5', .5], ['B5', 1], ['A5', .5], ['G5', .5], ['E5', 1], [null, .5], ['D5', .5], ['E5', .5], ['G5', 1.5]] },
  'Xylophone': { bpm: 200, wave: 'sine', seq: [['C6', .5], ['E6', .5], ['G6', 1]] },
  'Windows Ding': { bpm: 120, wave: 'sine', seq: [['G5', .5], ['C6', 1.5]] },
  'Chimes': { bpm: 160, wave: 'sine', seq: [['E6', .5], ['C6', .5], ['D6', .5], ['G5', 1.5], [null, .5], ['G5', .5], ['D6', .5], ['E6', .5], ['C6', 1.5]] },
  'Digital': { bpm: 240, wave: 'square', seq: [['A5', .5], [null, .25], ['A5', .5], [null, .25], ['A5', .5], [null, 1]] },
  'Beacon': { bpm: 100, wave: 'sine', seq: [['C5', .5], ['G5', .5], ['C6', 1]] },
  'Alarm Classic': { bpm: 300, wave: 'square', seq: [['C6', .5], [null, .25], ['C6', .5], [null, .25], ['C6', .5], [null, .25], ['C6', .5], [null, 1.5]] },
};

/** Play a ringtone by name once. Returns a promise resolving when done, with .stop(). */
export function playTone(name, { volume = 0.25, loop = false } = {}) {
  const t = RINGTONES[name] || RINGTONES['Nokia Tune'];
  const a = ac();
  const gain = a.createGain();
  gain.gain.value = volume;
  gain.connect(a.destination);
  let stopped = false, timer;
  const beat = 60 / t.bpm;
  const total = t.seq.reduce((s, [, b]) => s + b, 0) * beat;
  const once = () => {
    let at = a.currentTime + 0.05;
    for (const [n, b] of t.seq) {
      if (n) {
        const o = a.createOscillator(), g = a.createGain();
        o.type = t.wave; o.frequency.value = NOTE(n);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(1, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, at + b * beat * 0.95);
        o.connect(g).connect(gain);
        o.start(at); o.stop(at + b * beat);
      }
      at += b * beat;
    }
  };
  const p = new Promise((res) => {
    const run = () => {
      if (stopped) return res();
      once();
      timer = setTimeout(loop ? run : () => { gain.disconnect(); res(); }, total * 1000 + (loop ? 600 : 50));
    };
    run();
  });
  p.stop = () => { stopped = true; clearTimeout(timer); try { gain.disconnect(); } catch {} };
  return p;
}

function blip(freq, dur = 0.05, type = 'sine', vol = 0.08) {
  if (!settings.get('sounds')) return;
  const a = ac(), o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}

export const sounds = {
  tap: () => blip(1800, 0.02, 'sine', 0.03),
  key: () => blip(1200, 0.03, 'triangle', 0.05),
  lock: () => { blip(500, 0.06, 'square', 0.04); },
  unlock: () => { blip(700, 0.04, 'sine', 0.06); setTimeout(() => blip(1100, 0.06, 'sine', 0.06), 50); },
  shutter: () => {
    if (!settings.get('sounds')) return;
    const a = ac(), len = a.sampleRate * 0.08, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const s = a.createBufferSource(), g = a.createGain(); g.gain.value = 0.3;
    s.buffer = buf; s.connect(g).connect(a.destination); s.start();
  },
  notify: () => { if (settings.get('sounds')) playTone(settings.get('notificationSound'), { volume: 0.15 }); },
  error: () => blip(220, 0.2, 'sawtooth', 0.05),
  ringtones: Object.keys(RINGTONES),
  play: playTone,
};
