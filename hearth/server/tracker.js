// Subscription & bill tracker: when each payment is due, whether it has come out this month, and the history.
// Payments are ticked off automatically when the matching bank transaction arrives; you can also mark them
// paid or skipped yourself (e.g. cash, a payment from an account Hearth can't see, or a free month).
const { q } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00`);
const monthLen = (y, m) => new Date(y, m + 1, 0).getDate();
const today = () => iso(new Date());
const r2 = (n) => Math.round(n * 100) / 100;
const PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 };

// Statuses shown to people: Ongoing (active), Paused, Cancelling, Ended (incl. stopped/lapsed), Not recurring (ignored)
const LIVE = ['active', 'cancelling'];

function anchor(sub) { return sub.last_date || sub.start_date || sub.next_date || today(); }

// Every due date for this subscription that falls inside [from, to]
function occurrences(sub, from, to) {
  const out = []; const F = at(from), T = at(to);
  const a = at(anchor(sub));
  const dueDay = sub.due_day || a.getDate();
  const stepMonths = { monthly: 1, quarterly: 3, yearly: 12 }[sub.cadence];
  if (stepMonths) {
    // walk month by month from well before the window, keeping months in phase with the anchor
    const start = new Date(F.getFullYear(), F.getMonth() - 12, 1, 12);
    for (let d = new Date(start); d <= T; d.setMonth(d.getMonth() + 1)) {
      const diff = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth());
      if (((diff % stepMonths) + stepMonths) % stepMonths !== 0) continue;
      const due = new Date(d.getFullYear(), d.getMonth(), Math.min(dueDay, monthLen(d.getFullYear(), d.getMonth())), 12);
      if (due >= F && due <= T) out.push(iso(due));
    }
  } else {
    const step = (sub.interval_days || (sub.cadence === 'weekly' ? 7 : 14)) * 86400000;
    let t = a.getTime();
    while (t > F.getTime()) t -= step;
    for (; t <= T.getTime(); t += step) if (t >= F.getTime()) out.push(iso(new Date(t)));
  }
  // only while the subscription was running
  const begin = sub.start_date || null, end = sub.end_date || null;
  return out.filter((d) => (!begin || d >= begin.slice(0, 10)) && (!end || d <= end.slice(0, 10)));
}

function nextDue(sub, from = today()) {
  const horizon = iso(new Date(at(from).getTime() + 400 * 86400000));
  return occurrences({ ...sub, end_date: null }, from, horizon)[0] || null;
}

function payments(hid, subId, from, to) {
  return q.all(`SELECT id, date, ROUND(-amount,2) amount FROM transactions WHERE household_id=? AND subscription_id=? AND amount<0 AND date BETWEEN ? AND ? ORDER BY date`, hid, subId, from, to);
}

// Pair due dates with actual payments (closest payment within the cycle) and any manual marks
function reconcile(hid, sub, from, to) {
  const due = occurrences(sub, from, to);
  const cycle = Math.max(3, Math.round((sub.interval_days || 30.4) / 2));
  const pays = payments(hid, sub.id, iso(new Date(at(from).getTime() - cycle * 86400000)), iso(new Date(at(to).getTime() + cycle * 86400000)));
  const marks = Object.fromEntries(q.all('SELECT * FROM subscription_payments WHERE subscription_id=? AND due_date BETWEEN ? AND ?', sub.id, from, to).map((m) => [m.due_date, m]));
  const used = new Set(); const t = today();
  return due.map((d) => {
    const mark = marks[d];
    let pay = null, best = Infinity;
    for (const p of pays) {
      if (used.has(p.id)) continue;
      const gap = Math.abs(at(p.date) - at(d)) / 86400000;
      if (gap <= cycle && gap < best) { best = gap; pay = p; }
    }
    if (pay) used.add(pay.id);
    let status, source = null;
    if (mark?.status === 'paid') { status = 'paid'; source = 'you'; }
    else if (mark?.status === 'skipped') { status = 'skipped'; source = 'you'; }
    else if (pay) { status = 'paid'; source = 'bank'; }
    else if (d < t) status = 'overdue';
    else if (d === t) status = 'due_today';
    else status = 'upcoming';
    const daysLate = status === 'overdue' ? Math.round((at(t) - at(d)) / 86400000) : 0;
    return { due_date: d, status, source, expected: r2(mark?.amount ?? sub.amount ?? 0), paid_amount: status === 'paid' ? r2(pay?.amount ?? mark?.amount ?? sub.amount ?? 0) : 0,
      paid_date: pay?.date || mark?.paid_date || null, transaction_id: pay?.id || null, note: mark?.note || null, days_late: daysLate,
      price_changed: pay && sub.amount && Math.abs(pay.amount - sub.amount) > 0.009 };
  });
}

function subRows(hid) {
  return q.all(`SELECT s.*, COALESCE(s.name, s.merchant) display, c.name category_name, c.color category_color, c.icon category_icon,
      a.name account_name, u.name user_name, p.name person_name
    FROM subscriptions s LEFT JOIN categories c ON c.id=s.category_id LEFT JOIN accounts a ON a.id=s.account_id
    LEFT JOIN users u ON u.id=s.user_id LEFT JOIN people p ON p.id=s.person_id WHERE s.household_id=?`, hid);
}

function monthBounds(month) { const [y, m] = month.split('-').map(Number); return [`${month}-01`, `${month}-${pad(monthLen(y, m - 1))}`]; }

// The checklist for one month
function month(hid, month) {
  const [from, to] = monthBounds(month);
  const items = [];
  for (const s of subRows(hid)) {
    if (s.status === 'ignored') continue;
    if (s.status === 'paused') continue;
    for (const o of reconcile(hid, s, from, to)) {
      // ended/lapsed subscriptions only show months where something was due before they stopped, or still came out
      if (!LIVE.includes(s.status) && o.status !== 'paid' && o.due_date > (s.end_date || s.last_date || '')) continue;
      items.push({ ...o, subscription: slim(s) });
    }
  }
  items.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.subscription.display.localeCompare(b.subscription.display));
  const sum = (f) => r2(items.filter(f).reduce((n, i) => n + (i.status === 'paid' ? i.paid_amount : i.expected), 0));
  const byCat = {};
  for (const i of items) { const k = i.subscription.category_name || 'Uncategorised'; (byCat[k] ||= { category: k, color: i.subscription.category_color, icon: i.subscription.category_icon, total: 0, paid: 0, count: 0 }); byCat[k].total += i.expected; byCat[k].count++; if (i.status === 'paid') byCat[k].paid += i.paid_amount; }
  return {
    month, items,
    totals: { expected: sum(() => true), paid: sum((i) => i.status === 'paid'), remaining: sum((i) => ['upcoming', 'due_today'].includes(i.status)),
      overdue: sum((i) => i.status === 'overdue'), skipped: sum((i) => i.status === 'skipped'), count: items.length, paid_count: items.filter((i) => i.status === 'paid').length },
    by_category: Object.values(byCat).map((c) => ({ ...c, total: r2(c.total), paid: r2(c.paid) })).sort((a, b) => b.total - a.total),
  };
}

// Subscriptions × months grid
function history(hid, months = 12) {
  const now = new Date();
  const ms = Array.from({ length: months }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1, 12); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; });
  const rows = subRows(hid).filter((s) => s.status !== 'ignored').map((s) => {
    const cells = ms.map((m) => {
      const [f, t] = monthBounds(m);
      const occ = reconcile(hid, s, f, t);
      if (!occ.length) return { state: 'none' };
      const paid = occ.filter((o) => o.status === 'paid');
      return { state: paid.length === occ.length ? 'paid' : occ.some((o) => o.status === 'overdue') ? 'missed' : occ.every((o) => o.status === 'skipped') ? 'skipped' : paid.length ? 'part' : 'due',
        amount: r2(paid.reduce((n, o) => n + o.paid_amount, 0)), expected: r2(occ.reduce((n, o) => n + o.expected, 0)) };
    });
    return { subscription: slim(s), cells, total: r2(cells.reduce((n, c) => n + (c.amount || 0), 0)) };
  }).filter((r) => r.cells.some((c) => c.state !== 'none'));
  return { months: ms, rows, totals: ms.map((_, i) => r2(rows.reduce((n, r) => n + (r.cells[i].amount || 0), 0))) };
}

function slim(s) {
  const next = LIVE.includes(s.status) ? nextDue(s) : null;
  return { id: s.id, display: s.display, merchant: s.merchant, name: s.name, amount: s.amount, cadence: s.cadence, type: s.type, status: s.status, confirmed: s.confirmed,
    due_day: s.due_day, next_due: next, last_date: s.last_date, start_date: s.start_date, end_date: s.end_date, notes: s.notes, manual: s.manual,
    category_id: s.category_id, category_name: s.category_name, category_color: s.category_color, category_icon: s.category_icon,
    account_id: s.account_id, account_name: s.account_name, user_id: s.user_id, user_name: s.user_name, person_id: s.person_id, person_name: s.person_name,
    yearly: r2((s.amount || 0) * (PER_YEAR[s.cadence] || 12)), monthly: r2((s.amount || 0) * (PER_YEAR[s.cadence] || 12) / 12) };
}

function list(hid) {
  const rows = subRows(hid).map((s) => {
    const last = q.get('SELECT date, ROUND(-amount,2) amount FROM transactions WHERE subscription_id=? AND amount<0 ORDER BY date DESC LIMIT 1', s.id);
    const total = q.get('SELECT ROUND(COALESCE(SUM(-amount),0),2) v, COUNT(*) n FROM transactions WHERE subscription_id=? AND amount<0', s.id);
    return { ...slim(s), last_payment: last || null, total_paid: total.v, payments: total.n };
  });
  return rows;
}

function mark(hid, subId, dueDate, status, { amount, paid_date, note } = {}) {
  const s = q.get('SELECT * FROM subscriptions WHERE id=? AND household_id=?', subId, hid);
  if (!s) throw new Error('Subscription not found');
  if (status === 'due') { q.run('DELETE FROM subscription_payments WHERE subscription_id=? AND due_date=?', subId, dueDate); return; }
  q.run(`INSERT INTO subscription_payments(household_id,subscription_id,due_date,status,amount,paid_date,note) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(subscription_id,due_date) DO UPDATE SET status=excluded.status, amount=excluded.amount, paid_date=excluded.paid_date, note=excluded.note, updated_at=CURRENT_TIMESTAMP`,
    hid, subId, dueDate, status, amount ?? null, paid_date ?? (status === 'paid' ? today() : null), note ?? null);
}

// Link bank transactions to subscriptions you added yourself (matched by the text you gave)
function linkManual(hid) {
  for (const s of q.all('SELECT id, merchant, type FROM subscriptions WHERE household_id=? AND manual=1 AND status!=\'ignored\'', hid)) {
    q.run(`UPDATE transactions SET subscription_id=?, kind=? WHERE household_id=? AND amount<0 AND subscription_id IS NULL AND (merchant LIKE ? OR description LIKE ?)`,
      s.id, s.type || 'subscription', hid, `%${s.merchant}%`, `%${s.merchant}%`);
  }
}

// Things the tracker should flag: overdue payments, and charges after you said something ended
function alerts(hid) {
  const out = []; const t = today();
  const from = iso(new Date(at(t).getTime() - 20 * 86400000));
  for (const s of subRows(hid)) {
    if (LIVE.includes(s.status)) {
      for (const o of reconcile(hid, s, from, t)) if (o.status === 'overdue' && o.days_late >= 2) out.push({ kind: 'overdue', subscription: slim(s), ...o });
    }
    if (s.status === 'ended' && s.end_date) {
      const after = q.get('SELECT date, ROUND(-amount,2) amount FROM transactions WHERE subscription_id=? AND amount<0 AND date>? ORDER BY date DESC LIMIT 1', s.id, s.end_date);
      if (after) out.push({ kind: 'charged_after_end', subscription: slim(s), paid_date: after.date, paid_amount: after.amount });
    }
  }
  return out;
}

module.exports = { month, history, list, mark, nextDue, occurrences, reconcile, linkManual, alerts, PER_YEAR };

// Keep next_date (used by the forecast, Today and reminders) in step with the payment day you set
function refreshNextDates(hid) {
  for (const s of q.all(`SELECT * FROM subscriptions WHERE household_id=? AND status IN ('active','cancelling')`, hid)) {
    const n = nextDue(s);
    if (n && n !== s.next_date) q.run('UPDATE subscriptions SET next_date=? WHERE id=?', n, s.id);
  }
}
module.exports.refreshNextDates = refreshNextDates;
