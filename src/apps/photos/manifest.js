import { Images } from 'lucide';

export default {
  id: 'photos',
  name: 'Photos',
  icon: Images,
  category: 'system',
  preinstalled: true,
  pin: { size: 'wide', order: 6 },
  handles: ['image/*'],
  publisher: 'Microsoft Corporation',
  description: 'All your pictures and camera roll videos in one place: albums, timeline, favorites, editing and slideshows.',
  keywords: ['pictures', 'gallery', 'camera roll', 'album'],
};
