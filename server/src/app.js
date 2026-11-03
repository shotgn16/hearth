// Builds the Hearth web server: security headers, the API (from the feature modules) and the web app.
const express = require('express');
const { db } = require('./core/db');
const auth = require('./core/auth');
const { securityHeaders } = require('./core/security');
const { mountWeb } = require('./core/web');

function createApp({ modules = require('./modules') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '60mb' }));
  app.use(express.text({ limit: '60mb', type: ['text/*', 'application/x-ofx'] }));

  // ---- API: public routes first, then sign-in, then everything else ----
  const api = express.Router();
  for (const m of modules) if (m.publicRoutes) m.publicRoutes(api);
  api.use(auth.authMiddleware);
  for (const m of modules) if (m.routes) m.routes(api);
  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));
  app.use('/api', (e, req, res, next) => { console.error(e); res.status(e.status || 500).json({ error: e.message }); });

  // Before a Home Assistant backup: fold the write-ahead log into the main database file (localhost only)
  app.get('/internal/checkpoint', (req, res) => {
    const ip = String(req.socket.remoteAddress || '').replace('::ffff:', '');
    if (!['127.0.0.1', '::1'].includes(ip)) return res.status(403).end();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); res.send('ok');
  });

  // ---- the web app ----
  mountWeb(app);
  return app;
}

module.exports = { createApp };
