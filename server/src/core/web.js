// Serves the web app in ../../web. index.html gets a <base href> so every asset and API call is relative —
// required inside Home Assistant's ingress proxy, where Hearth lives under /api/hassio_ingress/<token>/.
const fs = require('fs');
const path = require('path');
const express = require('express');

const WEB_DIR = process.env.HEARTH_WEB_DIR || path.join(__dirname, '..', '..', 'web');

function mountWeb(app) {
  const INDEX = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
  const sendIndex = (req, res) => {
    const base = String(req.headers['x-ingress-path'] || '').replace(/[^\w\-/.]/g, '');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(INDEX.replace('<base href="/">', `<base href="${base}/">`));
  };
  app.get(['/', '/index.html'], sendIndex);
  app.use(express.static(WEB_DIR, { maxAge: 0, index: false }));
  app.get(/^\/(?!api).*/, sendIndex);
}

module.exports = { mountWeb, WEB_DIR };
