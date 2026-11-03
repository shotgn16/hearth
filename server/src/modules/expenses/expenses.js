// Unexpected costs and work expenses.
//  • Unexpected: anything you flag (or Hearth suggests) as a cost you didn't plan for — boiler repair, car parts, vet bills.
//  • Work expenses: things to claim back from an employer, tracked To claim → Claimed → Paid back.
const { q } = require('../../core/db');

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const COLS = `t.id, t.date, ROUND(t.amount,2) amount, t.merchant, t.description, t.notes, t.category_id, c.name category_name, c.color category_color, c.icon category_icon,
  t.person_id, pe.name person_name, t.user_id, u.name user_name, a.name account_name, t.event_id, e.title event_title,
  t.unexpected, t.work_expense, t.claim_status, t.claim_ref, t.claimed_at, t.reimbursed_at, t.reimbursement_tx_id`;
const FROM = `FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN people pe ON pe.id=t.person_id
  LEFT JOIN users u ON u.id=t.user_id LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN events e ON e.id=t.event_id`;

function monthsBack(n) { const now = new Date(); return Array.from({ length: n }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1, 12); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }); }

function unexpected(hid, { from, to, months = 12 } = {}) {
  const ms = monthsBack(months);
  const f = from || `${ms[0]}-01`, t = to || iso(new Date());
  const items = q.all(`SELECT ${COLS} ${FROM} WHERE t.household_id=? AND t.unexpected=1 AND t.date BETWEEN ? AND ? ORDER BY t.date DESC`, hid, f, t);
  const monthly = ms.map((m) => ({ month: m, total: r2(-(q.get(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE household_id=? AND unexpected=1 AND amount<0 AND substr(date,1,7)=?`, hid, m).v)) }));
  const past = monthly.slice(0, -1).filter((m) => m.total > 0);
  const average = past.length ? r2(past.reduce((n, m) => n + m.total, 0) / Math.max(past.length, monthly.length - 1)) : 0;
  const byCategory = q.all(`SELECT COALESCE(c.name,'Uncategorised') category, c.color, c.icon, ROUND(SUM(-t.amount),2) total, COUNT(*) n ${FROM}
    WHERE t.household_id=? AND t.unexpected=1 AND t.amount<0 AND t.date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`, hid, f, t);
  return { items, monthly, average_per_month: average, this_month: monthly.at(-1).total, year_total: r2(monthly.reduce((n, m) => n + m.total, 0)), by_category: byCategory, suggestions: suggestions(hid) };
}

// One-off spends that look unplanned: big for you, or far above what you usually pay that merchant
function suggestions(hid) {
  const since = iso(new Date(Date.now() - 60 * 86400000));
  const dismissed = new Set(JSON.parse(q.get(`SELECT value FROM settings WHERE household_id=? AND key='unexpected_dismissed'`, hid)?.value || '[]'));
  const rows = q.all(`SELECT ${COLS} ${FROM} WHERE t.household_id=? AND t.date>=? AND t.amount<0 AND t.unexpected=0 AND t.work_expense=0 AND t.kind='one_off'
    AND COALESCE(c.kind,'expense')='expense' AND COALESCE(c.name,'') NOT IN ('Supermarkets','Rent & Mortgage','Savings & Transfers') ORDER BY t.amount ASC LIMIT 200`, hid, since);
  const out = [];
  for (const r of rows) {
    if (dismissed.has(r.id)) continue;
    const hist = q.all('SELECT -amount a FROM transactions WHERE household_id=? AND merchant=? AND amount<0 AND id!=? ORDER BY a', hid, r.merchant, r.id).map((x) => x.a);
    const med = hist.length ? hist[Math.floor(hist.length / 2)] : 0;
    const size = -r.amount;
    if ((hist.length >= 3 && size > med * 3 && size >= 40) || (hist.length < 3 && size >= 150)) out.push({ ...r, usual: med ? r2(med) : null });
    if (out.length >= 8) break;
  }
  return out;
}

function work(hid, { status, from, to } = {}) {
  const w = ['t.household_id=?', 't.work_expense=1']; const p = [hid];
  if (status) { w.push("COALESCE(t.claim_status,'to_claim')=?"); p.push(status); }
  if (from) { w.push('t.date>=?'); p.push(from); } if (to) { w.push('t.date<=?'); p.push(to); }
  const items = q.all(`SELECT ${COLS} ${FROM} WHERE ${w.join(' AND ')} ORDER BY t.date DESC`, ...p);
  const sum = (s) => r2(-(q.get(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE household_id=? AND work_expense=1 AND COALESCE(claim_status,'to_claim')=?`, hid, s).v));
  const oldest = q.get(`SELECT MIN(date) d FROM transactions WHERE household_id=? AND work_expense=1 AND COALESCE(claim_status,'to_claim')='to_claim'`, hid).d;
  const thisYear = `${new Date().getFullYear()}-01-01`;
  return { items, totals: { to_claim: sum('to_claim'), claimed: sum('claimed'), paid_back: sum('paid_back'),
    year: r2(-(q.get('SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE household_id=? AND work_expense=1 AND date>=?', hid, thisYear).v)) }, oldest_unclaimed: oldest };
}

function setWorkStatus(hid, ids, status, { claim_ref, reimbursement_tx_id } = {}) {
  const now = iso(new Date());
  for (const id of ids) {
    if (status === 'to_claim') q.run(`UPDATE transactions SET work_expense=1, claim_status='to_claim', claimed_at=NULL, reimbursed_at=NULL WHERE id=? AND household_id=?`, id, hid);
    if (status === 'claimed') q.run(`UPDATE transactions SET work_expense=1, claim_status='claimed', claimed_at=COALESCE(claimed_at,?), claim_ref=COALESCE(?,claim_ref) WHERE id=? AND household_id=?`, now, claim_ref || null, id, hid);
    if (status === 'paid_back') q.run(`UPDATE transactions SET work_expense=1, claim_status='paid_back', claimed_at=COALESCE(claimed_at,?), reimbursed_at=?, claim_ref=COALESCE(?,claim_ref), reimbursement_tx_id=COALESCE(?,reimbursement_tx_id) WHERE id=? AND household_id=?`,
      now, now, claim_ref || null, reimbursement_tx_id || null, id, hid);
    if (status === 'none') q.run(`UPDATE transactions SET work_expense=0, claim_status=NULL, claim_ref=NULL, claimed_at=NULL, reimbursed_at=NULL, reimbursement_tx_id=NULL WHERE id=? AND household_id=?`, id, hid);
  }
  // the reimbursement itself is money coming back, not income
  if (reimbursement_tx_id) {
    const cat = q.get(`SELECT id FROM categories WHERE household_id=? AND name='Work expenses repaid'`, hid)?.id
      || Number(q.run(`INSERT INTO categories(household_id,name,color,icon,kind) VALUES(?,?,?,?,?)`, hid, 'Work expenses repaid', '#0f766e', '💼', 'transfer').lastInsertRowid);
    q.run('UPDATE transactions SET category_id=?, categorised_by=\'user\' WHERE id=? AND household_id=?', cat, reimbursement_tx_id, hid);
  }
}

// Incoming payments that could be your employer paying expenses back
function possibleReimbursements(hid, amount) {
  return q.all(`SELECT id, date, ROUND(amount,2) amount, merchant FROM transactions WHERE household_id=? AND amount>0 AND date>=? ORDER BY ABS(amount-?) ASC, date DESC LIMIT 8`,
    hid, iso(new Date(Date.now() - 120 * 86400000)), amount || 0);
}

module.exports = { unexpected, suggestions, work, setWorkStatus, possibleReimbursements };
