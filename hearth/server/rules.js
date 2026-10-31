// Workflow engine: "when <trigger> and <conditions> then <actions>".
// Triggers: transaction_created, budget_threshold, subscription_detected, subscription_due, price_target, large_transaction, note_added, event_upcoming
const { q } = require('./db');
const { notify } = require('./notify');
const { learnMerchant } = require('./categorize');

const FIELDS = {
  description: (t) => t.description || '', merchant: (t) => t.merchant || '', amount: (t) => t.amount,
  abs_amount: (t) => Math.abs(t.amount), account_id: (t) => t.account_id, category_id: (t) => t.category_id,
  person_id: (t) => t.person_id, kind: (t) => t.kind, user_id: (t) => t.user_id,
  weekday: (t) => new Date(t.date).getDay(), day_of_month: (t) => new Date(t.date).getDate(),
  direction: (t) => (t.amount < 0 ? 'out' : 'in'), source: (t) => t.source,
  // context fields for non-transaction triggers
  pct: (c) => c.pct, budget_id: (c) => c.budget_id, price: (c) => c.price, days_until: (c) => c.days_until,
};

function test(cond, ctx) {
  const getter = FIELDS[cond.field];
  const v = getter ? getter(ctx) : ctx[cond.field];
  const target = cond.value;
  const s = String(v ?? '').toLowerCase(), t = String(target ?? '').toLowerCase();
  switch (cond.op) {
    case 'contains': return s.includes(t);
    case 'not_contains': return !s.includes(t);
    case 'equals': return s === t;
    case 'not_equals': return s !== t;
    case 'starts_with': return s.startsWith(t);
    case 'regex': try { return new RegExp(target, 'i').test(String(v ?? '')); } catch { return false; }
    case 'gt': return Number(v) > Number(target);
    case 'gte': return Number(v) >= Number(target);
    case 'lt': return Number(v) < Number(target);
    case 'lte': return Number(v) <= Number(target);
    case 'between': { const [a, b] = String(target).split(',').map(Number); return Number(v) >= a && Number(v) <= b; }
    case 'in': return String(target).split(',').map((x) => x.trim().toLowerCase()).includes(s);
    case 'is_empty': return v == null || v === '';
    case 'not_empty': return !(v == null || v === '');
    default: return false;
  }
}

function fill(tpl = '', ctx) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'amount' && ctx.amount != null) return `£${Math.abs(ctx.amount).toFixed(2)}`;
    return ctx[k] ?? '';
  });
}

async function applyActions(hid, rule, ctx, isTx) {
  const actions = JSON.parse(rule.actions || '[]');
  const patch = {};
  for (const a of actions) {
    switch (a.type) {
      case 'set_category': patch.category_id = Number(a.value); patch.categorised_by = 'rule'; break;
      case 'set_person': patch.person_id = Number(a.value); break;
      case 'set_kind': patch.kind = a.value; break;
      case 'set_color': patch.color = a.value; break;
      case 'set_merchant': patch.merchant = a.value; break;
      case 'append_note': patch.notes = [ctx.notes, fill(a.value, ctx)].filter(Boolean).join(' · '); break;
      case 'set_event': patch.event_id = Number(a.value); break;
      case 'mark_unexpected': patch.unexpected = 1; break;
      case 'mark_work_expense': patch.work_expense = 1; patch.claim_status = 'to_claim'; break;
      case 'add_tag':
        if (isTx && ctx.id) {
          const tag = q.get('SELECT id FROM tags WHERE household_id=? AND (id=? OR name=?)', hid, Number(a.value) || -1, String(a.value));
          const tagId = tag?.id || Number(q.run('INSERT INTO tags(household_id,name) VALUES(?,?)', hid, String(a.value)).lastInsertRowid);
          q.run('INSERT OR IGNORE INTO transaction_tags VALUES(?,?)', ctx.id, tagId);
        }
        break;
      case 'ha_event': // fire an event HA automations can trigger on, e.g. hearth_large_spend
        try { await require('./ha').fireEvent(hid, a.value || 'hearth_event', { rule: rule.name, merchant: ctx.merchant, amount: ctx.amount, category_id: ctx.category_id, date: ctx.date, name: ctx.name, pct: ctx.pct }); } catch (e) { console.warn('HA event failed', e.message); }
        break;
      case 'ha_service': { // call any HA service, e.g. light.turn_on with {"entity_id":"light.hall","color_name":"red"}
        const [domain, service] = String(a.value || '').split('.');
        let data = {}; try { data = JSON.parse(fill(a.data || '{}', ctx)); } catch {}
        if (domain && service) try { await require('./ha').call(hid, 'POST', `/services/${domain}/${service}`, data); } catch (e) { console.warn('HA service failed', e.message); }
        break;
      }
      case 'notify':
        await notify(hid, { title: fill(a.title || rule.name, ctx), body: fill(a.message || '{merchant} {amount}', ctx), url: a.url || '/#/inbox' },
          { haServices: a.ha_services, ntfy: a.ntfy });
        break;
    }
  }
  if (isTx && ctx.id && Object.keys(patch).length) {
    const cols = Object.keys(patch);
    q.run(`UPDATE transactions SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...cols.map((c) => patch[c]), ctx.id);
    Object.assign(ctx, patch);
    if (patch.category_id && a_learn(actions)) learnMerchant(hid, ctx.merchant, patch.category_id);
  }
  q.run('UPDATE rules SET last_run=CURRENT_TIMESTAMP, run_count=run_count+1 WHERE id=?', rule.id);
}
const a_learn = (actions) => actions.some((a) => a.type === 'set_category' && a.learn);

async function runRules(hid, trigger, ctx, { isTx = trigger === 'transaction_created', onlyRuleId } = {}) {
  const rules = q.all('SELECT * FROM rules WHERE household_id=? AND enabled=1 AND trigger=? ORDER BY priority, id', hid, trigger)
    .filter((r) => !onlyRuleId || r.id === onlyRuleId);
  const matched = [];
  for (const r of rules) {
    const conds = JSON.parse(r.conditions || '[]');
    const ok = conds.length === 0 ? true : r.match_all ? conds.every((c) => test(c, ctx)) : conds.some((c) => test(c, ctx));
    if (!ok) continue;
    matched.push(r.id);
    await applyActions(hid, r, ctx, isTx);
    if (r.stop_processing) break;
  }
  return matched;
}

// Preview which existing transactions a rule would hit — lets people build rules confidently
function previewRule(hid, conditions, matchAll = true, limit = 50) {
  const txs = q.all('SELECT * FROM transactions WHERE household_id=? ORDER BY date DESC LIMIT 5000', hid);
  const hits = txs.filter((t) => (matchAll ? conditions.every((c) => test(c, t)) : conditions.some((c) => test(c, t))));
  return { count: hits.length, sample: hits.slice(0, limit) };
}

module.exports = { runRules, previewRule, test };
