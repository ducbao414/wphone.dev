// Seeds sample contacts at boot so other apps (Phone, Messaging, Cortana...) have data on first run.
import { ensureSeeded } from './lib.js';

export default function start(os) {
  ensureSeeded(os).then(() => os.tiles.refresh('people')).catch((e) => console.warn('people seed', e));
}
