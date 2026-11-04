// Background jobs: bank sync, calendar sync, price checks, subscription detection, budget alerts, daily digest.
const { q, getSetting, setSetting } = require('../core/db');
const { syncConnection } = require('../modules/banks/banks');
const { syncCalendar } = require('../modules/calendar/calendar');
const { checkWatch } = require('../modules/prices/prices');
const { detectSubscriptions } = require('../modules/tracker/subscriptions');
const { runRules } = require('../modules/workflows/rules');
const { notify } = require('../modules/notifications/notify');
const A = require('../modules/insights/analytics');
const { log } = require('../core/config');
const ha = require('../modules/homeassistant/ha');

const hoursSince = (ts) => (ts ? (Date.now() - new Date(ts)) / 3600000 : Infinity);

async function afterNewTransactions(hid) {
  const ai = require('../modules/ai/ai'); const c = ai.cfg(hid);
  if (c.enabled && c.features.auto_categorise) {
    // let the local AI place anything the built-in rules couldn't (you review it in Needs attention)
    for (let i = 0; i < 5; i++) {
      if (!q.get('SELECT 1 FROM transactions WHERE household_id=? AND category_id IS NULL LIMIT 1', hid)) break;
      try { const r = await ai.aiCategorise(hid, 40); if (!r.updated) break; } catch (e) { log.debug('auto-categorise skipped', e.message); break; }
    }
  }
  const subs = detectSubscriptions(hid);
  const tracker = require('../modules/tracker/tracker'); tracker.linkManual(hid); tracker.refreshNextDates(hid);
  for (const s of subs.filter((x) => x.isNew)) {
    const m = await runRules(hid, 'subscription_detected', { ...s, merchant: s.merchant, amount: -s.amount });
    if (!m.length) await notify(hid, { title: 'New subscription spotted', body: `${s.merchant} — £${s.amount.toFixed(2)} ${s.cadence}`, url: '/#/subscriptions' });
  }
  for (const s of subs.filter((x) => x.priceChange)) {
    await notify(hid, { title: `${s.merchant} changed price`, body: `£${s.priceChange.from.toFixed(2)} → £${s.priceChange.to.toFixed(2)}`, url: '/#/subscriptions' });
  }
  await budgetAlerts(hid);
}

async function budgetAlerts(hid) {
  const sent = getSetting(hid, 'budget_alerts_sent', {});
  for (const b of q.all('SELECT * FROM budgets WHERE household_id=?', hid)) {
    const s = A.budgetStatus(hid, b);
    for (const level of [b.alert_pct, 100]) {
      const key = `${b.id}:${s.start}:${level}`;
      if (s.pct >= level && !sent[key]) {
        sent[key] = true;
        const ctx = { ...s, budget_id: b.id, pct: s.pct, name: b.name, amount: -s.spent };
        const matched = await runRules(hid, 'budget_threshold', ctx);
        if (!matched.length) await notify(hid, { title: level >= 100 ? `${b.name} budget is used up` : `${b.name} at ${s.pct}%`, body: `£${s.spent.toFixed(0)} of £${b.amount.toFixed(0)} · ${s.days_left} days left`, url: '/#/budgets' },
          { userIds: b.scope === 'individual' && b.user_id ? [b.user_id] : undefined });
      }
    }
  }
  setSetting(hid, 'budget_alerts_sent', sent);
}

async function dailyDigest(hid) {
  const today = A.iso(new Date());
  if (getSetting(hid, 'digest_last') === today) return;
  const cfg = getSetting(hid, 'digest', { enabled: true, hour: 8 });
  if (!cfg.enabled || new Date().getHours() < cfg.hour) return;
  setSetting(hid, 'digest_last', today);
  const due = q.all(`SELECT * FROM subscriptions WHERE household_id=? AND status IN ('active','cancelling') AND next_date BETWEEN ? AND ?`, hid, today, A.iso(A.addDays(new Date(), 3)));
  for (const s of due) await runRules(hid, 'subscription_due', { ...s, days_until: Math.round((new Date(s.next_date) - new Date(today)) / 86400000), amount: -s.amount });
  const events = q.all(`SELECT * FROM events WHERE household_id=? AND substr(start,1,10) BETWEEN ? AND ?`, hid, today, A.iso(A.addDays(new Date(), 7)));
  for (const e of events) await runRules(hid, 'event_upcoming', { ...e, merchant: e.title, amount: -(e.budget || e.estimated_cost || 0), days_until: Math.round((new Date(e.start) - new Date(today)) / 86400000) });
  const inbox = A.inbox(hid).filter((i) => !i.soft);
  const parts = [];
  if (due.length) parts.push(`${due.length} payment${due.length > 1 ? 's' : ''} due soon (£${due.reduce((s, x) => s + x.amount, 0).toFixed(2)})`);
  const costly = events.filter((e) => e.budget || e.estimated_cost);
  if (costly.length) parts.push(`${costly.length} costed event${costly.length > 1 ? 's' : ''} this week`);
  if (inbox.length) parts.push(`${inbox.length} thing${inbox.length > 1 ? 's' : ''} to check`);
  if (parts.length) await notify(hid, { title: 'Your money today', body: parts.join(' · '), url: '/#/' });
}

async function aiJobs(hid) {
  const ai = require('../modules/ai/ai'); const c = ai.cfg(hid);
  if (!c.enabled) return;
  const now = new Date(); const digestHour = (getSetting(hid, 'digest', { hour: 8 }) || {}).hour ?? 8;
  if (now.getHours() < digestHour) return;
  // Monthly review on the 1st (for the month just finished)
  if (c.features.monthly_review && now.getDate() <= 3) {
    const period = A.iso(new Date(now.getFullYear(), now.getMonth() - 1, 15)).slice(0, 7);
    if (!q.get(`SELECT 1 FROM ai_reports WHERE household_id=? AND kind='monthly' AND period=?`, hid, period)
        && q.get('SELECT 1 FROM transactions WHERE household_id=? AND substr(date,1,7)=? LIMIT 1', hid, period)) {
      try { const r = await ai.monthlyReview(hid, period); await notify(hid, { title: 'Your monthly review is ready', body: r.title, url: '/#/insights/reviews' }); } catch (e) { log.warning('monthly review failed', e.message); }
    }
  }
  // Monday check-in
  if (c.features.weekly_checkin && now.getDay() === 1 && getSetting(hid, 'checkin_last') !== A.iso(now)) {
    setSetting(hid, 'checkin_last', A.iso(now));
    try { await notify(hid, { title: 'Week ahead', body: await ai.weeklyCheckin(hid), url: '/#/' }); } catch (e) { log.warning('check-in failed', e.message); }
  }
}

async function sensors(hid) {
  if (!ha.available(hid)) return;
  const f = require('../modules/ai/aitools').freeUntilPayday(hid);
  const monthSpend = q.get(`SELECT ROUND(COALESCE(SUM(-t.amount),0),2) v FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.household_id=? AND t.date>=? AND t.amount<0 AND COALESCE(c.kind,'expense')!='transfer'`, hid, A.iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12))).v;
  const next = q.get(`SELECT merchant, amount, next_date date FROM subscriptions WHERE household_id=? AND status='active' AND next_date>=? ORDER BY next_date LIMIT 1`, hid, A.iso(new Date()));
  await ha.publishSensors(hid, { ...f, monthSpend, inbox: A.inbox(hid).filter((i) => !i.soft).length, next });
}

// Tell people (once) when a payment is late or something charged after it was ended
async function trackerAlerts(hid) {
  const sent = getSetting(hid, 'tracker_alerts_sent', {});
  for (const a of require('../modules/tracker/tracker').alerts(hid)) {
    const key = a.kind === 'overdue' ? `o:${a.subscription.id}:${a.due_date}` : `e:${a.subscription.id}:${a.paid_date}`;
    if (sent[key]) continue; sent[key] = 1;
    if (a.kind === 'overdue') await notify(hid, { title: `${a.subscription.display} hasn't come out`, body: `£${a.expected.toFixed(2)} was due on ${a.due_date}. Mark it paid or skipped in Regular payments.`, url: '/#/subscriptions' });
    else await notify(hid, { title: `${a.subscription.display} charged after you ended it`, body: `£${a.paid_amount.toFixed(2)} on ${a.paid_date}`, url: '/#/subscriptions' });
  }
  setSetting(hid, 'tracker_alerts_sent', Object.fromEntries(Object.entries(sent).slice(-500)));
}

let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    for (const h of q.all('SELECT id FROM households')) {
      try { await householdTick(h.id); } catch (e) { log.error('Background jobs failed', e.stack || e.message); }
    }
  } finally { running = false; }
}

async function householdTick(hid) {
  {
    {
      const syncHours = getSetting(hid, 'bank_sync_hours', 4);
      let changed = false;
      for (const c of q.all('SELECT * FROM connections WHERE household_id=? AND auto_sync=1', hid)) {
        if (hoursSince(c.last_sync) >= syncHours) { try { const r = await syncConnection(c); if (r.added) changed = true; } catch (e) { log.warning('bank sync', e.message); } }
      }
      if (changed) await afterNewTransactions(hid).catch((e) => log.warning('after import', e.message));
      // email receipts: check each mailbox, then re-check pending suggestions (the bank payment may have arrived since)
      let newReceipts = 0;
      for (const acct of q.all(`SELECT * FROM email_accounts WHERE household_id=? AND enabled=1 AND (kind IS NOT 'microsoft' OR graph_refresh_token IS NOT NULL)`, hid)) {
        if (hoursSince(acct.last_sync) * 60 >= getSetting(hid, 'email_check_minutes', 30)) { try { newReceipts += (await require('../modules/email/email').syncAccount(acct)).found; } catch (e) { log.warning('email sync', acct.name, e.message); } }
      }
      if (changed || newReceipts) require('../modules/email/email').rematchPending(hid);
      if (newReceipts) await notify(hid, { title: `${newReceipts} receipt${newReceipts > 1 ? 's' : ''} from your email to check`, body: 'Hearth has matched them to your bills and payments — approve or change them.', url: '/#/receipts' });
      for (const cal of q.all('SELECT * FROM calendars WHERE household_id=? AND enabled=1', hid)) {
        if (hoursSince(cal.last_sync) >= 1) { try { await syncCalendar(cal); } catch (e) { log.warning('calendar', e.message); } }
      }
      for (const w of q.all('SELECT * FROM watches WHERE household_id=? AND enabled=1 AND url IS NOT NULL', hid)) {
        if (hoursSince(w.last_checked) >= getSetting(hid, 'price_check_hours', 6)) { try { await checkWatch(w); } catch { /* recorded on the watch */ } }
      }
      require('../modules/tracker/tracker').refreshNextDates(hid);
      await trackerAlerts(hid).catch((e) => log.warning('tracker alerts', e.message));
      await budgetAlerts(hid).catch((e) => log.warning('budget alerts', e.message));
      await dailyDigest(hid).catch((e) => log.warning('daily digest', e.message));
      await aiJobs(hid).catch((e) => log.warning('AI jobs', e.message));
      await sensors(hid).catch((e) => log.debug('sensors', e.message));
      // Background jobs added by feature modules (see src/modules/index.js)
      for (const m of require('../modules')) if (m.job) await m.job(hid).catch((e) => log.warning(`${m.name} job`, e.message));
    }
  }
}

const safeTick = () => tick().catch((e) => log.error('Background jobs failed', e.stack || e.message));
function start() { setTimeout(safeTick, 10000); setInterval(safeTick, 15 * 60 * 1000); }

module.exports = { start, tick, afterNewTransactions, budgetAlerts, sensors };
