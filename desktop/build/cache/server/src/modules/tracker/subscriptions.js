// Recurring-payment detection: groups by merchant, looks for regular intervals and stable amounts.
const { q } = require('../../core/db');

const CADENCES = [
  ['weekly', 7, 2], ['fortnightly', 14, 3], ['monthly', 30.4, 4], ['quarterly', 91, 10], ['yearly', 365, 20],
];

function median(a) { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function detectSubscriptions(hid) {
  // transfers to your own savings aren't subscriptions
  const rows = q.all(`SELECT t.id, t.date, t.amount, t.merchant, t.category_id, c.name cat FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
                      WHERE t.household_id=? AND t.amount < 0 AND t.merchant IS NOT NULL AND COALESCE(c.kind,'expense')!='transfer' ORDER BY t.merchant, t.date`, hid);
  const byMerchant = {};
  for (const r of rows) (byMerchant[r.merchant] ||= []).push(r);
  const found = [];
  for (const [merchant, txs] of Object.entries(byMerchant)) {
    if (txs.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < txs.length; i++) gaps.push((new Date(txs[i].date) - new Date(txs[i - 1].date)) / 86400000);
    const g = median(gaps);
    const cad = CADENCES.find(([, d, tol]) => Math.abs(g - d) <= tol);
    if (!cad) continue;
    const regular = gaps.filter((x) => Math.abs(x - cad[1]) <= cad[2] * 1.5).length / gaps.length;
    const amts = txs.map((t) => Math.abs(t.amount));
    const medAmt = median(amts);
    const stable = amts.filter((a) => Math.abs(a - medAmt) / medAmt < 0.15).length / amts.length;
    // Supermarkets are visited weekly but aren't subscriptions — require stable amounts
    if (regular < 0.6 || stable < 0.6 || (txs.length < 3 && cad[0] !== 'yearly' && cad[0] !== 'quarterly')) continue;
    const last = txs[txs.length - 1];
    const lastAmt = Math.abs(last.amount);
    const next = new Date(new Date(last.date).getTime() + cad[1] * 86400000).toISOString().slice(0, 10);
    const daysSince = (Date.now() - new Date(last.date)) / 86400000;
    const status = daysSince > cad[1] * 2 + cad[2] ? 'lapsed' : 'active';
    const existing = q.get('SELECT * FROM subscriptions WHERE household_id=? AND merchant=?', hid, merchant);
    if (existing?.manual) { q.run('UPDATE subscriptions SET last_date=MAX(COALESCE(last_date,\'\'),?), occurrences=? WHERE id=?', last.date, txs.length, existing.id);
      q.run(`UPDATE transactions SET kind=?, subscription_id=? WHERE household_id=? AND merchant=? AND amount<0`, existing.type || 'subscription', existing.id, hid, merchant); continue; }
    const priceChange = existing && existing.amount && Math.abs(existing.amount - lastAmt) > 0.009 ? { from: existing.amount, to: lastAmt } : null;
    const type = /bills|rent|mortgage|insurance|phone|internet/i.test(last.cat || '') ? 'bill' : 'subscription';
    q.run(`INSERT INTO subscriptions(household_id,merchant,amount,cadence,interval_days,next_date,last_date,category_id,status,occurrences,type,start_date)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(household_id,merchant) DO UPDATE SET amount=excluded.amount, cadence=excluded.cadence,
           interval_days=excluded.interval_days, next_date=excluded.next_date, last_date=excluded.last_date,
           status=CASE WHEN subscriptions.status IN ('ignored','paused','cancelling','ended') THEN subscriptions.status ELSE excluded.status END,
           occurrences=excluded.occurrences, type=CASE WHEN subscriptions.confirmed=1 THEN subscriptions.type ELSE excluded.type END,
           start_date=COALESCE(subscriptions.start_date, excluded.start_date)`,
      hid, merchant, lastAmt, cad[0], cad[1], next, last.date, last.category_id, status, txs.length, type, txs[0].date);
    const sub = q.get('SELECT * FROM subscriptions WHERE household_id=? AND merchant=?', hid, merchant);
    if (sub.status !== 'ignored') {
      q.run(`UPDATE transactions SET kind=?, subscription_id=? WHERE household_id=? AND merchant=? AND amount<0`, sub.type, sub.id, hid, merchant);
    }
    found.push({ ...sub, isNew: !existing, priceChange });
  }
  return found;
}

module.exports = { detectSubscriptions };
