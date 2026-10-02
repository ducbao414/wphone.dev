import { Headphones } from 'lucide';

export default {
  id: 'music',
  name: 'Music',
  icon: Headphones,
  category: 'system',
  preinstalled: true,
  pin: { size: 'medium', order: 10 },
  handles: ['audio/*'],
  publisher: 'Microsoft Corporation',
  description: 'Your music collection: artists, albums, songs and playlists, with background playback and free streaming music.',
  keywords: ['xbox music', 'songs', 'mp3', 'player', 'playlist'],
};
