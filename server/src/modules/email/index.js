// Email receipts — Mailboxes (IMAP, Microsoft 365, Exchange), receipt matching and the approval queue.
// Each module adds its API routes here; see docs/customising.md.
const fs = require('fs');
const { q } = require('../../core/db');
const { log } = require('../../core/config');
const secrets = require('../../core/secrets');
const { encrypt } = secrets;
const { notify } = require('../notifications/notify');
const email = require('./email');
const scheduler = require('../../jobs/scheduler');
const { wrap, err } = require('../../core/http');

const EMAIL_FIELDS = ['user_id', 'name', 'kind', 'host', 'port', 'secure', 'username', 'password', 'folders', 'folder_names', 'lookback_days', 'enabled', 'allow_self_signed', 'address', 'graph_client_id', 'graph_tenant', 'ews_url', 'ews_domain'];
const JSON_FIELDS = ['folders', 'folder_names'];
const safeAcct = (a) => ({ ...a, password: a.password ? '••••••' : '', graph_refresh_token: undefined, signed_in: a.kind === 'microsoft' ? !!a.graph_refresh_token : undefined, state: undefined,
  folders: JSON.parse(a.folders || '["INBOX"]'), folder_names: JSON.parse(a.folder_names || '{}'), login: a.kind === 'microsoft' ? require('./microsoft').loginStatus(a.id) : undefined });
const fieldVal = (k, v) => (k === 'password' ? encrypt(v) : JSON_FIELDS.includes(k) ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v);

// Routes for signed-in users
function routes(api) {
  api.get('/email/accounts', (req, res) => res.json(q.all('SELECT * FROM email_accounts WHERE household_id=? ORDER BY id', req.hid).map(safeAcct)));
  api.post('/email/accounts/test', wrap(async (req, res) => {
    let b = { secure: 1, port: 993, kind: 'imap', ...req.body };
    if (b.id) { const saved = q.get('SELECT * FROM email_accounts WHERE id=? AND household_id=?', b.id, req.hid); if (saved) b = { ...saved, ...b, password: !b.password || b.password === '••••••' ? saved.password : b.password, graph_refresh_token: saved.graph_refresh_token }; }
    try { const r = await email.testConnection(b); res.json({ ok: true, ...r }); }
    catch (e) { throw err(`Couldn't sign in: ${e.responseText || e.message}${/auth|login|credentials/i.test(e.responseText || e.message) ? ' — most providers need an app password for IMAP (see the help below).' : ''}`); }
  }));
  api.post('/email/accounts', wrap(async (req, res) => {
    const b = req.body; const kind = b.kind || 'imap';
    if (kind === 'imap' && (!b.host || !b.username || !b.password)) throw err('Server, username and password are needed');
    if (kind === 'microsoft' && !b.graph_client_id) throw err('The Application (client) ID from your Entra app registration is needed');
    if (kind === 'ews' && (!b.ews_url || !b.username || !b.password)) throw err('EWS URL, username and password are needed');
    if (kind !== 'imap' && !b.folders) b.folders = ['inbox'];
    const keys = EMAIL_FIELDS.filter((k) => b[k] !== undefined);
    const id = Number(q.run(`INSERT INTO email_accounts(household_id${keys.map((k) => `,${k}`).join('')}) VALUES(?${keys.map(() => ',?').join('')})`, req.hid,
      ...keys.map((k) => fieldVal(k, b[k]))).lastInsertRowid);
    const acct = q.get('SELECT * FROM email_accounts WHERE id=?', id);
    if (kind === 'microsoft') return res.json(safeAcct(acct)); // sync starts once signed in
    email.syncAccount(acct).then((r) => { if (r.found) notify(req.hid, { title: 'Receipts found in your email', body: `${r.found} to check`, url: '/#/receipts' }); }).catch((e) => log.warning('first email sync', e.message));
    res.json(safeAcct(acct));
  }));
  api.patch('/email/accounts/:id', (req, res) => {
    const b = req.body;
    const before = q.get('SELECT graph_client_id, graph_tenant FROM email_accounts WHERE id=? AND household_id=?', req.params.id, req.hid);
    if (!before) return res.status(404).json({ error: 'Not found' });
    for (const k of EMAIL_FIELDS) if (b[k] !== undefined && !(k === 'password' && (b[k] === '••••••' || b[k] === ''))) q.run(`UPDATE email_accounts SET ${k}=? WHERE id=? AND household_id=?`, fieldVal(k, b[k]), req.params.id, req.hid);
    // a different Entra app or tenant means signing in again
    if ((b.graph_client_id !== undefined && b.graph_client_id !== before.graph_client_id) || (b.graph_tenant !== undefined && b.graph_tenant !== before.graph_tenant)) {
      require('./microsoft').forget(req.params.id);
      q.run('UPDATE email_accounts SET graph_refresh_token=NULL WHERE id=?', req.params.id);
    }
    if (b.folders !== undefined || b.lookback_days !== undefined) q.run(`UPDATE email_accounts SET state='{}' WHERE id=? AND household_id=?`, req.params.id, req.hid);
    res.json({ ok: true });
  });
  // Microsoft sign-in (device code): start it, then poll its status from the page
  api.post('/email/accounts/:id/microsoft/login', wrap(async (req, res) => {
    const a = q.get(`SELECT * FROM email_accounts WHERE id=? AND household_id=? AND kind='microsoft'`, req.params.id, req.hid); if (!a) throw err('Not found', 404);
    const info = await require('./microsoft').startLogin(a);
    res.json({ user_code: info.user_code, verification_uri: info.verification_uri, message: info.message, expires: info.expires });
  }));
  api.get('/email/accounts/:id/microsoft/status', (req, res) => {
    const a = q.get('SELECT id, graph_refresh_token, address FROM email_accounts WHERE id=? AND household_id=?', req.params.id, req.hid); if (!a) return res.status(404).json({ error: 'Not found' });
    const st = require('./microsoft').loginStatus(a.id);
    if (st?.status === 'done' && !st.synced) { st.synced = true; const full = q.get('SELECT * FROM email_accounts WHERE id=?', a.id); email.syncAccount(full).catch((e) => log.warning('first Microsoft sync', e.message)); }
    res.json({ ...(st || {}), signed_in: !!a.graph_refresh_token, address: a.address });
  });
  api.delete('/email/accounts/:id', (req, res) => {
    if (q.run('DELETE FROM email_accounts WHERE id=? AND household_id=?', req.params.id, req.hid).changes) require('./microsoft').forget(req.params.id);
    res.json({ ok: true });
  });
  api.post('/email/accounts/:id/sync', wrap(async (req, res) => {
    const a = q.get('SELECT * FROM email_accounts WHERE id=? AND household_id=?', req.params.id, req.hid); if (!a) throw err('Not found', 404);
    try { res.json(await email.syncAccount(a, { full: !!req.body.full })); } catch (e) { throw err(`Mailbox check failed: ${e.responseText || e.message}`); }
  }));
  api.get('/email/receipts', (req, res) => res.json(email.list(req.hid, ['pending', 'approved', 'ignored'].includes(req.query.status) ? req.query.status : 'pending')));
  api.get('/email/receipts/counts', (req, res) => res.json(Object.fromEntries(q.all('SELECT status, COUNT(*) n FROM email_receipts WHERE household_id=? GROUP BY status', req.hid).map((r) => [r.status, r.n]))));
  api.get('/email/receipts/:id', (req, res) => { const d = email.detail(req.hid, Number(req.params.id)); d ? res.json(d) : res.status(404).json({ error: 'Not found' }); });
  api.post('/email/receipts/:id/approve', wrap(async (req, res) => { const r = await email.approve(req.hid, req.user.id, Number(req.params.id), req.body || {}); scheduler.afterNewTransactions(req.hid).catch(() => {}); res.json(r); }));
  api.post('/email/receipts/approve-batch', wrap(async (req, res) => { let n = 0; for (const id of req.body.ids || []) { try { await email.approve(req.hid, req.user.id, Number(id), {}); n++; } catch {} } res.json({ approved: n }); }));
  api.post('/email/receipts/:id/ignore', wrap(async (req, res) => { email.ignore(req.hid, Number(req.params.id), { sender: !!req.body.sender }); res.json({ ok: true }); }));
  api.post('/email/receipts/:id/undo', wrap(async (req, res) => { email.undo(req.hid, Number(req.params.id)); res.json({ ok: true }); }));
  api.post('/email/receipts/:id/rematch', (req, res) => { email.rematch(req.hid, Number(req.params.id)); res.json(email.detail(req.hid, Number(req.params.id))); });
  api.get('/email/receipts/:id/file/:name', (req, res) => {
    const a = email.attachmentPath(req.hid, Number(req.params.id), req.params.name);
    if (!a || !require('fs').existsSync(a.file)) return res.status(404).json({ error: 'Not found' });
    // receipts are stored encrypted; only PDFs and pictures open in the browser, in a sandbox
    const safe = /^(application\/pdf|image\/(png|jpe?g|gif|webp|heic))$/i.test(a.type);
    res.setHeader('Content-Type', safe ? a.type : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${safe ? 'inline' : 'attachment'}; filename="${a.name.replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('Content-Security-Policy', 'sandbox; default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'; plugin-types application/pdf');
    res.send(secrets.readFileDecrypted(a.file));
  });
  api.get('/transactions/:id/receipts', (req, res) => res.json(q.all(`SELECT id, merchant, subject, total, receipt_date, order_ref, attachments, status FROM email_receipts WHERE household_id=? AND transaction_id=? AND status='approved'`, req.hid, req.params.id)
    .map((r) => ({ ...r, attachments: JSON.parse(r.attachments || '[]') }))));
}

module.exports = { name: 'email', title: 'Email receipts', routes };
