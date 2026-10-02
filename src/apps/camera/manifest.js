import { Camera } from 'lucide';

export default {
  id: 'camera',
  name: 'Camera',
  icon: Camera,
  category: 'system',
  preinstalled: true,
  pin: { size: 'small', order: 7 },
  fullscreen: true,
  keepAwake: true,
  publisher: 'Microsoft Corporation',
  description: 'Take photos and record videos with lenses, timer, flash and grid lines. Saves to your Camera Roll.',
  keywords: ['photo', 'video', 'picture', 'selfie', 'lens'],
};
