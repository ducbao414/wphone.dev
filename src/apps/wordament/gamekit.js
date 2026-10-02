// Shared game helpers — duplicated per game app (apps must not import across folders).
// Contract with the Games hub (src/apps/games):
//   ctx.storage 'stats'              => { played, won, best, bestTime, ... }
//   os.storage('games') 'achievements' => [{ game, id, title, description, gamerscore, unlocked }]
//   os.storage('games') 'catalog:<game>' => [{ id, title, description, gamerscore }]  (all defined, for locked display)
const XBOX_GREEN = '#107C10';

export function createKit(ctx, { game, name, achievements = [] }) {
  const { os, storage, root } = ctx;
  const hub = os.storage('games');
  const defs = new Map(achievements.map((a) => [a.id, a]));
  hub.set('catalog:' + game, achievements.map(({ id, title, description, gamerscore }) => ({ id, title, description, gamerscore }))).catch(() => {});

  let audio = null;
  const ac = () => (audio ??= new (window.AudioContext || window.webkitAudioContext)());
  let toastQueue = Promise.resolve();
  let statsQueue = Promise.resolve();
  let unlockQueue = Promise.resolve();
  const tried = new Set();

  const kit = {
    /** true when this app's frame is the foreground one (gate keyboard handlers on this) */
    isActive: () => root.isConnected && !!root.closest('.app-frame.active'),

    async getStats(defaults = {}) {
      return { played: 0, won: 0, best: 0, bestTime: 0, ...defaults, ...(await storage.get('stats', {})) };
    },
    /** fn(stats) mutates or returns new stats */
    updateStats(fn, defaults = {}) {
      // serialized so concurrent updates never lose writes
      statsQueue = statsQueue.catch(() => {}).then(async () => {
        const s = await kit.getStats(defaults);
        const r = (await fn(s)) || s;
        await storage.set('stats', r);
        return r;
      });
      return statsQueue;
    },

    async unlocked() {
      return (await hub.get('achievements', [])).filter((a) => a.game === game);
    },
    /** Unlock achievement by id (must be in `achievements` defs). Shows Xbox-style toast once. */
    unlock(id) {
      const d = defs.get(id);
      if (!d || tried.has(id)) return Promise.resolve(false);
      tried.add(id); // cheap to call every frame
      unlockQueue = unlockQueue.catch(() => {}).then(async () => {
        const list = await hub.get('achievements', []);
        if (list.some((a) => a.game === game && a.id === id)) return false;
        list.push({ game, gameName: name, id, title: d.title, description: d.description || '', gamerscore: d.gamerscore || 10, unlocked: Date.now() });
        await hub.set('achievements', list);
        try { os.tiles.refresh('games')?.catch?.(() => {}); } catch { /* hub tile optional */ }
        toastQueue = toastQueue.then(() => kit.achievementToast(d));
        return true;
      });
      return unlockQueue;
    },

    /** Xbox Live "achievement unlocked" banner inside the app root. */
    achievementToast(d) {
      return new Promise((res) => {
        const n = document.createElement('div');
        n.setAttribute('style', `position:absolute;left:50%;top:14px;transform:translateX(-50%) scale(.6);opacity:0;z-index:999;
          display:flex;align-items:center;gap:10px;background:#1a1a1a;color:#fff;border-radius:30px;padding:6px 18px 6px 6px;
          box-shadow:0 4px 18px rgba(0,0,0,.5);transition:transform .35s cubic-bezier(.1,.9,.2,1),opacity .25s;pointer-events:none;
          max-width:92%;white-space:nowrap;font-family:var(--font)`);
        n.innerHTML = `<span style="flex:none;width:36px;height:36px;border-radius:50%;background:${XBOX_GREEN};display:flex;align-items:center;justify-content:center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M7 6.5c3 2 7.5 7.5 10 11M17 6.5c-3 2-7.5 7.5-10 11"/></svg></span>
          <span style="min-width:0;overflow:hidden"><span style="display:block;font-size:11px;opacity:.75">achievement unlocked</span>
          <span style="display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis">${d.gamerscore || 10}G – ${String(d.title).replace(/</g, '&lt;')}</span></span>`;
        root.append(n);
        kit.tone([523, 784, 1047], 0.09, 'sine', 0.12);
        requestAnimationFrame(() => { n.style.opacity = '1'; n.style.transform = 'translateX(-50%) scale(1)'; });
        setTimeout(() => { n.style.opacity = '0'; n.style.transform = 'translateX(-50%) translateY(-30px)'; }, 2800);
        setTimeout(() => { n.remove(); res(); }, 3200);
      });
    },

    /** Tiny synth: tone(freqs[], stepSeconds, wave, volume). Respects the 'sounds' setting. */
    tone(freqs, step = 0.08, wave = 'square', vol = 0.06) {
      if (os.settings.get('sounds') === false) return;
      try {
        const a = ac();
        if (a.state === 'suspended') a.resume();
        const arr = Array.isArray(freqs) ? freqs : [freqs];
        arr.forEach((f, i) => {
          if (!f) return;
          const o = a.createOscillator(), g = a.createGain();
          o.type = wave; o.frequency.value = f;
          const t = a.currentTime + i * step;
          g.gain.setValueAtTime(vol, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.95);
          o.connect(g).connect(a.destination);
          o.start(t); o.stop(t + step);
        });
      } catch { /* audio unavailable */ }
    },

    /** WP pause dialog. Resolves 'resume' | 'quit' | 'restart' (if offered). */
    async pauseDialog({ restart = false, title = 'paused', message = '' } = {}) {
      const buttons = restart ? ['resume', 'restart', 'quit'] : ['resume', 'quit'];
      const i = await os.ui.messageBox({ title, message, buttons });
      return i === -1 ? 'resume' : buttons[i];
    },

    /**
     * WP-style game start menu page content.
     *   kit.menu(container, { title:'minesweeper', subtitle, color, items:[{ label, sub, onClick, accent }] })
     */
    menu(container, { items = [] } = {}) {
      const { el } = os.ui;
      const box = el('div', { style: { display: 'flex', flexDirection: 'column' } });
      for (const it of items.filter(Boolean)) {
        box.append(el('div.tilt', {
          style: { padding: '8px 0', cursor: 'pointer' },
          onclick: () => { os.sounds.tap?.(); it.onClick?.(); },
        },
        el('div', { style: { fontFamily: 'var(--font-light)', fontWeight: 300, fontSize: '32px', lineHeight: 1.15, color: it.accent ? 'var(--game-color, var(--accent))' : 'var(--fg)' } }, it.label),
        it.sub ? el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--fg2)' } }, it.sub) : null));
      }
      container.append(box);
      return box;
    },

    formatTime(sec) {
      sec = Math.max(0, Math.floor(sec));
      const m = Math.floor(sec / 60), s = sec % 60;
      return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    },
  };
  return kit;
}
