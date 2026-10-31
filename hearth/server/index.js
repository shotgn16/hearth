process.removeAllListeners('warning'); // silence node:sqlite experimental notice
const express = require('express');
const path = require('path');
const { db, q, getSetting, setSetting, DATA_DIR } = require('./db');
const { config, log } = require('./config');
const auth = require('./auth');
const { seedCategories, learnMerchant } = require('./categorize');
const ING = require('./ingest');
const banks = require('./banks');
const { detectSubscriptions } = require('./subscriptions');
const rules = require('./rules');
const A = require('./analytics');
const ai = require('./ai');
const notes = require('./notes');
const cal = require('./calendar');
const prices = require('./prices');
const { notify } = require('./notify');
const scheduler = require('./scheduler');

const app = express();
app.use(express.json({ limit: '60mb' }));
app.use(express.text({ limit: '60mb', type: ['text/*', 'application/x-ofx'] }));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(e.status || 400).json({ error: e.message }); });
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const api = express.Router();

// ---------------- Home Assistant ingress ----------------
// Identity headers are only trusted when the request really comes from the Supervisor's ingress proxy.
const SUPERVISOR_IP = process.env.INGRESS_PROXY_IP || '172.30.32.2'; // override only for local testing
function haIdentity(req) {
  if (!config.isAddon) return null;
  const ip = String(req.socket.remoteAddress || '').replace('::ffff:', '');
  if (ip !== SUPERVISOR_IP || !req.headers['x-remote-user-id']) return null;
  return { id: String(req.headers['x-remote-user-id']), name: String(req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || 'Home Assistant user'),
    username: String(req.headers['x-remote-user-name'] || '') };
}

// ---------------- public: first-run setup + login ----------------
api.get('/status', (req, res) => {
  const ha = haIdentity(req);
  res.json({ needsSetup: !q.get('SELECT 1 FROM users LIMIT 1'), version: process.env.HEARTH_VERSION || '1.2.0', addon: config.isAddon, ha_user: ha ? { name: ha.name } : null });
});

// Opening Hearth from the HA sidebar signs you in as your HA user once linked
api.post('/ingress-session', wrap(async (req, res) => {
  const ha = haIdentity(req);
  if (!ha) return res.json({ ok: false });
  let u = q.get('SELECT * FROM users WHERE ha_user_id=?', ha.id);
  if (!u && config.autoCreateHaUsers) {
    const hh = q.get('SELECT id FROM households ORDER BY id LIMIT 1');
    if (hh) {
      const uid = Number(q.run('INSERT INTO users(household_id,name,email,pass_hash,role,ha_user_id) VALUES(?,?,?,?,?,?)', hh.id, ha.name, `${ha.username || ha.id}@homeassistant.local`,
        auth.hashPassword(require('crypto').randomBytes(24).toString('hex')), 'member', ha.id).lastInsertRowid);
      q.run('INSERT INTO people(household_id,name,user_id) VALUES(?,?,?)', hh.id, ha.name, uid);
      u = q.get('SELECT * FROM users WHERE id=?', uid);
    }
  }
  if (!u) return res.json({ ok: false, link: true, ha_user: { name: ha.name } });
  res.json({ ok: true, token: auth.createSession(u.id) });
}));

api.post('/setup', wrap(async (req, res) => {
  if (q.get('SELECT 1 FROM users LIMIT 1')) throw err('Already set up', 403);
  const { household, name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) throw err('Name, email and a password of 8+ characters are required');
  const hid = Number(q.run('INSERT INTO households(name) VALUES(?)', household || `${name}'s household`).lastInsertRowid);
  const uid = Number(q.run('INSERT INTO users(household_id,name,email,pass_hash,role,ha_user_id) VALUES(?,?,?,?,?,?)', hid, name, email.toLowerCase(), auth.hashPassword(password), 'admin', haIdentity(req)?.id || null).lastInsertRowid);
  q.run('INSERT INTO people(household_id,name,user_id,color) VALUES(?,?,?,?)', hid, name, uid, '#3b82f6');
  seedCategories(hid);
  q.run('INSERT INTO accounts(household_id,owner_user_id,name,type) VALUES(?,?,?,?)', hid, uid, 'Cash', 'cash');
  res.json({ token: auth.createSession(uid) });
}));

api.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const u = q.get('SELECT * FROM users WHERE email=?', String(email || '').toLowerCase());
  if (!u || !auth.verifyPassword(password || '', u.pass_hash)) throw err('Email or password is wrong', 401);
  const ha = haIdentity(req);
  if (ha && !u.ha_user_id && !q.get('SELECT 1 FROM users WHERE ha_user_id=?', ha.id)) q.run('UPDATE users SET ha_user_id=? WHERE id=?', ha.id, u.id);
  res.json({ token: auth.createSession(u.id) });
}));

api.use(auth.authMiddleware);
api.post('/logout', (req, res) => { q.run('DELETE FROM sessions WHERE token=?', req.user.token); res.json({ ok: true }); });
api.get('/me', (req, res) => res.json({ user: (({ token, ...u }) => u)(req.user), household: q.get('SELECT * FROM households WHERE id=?', req.hid),
  addon: config.isAddon, ha: require('./ha').available(req.hid), ha_linked: !!q.get('SELECT ha_user_id FROM users WHERE id=?', req.user.id)?.ha_user_id,
  ai: (() => { const c = ai.cfg(req.hid); return { enabled: c.enabled, vision: !!c.visionModel, features: c.features }; })() }));

// ---------------- generic CRUD for simple household-scoped tables ----------------
function crud(table, fields, { json = [], order = 'id', after } = {}) {
  const enc = (k, v) => (json.includes(k) && typeof v !== 'string' ? JSON.stringify(v ?? []) : v === '' ? null : v);
  api.get(`/${table}`, (req, res) => res.json(q.all(`SELECT * FROM ${table} WHERE household_id=? ORDER BY ${order}`, req.hid)));
  api.post(`/${table}`, wrap(async (req, res) => {
    const keys = fields.filter((f) => req.body[f] !== undefined);
    const r = q.run(`INSERT INTO ${table}(household_id${keys.map((k) => `,${k}`).join('')}) VALUES(?${keys.map(() => ',?').join('')})`, req.hid, ...keys.map((k) => enc(k, req.body[k])));
    const row = q.get(`SELECT * FROM ${table} WHERE id=?`, Number(r.lastInsertRowid));
    if (after) await after(req, row);
    res.json(row);
  }));
  api.patch(`/${table}/:id`, wrap(async (req, res) => {
    const keys = fields.filter((f) => req.body[f] !== undefined);
    if (keys.length) q.run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=? AND household_id=?`, ...keys.map((k) => enc(k, req.body[k])), req.params.id, req.hid);
    const row = q.get(`SELECT * FROM ${table} WHERE id=? AND household_id=?`, req.params.id, req.hid);
    if (after) await after(req, row);
    res.json(row);
  }));
  api.delete(`/${table}/:id`, (req, res) => { q.run(`DELETE FROM ${table} WHERE id=? AND household_id=?`, req.params.id, req.hid); res.json({ ok: true }); });
}
crud('people', ['name', 'color', 'user_id'], { order: 'name' });
crud('accounts', ['owner_user_id', 'name', 'institution', 'type', 'currency', 'balance', 'balance_date', 'color', 'shared', 'archived'], { order: 'archived, name' });
crud('categories', ['name', 'parent_id', 'color', 'icon', 'kind'], { order: 'kind DESC, name' });
crud('tags', ['name', 'color'], { order: 'name' });
crud('rules', ['name', 'enabled', 'priority', 'trigger', 'match_all', 'conditions', 'actions', 'stop_processing'], { json: ['conditions', 'actions'], order: 'priority, id' });
crud('budgets', ['name', 'amount', 'period', 'start_date', 'end_date', 'category_ids', 'tag_ids', 'scope', 'user_id', 'person_id', 'event_id', 'alert_pct', 'rollover', 'color', 'flag'], { json: ['category_ids', 'tag_ids'] });
crud('goals', ['name', 'kind', 'target_amount', 'current_amount', 'target_date', 'account_id', 'scope', 'user_id', 'color']);
crud('calendars', ['user_id', 'name', 'provider', 'url', 'credentials', 'color', 'enabled'], { after: async (req, row) => { if (row?.url) cal.syncCalendar(row).catch(() => {}); } });
crud('watches', ['user_id', 'query', 'url', 'target_price', 'provider', 'enabled'], { after: async (req, row) => { if (row?.url) prices.checkWatch(row).catch(() => {}); } });
crud('saved_views', ['user_id', 'name', 'kind', 'config', 'pinned'], { json: ['config'] });

// ---------------- users ----------------
api.get('/users', (req, res) => res.json(q.all('SELECT id,name,email,role,color,created_at FROM users WHERE household_id=?', req.hid)));
api.post('/users', wrap(async (req, res) => {
  if (req.user.role !== 'admin') throw err('Only an admin can add people', 403);
  const { name, email, password, color, role } = req.body;
  if (!password || password.length < 8) throw err('Password must be 8+ characters');
  const uid = Number(q.run('INSERT INTO users(household_id,name,email,pass_hash,role,color) VALUES(?,?,?,?,?,?)', req.hid, name, email.toLowerCase(), auth.hashPassword(password), role || 'member', color || '#ec4899').lastInsertRowid);
  q.run('INSERT INTO people(household_id,name,user_id,color) VALUES(?,?,?,?)', req.hid, name, uid, color || '#ec4899');
  res.json({ id: uid });
}));
api.patch('/users/:id', wrap(async (req, res) => {
  if (req.user.role !== 'admin' && Number(req.params.id) !== req.user.id) throw err('Not allowed', 403);
  const { name, color, password, role } = req.body;
  if (name) q.run('UPDATE users SET name=? WHERE id=? AND household_id=?', name, req.params.id, req.hid);
  if (color) q.run('UPDATE users SET color=? WHERE id=? AND household_id=?', color, req.params.id, req.hid);
  if (password) q.run('UPDATE users SET pass_hash=? WHERE id=? AND household_id=?', auth.hashPassword(password), req.params.id, req.hid);
  if (role && req.user.role === 'admin') q.run('UPDATE users SET role=? WHERE id=? AND household_id=?', role, req.params.id, req.hid);
  res.json({ ok: true });
}));
api.delete('/users/:id', wrap(async (req, res) => {
  if (req.user.role !== 'admin' || Number(req.params.id) === req.user.id) throw err('Not allowed', 403);
  q.run('DELETE FROM users WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true });
}));


// ---------------- transactions (the spreadsheet core) ----------------
function txQuery(req, { forExport = false } = {}) {
  const f = req.query; const w = ['t.household_id=?']; const p = [req.hid];
  if (f.q) { w.push('(t.description LIKE ? OR t.merchant LIKE ? OR t.notes LIKE ?)'); p.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  if (f.from) { w.push('t.date>=?'); p.push(f.from); }
  if (f.to) { w.push('t.date<=?'); p.push(f.to); }
  for (const k of ['category_id', 'account_id', 'person_id', 'event_id', 'subscription_id']) if (f[k]) { w.push(`t.${k}=?`); p.push(f[k]); }
  if (f.user_id) { w.push('(t.user_id=? OR a.owner_user_id=?)'); p.push(f.user_id, f.user_id); }
  if (f.kind) { w.push('t.kind=?'); p.push(f.kind); }
  if (f.direction === 'out') w.push('t.amount<0'); if (f.direction === 'in') w.push('t.amount>0');
  if (f.min) { w.push('ABS(t.amount)>=?'); p.push(Number(f.min)); }
  if (f.max) { w.push('ABS(t.amount)<=?'); p.push(Number(f.max)); }
  if (f.uncategorised === '1') w.push('t.category_id IS NULL');
  if (f.categorised_by) { w.push('t.categorised_by=?'); p.push(f.categorised_by); }
  if (f.id) { w.push('t.id=?'); p.push(Number(f.id)); }
  if (f.unexpected === '1') w.push('t.unexpected=1');
  if (f.work_expense === '1') w.push('t.work_expense=1');
  if (f.claim_status) { w.push("COALESCE(t.claim_status,'to_claim')=?"); p.push(f.claim_status); }
  if (f.tag_id) { w.push('t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id=?)'); p.push(f.tag_id); }
  const sortable = { date: 't.date', amount: 't.amount', merchant: 't.merchant', category: 'c.name', account: 'a.name' };
  const sort = `${sortable[f.sort] || 't.date'} ${f.dir === 'asc' ? 'ASC' : 'DESC'}, t.id DESC`;
  const base = `FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN accounts a ON a.id=t.account_id
                LEFT JOIN people pe ON pe.id=t.person_id LEFT JOIN events e ON e.id=t.event_id WHERE ${w.join(' AND ')}`;
  const limit = forExport ? 1000000 : Math.min(Number(f.limit) || 100, 2000);
  const rows = q.all(`SELECT t.*, c.name category_name, c.color category_color, c.icon category_icon, a.name account_name, pe.name person_name, e.title event_title,
    (SELECT GROUP_CONCAT(tg.id||':'||tg.name||':'||tg.color, '|') FROM transaction_tags tt JOIN tags tg ON tg.id=tt.tag_id WHERE tt.transaction_id=t.id) tags
    ${base} ORDER BY ${sort} LIMIT ? OFFSET ?`, ...p, limit, Number(f.offset) || 0);
  const totals = q.get(`SELECT COUNT(*) n, ROUND(COALESCE(SUM(CASE WHEN t.amount<0 THEN -t.amount END),0),2) out_total, ROUND(COALESCE(SUM(CASE WHEN t.amount>0 THEN t.amount END),0),2) in_total ${base}`, ...p);
  return { rows: rows.map((r) => ({ ...r, tags: r.tags ? r.tags.split('|').map((s) => { const [id, name, color] = s.split(':'); return { id: Number(id), name, color }; }) : [] })), totals };
}
api.get('/transactions', (req, res) => res.json(txQuery(req)));
api.get('/transactions/export.csv', (req, res) => {
  const { rows } = txQuery(req, { forExport: true });
  const cols = ['date', 'amount', 'merchant', 'description', 'category_name', 'account_name', 'person_name', 'event_title', 'kind', 'notes', 'unexpected', 'work_expense', 'claim_status', 'claim_ref', 'claimed_at', 'reimbursed_at'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send([cols.join(','), ...rows.map((r) => [...cols.map((c) => esc(r[c])), ''].slice(0, cols.length).join(','))].join('\n'));
});
api.post('/transactions', wrap(async (req, res) => {
  const r = await ING.ingest(req.hid, [req.body], { source: 'manual', userId: req.body.user_id || req.user.id });
  if (!r.added) throw err('Looks like a duplicate of an existing transaction');
  scheduler.afterNewTransactions(req.hid).catch(() => {});
  res.json(q.get('SELECT * FROM transactions WHERE id=?', r.ids[0]));
}));
const TX_FIELDS = ['date', 'amount', 'description', 'merchant', 'category_id', 'person_id', 'event_id', 'user_id', 'notes', 'color', 'kind', 'account_id', 'unexpected', 'work_expense', 'claim_status', 'claim_ref'];
function patchTx(hid, ids, body) {
  if (body.work_expense === 1 || body.work_expense === true) { body.work_expense = 1; if (body.claim_status === undefined) body.claim_status = 'to_claim'; }
  if (body.work_expense === 0 || body.work_expense === false) { body.work_expense = 0; body.claim_status = null; }
  if (body.unexpected !== undefined) body.unexpected = body.unexpected ? 1 : 0;
  const keys = TX_FIELDS.filter((k) => body[k] !== undefined);
  if (keys.length) for (const id of ids) q.run(`UPDATE transactions SET ${keys.map((k) => `${k}=?`).join(',')}${body.category_id !== undefined ? ",categorised_by='user'" : ''} WHERE id=? AND household_id=?`, ...keys.map((k) => (body[k] === '' ? null : body[k] ?? null)), id, hid);
  if (body.add_tag) for (const id of ids) q.run('INSERT OR IGNORE INTO transaction_tags VALUES(?,?)', id, body.add_tag);
  if (body.remove_tag) for (const id of ids) q.run('DELETE FROM transaction_tags WHERE transaction_id=? AND tag_id=?', id, body.remove_tag);
  let alsoUpdated = 0;
  // Teach the categoriser: one correction fixes every past and future transaction from that merchant
  if (body.category_id && body.learn !== false) {
    for (const m of new Set(ids.map((id) => q.get('SELECT merchant FROM transactions WHERE id=?', id)?.merchant).filter(Boolean))) {
      learnMerchant(hid, m, body.category_id);
      if (body.apply_to_merchant !== false) alsoUpdated += Number(q.run(`UPDATE transactions SET category_id=?, categorised_by='learned' WHERE household_id=? AND merchant=? AND (category_id IS NULL OR categorised_by IN ('pattern','ai','learned'))`, body.category_id, hid, m).changes);
    }
  }
  return alsoUpdated;
}
api.patch('/transactions/:id', wrap(async (req, res) => { const n = patchTx(req.hid, [Number(req.params.id)], req.body); res.json({ ok: true, also_updated: n }); }));
api.post('/transactions/bulk', wrap(async (req, res) => { const n = patchTx(req.hid, req.body.ids || [], req.body.patch || {}); res.json({ ok: true, also_updated: n }); }));
api.post('/transactions/bulk-delete', (req, res) => { for (const id of req.body.ids || []) q.run('DELETE FROM transactions WHERE id=? AND household_id=?', id, req.hid); res.json({ ok: true }); });
api.delete('/transactions/:id', (req, res) => { q.run('DELETE FROM transactions WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });

// ---------------- import ----------------
function parseFile(text, format) {
  const fmt = format || (/<OFX>|<STMTTRN>/i.test(text) ? 'ofx' : /^!Type:/m.test(text) ? 'qif' : 'csv');
  if (fmt === 'ofx') return { format: 'ofx', transactions: ING.parseOFX(text) };
  if (fmt === 'qif') return { format: 'qif', transactions: ING.parseQIF(text) };
  const { rows, delimiter } = ING.parseCSVText(text);
  return { format: 'csv', rows, delimiter, header: rows[0] || [], mapping: ING.guessMapping(rows[0] || []) };
}
api.post('/import/preview', wrap(async (req, res) => {
  const p = parseFile(req.body.text, req.body.format);
  if (p.format !== 'csv') return res.json({ format: p.format, count: p.transactions.length, sample: p.transactions.slice(0, 10) });
  const mapping = req.body.mapping || p.mapping;
  const txs = ING.rowsToTransactions(p.rows, mapping, req.body.options || {});
  res.json({ format: 'csv', header: p.header, mapping, rows: p.rows.slice(0, 6), count: txs.length, sample: txs.slice(0, 10),
    range: txs.length ? [txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date), txs.reduce((m, t) => (t.date > m ? t.date : m), txs[0].date)] : null });
}));
api.post('/import/commit', wrap(async (req, res) => {
  const p = parseFile(req.body.text, req.body.format);
  let txs = p.format === 'csv' ? ING.rowsToTransactions(p.rows, req.body.mapping || p.mapping, req.body.options || {}) : p.transactions;
  // map bank-provided category names onto ours when they match
  const cats = q.all('SELECT id, name FROM categories WHERE household_id=?', req.hid);
  // Hearth's own recognition wins; the bank's category is only a fallback for merchants Hearth doesn't know
  const { guessCategory, normaliseMerchant } = require('./categorize');
  txs = txs.map((t) => {
    const own = guessCategory(req.hid, normaliseMerchant(t.description), t.description, t.amount).id;
    const bank = t._category ? cats.find((c) => c.name.toLowerCase().startsWith(String(t._category).toLowerCase().split(/[ &]/)[0]))?.id ?? null : null;
    return { ...t, account_id: req.body.account_id || null, person_id: req.body.person_id || null, category_id: own || bank || null };
  });
  const r = await ING.ingest(req.hid, txs, { source: `import:${p.format}`, userId: req.body.user_id || req.user.id, runWorkflows: req.body.run_workflows !== false });
  await scheduler.afterNewTransactions(req.hid);
  res.json({ added: r.added, skipped: r.skipped });
}));

// ---------------- bank connections ----------------
api.get('/connections', (req, res) => res.json(q.all('SELECT id,provider,name,last_sync,last_error,auto_sync FROM connections WHERE household_id=?', req.hid)));
api.post('/connections', wrap(async (req, res) => {
  const { provider = 'simplefin', name, setup_token, access_url, history_from, owner_user_id, ...rest } = req.body;
  let config;
  if (provider === 'simplefin') config = { access_url: access_url || await banks.claimSimplefin(setup_token), history_from, owner_user_id };
  else config = { ...rest, history_from, owner_user_id };
  const id = Number(q.run('INSERT INTO connections(household_id,provider,name,config) VALUES(?,?,?,?)', req.hid, provider, name || 'superFin', JSON.stringify(config)).lastInsertRowid);
  const result = await banks.syncConnection(q.get('SELECT * FROM connections WHERE id=?', id), { full: true });
  await scheduler.afterNewTransactions(req.hid);
  res.json({ id, ...result });
}));
api.post('/connections/:id/sync', wrap(async (req, res) => {
  const c = q.get('SELECT * FROM connections WHERE id=? AND household_id=?', req.params.id, req.hid);
  if (!c) throw err('Not found', 404);
  const r = await banks.syncConnection(c, { full: !!req.body.full });
  await scheduler.afterNewTransactions(req.hid);
  res.json(r);
}));
api.patch('/connections/:id', (req, res) => { if (req.body.auto_sync !== undefined) q.run('UPDATE connections SET auto_sync=? WHERE id=? AND household_id=?', req.body.auto_sync ? 1 : 0, req.params.id, req.hid); if (req.body.name) q.run('UPDATE connections SET name=? WHERE id=? AND household_id=?', req.body.name, req.params.id, req.hid); res.json({ ok: true }); });
api.delete('/connections/:id', (req, res) => { q.run('DELETE FROM connections WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });

// ---------------- subscriptions & bills tracker ----------------
const tracker = require('./tracker');
const expenses = require('./expenses');
const INTERVAL = { weekly: 7, fortnightly: 14, monthly: 30.4, quarterly: 91, yearly: 365 };
api.get('/subscriptions', (req, res) => res.json(tracker.list(req.hid)));
api.post('/subscriptions/detect', (req, res) => { const r = detectSubscriptions(req.hid); tracker.linkManual(req.hid); tracker.refreshNextDates(req.hid); res.json(r); });
// Add one yourself — e.g. something paid from an account Hearth can't see, or a new subscription before its first payment
api.post('/subscriptions', wrap(async (req, res) => {
  const b = req.body; if (!b.name || !b.amount) throw err('Name and amount are needed');
  const cadence = b.cadence || 'monthly';
  const match = (b.match || b.name).trim();
  if (q.get('SELECT 1 FROM subscriptions WHERE household_id=? AND merchant=?', req.hid, match)) throw err('You already track something with that name');
  const id = Number(q.run(`INSERT INTO subscriptions(household_id,merchant,name,amount,cadence,interval_days,due_day,start_date,category_id,type,status,confirmed,manual,account_id,user_id,person_id,notes,last_date)
    VALUES(?,?,?,?,?,?,?,?,?,?,'active',1,1,?,?,?,?,?)`, req.hid, match, b.name, Math.abs(Number(b.amount)), cadence, INTERVAL[cadence], b.due_day ? Number(b.due_day) : null,
    b.start_date || A.iso(new Date()), b.category_id || null, b.type || 'subscription', b.account_id || null, b.user_id || null, b.person_id || null, b.notes || null, b.start_date || null).lastInsertRowid);
  tracker.linkManual(req.hid); tracker.refreshNextDates(req.hid);
  res.json(tracker.list(req.hid).find((x) => x.id === id));
}));
api.patch('/subscriptions/:id', (req, res) => {
  const b = { ...req.body };
  if (b.status === 'cancelled') b.status = 'ended';
  if (b.status === 'ended' && b.end_date === undefined) b.end_date = A.iso(new Date());
  if (b.status && ['active', 'paused', 'cancelling'].includes(b.status) && b.end_date === undefined) b.end_date = null;
  if (b.cadence) b.interval_days = INTERVAL[b.cadence];
  for (const k of ['confirmed', 'status', 'cadence', 'interval_days', 'amount', 'next_date', 'category_id', 'type', 'name', 'due_day', 'start_date', 'end_date', 'notes', 'account_id', 'user_id', 'person_id']) {
    if (b[k] !== undefined) q.run(`UPDATE subscriptions SET ${k}=? WHERE id=? AND household_id=?`, b[k] === '' ? null : b[k], req.params.id, req.hid);
  }
  if (b.status === 'ignored') q.run(`UPDATE transactions SET kind='one_off', subscription_id=NULL WHERE subscription_id=?`, req.params.id);
  if (b.type) q.run('UPDATE transactions SET kind=? WHERE subscription_id=?', b.type, req.params.id);
  tracker.refreshNextDates(req.hid);
  res.json({ ok: true });
});
api.delete('/subscriptions/:id', (req, res) => {
  q.run(`UPDATE transactions SET kind='one_off', subscription_id=NULL WHERE subscription_id=? AND household_id=?`, req.params.id, req.hid);
  q.run('DELETE FROM subscriptions WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true });
});
api.get('/tracker/month', (req, res) => res.json(tracker.month(req.hid, /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : A.iso(new Date()).slice(0, 7))));
api.get('/tracker/history', (req, res) => res.json(tracker.history(req.hid, Math.min(24, Number(req.query.months) || 12))));
api.get('/tracker/due-dates', (req, res) => {
  const s = q.get('SELECT * FROM subscriptions WHERE id=? AND household_id=?', Number(req.query.subscription_id), req.hid); if (!s) return res.json([]);
  const c = req.query.around || A.iso(new Date()); const shift = (n) => A.iso(A.addDays(new Date(`${c}T12:00:00`), n));
  res.json(tracker.occurrences({ ...s, end_date: null }, shift(-45), shift(45)));
});
api.post('/tracker/mark', wrap(async (req, res) => { const b = req.body; tracker.mark(req.hid, Number(b.subscription_id), b.due_date, b.status, b); res.json({ ok: true }); }));

// ---------------- email receipts (IMAP) ----------------
const email = require('./email');
const EMAIL_FIELDS = ['user_id', 'name', 'host', 'port', 'secure', 'username', 'password', 'folders', 'lookback_days', 'enabled', 'allow_self_signed'];
const safeAcct = (a) => ({ ...a, password: a.password ? '••••••' : '', state: undefined, folders: JSON.parse(a.folders || '["INBOX"]') });
api.get('/email/accounts', (req, res) => res.json(q.all('SELECT * FROM email_accounts WHERE household_id=? ORDER BY id', req.hid).map(safeAcct)));
api.post('/email/accounts/test', wrap(async (req, res) => {
  let b = { secure: 1, port: 993, ...req.body };
  if (b.id && (!b.password || b.password === '••••••')) b.password = q.get('SELECT password FROM email_accounts WHERE id=? AND household_id=?', b.id, req.hid)?.password;
  try { res.json({ ok: true, folders: await email.testConnection(b) }); }
  catch (e) { throw err(`Couldn't sign in: ${e.responseText || e.message}${/auth|login|credentials/i.test(e.responseText || e.message) ? ' — most providers need an app password for IMAP (see the help below).' : ''}`); }
}));
api.post('/email/accounts', wrap(async (req, res) => {
  const b = req.body; if (!b.host || !b.username || !b.password) throw err('Server, username and password are needed');
  const keys = EMAIL_FIELDS.filter((k) => b[k] !== undefined);
  const id = Number(q.run(`INSERT INTO email_accounts(household_id${keys.map((k) => `,${k}`).join('')}) VALUES(?${keys.map(() => ',?').join('')})`, req.hid,
    ...keys.map((k) => (k === 'folders' ? JSON.stringify(b[k]) : typeof b[k] === 'boolean' ? (b[k] ? 1 : 0) : b[k]))).lastInsertRowid);
  const acct = q.get('SELECT * FROM email_accounts WHERE id=?', id);
  email.syncAccount(acct).then((r) => { if (r.found) notify(req.hid, { title: 'Receipts found in your email', body: `${r.found} to check`, url: '/#/receipts' }); }).catch((e) => log.warning('first email sync', e.message));
  res.json(safeAcct(acct));
}));
api.patch('/email/accounts/:id', (req, res) => {
  const b = req.body;
  for (const k of EMAIL_FIELDS) if (b[k] !== undefined && !(k === 'password' && (b[k] === '••••••' || b[k] === ''))) q.run(`UPDATE email_accounts SET ${k}=? WHERE id=? AND household_id=?`, k === 'folders' ? JSON.stringify(b[k]) : typeof b[k] === 'boolean' ? (b[k] ? 1 : 0) : b[k], req.params.id, req.hid);
  if (b.folders !== undefined || b.lookback_days !== undefined) q.run(`UPDATE email_accounts SET state='{}' WHERE id=? AND household_id=?`, req.params.id, req.hid);
  res.json({ ok: true });
});
api.delete('/email/accounts/:id', (req, res) => { q.run('DELETE FROM email_accounts WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });
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
  res.setHeader('Content-Type', a.type); res.setHeader('Content-Disposition', `inline; filename="${a.name.replace(/"/g, '')}"`); res.sendFile(a.file);
});
api.get('/transactions/:id/receipts', (req, res) => res.json(q.all(`SELECT id, merchant, subject, total, receipt_date, order_ref, attachments, status FROM email_receipts WHERE household_id=? AND transaction_id=? AND status='approved'`, req.hid, req.params.id)
  .map((r) => ({ ...r, attachments: JSON.parse(r.attachments || '[]') }))));

// ---------------- unexpected costs & work expenses ----------------
api.get('/expenses/unexpected', (req, res) => res.json(expenses.unexpected(req.hid, req.query)));
api.post('/expenses/unexpected/dismiss', (req, res) => { const d = getSetting(req.hid, 'unexpected_dismissed', []); d.push(Number(req.body.id)); setSetting(req.hid, 'unexpected_dismissed', d.slice(-1000)); res.json({ ok: true }); });
api.get('/expenses/work', (req, res) => res.json(expenses.work(req.hid, req.query)));
api.post('/expenses/work/status', wrap(async (req, res) => { expenses.setWorkStatus(req.hid, (req.body.ids || []).map(Number), req.body.status, req.body); res.json({ ok: true }); }));
api.get('/expenses/work/reimbursements', (req, res) => res.json(expenses.possibleReimbursements(req.hid, Number(req.query.amount) || 0)));

// ---------------- workflows ----------------
api.post('/rules/preview', (req, res) => res.json(rules.previewRule(req.hid, req.body.conditions || [], req.body.match_all !== false)));
api.post('/rules/:id/apply', wrap(async (req, res) => {
  const r = q.get('SELECT * FROM rules WHERE id=? AND household_id=?', req.params.id, req.hid);
  if (!r || r.trigger !== 'transaction_created') throw err('Only transaction workflows can be applied to past transactions');
  const conds = JSON.parse(r.conditions); const hits = rules.previewRule(req.hid, conds, !!r.match_all, 100000);
  const noNotify = { ...r, actions: JSON.stringify(JSON.parse(r.actions).filter((a) => a.type !== 'notify')) };
  q.run('UPDATE rules SET actions=? WHERE id=?', noNotify.actions, r.id);
  try { for (const t of hits.sample) await rules.runRules(req.hid, 'transaction_created', t, { onlyRuleId: r.id }); }
  finally { q.run('UPDATE rules SET actions=? WHERE id=?', r.actions, r.id); }
  res.json({ applied: hits.count });
}));

// ---------------- budgets & goals ----------------
api.get('/budgets/status', (req, res) => res.json(q.all('SELECT * FROM budgets WHERE household_id=?', req.hid).map((b) => A.budgetStatus(req.hid, b, req.query.date ? new Date(req.query.date) : new Date()))));
api.get('/goals/status', (req, res) => res.json(q.all('SELECT * FROM goals WHERE household_id=?', req.hid).map(A.goalStatus)));
api.post('/goals/:id/contribute', (req, res) => {
  q.run('INSERT INTO goal_contributions(goal_id,amount,date,note) VALUES(?,?,?,?)', req.params.id, req.body.amount, A.iso(new Date()), req.body.note || null);
  q.run('UPDATE goals SET current_amount=current_amount+? WHERE id=? AND household_id=?', req.body.amount, req.params.id, req.hid);
  res.json({ ok: true });
});

// ---------------- insights, forecasts, reports, planner, inbox ----------------
api.get('/dashboard', (req, res) => {
  const ins = A.insights(req.hid);
  const fc = A.forecast(req.hid, { months: 6, years: 1 });
  const budgets = q.all('SELECT * FROM budgets WHERE household_id=?', req.hid).map((b) => A.budgetStatus(req.hid, b));
  const upcoming = q.all(`SELECT 'sub' type, merchant title, next_date date, amount FROM subscriptions WHERE household_id=? AND status IN ('active','cancelling') AND next_date BETWEEN ? AND ?
    UNION ALL SELECT 'event', title, substr(start,1,10), COALESCE(budget, estimated_cost) FROM events WHERE household_id=? AND start BETWEEN ? AND ? AND COALESCE(budget,estimated_cost) IS NOT NULL
    ORDER BY date LIMIT 12`, req.hid, A.iso(new Date()), A.iso(A.addDays(new Date(), 21)), req.hid, A.iso(new Date()), A.iso(A.addDays(new Date(), 21)));
  const accounts = q.all('SELECT * FROM accounts WHERE household_id=? AND archived=0 ORDER BY balance DESC', req.hid);
  // "Free until payday": spendable balance minus everything already committed before the next pay date
  const lastPay = q.get(`SELECT t.date FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.household_id=? AND c.name='Salary' ORDER BY t.date DESC LIMIT 1`, req.hid);
  let payday = null;
  if (lastPay) { const d = new Date(`${lastPay.date}T12:00:00`); while (d <= new Date()) d.setMonth(d.getMonth() + 1); payday = A.iso(d); }
  const until = payday || A.iso(A.addDays(new Date(), 30));
  const spendable = accounts.filter((a) => !['savings', 'investment', 'pension', 'loan', 'credit'].includes(a.type)).reduce((s, a) => s + a.balance, 0);
  const committed = q.get(`SELECT COALESCE(SUM(amount),0) v FROM subscriptions WHERE household_id=? AND status IN ('active','cancelling') AND next_date>=? AND next_date<?`, req.hid, A.iso(new Date()), until).v
    + q.get(`SELECT COALESCE(SUM(COALESCE(budget,estimated_cost)),0) v FROM events WHERE household_id=? AND start>=? AND start<?`, req.hid, A.iso(new Date()), until).v;
  const free = { payday, until, spendable: Math.round(spendable * 100) / 100, committed: Math.round(committed * 100) / 100, free: Math.round((spendable - committed) * 100) / 100,
    days: Math.max(1, Math.round((new Date(until) - new Date(A.iso(new Date()))) / 86400000)) };
  const trackerMonth = require('./tracker').month(req.hid, A.iso(new Date()).slice(0, 7)).totals;
  const work = require('./expenses').work(req.hid).totals;
  res.json({ free, tracker: trackerMonth, work, insights: ins, forecast: { balance: fc.balance, daily: fc.daily, lowPoint: fc.lowPoint, monthly: fc.monthly }, budgets, upcoming, accounts,
    inboxCount: A.inbox(req.hid).filter((i) => !i.soft).length, goals: q.all('SELECT * FROM goals WHERE household_id=?', req.hid).map(A.goalStatus) });
});
api.get('/insights', (req, res) => res.json(A.insights(req.hid)));
api.get('/yearly', (req, res) => res.json(A.yearly(req.hid)));
api.get('/forecast', (req, res) => res.json(A.forecast(req.hid, { months: Number(req.query.months) || 12, years: Number(req.query.years) || 5 })));
api.get('/categories/totals', (req, res) => res.json(A.categoryTotals(req.hid, req.query.from || '1970-01-01', req.query.to || '2999-12-31')));
api.post('/pivot', (req, res) => res.json(A.pivot(req.hid, req.body)));
api.get('/planner', (req, res) => res.json(A.planner(req.hid, Number(req.query.year) || new Date().getFullYear(), Number(req.query.user_id) || 0)));
api.put('/planner', (req, res) => {
  const { month, category_id, user_id = 0, amount, note } = req.body;
  if (amount === null || amount === '') q.run('DELETE FROM plan_cells WHERE household_id=? AND month=? AND category_id=? AND user_id=?', req.hid, month, category_id, user_id);
  else q.run(`INSERT INTO plan_cells VALUES(?,?,?,?,?,?) ON CONFLICT DO UPDATE SET amount=excluded.amount, note=excluded.note`, req.hid, month, category_id, user_id, Number(amount), note || null);
  res.json({ ok: true });
});
api.post('/planner/autofill', (req, res) => { A.plannerAutofill(req.hid, Number(req.body.year) || new Date().getFullYear(), Number(req.body.user_id) || 0, req.body.mode); res.json({ ok: true }); });
api.get('/inbox', (req, res) => res.json(A.inbox(req.hid)));
api.post('/inbox/dismiss', (req, res) => { const d = getSetting(req.hid, 'inbox_dismissed', []); d.push(req.body.id); setSetting(req.hid, 'inbox_dismissed', d.slice(-2000)); res.json({ ok: true }); });

// ---------------- calendars & events ----------------
api.post('/calendars/:id/sync', wrap(async (req, res) => res.json(await cal.syncCalendar(q.get('SELECT * FROM calendars WHERE id=? AND household_id=?', req.params.id, req.hid)))));
api.get('/events', (req, res) => {
  const from = req.query.from || A.iso(A.addDays(new Date(), -30)), to = req.query.to || A.iso(A.addDays(new Date(), 90));
  res.json(q.all(`SELECT e.*, cl.name calendar_name, COALESCE(e.color, cl.color, '#ec4899') color,
    (SELECT ROUND(COALESCE(SUM(-amount),0),2) FROM transactions WHERE event_id=e.id AND amount<0) spent
    FROM events e LEFT JOIN calendars cl ON cl.id=e.calendar_id WHERE e.household_id=? AND substr(e.start,1,10) BETWEEN ? AND ?
    ${req.query.costed === '1' ? 'AND (e.budget IS NOT NULL OR e.estimated_cost IS NOT NULL OR EXISTS(SELECT 1 FROM transactions WHERE event_id=e.id))' : ''}
    ORDER BY e.start`, req.hid, from, to));
});
api.post('/events', (req, res) => {
  const b = req.body;
  const r = q.run('INSERT INTO events(household_id,title,start,end,location,budget,estimated_cost,person_id,color,notes) VALUES(?,?,?,?,?,?,?,?,?,?)',
    req.hid, b.title, b.start, b.end || null, b.location || null, b.budget ?? null, b.estimated_cost ?? null, b.person_id ?? null, b.color || null, b.notes || null);
  res.json(q.get('SELECT * FROM events WHERE id=?', Number(r.lastInsertRowid)));
});
api.patch('/events/:id', (req, res) => {
  for (const k of ['title', 'start', 'end', 'location', 'budget', 'estimated_cost', 'person_id', 'color', 'notes']) if (req.body[k] !== undefined) q.run(`UPDATE events SET ${k}=? WHERE id=? AND household_id=?`, req.body[k] === '' ? null : req.body[k], req.params.id, req.hid);
  res.json(q.get('SELECT * FROM events WHERE id=?', req.params.id));
});
api.delete('/events/:id', (req, res) => { q.run('DELETE FROM events WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });
api.get('/events/:id/costs', (req, res) => res.json(cal.eventCostHistory(req.hid, Number(req.params.id))));
api.post('/events/:id/link', (req, res) => { for (const id of req.body.transaction_ids || []) q.run('UPDATE transactions SET event_id=? WHERE id=? AND household_id=?', req.body.unlink ? null : req.params.id, id, req.hid); res.json({ ok: true }); });

// ---------------- quick notes ----------------
api.get('/notes', (req, res) => res.json(q.all('SELECT * FROM notes WHERE household_id=? ORDER BY id DESC LIMIT 200', req.hid).map((n) => ({ ...n, parsed: JSON.parse(n.parsed || '{}') }))));
api.post('/notes', wrap(async (req, res) => {
  const out = await notes.processNote(req.hid, req.user.id, req.body.text, { useAI: req.body.use_ai !== false && ai.cfg(req.hid).enabled && ai.cfg(req.hid).features.smart_notes, accountId: req.body.account_id });
  if (out.created?.kind === 'transaction') scheduler.afterNewTransactions(req.hid).catch(() => {});
  res.json(out);
}));
api.post('/notes/:id/file', wrap(async (req, res) => res.json(await notes.fileNote(req.hid, req.user.id, Number(req.params.id), req.body.parsed, req.body.account_id))));
api.delete('/notes/:id', (req, res) => { q.run('DELETE FROM notes WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });

// ---------------- local AI ----------------
const aiT = require('./aitools');
// Streams newline-delimited JSON events: thread, tool, token, action, notice, done, error
api.post('/ai/chat', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const emit = (e) => { try { res.write(`${JSON.stringify(e)}\n`); } catch {} };
  try { await ai.assistant(req.hid, req.user.id, { message: String(req.body.message || ''), threadId: Number(req.body.thread_id) || null }, emit); }
  catch (e) { emit({ type: 'error', message: e.message }); }
  res.end();
});
api.get('/ai/threads', (req, res) => res.json(q.all('SELECT * FROM ai_threads WHERE household_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 50', req.hid, req.user.id)));
api.get('/ai/threads/:id', (req, res) => {
  const th = q.get('SELECT * FROM ai_threads WHERE id=? AND household_id=? AND user_id=?', req.params.id, req.hid, req.user.id);
  if (!th) return res.status(404).json({ error: 'Not found' });
  const msgs = q.all(`SELECT role, content, meta, created_at FROM ai_chats WHERE thread_id=? AND role IN ('user','assistant') ORDER BY id`, th.id).map((m) => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null }));
  const actions = q.all('SELECT * FROM ai_actions WHERE thread_id=? ORDER BY id', th.id);
  res.json({ thread: th, messages: msgs, actions });
});
api.delete('/ai/threads/:id', (req, res) => { q.run('DELETE FROM ai_chats WHERE thread_id=? AND household_id=?', req.params.id, req.hid); q.run('DELETE FROM ai_threads WHERE id=? AND household_id=? AND user_id=?', req.params.id, req.hid, req.user.id); res.json({ ok: true }); });
api.get('/ai/actions', (req, res) => res.json(q.all('SELECT * FROM ai_actions WHERE household_id=? AND status=? ORDER BY id DESC LIMIT 50', req.hid, req.query.status || 'pending')));
api.post('/ai/actions/:id/confirm', wrap(async (req, res) => {
  const a = q.get(`SELECT * FROM ai_actions WHERE id=? AND household_id=? AND status='pending'`, req.params.id, req.hid);
  if (!a) throw err('That suggestion has already been handled', 404);
  const result = aiT.executeAction(req.hid, req.user.id, a);
  q.run(`UPDATE ai_actions SET status='done', result=? WHERE id=?`, result, a.id);
  res.json({ ok: true, result });
}));
api.post('/ai/actions/:id/dismiss', (req, res) => { q.run(`UPDATE ai_actions SET status='dismissed' WHERE id=? AND household_id=?`, req.params.id, req.hid); res.json({ ok: true }); });
api.get('/ai/models', wrap(async (req, res) => res.json(await ai.listModels(req.hid))));
api.post('/ai/categorise', wrap(async (req, res) => res.json(await ai.aiCategorise(req.hid, Number(req.body.limit) || 40))));
api.post('/ai/search', wrap(async (req, res) => res.json(await ai.nlSearch(req.hid, String(req.body.q || '')))));
api.post('/ai/rule', wrap(async (req, res) => res.json(await ai.nlRule(req.hid, String(req.body.text || '')))));
api.post('/ai/receipt', wrap(async (req, res) => {
  const r = await ai.readReceipt(req.hid, req.user.id, String(req.body.image || ''));
  if (!r.matched) scheduler.afterNewTransactions(req.hid).catch(() => {});
  res.json(r);
}));
api.get('/ai/reports', (req, res) => res.json(q.all('SELECT id, kind, period, title, content, created_at FROM ai_reports WHERE household_id=? ORDER BY created_at DESC LIMIT 24', req.hid)));
api.post('/ai/review', wrap(async (req, res) => res.json(await ai.monthlyReview(req.hid, req.body.period))));
api.post('/ai/budget-suggestions', wrap(async (req, res) => res.json(await ai.budgetSuggestions(req.hid, req.user.id))));
api.post('/ai/subscription-review', wrap(async (req, res) => res.json(await ai.subscriptionReview(req.hid, req.user.id))));
api.post('/ai/events/:id/estimate', wrap(async (req, res) => res.json(await ai.eventEstimate(req.hid, Number(req.params.id)))));
api.get('/ai/log', (req, res) => res.json(q.all('SELECT * FROM ai_log WHERE household_id=? ORDER BY id DESC LIMIT 100', req.hid)));
api.post('/ai/undo-categorise', (req, res) => {
  const n = q.run(`UPDATE transactions SET category_id=NULL, categorised_by=NULL WHERE household_id=? AND categorised_by='ai' AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))`,
    req.hid, req.body.ids ? 1 : null, JSON.stringify(req.body.ids || [])).changes;
  res.json({ undone: n });
});
api.post('/ai/accept-categorise', (req, res) => {
  const rows = q.all(`SELECT id, merchant, category_id FROM transactions WHERE household_id=? AND categorised_by='ai'`, req.hid);
  const { learnMerchant } = require('./categorize');
  for (const r of rows) learnMerchant(req.hid, r.merchant, r.category_id);
  q.run(`UPDATE transactions SET categorised_by='learned' WHERE household_id=? AND categorised_by='ai'`, req.hid);
  res.json({ accepted: rows.length });
});

// ---------------- price watch ----------------
api.post('/watches/:id/check', wrap(async (req, res) => res.json(await prices.checkWatch(q.get('SELECT * FROM watches WHERE id=? AND household_id=?', req.params.id, req.hid)))));
api.get('/watch/search', (req, res) => {
  const integ = getSetting(req.hid, 'integrations', { pricerunner: true, url: true });
  res.json(prices.searchLinks(req.query.q || '').filter((l) => !l.provider || integ[l.provider] !== false));
});
api.get('/watches/:id/advice', (req, res) => { const w = q.get('SELECT * FROM watches WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ advice: prices.timingAdvice(JSON.parse(w?.history || '[]')) }); });

// ---------------- notifications & settings ----------------
api.get('/notifications', (req, res) => res.json(q.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', req.user.id)));
api.post('/notifications/read', (req, res) => { q.run('UPDATE notifications SET read=1 WHERE user_id=?', req.user.id); res.json({ ok: true }); });
const SETTING_KEYS = ['ollama', 'hass_sensors', 'tracker', 'email_check_minutes', 'homeassistant', 'ntfy', 'integrations', 'large_tx_threshold', 'bank_sync_hours', 'price_check_hours', 'digest', 'theme'];
api.get('/settings', (req, res) => {
  const out = {}; for (const k of SETTING_KEYS) out[k] = getSetting(req.hid, k);
  if (out.homeassistant?.token) out.homeassistant = { ...out.homeassistant, token: '••••••' };
  res.json(out);
});
api.put('/settings', (req, res) => {
  for (const k of SETTING_KEYS) if (req.body[k] !== undefined) {
    let v = req.body[k];
    if (k === 'homeassistant' && v?.token === '••••••') v = { ...v, token: getSetting(req.hid, 'homeassistant')?.token };
    setSetting(req.hid, k, v);
  }
  if (req.body.household_name) q.run('UPDATE households SET name=? WHERE id=?', req.body.household_name, req.hid);
  res.json({ ok: true });
});
const ha = require('./ha');
api.get('/homeassistant/status', wrap(async (req, res) => {
  const t = ha.target(req.hid);
  if (!t) return res.json({ connected: false, addon: config.isAddon });
  try { const c = await ha.call(req.hid, 'GET', '/config'); res.json({ connected: true, via: t.via, version: c.version, location: c.location_name, addon: config.isAddon }); }
  catch (e) { res.json({ connected: false, via: t.via, error: e.message, addon: config.isAddon }); }
}));
api.get('/homeassistant/services', wrap(async (req, res) => res.json(await ha.notifyServices(req.hid))));
api.get('/homeassistant/calendars', wrap(async (req, res) => res.json(await ha.calendars(req.hid))));
api.post('/sync-all', wrap(async (req, res) => { await scheduler.tick(); res.json({ ok: true }); }));
api.get('/backup', (req, res) => {
  const tables = ['accounts', 'categories', 'transactions', 'tags', 'transaction_tags', 'people', 'rules', 'budgets', 'goals', 'events', 'notes', 'subscriptions', 'subscription_payments', 'email_receipts', 'watches', 'plan_cells', 'saved_views'];
  const out = { exported_at: new Date().toISOString() };
  for (const t of tables) out[t] = t === 'transaction_tags' ? q.all('SELECT tt.* FROM transaction_tags tt JOIN transactions t ON t.id=tt.transaction_id WHERE t.household_id=?', req.hid) : q.all(`SELECT * FROM ${t} WHERE household_id=?`, req.hid);
  res.setHeader('Content-Disposition', `attachment; filename="hearth-backup-${A.iso(new Date())}.json"`);
  res.json(out);
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));
app.use('/api', (e, req, res, next) => { console.error(e); res.status(500).json({ error: e.message }); });
// Before an HA backup: fold the write-ahead log into the main database file (localhost only)
app.get('/internal/checkpoint', (req, res) => {
  const ip = String(req.socket.remoteAddress || '').replace('::ffff:', '');
  if (!['127.0.0.1', '::1'].includes(ip)) return res.status(403).end();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); res.send('ok');
});

// index.html gets a <base> so every asset and API call is relative — required inside HA's ingress proxy
const INDEX = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const sendIndex = (req, res) => {
  const base = String(req.headers['x-ingress-path'] || '').replace(/[^\w\-/.]/g, '');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(INDEX.replace('<base href="/">', `<base href="${base}/">`));
};
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, index: false }));
app.get(/^\/(?!api).*/, sendIndex);

const PORT = config.port;
if (require.main === module) {
  app.listen(PORT, () => { log.info(`Hearth ${config.isAddon ? 'add-on ' : ''}running on port ${PORT} · data in ${DATA_DIR}`); scheduler.start(); });
}
module.exports = app;
