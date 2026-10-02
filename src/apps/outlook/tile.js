// Outlook live tile: unread inbox count + latest unread senders/subjects.
import { loadMail, tileData } from './store.js';

export default {
  interval: 15 * 60e3,
  async update(os) {
    const mail = await loadMail(os.storage('outlook'));
    return tileData(mail, os.util.esc);
  },
};
