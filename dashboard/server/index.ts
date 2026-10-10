/**
 * index.ts — NFL dashboard server.
 * Serves the built React app (dist/client) and the read-only JSON API (/api).
 * One process, one App Service; sign-in is App Service Authentication (auth.ts).
 */
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { router } from './routes.js';
import { requireUser, authMode } from './auth.js';

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => { res.json({ ok: true }); });

app.use('/api', requireUser, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, router);
app.use('/api', (_req, res) => { res.status(404).json({ error: 'unknown endpoint' }); });

// Static SPA (production build). Hash routing, so index.html is the only page.
const here = dirname(fileURLToPath(import.meta.url));
const client = [resolve(here, '../client'), resolve(here, '../dist/client')].find((p) => existsSync(p));
if (client) {
  app.use(requireUser, express.static(client, { maxAge: '1h', index: 'index.html' }));
}

const port = Number(process.env.PORT ?? 8081);
app.listen(port, () => {
  console.log(`NFL dashboard on :${port}  (auth: ${authMode()}${client ? '' : ', no client build — API only'})`);
});
