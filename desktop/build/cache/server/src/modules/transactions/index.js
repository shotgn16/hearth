// Transactions — The transaction list / spreadsheet: search, edit, bulk edit, export, saved views.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const { learnMerchant } = require('./categorize');
const ING = require('./ingest');
const scheduler = require('../../jobs/scheduler');
const { wrap, err, crud } = require('../../core/http');

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

// Routes for signed-in users
function routes(api) {
  crud(api, 'saved_views', ['user_id', 'name', 'kind', 'config', 'pinned'], { json: ['config'] });
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
  api.patch('/transactions/:id', wrap(async (req, res) => { const n = patchTx(req.hid, [Number(req.params.id)], req.body); res.json({ ok: true, also_updated: n }); }));
  api.post('/transactions/bulk', wrap(async (req, res) => { const n = patchTx(req.hid, req.body.ids || [], req.body.patch || {}); res.json({ ok: true, also_updated: n }); }));
  api.post('/transactions/bulk-delete', (req, res) => { for (const id of req.body.ids || []) q.run('DELETE FROM transactions WHERE id=? AND household_id=?', id, req.hid); res.json({ ok: true }); });
  api.delete('/transactions/:id', (req, res) => { q.run('DELETE FROM transactions WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });
}

module.exports = { name: 'transactions', title: 'Transactions', routes };
