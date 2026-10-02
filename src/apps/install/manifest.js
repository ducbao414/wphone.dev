// "Install" tile: an action tile (no app window). Tapping it opens the browser's install dialog or shows instructions.
import { Download } from 'lucide';

export default {
  id: 'install',
  name: 'Add to Home',
  icon: Download,
  category: 'system',
  pin: { size: 'small', order: 21 },
  description: 'Install this phone on your real device’s home screen so it opens full screen.',
  keywords: ['install', 'home screen', 'pwa', 'app'],
  // Runs synchronously on tap (inside the user gesture the browser requires for its install prompt).
  action: (os) => os.install.prompt(os),
};
