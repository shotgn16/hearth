// One-off upgrades that run at start-up. Safe to run every time: finished work is skipped.
const fs = require('fs');
const path = require('path');
const { q, getSetting, setSetting, DATA_DIR } = require('./db');
const { log } = require('./config');
const secrets = require('./secrets');
const { SECRET_SETTINGS } = require('./http');

const { encrypt } = secrets;

// Encrypt anything saved before encryption was added (1.5.0)
function encryptExistingSecrets() {
  let n = 0;
  for (const c of q.all('SELECT id, config FROM connections')) if (c.config && !secrets.isEncrypted(c.config)) { q.run('UPDATE connections SET config=? WHERE id=?', encrypt(c.config), c.id); n++; }
  for (const a of q.all('SELECT id, password, graph_refresh_token FROM email_accounts')) {
    if (a.password && !secrets.isEncrypted(a.password)) { q.run('UPDATE email_accounts SET password=? WHERE id=?', encrypt(a.password), a.id); n++; }
    if (a.graph_refresh_token && !secrets.isEncrypted(a.graph_refresh_token)) { q.run('UPDATE email_accounts SET graph_refresh_token=? WHERE id=?', encrypt(a.graph_refresh_token), a.id); n++; }
  }
  for (const c of q.all('SELECT id, credentials FROM calendars')) if (c.credentials && !secrets.isEncrypted(c.credentials)) { q.run('UPDATE calendars SET credentials=? WHERE id=?', encrypt(c.credentials), c.id); n++; }
  for (const h of q.all('SELECT id FROM households')) for (const k of SECRET_SETTINGS) {
    const v = getSetting(h.id, k); if (v?.token && !secrets.isEncrypted(v.token)) { setSetting(h.id, k, { ...v, token: encrypt(v.token) }); n++; }
  }
  const dir = path.join(DATA_DIR, 'receipts');
  if (fs.existsSync(dir)) for (const sub of fs.readdirSync(dir)) {
    const d = path.join(dir, sub); if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) { const p = path.join(d, f), buf = fs.readFileSync(p); if (!buf.subarray(0, 8).equals(Buffer.from('HEARTHE1'))) { secrets.writeFileEncrypted(p, buf); n++; } }
  }
  if (n) log.info(`Encrypted ${n} saved secrets and receipt files`);
  try { fs.chmodSync(path.join(DATA_DIR, 'hearth.db'), 0o600); } catch { /* not supported */ }
}

function runUpgrades() {
  try { encryptExistingSecrets(); } catch (e) { log.error('Encrypting saved secrets failed', e.message); }
}

module.exports = { runUpgrades, encryptExistingSecrets };
