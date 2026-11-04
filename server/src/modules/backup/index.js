// Backups — Passphrase-encrypted backup download.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const secrets = require('../../core/secrets');
const A = require('../insights/analytics');
const { wrap, err } = require('../../core/http');

const backupData = (hid) => {
  const tables = ['accounts', 'categories', 'transactions', 'tags', 'transaction_tags', 'people', 'rules', 'budgets', 'goals', 'events', 'notes', 'subscriptions', 'subscription_payments', 'email_receipts', 'watches', 'plan_cells', 'saved_views'];
  const out = { exported_at: new Date().toISOString() };
  for (const t of tables) out[t] = t === 'transaction_tags' ? q.all('SELECT tt.* FROM transaction_tags tt JOIN transactions t ON t.id=tt.transaction_id WHERE t.household_id=?', hid) : q.all(`SELECT * FROM ${t} WHERE household_id=?`, hid);
  return out;
};

// Routes for signed-in users
function routes(api) {
  // Backups are protected with a passphrase you choose (AES-256-GCM, key stretched with scrypt)
  api.post('/backup', wrap(async (req, res) => {
    const pass = String(req.body.passphrase || '');
    const day = A.iso(new Date());
    if (!pass) { if (!req.body.unencrypted) throw err('Choose a passphrase to protect the backup'); res.setHeader('Content-Disposition', `attachment; filename="hearth-backup-${day}.json"`); return res.json(backupData(req.hid)); }
    if (pass.length < 8) throw err('Use a passphrase of at least 8 characters');
    res.setHeader('Content-Disposition', `attachment; filename="hearth-backup-${day}.hearth"`);
    res.type('application/json').send(secrets.encryptWithPassphrase(JSON.stringify(backupData(req.hid)), pass));
  }));
  // Open an encrypted backup (to check it, or read it back out)
  api.post('/backup/decrypt', wrap(async (req, res) => {
    const { file, passphrase } = req.body;
    res.type('application/json').send(secrets.decryptWithPassphrase(file, String(passphrase || '')));
  }));
}

module.exports = { name: 'backup', title: 'Backups', routes };
