// Insights — Today screen, insights, forecasts, pivot reports and Needs attention.
// Each module adds its API routes here; see docs/customising.md.
const { q, getSetting, setSetting } = require('../../core/db');
const A = require('./analytics');

// Routes for signed-in users
function routes(api) {
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
    const trackerMonth = require('../tracker/tracker').month(req.hid, A.iso(new Date()).slice(0, 7)).totals;
    const work = require('../expenses/expenses').work(req.hid).totals;
    res.json({ free, tracker: trackerMonth, work, insights: ins, forecast: { balance: fc.balance, daily: fc.daily, lowPoint: fc.lowPoint, monthly: fc.monthly }, budgets, upcoming, accounts,
      inboxCount: A.inbox(req.hid).filter((i) => !i.soft).length, goals: q.all('SELECT * FROM goals WHERE household_id=?', req.hid).map(A.goalStatus) });
  });
  api.get('/insights', (req, res) => res.json(A.insights(req.hid)));
  api.get('/yearly', (req, res) => res.json(A.yearly(req.hid)));
  api.get('/forecast', (req, res) => res.json(A.forecast(req.hid, { months: Number(req.query.months) || 12, years: Number(req.query.years) || 5 })));
  api.get('/categories/totals', (req, res) => res.json(A.categoryTotals(req.hid, req.query.from || '1970-01-01', req.query.to || '2999-12-31')));
  api.post('/pivot', (req, res) => res.json(A.pivot(req.hid, req.body)));
  api.get('/inbox', (req, res) => res.json(A.inbox(req.hid)));
  api.post('/inbox/dismiss', (req, res) => { const d = getSetting(req.hid, 'inbox_dismissed', []); d.push(req.body.id); setSetting(req.hid, 'inbox_dismissed', d.slice(-2000)); res.json({ ok: true }); });
}

module.exports = { name: 'insights', title: 'Insights', routes };
