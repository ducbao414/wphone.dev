import { avatarSVG } from './avatar.js';

export default {
  interval: 10 * 60e3,
  async update(os, { size }) {
    const st = os.storage('games');
    const list = await st.get('achievements', []);
    const score = list.reduce((s, a) => s + (a.gamerscore || 0), 0);
    const tag = (await st.get('gamertag', null)) || os.settings.get('ownerName') || 'Gamer';
    const esc = os.util.esc;
    const faces = [];
    if (size === 'wide') {
      faces.push({
        html: `<div style="display:flex;gap:12px;align-items:center;height:100%">
          <div style="flex:none;width:86px;height:86px">${avatarSVG(tag, { size: 86 })}</div>
          <div style="min-width:0"><div class="t-mid" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tag)}</div>
          <div class="t-big">${score}<span style="font-size:22px"> G</span></div><div class="t-sub">${list.length} achievement${list.length === 1 ? '' : 's'}</div></div></div>`,
      });
    } else {
      faces.push({ html: `<div style="height:100%;display:flex;flex-direction:column;justify-content:flex-end"><div class="t-big">${score}<span style="font-size:20px"> G</span></div><div class="t-sub">gamerscore</div></div>` });
      faces.push({ html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding-bottom:16px">${avatarSVG(tag, { size: 100, bg: false })}</div>` });
    }
    const last = [...list].sort((a, b) => b.unlocked - a.unlocked)[0];
    if (last && size !== 'small') faces.push({ html: `<div class="t-sub">latest achievement</div><div class="t-mid">${esc(last.title)}</div><div class="t-sub">${esc(last.gameName || last.game)} · ${last.gamerscore}G</div>` });
    return { faces, color: '#107C10' };
  },
};
