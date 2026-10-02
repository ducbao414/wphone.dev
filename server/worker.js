// Cloudflare Workers entry. Static files in dist/ are served by Workers Static Assets (see wrangler.jsonc);
// only /api/* requests reach this Worker.
import { createApp } from './app.js';

const app = createApp({
  // Cloudflare already knows the visitor's approximate location — no third-party IP lookup needed.
  ipLocation: (c) => {
    const cf = c.req.raw.cf;
    if (!cf?.latitude) return null;
    return { lat: Number(cf.latitude), lon: Number(cf.longitude), city: cf.city || '', country: cf.country || '', countryCode: cf.country || '', timezone: cf.timezone };
  },
});

export default app;
