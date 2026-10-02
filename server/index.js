// Node / VPS entry: serves the built SPA (dist/) plus the shared /api routes from app.js.
//   npm run build && node server/index.js
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { compress } from 'hono/compress';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 8787);

// Shared API (with compression), then static files.
const app = createApp({
  middleware: [compress()],
  // DNS lookup so the proxy can refuse hostnames that point at private/internal addresses
  resolveHost: async (host) => (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address),
  remoteAddress: (c) => c.env?.incoming?.socket?.remoteAddress,
});
if (existsSync('./dist')) {
  app.use('/assets/*', async (c, next) => { await next(); c.header('cache-control', 'public, max-age=31536000, immutable'); });
  app.use('/*', serveStatic({ root: './dist' }));
  const index = readFileSync('./dist/index.html', 'utf8');
  app.get('*', (c) => c.html(index));
}

serve({ fetch: app.fetch, port: PORT }, (i) => console.log(`wphone server on http://localhost:${i.port}`));
