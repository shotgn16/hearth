// Budgets, goals & planner — Budgets, savings targets and the year planner.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const A = require('../insights/analytics');
const { crud } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  crud(api, 'budgets', ['name', 'amount', 'period', 'start_date', 'end_date', 'category_ids', 'tag_ids', 'scope', 'user_id', 'person_id', 'event_id', 'alert_pct', 'rollover', 'color', 'flag'], { json: ['category_ids', 'tag_ids'] });
  crud(api, 'goals', ['name', 'kind', 'target_amount', 'current_amount', 'target_date', 'account_id', 'scope', 'user_id', 'color']);
  api.get('/budgets/status', (req, res) => res.json(q.all('SELECT * FROM budgets WHERE household_id=?', req.hid).map((b) => A.budgetStatus(req.hid, b, req.query.date ? new Date(req.query.date) : new Date()))));
  api.get('/goals/status', (req, res) => res.json(q.all('SELECT * FROM goals WHERE household_id=?', req.hid).map(A.goalStatus)));
  api.post('/goals/:id/contribute', (req, res) => {
    q.run('INSERT INTO goal_contributions(goal_id,amount,date,note) VALUES(?,?,?,?)', req.params.id, req.body.amount, A.iso(new Date()), req.body.note || null);
    q.run('UPDATE goals SET current_amount=current_amount+? WHERE id=? AND household_id=?', req.body.amount, req.params.id, req.hid);
    res.json({ ok: true });
  });
  api.get('/planner', (req, res) => res.json(A.planner(req.hid, Number(req.query.year) || new Date().getFullYear(), Number(req.query.user_id) || 0)));
  api.put('/planner', (req, res) => {
    const { month, category_id, user_id = 0, amount, note } = req.body;
    if (amount === null || amount === '') q.run('DELETE FROM plan_cells WHERE household_id=? AND month=? AND category_id=? AND user_id=?', req.hid, month, category_id, user_id);
    else q.run(`INSERT INTO plan_cells VALUES(?,?,?,?,?,?) ON CONFLICT DO UPDATE SET amount=excluded.amount, note=excluded.note`, req.hid, month, category_id, user_id, Number(amount), note || null);
    res.json({ ok: true });
  });
  api.post('/planner/autofill', (req, res) => { A.plannerAutofill(req.hid, Number(req.body.year) || new Date().getFullYear(), Number(req.body.user_id) || 0, req.body.mode); res.json({ ok: true }); });
}

module.exports = { name: 'planning', title: 'Budgets, goals & planner', routes };
