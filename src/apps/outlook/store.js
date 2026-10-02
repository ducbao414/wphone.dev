// Shared mailbox helpers (used by index.js and tile.js). Keep free of DOM-heavy imports.

export const FOLDERS = [
  { id: 'inbox', label: 'inbox' },
  { id: 'sent', label: 'sent items' },
  { id: 'drafts', label: 'drafts' },
  { id: 'deleted', label: 'deleted items' },
];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const newId = uid;

export const DEFAULT_PREFS = { signature: 'Sent from my Windows Phone', name: '', address: '', preview: true, digest: true, lastDigest: 0 };

export function ownerAddress(name) {
  const base = String(name || 'lumia owner').toLowerCase().normalize('NFD').replace(/[^\w\s.]/g, '').trim().replace(/\s+/g, '.') || 'lumia.owner';
  return base + '@outlook.com';
}

/** Seeded welcome mail, with period (2014) flavor. Dates are relative to now so the box looks alive. */
export function seedMail() {
  const now = Date.now();
  const H = 3600e3, D = 864e5;
  const m = (from, address, subject, body, ago, extra = {}) => ({
    id: uid(), folder: 'inbox', from: { name: from, address }, to: [], cc: [], subject, body, date: now - ago, read: false, flagged: false, attachments: [], ...extra,
  });
  return [
    m('Windows Phone', 'windowsphone@microsoft.com', 'Welcome to Windows Phone 8.1',
      `Hi there,

Thanks for choosing Windows Phone. Here are a few things to try first:

• Say hello to Cortana — tap the search button and ask "What's the weather tomorrow?" or "Remind me to call Mom when I get home."
• Swipe down from the top of the screen to open the Action Center. Your notifications and quick settings live here.
• Make Start yours. Tap and hold a tile to resize or move it, and pick a background photo in Settings > start+theme.
• Type faster with Word Flow — just slide your finger from letter to letter.

Visit http://www.windowsphone.com for tips, apps and accessories.

Enjoy your new phone!
The Windows Phone Team`, 12 * 60e3),
    m('Outlook.com Team', 'member_services@outlook.com', 'Get started with Outlook.com',
      `Welcome to Outlook.com!

Your new inbox is ready on your phone, the web and your PC.

– Sweep: clean out newsletters you don't read in one tap.
– Schedule cleanup: keep only the latest message from senders like daily deals.
– Connect your Facebook, Twitter and LinkedIn accounts to see your friends' updates in People.

Tip: flag a message to keep it at the top of your mind — flagged mail shows up in the "flagged" pivot.

Happy emailing,
The Outlook.com Team`, 2 * H, { flagged: true }),
    m('Lumia', 'lumia@lumia.microsoft.com', 'Lumia Cyan is here: Living Images, Storyteller and more',
      `The Lumia Cyan update brings your Lumia the best of Windows Phone 8.1 plus exclusive Lumia features:

Lumia Camera with Living Images — every shot captures a moment of motion right before you take the picture.
Lumia Storyteller — your photos and videos automatically organized by time and place.
Glance Screen 2.0 — check the time and notifications without waking your phone.
Lumia Beamer — share your screen to any browser.

Your update will arrive over the air. Make sure you're connected to Wi-Fi and plugged in.

Explore more at http://www.microsoft.com/en/mobile/

Lumia — the Lumia team`, 9 * H),
    m('OneDrive', 'onedrive@email.onedrive.com', 'Your camera roll is now backed up to OneDrive',
      `Good news! Photos and videos you take on your phone will now be saved to your OneDrive automatically.

You have 15 GB of free storage — plus 15 GB bonus for turning on camera roll backup.

Find your photos anytime at https://onedrive.live.com

The OneDrive Team`, 1 * D + 3 * H, { read: true }),
    m('Xbox Music', 'xboxmusic@xbox.com', 'Your free Xbox Music Pass trial starts now',
      `Stream millions of songs ad-free and download your favourites to listen offline on your phone.

Try the new Xbox Music app from the Store, then pin your favorite playlists to Start.

Rock on,
Xbox Music`, 2 * D + 5 * H, { read: true }),
    m('Skype', 'no-reply@skype.com', 'Skype is now built right into your phone',
      `With Skype on Windows Phone you can answer Skype calls just like regular phone calls — right from the lock screen.

Tip: upgrade any phone call to a Skype video call with a single tap.

The Skype Team`, 4 * D, { read: true }),
    m('Microsoft account team', 'account-security-noreply@accountprotection.microsoft.com', 'New sign-in to your Microsoft account',
      `We detected a new sign-in to your Microsoft account from a Windows Phone device.

If this was you, you can safely ignore this email.

Thanks,
The Microsoft account team`, 6 * D, { read: true }),
  ].concat([{
    id: uid(), folder: 'sent', from: { name: '', address: '' }, to: [{ name: 'Windows Phone', address: 'windowsphone@microsoft.com' }], cc: [],
    subject: 'Hello from my new Lumia', body: 'Just set up my new phone. Live tiles look great!\n\nSent from my Windows Phone', date: now - 5 * D, read: true, flagged: false, attachments: [],
  }]);
}

/** Load mailbox from a storage namespace, seeding the first time. */
export async function loadMail(storage) {
  let mail = await storage.get('mail', null);
  if (!Array.isArray(mail)) { mail = seedMail(); await storage.set('mail', mail); }
  return mail;
}

export function unreadInbox(mail) { return mail.filter((m) => m.folder === 'inbox' && !m.read); }

export function tileData(mail, esc) {
  const unread = unreadInbox(mail).sort((a, b) => b.date - a.date);
  const faces = unread.slice(0, 3).map((m) => ({
    html: `<div class="t-mid" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.from?.name || m.from?.address || '')}</div>`
      + `<div class="t-mid t-clip" style="-webkit-line-clamp:2">${esc(m.subject || '(no subject)')}</div>`
      + `<div class="t-sub t-clip" style="-webkit-line-clamp:2">${esc(String(m.body || '').replace(/\s+/g, ' ').slice(0, 120))}</div>`,
  }));
  return { title: 'Outlook', badge: unread.length || null, faces };
}
