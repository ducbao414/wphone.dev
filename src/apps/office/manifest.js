// Office Mobile hub (Word + Excel + plain text). Icon: the 2013-era Office "door" mark.
const officeIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.2 2 4 5.6v12.8L14.2 22 20 20.3V3.7L14.2 2Zm0 2.3v15.4L6.4 17.8l7.8 1.1V5.1L8.8 6.9v9.6l-2.4.9V6.6l7.8-2.3Z"/></svg>';

export default {
  id: 'office',
  name: 'Office',
  icon: officeIcon,
  color: '#D24726',
  category: 'system',
  preinstalled: true,
  pin: { size: 'small', order: 17 },
  handles: ['.wdoc', '.wxls', '.txt', '.md', '.csv', 'text/plain', 'text/markdown', 'text/csv'],
  publisher: 'Microsoft Corporation',
  description: 'Office Mobile: create and edit Word documents, Excel spreadsheets and text files on your phone.',
  rating: 4.3,
  size: '24 MB',
  keywords: ['word', 'excel', 'office', 'documents', 'spreadsheet', 'csv', 'text'],
};
