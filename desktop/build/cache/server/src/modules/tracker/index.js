// Regular payments — Subscription and bill detection, due dates, this month's checklist and history.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const { detectSubscriptions } = require('./subscriptions');
const tracker = require('./tracker');
const A = require('../insights/analytics');
const { wrap, err } = require('../../core/http');

const INTERVAL = { weekly: 7, fortnightly: 14, monthly: 30.4, quarterly: 91, yearly: 365 };

// Routes for signed-in users
function routes(api) {
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
}

module.exports = { name: 'tracker', title: 'Regular payments', routes };
