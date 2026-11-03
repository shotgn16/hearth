// Unexpected & work — Unexpected costs and work expense claims.
// Each module adds its API routes here; see docs/customising.md.
const { getSetting, setSetting } = require('../../core/db');
const expenses = require('./expenses');
const { wrap } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  api.get('/expenses/unexpected', (req, res) => res.json(expenses.unexpected(req.hid, req.query)));
  api.post('/expenses/unexpected/dismiss', (req, res) => { const d = getSetting(req.hid, 'unexpected_dismissed', []); d.push(Number(req.body.id)); setSetting(req.hid, 'unexpected_dismissed', d.slice(-1000)); res.json({ ok: true }); });
  api.get('/expenses/work', (req, res) => res.json(expenses.work(req.hid, req.query)));
  api.post('/expenses/work/status', wrap(async (req, res) => { expenses.setWorkStatus(req.hid, (req.body.ids || []).map(Number), req.body.status, req.body); res.json({ ok: true }); }));
  api.get('/expenses/work/reimbursements', (req, res) => res.json(expenses.possibleReimbursements(req.hid, Number(req.query.amount) || 0)));
}

module.exports = { name: 'expenses', title: 'Unexpected & work', routes };
