// Settings background agent: Battery Saver "turn on automatically when low" and "until next charge".
export default function start(os, { storage }) {
  let busy = false;
  const check = async () => {
    if (busy) return;
    busy = true;
    try {
      const b = os.device.battery;
      if (!b?.supported) return;
      const saver = os.settings.get('batterySaver');
      if (!b.charging && b.level <= 0.2 && !saver && (await storage.get('autoSaver', true))) {
        // Don't re-enable after the user turned it off manually during this discharge cycle
        if (await storage.get('saverDismissed', false)) return;
        await storage.set('saverAuto', true);
        await os.settings.set('batterySaver', true);
        os.notify({ appId: 'settings', title: 'Battery Saver', body: `is on — ${Math.round(b.level * 100)}% battery left`, args: { page: 'battery' } });
      } else if (b.charging) {
        await storage.set('saverDismissed', false);
        if (saver && (await storage.get('saverAuto', false))) {
          await storage.set('saverAuto', false);
          await os.settings.set('batterySaver', false);
        }
      }
    } finally { busy = false; }
  };
  os.settings.on('change:batterySaver', async (v) => {
    const b = os.device.battery;
    if (!v && b?.supported && !b.charging && b.level <= 0.2) await storage.set('saverDismissed', true);
  });
  os.device.on('battery', check);
  setTimeout(check, 3000);
}
