// Tools the local AI can call to look things up in your data, and actions it can propose (you confirm them in the app).
const { q } = require('./db');
const A = require('./analytics');
const { categoryIdByName } = require('./categorize');

const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const today = () => A.iso(new Date());
const monthStart = () => { const d = new Date(); return A.iso(new Date(d.getFullYear(), d.getMonth(), 1, 12)); };

function findCategory(hid, name) {
  if (!name) return null;
  const cats = q.all('SELECT id, name FROM categories WHERE household_id=?', hid);
  const n = String(name).toLowerCase();
  return cats.find((c) => c.name.toLowerCase() === n) || cats.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase().split(' ')[0])) || null;
}
const findUser = (hid, name) => (name ? q.get('SELECT id, name FROM users WHERE household_id=? AND LOWER(name)=LOWER(?)', hid, name) : null);
const findPerson = (hid, name) => (name ? q.get('SELECT id, name FROM people WHERE household_id=? AND LOWER(name)=LOWER(?)', hid, name) : null);

function freeUntilPayday(hid) {
  const accounts = q.all('SELECT * FROM accounts WHERE household_id=? AND archived=0', hid);
  const lastPay = q.get(`SELECT t.date FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.household_id=? AND c.name='Salary' ORDER BY t.date DESC LIMIT 1`, hid);
  let payday = null;
  if (lastPay) { const d = new Date(`${lastPay.date}T12:00:00`); while (d <= new Date()) d.setMonth(d.getMonth() + 1); payday = A.iso(d); }
  const until = payday || A.iso(A.addDays(new Date(), 30));
  const spendable = accounts.filter((a) => !['savings', 'investment', 'pension', 'loan', 'credit'].includes(a.type)).reduce((s, a) => s + a.balance, 0);
  const committed = q.get(`SELECT COALESCE(SUM(amount),0) v FROM subscriptions WHERE household_id=? AND status='active' AND next_date>=? AND next_date<?`, hid, today(), until).v
    + q.get(`SELECT COALESCE(SUM(COALESCE(budget,estimated_cost)),0) v FROM events WHERE household_id=? AND start>=? AND start<?`, hid, today(), until).v;
  return { payday, until, spendable: r2(spendable), committed: r2(committed), free: r2(spendable - committed), days: Math.max(1, Math.round((new Date(until) - new Date(today())) / 86400000)), balance: r2(accounts.reduce((s, a) => s + a.balance, 0)) };
}

const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = (description) => ({ type: 'string', description });
const N = (description) => ({ type: 'number', description });

const DEFINITIONS = [
  fn('get_overview', 'Current balances, money free until next payday, spending so far this month and number of items needing attention. Call this first for any "how am I doing" question.'),
  fn('spending_by_category', 'Total spending per category for a date range.', { from: S('Start date YYYY-MM-DD'), to: S('End date YYYY-MM-DD'), user: S('Optional: only this household member\'s spending (name)'), person: S('Optional: only spending assigned to this person (name)') }, ['from', 'to']),
  fn('search_transactions', 'Find individual transactions. Returns up to 25 plus totals.', { query: S('Text to match in merchant/description/notes'), category: S('Category name'), from: S('YYYY-MM-DD'), to: S('YYYY-MM-DD'), min_amount: N('Minimum size in pounds'), max_amount: N('Maximum size in pounds'), direction: { type: 'string', enum: ['out', 'in'] } }),
  fn('compare_periods', 'Compare spending between two date ranges, grouped by category or merchant.', { a_from: S('First period start'), a_to: S('First period end'), b_from: S('Second period start'), b_to: S('Second period end'), group_by: { type: 'string', enum: ['category', 'merchant'] } }, ['a_from', 'a_to', 'b_from', 'b_to']),
  fn('monthly_totals', 'Income and spending per month for recent months, for trends.', { months: N('How many months back, default 12') }),
  fn('merchant_history', 'Every visit and total spent at one merchant/shop.', { merchant: S('Merchant name, partial is fine') }, ['merchant']),
  fn('get_budgets', 'All budgets with spent, remaining, projected end-of-period spend and who they belong to.'),
  fn('get_goals', 'Savings goals and targets with progress and monthly amount needed.'),
  fn('get_subscriptions', 'Active subscriptions and regular bills with amounts, frequency, next date and yearly cost.'),
  fn('get_forecast', 'Projected balance for coming months based on regular payments, seasonality, plans and event budgets.', { months: N('Months ahead, default 6') }),
  fn('upcoming_events', 'Calendar events coming up with any budgets or estimated costs.', { days: N('Days ahead, default 30') }),
  fn('event_cost_history', 'What similar past calendar events actually cost, to estimate a budget.', { title: S('Event title or keywords, e.g. "birthday party"') }, ['title']),
  fn('price_watches', 'Products being price-watched with current, lowest and target prices and history length.'),
  fn('check_purchase', 'Check whether a purchase is affordable right now: free money until payday, relevant budget, impact on goals, similar past purchases and any price watch.', { item: S('What they want to buy'), price: N('Price in pounds'), category: S('Best-guess category name') }, ['item', 'price']),
  // actions — these create a suggestion card the person confirms; nothing changes until they tap Confirm
  fn('propose_budget', 'Suggest creating a budget. The person must confirm.', { name: S('Budget name'), amount: N('Amount in pounds'), period: { type: 'string', enum: ['weekly', 'monthly', 'quarterly', 'yearly'] }, categories: { type: 'array', items: { type: 'string' }, description: 'Category names' }, user: S('Optional: make it one member\'s own budget (name)'), reason: S('One sentence why') }, ['name', 'amount', 'period']),
  fn('propose_goal', 'Suggest a savings goal. The person must confirm.', { name: S('Goal name'), target_amount: N('Target in pounds'), target_date: S('Optional YYYY-MM-DD'), reason: S('One sentence why') }, ['name', 'target_amount']),
  fn('propose_price_watch', 'Suggest watching the price of a product. The person must confirm.', { item: S('Product'), target_price: N('Price to alert at'), reason: S('One sentence why') }, ['item']),
  fn('propose_event_budget', 'Suggest a budget for a calendar event. The person must confirm.', { event: S('Event title'), amount: N('Budget in pounds'), reason: S('Why this amount') }, ['event', 'amount']),
  fn('propose_planned_cost', 'Suggest adding a future cost to the calendar so it is in the forecast. The person must confirm.', { title: S('What'), date: S('YYYY-MM-DD'), amount: N('Pounds') }, ['title', 'date', 'amount']),
  fn('propose_recategorise', 'Suggest moving all transactions from a merchant to a category. The person must confirm.', { merchant: S('Merchant'), category: S('Category name') }, ['merchant', 'category']),
  fn('propose_cancel_subscription', 'Suggest marking a subscription to cancel and reminding them before the next payment. The person must confirm.', { merchant: S('Subscription merchant'), reason: S('Why') }, ['merchant']),
];

const RUNNERS = {
  get_overview(hid) {
    const f = freeUntilPayday(hid);
    const month = q.get(`SELECT ROUND(COALESCE(SUM(-t.amount),0),2) v FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.household_id=? AND t.date>=? AND t.amount<0 AND COALESCE(c.kind,'expense')!='transfer'`, hid, monthStart()).v;
    const accounts = q.all('SELECT name, type, ROUND(balance,2) balance FROM accounts WHERE household_id=? AND archived=0', hid);
    return { today: today(), ...f, spent_this_month: month, accounts, needs_attention: A.inbox(hid).filter((i) => !i.soft).length };
  },
  spending_by_category(hid, a) {
    let sql = `SELECT COALESCE(c.name,'Uncategorised') category, ROUND(SUM(-t.amount),2) total, COUNT(*) n FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN accounts ac ON ac.id=t.account_id
      WHERE t.household_id=? AND t.date BETWEEN ? AND ? AND t.amount<0 AND COALESCE(c.kind,'expense')!='transfer'`; const p = [hid, a.from, a.to];
    const u = findUser(hid, a.user); if (u) { sql += ' AND (t.user_id=? OR ac.owner_user_id=?)'; p.push(u.id, u.id); }
    const pe = findPerson(hid, a.person); if (pe) { sql += ' AND t.person_id=?'; p.push(pe.id); }
    const rows = q.all(`${sql} GROUP BY c.id ORDER BY total DESC`, ...p);
    return { from: a.from, to: a.to, total: r2(rows.reduce((s, r) => s + r.total, 0)), categories: rows };
  },
  search_transactions(hid, a) {
    const w = ['t.household_id=?']; const p = [hid];
    if (a.query) { w.push('(t.merchant LIKE ? OR t.description LIKE ? OR t.notes LIKE ?)'); p.push(`%${a.query}%`, `%${a.query}%`, `%${a.query}%`); }
    const c = findCategory(hid, a.category); if (c) { w.push('t.category_id=?'); p.push(c.id); }
    if (a.from) { w.push('t.date>=?'); p.push(a.from); } if (a.to) { w.push('t.date<=?'); p.push(a.to); }
    if (a.min_amount) { w.push('ABS(t.amount)>=?'); p.push(a.min_amount); } if (a.max_amount) { w.push('ABS(t.amount)<=?'); p.push(a.max_amount); }
    if (a.direction === 'out') w.push('t.amount<0'); if (a.direction === 'in') w.push('t.amount>0');
    const base = `FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE ${w.join(' AND ')}`;
    const tot = q.get(`SELECT COUNT(*) n, ROUND(COALESCE(SUM(-t.amount),0),2) net_out ${base}`, ...p);
    const rows = q.all(`SELECT t.date, t.merchant, ROUND(t.amount,2) amount, c.name category, t.kind ${base} ORDER BY t.date DESC LIMIT 25`, ...p);
    return { count: tot.n, total_spent: tot.net_out, transactions: rows };
  },
  compare_periods(hid, a) {
    const g = a.group_by === 'merchant' ? 't.merchant' : "COALESCE(c.name,'Uncategorised')";
    const run = (f, t) => q.all(`SELECT ${g} k, ROUND(SUM(-t.amount),2) v FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.household_id=? AND t.date BETWEEN ? AND ? AND t.amount<0 AND COALESCE(c.kind,'expense')!='transfer' GROUP BY k`, hid, f, t);
    const A1 = run(a.a_from, a.a_to), B1 = run(a.b_from, a.b_to);
    const keys = [...new Set([...A1, ...B1].map((x) => x.k))];
    const rows = keys.map((k) => { const x = A1.find((r) => r.k === k)?.v || 0, y = B1.find((r) => r.k === k)?.v || 0; return { [a.group_by || 'category']: k, first: x, second: y, change: r2(y - x) }; })
      .sort((m, n) => Math.abs(n.change) - Math.abs(m.change)).slice(0, 20);
    return { first: [a.a_from, a.a_to], second: [a.b_from, a.b_to], first_total: r2(A1.reduce((s, r) => s + r.v, 0)), second_total: r2(B1.reduce((s, r) => s + r.v, 0)), biggest_changes: rows };
  },
  monthly_totals(hid, a) { return { months: A.monthlyTotals(hid, Math.min(36, a.months || 12)) }; },
  merchant_history(hid, a) {
    const rows = q.all(`SELECT date, ROUND(amount,2) amount, merchant FROM transactions WHERE household_id=? AND merchant LIKE ? ORDER BY date DESC LIMIT 40`, hid, `%${a.merchant}%`);
    const all = q.get(`SELECT COUNT(*) n, ROUND(SUM(-amount),2) total, MIN(date) first, MAX(date) last FROM transactions WHERE household_id=? AND merchant LIKE ? AND amount<0`, hid, `%${a.merchant}%`);
    return { ...all, recent: rows };
  },
  get_budgets(hid) {
    return q.all('SELECT * FROM budgets WHERE household_id=?', hid).map((b) => A.budgetStatus(hid, b)).map((b) => ({ name: b.name, amount: b.amount, period: b.period, spent: b.spent, remaining: b.remaining,
      projected: b.projected, on_track: b.on_track, days_left: b.days_left, belongs_to: b.scope === 'individual' ? q.get('SELECT name FROM users WHERE id=?', b.user_id)?.name : b.scope === 'person' ? q.get('SELECT name FROM people WHERE id=?', b.person_id)?.name : 'everyone' }));
  },
  get_goals(hid) { return q.all('SELECT * FROM goals WHERE household_id=?', hid).map(A.goalStatus).map((g) => ({ name: g.name, target: g.target_amount, saved: g.current_amount, pct: g.pct, target_date: g.target_date, monthly_needed: g.monthly_needed })); },
  get_subscriptions(hid) {
    const per = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 };
    const rows = q.all(`SELECT merchant, type, amount, cadence, next_date, last_date, occurrences FROM subscriptions WHERE household_id=? AND status='active' ORDER BY amount DESC`, hid);
    return { yearly_total: r2(rows.reduce((s, r) => s + r.amount * (per[r.cadence] || 12), 0)), items: rows.map((r) => ({ ...r, yearly: r2(r.amount * (per[r.cadence] || 12)) })) };
  },
  get_forecast(hid, a) { const f = A.forecast(hid, { months: Math.min(24, a.months || 6), years: 1 }); return { balance_now: f.balance, typical_income: f.avgIncome, typical_spending: f.avgSpending, low_point_next_8_weeks: f.lowPoint, months: f.monthly }; },
  upcoming_events(hid, a) {
    return q.all(`SELECT title, substr(start,1,10) date, budget, estimated_cost, location FROM events WHERE household_id=? AND start BETWEEN ? AND ? ORDER BY start LIMIT 40`, hid, today(), A.iso(A.addDays(new Date(), a.days || 30)));
  },
  event_cost_history(hid, a) {
    const words = String(a.title).toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    if (!words.length) return { similar: [] };
    const evs = q.all(`SELECT id, title, substr(start,1,10) date, budget FROM events WHERE household_id=? AND start<? AND (${words.map(() => 'LOWER(title) LIKE ?').join(' OR ')}) ORDER BY start DESC LIMIT 10`, hid, today(), ...words.map((w) => `%${w}%`));
    return { similar: evs.map((e) => ({ ...e, actually_spent: r2(q.get('SELECT COALESCE(SUM(-amount),0) v FROM transactions WHERE event_id=? AND amount<0', e.id).v) })) };
  },
  price_watches(hid) { return q.all('SELECT query item, last_price, lowest_price, target_price, best_store, last_checked, json_array_length(history) checks FROM watches WHERE household_id=? AND enabled=1', hid); },
  check_purchase(hid, a) {
    const f = freeUntilPayday(hid);
    const cat = findCategory(hid, a.category);
    const budgets = q.all('SELECT * FROM budgets WHERE household_id=?', hid).map((b) => A.budgetStatus(hid, b))
      .filter((b) => !cat || JSON.parse(b.category_ids || '[]').length === 0 || JSON.parse(b.category_ids || '[]').includes(cat.id))
      .map((b) => ({ name: b.name, remaining: b.remaining, after_purchase: r2(b.remaining - a.price) }));
    const goals = q.all('SELECT * FROM goals WHERE household_id=?', hid).map(A.goalStatus).filter((g) => g.monthly_needed)
      .map((g) => ({ name: g.name, monthly_needed: g.monthly_needed, months_delay_if_taken_from_goal: r2(a.price / g.monthly_needed) }));
    const words = String(a.item).split(/\s+/).filter((w) => w.length > 2);
    const similar = words.length ? q.all(`SELECT date, merchant, ROUND(amount,2) amount FROM transactions WHERE household_id=? AND amount<0 AND (${words.map(() => '(description LIKE ? OR notes LIKE ?)').join(' OR ')}) ORDER BY date DESC LIMIT 5`, hid, ...words.flatMap((w) => [`%${w}%`, `%${w}%`])) : [];
    const watch = q.get('SELECT query, last_price, lowest_price, best_store FROM watches WHERE household_id=? AND query LIKE ?', hid, `%${words[0] || a.item}%`);
    return { price: a.price, free_until_payday: f.free, after_purchase: r2(f.free - a.price), days_until_payday: f.days, per_day_after: r2((f.free - a.price) / f.days), payday: f.payday, budgets, goals, similar_past_purchases: similar, price_watch: watch || null };
  },
};

// ---- actions ----
function propose(hid, userId, threadId, type, payload, summary) {
  const id = Number(q.run('INSERT INTO ai_actions(household_id,user_id,thread_id,type,payload,summary) VALUES(?,?,?,?,?,?)', hid, userId, threadId, type, JSON.stringify(payload), summary).lastInsertRowid);
  return { id, type, summary, payload, status: 'pending' };
}
const money = (n) => `£${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
const PROPOSERS = {
  propose_budget: (hid, u, t, a) => {
    const cats = (a.categories || []).map((n) => findCategory(hid, n)).filter(Boolean);
    const user = findUser(hid, a.user);
    return propose(hid, u, t, 'budget', { name: a.name, amount: Number(a.amount), period: a.period || 'monthly', category_ids: cats.map((c) => c.id), scope: user ? 'individual' : 'shared', user_id: user?.id || null },
      `Create a ${a.period || 'monthly'} budget "${a.name}" of ${money(a.amount)}${cats.length ? ` for ${cats.map((c) => c.name).join(', ')}` : ''}${user ? ` for ${user.name}` : ''}${a.reason ? ` — ${a.reason}` : ''}`);
  },
  propose_goal: (hid, u, t, a) => propose(hid, u, t, 'goal', { name: a.name, target_amount: Number(a.target_amount), target_date: a.target_date || null }, `Save ${money(a.target_amount)} for "${a.name}"${a.target_date ? ` by ${a.target_date}` : ''}${a.reason ? ` — ${a.reason}` : ''}`),
  propose_price_watch: (hid, u, t, a) => propose(hid, u, t, 'watch', { query: a.item, target_price: a.target_price || null }, `Watch the price of ${a.item}${a.target_price ? ` and tell you under ${money(a.target_price)}` : ''}${a.reason ? ` — ${a.reason}` : ''}`),
  propose_event_budget: (hid, u, t, a) => {
    const ev = q.get(`SELECT id, title, substr(start,1,10) d FROM events WHERE household_id=? AND LOWER(title) LIKE LOWER(?) AND start>=? ORDER BY start LIMIT 1`, hid, `%${a.event}%`, A.iso(A.addDays(new Date(), -1)));
    if (!ev) return { error: `No upcoming event matching "${a.event}"` };
    return propose(hid, u, t, 'event_budget', { event_id: ev.id, budget: Number(a.amount) }, `Set a ${money(a.amount)} budget for "${ev.title}" on ${ev.d}${a.reason ? ` — ${a.reason}` : ''}`);
  },
  propose_planned_cost: (hid, u, t, a) => propose(hid, u, t, 'planned_cost', { title: a.title, start: a.date, estimated_cost: Number(a.amount) }, `Add "${a.title}" on ${a.date} as a planned cost of ${money(a.amount)}`),
  propose_recategorise: (hid, u, t, a) => {
    const c = findCategory(hid, a.category); if (!c) return { error: `Unknown category "${a.category}"` };
    const n = q.get('SELECT COUNT(*) n FROM transactions WHERE household_id=? AND merchant LIKE ?', hid, `%${a.merchant}%`).n;
    return propose(hid, u, t, 'recategorise', { merchant: a.merchant, category_id: c.id }, `Move ${n} transactions from ${a.merchant} to ${c.name}, and file future ones there`);
  },
  propose_cancel_subscription: (hid, u, t, a) => {
    const s = q.get(`SELECT * FROM subscriptions WHERE household_id=? AND merchant LIKE ? AND status='active'`, hid, `%${a.merchant}%`);
    if (!s) return { error: `No active subscription matching "${a.merchant}"` };
    return propose(hid, u, t, 'cancel_subscription', { subscription_id: s.id, merchant: s.merchant, next_date: s.next_date, amount: s.amount }, `Remind you to cancel ${s.merchant} (${money(s.amount)} ${s.cadence}) before ${s.next_date}${a.reason ? ` — ${a.reason}` : ''}`);
  },
};

function executeAction(hid, userId, action) {
  const p = JSON.parse(action.payload);
  switch (action.type) {
    case 'budget': q.run('INSERT INTO budgets(household_id,name,amount,period,category_ids,scope,user_id) VALUES(?,?,?,?,?,?,?)', hid, p.name, p.amount, p.period, JSON.stringify(p.category_ids || []), p.scope, p.user_id); return 'Budget created';
    case 'goal': q.run('INSERT INTO goals(household_id,name,target_amount,target_date) VALUES(?,?,?,?)', hid, p.name, p.target_amount, p.target_date); return 'Goal created';
    case 'watch': q.run('INSERT INTO watches(household_id,user_id,query,target_price) VALUES(?,?,?,?)', hid, userId, p.query, p.target_price); return 'Added to price watch';
    case 'event_budget': q.run('UPDATE events SET budget=? WHERE id=? AND household_id=?', p.budget, p.event_id, hid); return 'Event budget set';
    case 'planned_cost': q.run(`INSERT INTO events(household_id,title,start,estimated_cost,source) VALUES(?,?,?,?,'ai')`, hid, p.title, p.start, p.estimated_cost); return 'Planned cost added';
    case 'recategorise': {
      const { learnMerchant } = require('./categorize');
      const ms = q.all('SELECT DISTINCT merchant FROM transactions WHERE household_id=? AND merchant LIKE ?', hid, `%${p.merchant}%`);
      for (const m of ms) learnMerchant(hid, m.merchant, p.category_id);
      const n = q.run(`UPDATE transactions SET category_id=?, categorised_by='user' WHERE household_id=? AND merchant LIKE ?`, p.category_id, hid, `%${p.merchant}%`).changes;
      return `Moved ${n} transactions`;
    }
    case 'cancel_subscription': {
      q.run(`UPDATE subscriptions SET status='cancelling' WHERE id=? AND household_id=?`, p.subscription_id, hid);
      const remind = A.iso(A.addDays(new Date(p.next_date), -3));
      q.run(`INSERT INTO events(household_id,title,start,estimated_cost,notes,source) VALUES(?,?,?,?,?,'ai')`, hid, `Cancel ${p.merchant}`, remind < today() ? today() : remind, null, `Next payment of £${p.amount} due ${p.next_date}`);
      return 'Reminder added to your calendar';
    }
    default: throw new Error('Unknown action');
  }
}

async function run(hid, userId, threadId, name, args = {}) {
  if (RUNNERS[name]) return RUNNERS[name](hid, args || {});
  if (PROPOSERS[name]) return PROPOSERS[name](hid, userId, threadId, args || {});
  return { error: `Unknown tool ${name}` };
}

// Plain-English label for the tool trace shown in the chat
function describe(name, a = {}) {
  const map = {
    get_overview: 'Checked balances and this month', spending_by_category: `Looked at spending by category ${a.from || ''}${a.to ? ` → ${a.to}` : ''}`,
    search_transactions: `Searched transactions${a.query ? ` for "${a.query}"` : ''}${a.category ? ` in ${a.category}` : ''}`, compare_periods: 'Compared two periods',
    monthly_totals: 'Looked at monthly trends', merchant_history: `Looked at history for ${a.merchant || 'a merchant'}`, get_budgets: 'Checked budgets', get_goals: 'Checked goals',
    get_subscriptions: 'Checked subscriptions and bills', get_forecast: 'Looked at the forecast', upcoming_events: 'Checked upcoming events', event_cost_history: `Looked up past costs of "${a.title || ''}"`,
    price_watches: 'Checked price watches', check_purchase: `Checked if ${a.item || 'it'}${a.price ? ` at £${a.price}` : ''} is affordable`,
  };
  return map[name] || (name.startsWith('propose_') ? 'Prepared a suggestion' : name);
}

module.exports = { DEFINITIONS, run, executeAction, describe, freeUntilPayday, findCategory };
