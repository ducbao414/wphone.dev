import { NotebookPen } from 'lucide';

export default {
  id: 'onenote',
  name: 'OneNote',
  icon: NotebookPen,
  color: '#7719AA',
  category: 'system',
  preinstalled: true,
  pin: { size: 'small', order: 16 },
  handles: ['.one'],
  shareTarget: true,
  publisher: 'Microsoft Corporation',
  description: 'Capture thoughts, checklists, pictures and voice notes. Notes sync to your phone storage.',
  keywords: ['notes', 'checklist', 'todo', 'memo'],
};
