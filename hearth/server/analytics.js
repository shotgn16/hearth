// Budgets, goals, insights, forecasting, pivot reports, cash-flow planner and the "Needs attention" inbox.
const { q } = require('./db');

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const ym = (d) => iso(d).slice(0, 7);
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
const addMonths = (d, n) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth() + n, Math.min(x.getDate(), 28), 12); };
const round = (n) => Math.round(n * 100) / 100;

// ---------- budgets ----------
function periodWindow(b, ref = new Date()) {
  const d = new Date(ref);
  switch (b.period) {
    case 'weekly': { const day = (d.getDay() + 6) % 7; const s = addDays(d, -day); return [iso(s), iso(addDays(s, 6))]; }
    case 'monthly': return [iso(new Date(d.getFullYear(), d.getMonth(), 1, 12)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))];
    case 'quarterly': { const qs = Math.floor(d.getMonth() / 3) * 3; return [iso(new Date(d.getFullYear(), qs, 1, 12)), iso(new Date(d.getFullYear(), qs + 3, 0, 12))]; }
    case 'yearly': return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
    default: return [b.start_date || '1970-01-01', b.end_date || '2999-12-31']; // custom / one-off / event
  }
}

function scopeFilter(scope, userId, personId) {
  // "individual" = spending by that user (who made it, or from an account they own); "shared" = whole household
  if (scope === 'individual' && userId) return { sql: ' AND (t.user_id=? OR a.owner_user_id=?)', params: [userId, userId] };
  if (scope === 'person' && personId) return { sql: ' AND t.person_id=?', params: [personId] };
  return { sql: '', params: [] };
}

function budgetStatus(hid, b, ref = new Date()) {
  const [start, end] = periodWindow(b, ref);
  const cats = JSON.parse(b.category_ids || '[]'), tags = JSON.parse(b.tag_ids || '[]');
  let sql = `SELECT COALESCE(SUM(-t.amount),0) spent, COUNT(*) n FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
             WHERE t.household_id=? AND t.date BETWEEN ? AND ? AND t.amount<0`;
  const params = [hid, start, end];
  if (cats.length) { sql += ` AND t.category_id IN (${cats.map(() => '?').join(',')})`; params.push(...cats); }
  else sql += ` AND COALESCE((SELECT kind FROM categories WHERE id=t.category_id),'expense')!='transfer'`;
  if (tags.length) { sql += ` AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tags.map(() => '?').join(',')}))`; params.push(...tags); }
  if (b.event_id) { sql += ' AND t.event_id=?'; params.push(b.event_id); }
  const sf = scopeFilter(b.scope, b.user_id, b.person_id); sql += sf.sql; params.push(...sf.params);
  const { spent, n } = q.get(sql, ...params);
  const totalDays = (new Date(end) - new Date(start)) / 86400000 + 1;
  const elapsed = Math.min(totalDays, Math.max(1, (new Date(iso(ref)) - new Date(start)) / 86400000 + 1));
  const pace = spent / elapsed * totalDays;
  return { ...b, start, end, spent: round(spent), remaining: round(b.amount - spent), pct: b.amount ? Math.round(spent / b.amount * 100) : 0,
    projected: round(pace), on_track: pace <= b.amount, count: n, days_left: Math.max(0, Math.ceil(totalDays - elapsed)) };
}

function goalStatus(g) {
  const pct = g.target_amount ? Math.min(100, Math.round(g.current_amount / g.target_amount * 100)) : 0;
  let monthly_needed = null;
  if (g.target_date) {
    const months = Math.max(1, (new Date(g.target_date) - new Date()) / (30.4 * 86400000));
    monthly_needed = round(Math.max(0, g.target_amount - g.current_amount) / months);
  }
  return { ...g, pct, remaining: round(g.target_amount - g.current_amount), monthly_needed };
}

// ---------- insights ----------
function monthlyTotals(hid, months = 24) {
  const from = ym(addMonths(new Date(), -months + 1)) + '-01';
  return q.all(`SELECT substr(t.date,1,7) month,
      ROUND(SUM(CASE WHEN t.amount>0 AND COALESCE(c.kind,'')!='transfer' THEN t.amount ELSE 0 END),2) income,
      ROUND(SUM(CASE WHEN t.amount<0 AND COALESCE(c.kind,'')!='transfer' THEN -t.amount ELSE 0 END),2) spending
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.household_id=? AND t.date>=? GROUP BY month ORDER BY month`, hid, from);
}

function categoryTotals(hid, start, end) {
  return q.all(`SELECT c.id, COALESCE(c.name,'Uncategorised') name, COALESCE(c.color,'#94a3b8') color, c.icon, ROUND(SUM(-t.amount),2) total, COUNT(*) n
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.household_id=? AND t.date BETWEEN ? AND ? AND t.amount<0 AND COALESCE(c.kind,'expense')!='transfer'
    GROUP BY c.id ORDER BY total DESC`, hid, start, end);
}

function insights(hid) {
  const now = new Date();
  const thisStart = iso(new Date(now.getFullYear(), now.getMonth(), 1, 12));
  const today = iso(now);
  const dayOfMonth = now.getDate();
  const lastStart = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1, 12));
  const lastSameDay = iso(new Date(now.getFullYear(), now.getMonth() - 1, Math.min(dayOfMonth, new Date(now.getFullYear(), now.getMonth(), 0).getDate()), 12));
  const lyStart = iso(new Date(now.getFullYear() - 1, now.getMonth(), 1, 12));
  const lyEnd = iso(new Date(now.getFullYear() - 1, now.getMonth() + 1, 0, 12));
  const thisCats = categoryTotals(hid, thisStart, today);
  const lastCats = categoryTotals(hid, lastStart, lastSameDay);
  const lyCats = categoryTotals(hid, lyStart, lyEnd);
  const sum = (a) => round(a.reduce((s, x) => s + x.total, 0));
  const cards = [];
  const thisTotal = sum(thisCats), lastTotal = sum(lastCats);
  if (lastTotal > 0) {
    const diff = thisTotal - lastTotal;
    cards.push({ tone: diff > 0 ? 'warn' : 'good', title: `£${Math.abs(diff).toFixed(0)} ${diff > 0 ? 'more' : 'less'} than this time last month`,
      body: `£${thisTotal.toFixed(0)} spent so far this month vs £${lastTotal.toFixed(0)} by day ${dayOfMonth} last month.` });
  }
  for (const c of thisCats.slice(0, 8)) {
    const prev = lastCats.find((x) => x.id === c.id)?.total || 0;
    if (prev > 20 && c.total > prev * 1.3) cards.push({ tone: 'warn', title: `${c.icon || ''} ${c.name} is running hot`, body: `£${c.total.toFixed(0)} vs £${prev.toFixed(0)} at this point last month (+${Math.round((c.total / prev - 1) * 100)}%).` });
  }
  const subs = q.all(`SELECT * FROM subscriptions WHERE household_id=? AND status='active'`, hid);
  const perYear = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 };
  const annual = round(subs.reduce((s, x) => s + x.amount * (perYear[x.cadence] || 12), 0));
  const onlySubs = subs.filter((s) => s.type === 'subscription');
  const subAnnual = round(onlySubs.reduce((s, x) => s + x.amount * (perYear[x.cadence] || 12), 0));
  if (onlySubs.length) cards.push({ tone: 'info', title: `${onlySubs.length} subscriptions · £${subAnnual.toFixed(0)}/year`, body: `Plus £${((annual - subAnnual) / 12).toFixed(0)}/month in regular bills. Everything recurring: £${(annual / 12).toFixed(0)}/month.` });
  // unusual transactions: >3× that merchant's median in the last 30 days
  const recent = q.all(`SELECT * FROM transactions WHERE household_id=? AND date>=? AND amount<0`, hid, iso(addDays(now, -30)));
  for (const t of recent) {
    const hist = q.all(`SELECT -amount a FROM transactions WHERE household_id=? AND merchant=? AND amount<0 AND id!=?`, hid, t.merchant, t.id).map((x) => x.a).sort((a, b) => a - b);
    if (hist.length >= 4) { const med = hist[Math.floor(hist.length / 2)]; if (-t.amount > med * 3 && -t.amount > 30) cards.push({ tone: 'warn', title: `Unusual: £${(-t.amount).toFixed(2)} at ${t.merchant}`, body: `You usually spend about £${med.toFixed(2)} there.`, tx: t.id }); }
  }
  const months = monthlyTotals(hid, 13);
  const yearAgo = months.find((m) => m.month === ym(lyStart));
  if (yearAgo) cards.push({ tone: 'info', title: `Same month last year: £${yearAgo.spending.toFixed(0)} spent`, body: `Top then: ${lyCats.slice(0, 3).map((c) => c.name).join(', ') || '—'}.` });
  const topMerchants = q.all(`SELECT merchant, ROUND(SUM(-amount),2) total, COUNT(*) n FROM transactions WHERE household_id=? AND date>=? AND amount<0 GROUP BY merchant ORDER BY total DESC LIMIT 10`, hid, iso(addDays(now, -90)));
  return { cards, thisMonth: { total: thisTotal, categories: thisCats }, months, topMerchants, annualSubscriptions: annual, annualRecurring: annual };
}

function yearly(hid) {
  const rows = q.all(`SELECT substr(t.date,1,4) year, substr(t.date,6,2) m,
      ROUND(SUM(CASE WHEN t.amount<0 AND COALESCE(c.kind,'')!='transfer' THEN -t.amount ELSE 0 END),2) spending,
      ROUND(SUM(CASE WHEN t.amount>0 AND COALESCE(c.kind,'')!='transfer' THEN t.amount ELSE 0 END),2) income
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.household_id=? GROUP BY year, m ORDER BY year, m`, hid);
  const years = {};
  for (const r of rows) { (years[r.year] ||= { year: r.year, months: Array(12).fill(0), income: 0, spending: 0 }); years[r.year].months[Number(r.m) - 1] = r.spending; years[r.year].income += r.income; years[r.year].spending += r.spending; }
  return Object.values(years).map((y) => ({ ...y, income: round(y.income), spending: round(y.spending), saved: round(y.income - y.spending) }));
}

// ---------- forecast ----------
// Blends: known recurring payments (exact dates), seasonal category averages (same month in past years when available),
// income averages, your planner entries and event budgets. Returns weekly, monthly and yearly horizons.
function forecast(hid, { months = 12, years = 3 } = {}) {
  const now = new Date();
  const balance = q.get('SELECT COALESCE(SUM(balance),0) b FROM accounts WHERE household_id=? AND archived=0', hid).b;
  const hist = monthlyTotals(hid, 24);
  const recent = hist.filter((m) => m.month < ym(now)).slice(-6);
  const avgIncome = recent.length ? recent.reduce((s, m) => s + m.income, 0) / recent.length : 0;
  const subs = q.all(`SELECT * FROM subscriptions WHERE household_id=? AND status='active'`, hid);
  const subMonthly = subs.reduce((s, x) => s + x.amount * (30.4 / (x.interval_days || 30.4)), 0);
  const recentSpend = recent.length ? recent.reduce((s, m) => s + m.spending, 0) / recent.length : 0;
  const discretionary = Math.max(0, recentSpend - subMonthly);
  const overallAvg = hist.length ? hist.reduce((s, m) => s + m.spending, 0) / hist.length : 0;
  const seasonal = (mm) => { const same = hist.filter((h) => h.month.slice(5) === mm); if (!same.length || !overallAvg) return 1; return Math.min(1.6, Math.max(0.6, same.reduce((s, h) => s + h.spending, 0) / same.length / overallAvg)); };
  const events = q.all(`SELECT start, COALESCE(budget, estimated_cost, 0) cost, title FROM events WHERE household_id=? AND start>=? AND COALESCE(budget,estimated_cost,0)>0`, hid, iso(now));
  const plans = q.all(`SELECT month, SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END) spend, SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) inc
                       FROM plan_cells WHERE household_id=? AND user_id=0 AND month>=? GROUP BY month`, hid, ym(now));

  // daily for next 8 weeks
  const daily = []; let bal = balance;
  const dailyDisc = discretionary / 30.4, dailyIncome = avgIncome / 30.4;
  for (let i = 1; i <= 56; i++) {
    const d = addDays(now, i), ds = iso(d);
    let out = dailyDisc * seasonal(ds.slice(5, 7));
    for (const s of subs) { let n = new Date(s.next_date); while (n < d && iso(n) !== ds) n = addDays(n, s.interval_days); if (iso(n) === ds) out += s.amount; }
    out += events.filter((e) => e.start.slice(0, 10) === ds).reduce((s, e) => s + e.cost, 0);
    bal += dailyIncome - out;
    daily.push({ date: ds, balance: round(bal), out: round(out) });
  }
  const weekly = daily.filter((_, i) => i % 7 === 6).map((d, i) => ({ label: `Wk ${i + 1}`, date: d.date, balance: d.balance }));

  const monthly = []; bal = balance;
  for (let i = 1; i <= months; i++) {
    const m = ym(addMonths(now, i));
    const plan = plans.find((p) => p.month === m);
    const ev = events.filter((e) => e.start.slice(0, 7) === m).reduce((s, e) => s + e.cost, 0);
    const spend = (plan?.spend ? plan.spend : discretionary * seasonal(m.slice(5)) + subMonthly) + ev;
    const income = plan?.inc ? plan.inc : avgIncome;
    bal += income - spend;
    monthly.push({ month: m, income: round(income), spending: round(spend), events: round(ev), balance: round(bal), planned: !!plan });
  }
  const yearlyF = []; bal = balance;
  const netYear = (avgIncome - discretionary - subMonthly) * 12;
  for (let y = 1; y <= years; y++) { bal += netYear * Math.pow(0.98, y - 1); yearlyF.push({ year: now.getFullYear() + y, balance: round(bal), net: round(netYear) }); }
  const lowPoint = daily.reduce((m, d) => (d.balance < m.balance ? d : m), daily[0] || { balance });
  return { balance: round(balance), avgIncome: round(avgIncome), avgSpending: round(recentSpend), subscriptionsMonthly: round(subMonthly), daily, weekly, monthly, yearly: yearlyF, lowPoint };
}

// ---------- pivot (spreadsheet replacement) ----------
const DIMS = {
  month: "substr(t.date,1,7)", week: "strftime('%Y-W%W', t.date)", year: "substr(t.date,1,4)", day: 't.date',
  category: "COALESCE(c.name,'Uncategorised')", merchant: 't.merchant', person: "COALESCE(p.name,'—')", account: "COALESCE(a.name,'—')",
  user: "COALESCE(u.name,'—')", event: "COALESCE(e.title,'—')", kind: 't.kind', weekday: "strftime('%w', t.date)",
};
function pivot(hid, { rows = 'category', cols = 'month', measure = 'spending', from, to, filter = {} }) {
  const m = { spending: 'SUM(CASE WHEN t.amount<0 THEN -t.amount ELSE 0 END)', income: 'SUM(CASE WHEN t.amount>0 THEN t.amount ELSE 0 END)', net: 'SUM(t.amount)', count: 'COUNT(*)', average: 'AVG(ABS(t.amount))' }[measure] || 'SUM(-t.amount)';
  const r = DIMS[rows] || DIMS.category, c = cols && cols !== 'none' ? DIMS[cols] || DIMS.month : "'Total'";
  let where = 't.household_id=?'; const params = [hid];
  if (from) { where += ' AND t.date>=?'; params.push(from); }
  if (to) { where += ' AND t.date<=?'; params.push(to); }
  if (filter.category_id) { where += ' AND t.category_id=?'; params.push(filter.category_id); }
  if (filter.person_id) { where += ' AND t.person_id=?'; params.push(filter.person_id); }
  if (filter.user_id) { where += ' AND (t.user_id=? OR a.owner_user_id=?)'; params.push(filter.user_id, filter.user_id); }
  if (measure === 'spending') where += " AND COALESCE(c.kind,'expense')!='transfer'";
  const data = q.all(`SELECT ${r} r, ${c} c, ROUND(${m},2) v FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
    LEFT JOIN people p ON p.id=t.person_id LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN users u ON u.id=t.user_id
    LEFT JOIN events e ON e.id=t.event_id WHERE ${where} GROUP BY r, c`, ...params);
  const rowKeys = [...new Set(data.map((d) => d.r))], colKeys = [...new Set(data.map((d) => d.c))].sort();
  const grid = rowKeys.map((rk) => { const cells = colKeys.map((ck) => data.find((d) => d.r === rk && d.c === ck)?.v || 0); return { key: rk, cells, total: round(cells.reduce((s, x) => s + x, 0)) }; })
    .sort((a, b) => b.total - a.total);
  const colTotals = colKeys.map((_, i) => round(grid.reduce((s, g) => s + g.cells[i], 0)));
  return { rows: grid, cols: colKeys, colTotals, grandTotal: round(colTotals.reduce((s, x) => s + x, 0)) };
}

// ---------- cash-flow planner: plan per category per month; actuals fill themselves ----------
function planner(hid, year, userId = 0) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const cats = q.all('SELECT * FROM categories WHERE household_id=? ORDER BY kind DESC, name', hid);
  const actual = q.all(`SELECT category_id, substr(date,1,7) m, ROUND(SUM(amount),2) v FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
    WHERE t.household_id=? AND substr(date,1,4)=? ${userId ? 'AND (t.user_id=? OR a.owner_user_id=?)' : ''} GROUP BY category_id, m`,
    ...[hid, String(year), ...(userId ? [userId, userId] : [])]);
  const plan = q.all('SELECT * FROM plan_cells WHERE household_id=? AND substr(month,1,4)=? AND user_id=?', hid, String(year), userId);
  const rows = cats.map((c) => ({
    category: c, cells: months.map((m) => ({ month: m, plan: plan.find((p) => p.category_id === c.id && p.month === m)?.amount ?? null,
      actual: actual.find((a) => a.category_id === c.id && a.m === m)?.v ?? 0 })),
  }));
  return { months, rows };
}

// Copy last month's plan forward / fill from 3-month average — the "drag the formula across" equivalent
function plannerAutofill(hid, year, userId = 0, mode = 'average') {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const cats = q.all('SELECT id FROM categories WHERE household_id=?', hid);
  for (const c of cats) {
    const avg = q.get(`SELECT ROUND(SUM(amount)/3.0,2) v FROM transactions WHERE household_id=? AND category_id=? AND date>=?`, hid, c.id, iso(addMonths(new Date(), -3))).v || 0;
    if (!avg) continue;
    for (const m of months) {
      if (m < ym(new Date())) continue;
      q.run(`INSERT INTO plan_cells(household_id,month,category_id,user_id,amount) VALUES(?,?,?,?,?) ON CONFLICT DO ${mode === 'overwrite' ? 'UPDATE SET amount=excluded.amount' : 'NOTHING'}`, hid, m, c.id, userId, avg);
    }
  }
}

// ---------- the inbox: only things that genuinely need a human ----------
function inbox(hid) {
  const items = [];
  const uncategorised = q.all(`SELECT * FROM transactions WHERE household_id=? AND category_id IS NULL ORDER BY date DESC LIMIT 50`, hid);
  for (const t of uncategorised) items.push({ type: 'categorise', id: `tx-${t.id}`, tx: t, title: `What was ${t.merchant}?`, body: `£${Math.abs(t.amount).toFixed(2)} on ${t.date}` });
  const newSubs = q.all(`SELECT * FROM subscriptions WHERE household_id=? AND confirmed=0 AND status='active' AND type='subscription'`, hid);
  for (const s of newSubs) items.push({ type: 'subscription', id: `sub-${s.id}`, sub: s, title: `Is ${s.merchant} a subscription?`, body: `Looks ${s.cadence} at £${s.amount.toFixed(2)}` });
  const notes = q.all(`SELECT * FROM notes WHERE household_id=? AND status='needs_review'`, hid);
  for (const n of notes) items.push({ type: 'note', id: `note-${n.id}`, note: { ...n, parsed: JSON.parse(n.parsed || '{}') }, title: `Check this note`, body: n.text });
  const budgets = q.all('SELECT * FROM budgets WHERE household_id=?', hid).map((b) => budgetStatus(hid, b)).filter((b) => b.pct >= b.alert_pct && (!b.end_date || b.end_date >= iso(new Date())));
  for (const b of budgets) items.push({ type: 'budget', id: `budget-${b.id}`, budget: b, title: `${b.name}: ${b.pct}% used`, body: `${b.remaining >= 0 ? `£${b.remaining.toFixed(0)} left` : `£${(-b.remaining).toFixed(0)} over`}, ${b.days_left ? `${b.days_left} days to go` : 'last day of the period'}` });
  const soon = q.all(`SELECT * FROM events WHERE household_id=? AND start BETWEEN ? AND ? AND budget IS NULL AND estimated_cost IS NULL`, hid, iso(new Date()), iso(addDays(new Date(), 14)));
  for (const e of soon.slice(0, 5)) items.push({ type: 'event', id: `event-${e.id}`, event: e, title: `Will "${e.title}" cost anything?`, body: `${e.start.slice(0, 10)} — set a budget or dismiss`, soft: true });
  const aiFiled = q.get(`SELECT COUNT(*) n FROM transactions WHERE household_id=? AND categorised_by='ai'`, hid).n;
  if (aiFiled) items.push({ type: 'ai_check', id: `ai-${aiFiled}`, title: `The AI filed ${aiFiled} transaction${aiFiled > 1 ? 's' : ''}`, body: 'Glance over them, then accept so Hearth remembers', count: aiFiled });
  for (const a of q.all(`SELECT * FROM ai_actions WHERE household_id=? AND status='pending' AND created_at>=datetime('now','-14 days') ORDER BY id DESC LIMIT 5`, hid))
    items.push({ type: 'ai_action', id: `act-${a.id}`, action: a, title: 'Suggestion from Hearth', body: a.summary, soft: true });
  const dismissed = new Set(JSON.parse(q.get(`SELECT value FROM settings WHERE household_id=? AND key='inbox_dismissed'`, hid)?.value || '[]'));
  return items.filter((i) => !dismissed.has(i.id));
}

module.exports = { budgetStatus, goalStatus, insights, yearly, forecast, pivot, planner, plannerAutofill, inbox, categoryTotals, monthlyTotals, periodWindow, iso, addDays };
