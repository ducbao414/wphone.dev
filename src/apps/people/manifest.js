import { Users } from 'lucide';

export default {
  id: 'people',
  name: 'People',
  icon: Users,
  category: 'system',
  preinstalled: true,
  pin: { size: 'wide', order: 4 },
  tileSizes: ['small', 'medium', 'wide'],
  handles: ['.vcf', 'text/vcard', 'text/x-vcard'],
  publisher: 'Microsoft Corporation',
  description: 'All your contacts in one place. Call, text, email, group and pin the people you care about.',
  keywords: ['contacts', 'address book', 'people', 'vcard'],
};
