// Regular payments: a tracker for subscriptions and bills.
//  This month — a checklist of what's due, ticked off when the payment comes out (or by you)
//  All — every subscription grouped by Ongoing / Cancelling / Paused / Ended, with due dates and last payments
//  By category — what each kind of regular payment costs
//  History — subscriptions × months, like the spreadsheet you'd otherwise keep
import { state, api, esc, fmt, fmt0, niceDate, relDay, catIcon, sheet, toast, fail, on, opts, iso } from './core.js';
import { md, actionCard, bindActionCards } from './ask.js';

let tab = 'month', viewMonth = iso().slice(0, 7), statusFilter = 'all', typeFilter = 'all';
const STATUS = { active: 'Ongoing', cancelling: 'Cancelling', paused: 'Paused', ended: 'Ended', lapsed: 'Stopped', ignored: 'Not recurring' };
const CADENCE = { weekly: 'weekly', fortnightly: 'every 2 weeks', monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly' };
const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th'}`;
const shiftMonth = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + k, 1, 12); return iso(d).slice(0, 7); };
const monthName = (m, opts = { month: 'long', year: 'numeric' }) => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-GB', opts);

export async function renderSubscriptions(el, parts = []) {
  if (parts[0]) tab = parts[0];
  el.innerHTML = `<div class="row" style="margin-bottom:4px"><div class="seg" style="margin:0">${[['month', 'This month'], ['all', 'All'], ['category', 'By category'], ['history', 'History']]
    .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="spacer"></span>
    <button class="btn soft small" data-detect>Scan again</button>${state.me.ai?.enabled ? '<button class="btn soft small" data-aireview>Ask AI what to cut</button>' : ''}<button class="btn small" data-add>Add</button></div>
    <div id="subai" style="margin-top:14px"></div><div id="sb" style="margin-top:14px"></div>`;
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; renderSubscriptions(el); });
  el.querySelector('[data-add]').onclick = () => editSheet(null, () => renderSubscriptions(el));
  el.querySelector('[data-detect]').onclick = async () => { const r = await api('/subscriptions/detect', { method: 'POST' }); toast(`Checked — ${r.length} regular payments found`); renderSubscriptions(el); };
  el.querySelector('[data-aireview]')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Reviewing…';
    try {
      const r = await api('/ai/subscription-review', { method: 'POST' });
      const box = el.querySelector('#subai');
      box.innerHTML = `<div class="surface pad">${md(r.summary || '')}${r.suggestions.length ? `<ul class="small">${r.suggestions.map((x) => `<li><b>${esc(x.merchant)}</b> — ${esc(x.reason)}${x.yearly_saving ? ` (about ${fmt0(x.yearly_saving)}/yr)` : ''}</li>`).join('')}</ul>` : ''}${r.actions.map(actionCard).join('')}</div>`;
      bindActionCards(box);
    } catch (err) { fail(err); }
    e.target.disabled = false; e.target.textContent = 'Ask AI what to cut';
  });
  const box = el.querySelector('#sb');
  const done = () => renderSubscriptions(el);
  if (tab === 'month') return monthView(box, done);
  if (tab === 'all') return allView(box, done);
  if (tab === 'category') return categoryView(box, done);
  return historyView(box, done);
}

// ---------- this month ----------
const BADGE = {
  paid: (i) => `<span class="pill ok">✓ Paid${i.paid_date ? ` ${niceDate(i.paid_date)}` : ''}${i.source === 'you' ? (String(i.note || '').startsWith('Email receipt') ? ' · from receipt' : ' · by you') : ''}</span>`,
  overdue: (i) => `<span class="pill late">${i.days_late} day${i.days_late === 1 ? '' : 's'} late</span>`,
  due_today: () => '<span class="pill due">Due today</span>',
  upcoming: (i) => `<span class="pill">${relDay(i.due_date)}</span>`,
  skipped: () => '<span class="pill">Skipped</span>',
};
async function monthView(box, done) {
  const m = await api(`/tracker/month?month=${viewMonth}`);
  const t = m.totals, pct = t.expected ? Math.round(t.paid / t.expected * 100) : 0;
  box.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="seg" style="margin:0"><button data-m="-1" aria-label="Previous month">‹</button><button class="on">${monthName(viewMonth)}</button><button data-m="1" aria-label="Next month">›</button></div>
      ${viewMonth !== iso().slice(0, 7) ? '<button class="btn ghost small" data-m="0">This month</button>' : ''}</div>
    <div class="stat-row"><div><b>${fmt0(t.paid)}</b><span>come out so far · ${t.paid_count} of ${t.count}</span></div><div><b>${fmt0(t.remaining)}</b><span>still to come out</span></div>
      ${t.overdue ? `<div><b style="color:var(--amber-ink)">${fmt0(t.overdue)}</b><span>late — check these</span></div>` : ''}<div><b>${fmt0(t.expected)}</b><span>expected this month</span></div></div>
    <div class="bar" style="margin:-6px 0 18px"><i style="width:${pct}%;background:var(--green)"></i></div>
    ${m.items.length ? `<div class="surface"><ul class="list">${m.items.map((i) => row(i)).join('')}</ul></div>` : '<div class="empty"><b>Nothing due this month</b>Add a subscription or bill with the Add button.</div>'}
    <p class="muted small">Ticked automatically when the payment comes out of a connected account. Tap the circle to mark it paid yourself (cash, another account) — tap again to skip this month or undo.</p>`;
  on(box, 'click', '[data-m]', (e, b) => { const k = Number(b.dataset.m); viewMonth = k === 0 ? iso().slice(0, 7) : shiftMonth(viewMonth, k); monthView(box, done); });
  on(box, 'click', '[data-tick]', async (e, b) => {
    const [id, due, status, source] = b.dataset.tick.split('|');
    // cycle: not paid → paid (by you) → skipped → back to automatic
    const next = status === 'paid' && source === 'you' ? 'skipped' : status === 'skipped' ? 'due' : status === 'paid' ? null : 'paid';
    if (!next) return toast('This one came out of your bank — nothing to tick');
    try { await api('/tracker/mark', { method: 'POST', body: { subscription_id: Number(id), due_date: due, status: next } }); monthView(box, done); } catch (err) { fail(err); }
  });
  on(box, 'click', '[data-open]', (e, li) => { if (e.target.closest('[data-tick]')) return; openSub(Number(li.dataset.open), done); });
}
function row(i) {
  const s = i.subscription;
  return `<li class="tap" data-open="${s.id}">
    <button class="tick ${i.status}" data-tick="${s.id}|${i.due_date}|${i.status}|${i.source || ''}" aria-label="${i.status === 'paid' ? 'Paid' : 'Mark as paid'}">${i.status === 'paid' ? '✓' : i.status === 'skipped' ? '–' : ''}</button>
    ${catIcon({ color: s.category_color, icon: s.category_icon }, 34)}
    <div class="main"><div class="title">${esc(s.display)}${s.status === 'cancelling' ? ' <span class="tag" style="background:var(--amber-soft);color:var(--amber-ink)">cancelling</span>' : ''}</div>
      <div class="meta">Due ${niceDate(i.due_date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${esc(s.category_name || (s.type === 'bill' ? 'Bill' : 'Subscription'))}${i.price_changed ? ' · price changed' : ''}</div></div>
    <div style="text-align:right"><div class="amt">${fmt(i.status === 'paid' ? i.paid_amount : i.expected)}</div>${BADGE[i.status](i)}</div></li>`;
}

// ---------- all ----------
async function allView(box, done) {
  const list = await api('/subscriptions');
  const groups = [['active', 'Ongoing'], ['cancelling', 'Cancelling'], ['paused', 'Paused'], ['ended', 'Ended & stopped'], ['ignored', 'Not recurring']];
  const inGroup = (s, g) => (g === 'ended' ? ['ended', 'lapsed'].includes(s.status) : s.status === g);
  const shown = list.filter((s) => (typeFilter === 'all' || s.type === typeFilter) && (statusFilter === 'all' || inGroup(s, statusFilter)));
  const live = list.filter((s) => ['active', 'cancelling'].includes(s.status));
  box.innerHTML = `<div class="stat-row"><div><b>${fmt0(live.reduce((n, s) => n + s.monthly, 0))}</b><span>a month on autopilot</span></div>
      <div><b>${fmt0(live.filter((s) => s.type === 'subscription').reduce((n, s) => n + s.yearly, 0))}</b><span>a year on subscriptions</span></div>
      <div><b>${fmt0(live.filter((s) => s.type === 'bill').reduce((n, s) => n + s.yearly, 0))}</b><span>a year on bills</span></div></div>
    <div class="chips" style="margin-bottom:14px">${[['all', 'Everything'], ...groups].map(([k, l]) => `<button class="chip ${statusFilter === k ? 'on' : ''}" data-sf="${k}">${l}</button>`).join('')}
      <span style="width:12px"></span>${[['all', 'Both'], ['subscription', 'Subscriptions'], ['bill', 'Bills']].map(([k, l]) => `<button class="chip ${typeFilter === k ? 'on' : ''}" data-tf="${k}">${l}</button>`).join('')}</div>
    ${groups.map(([g, label]) => {
      const items = shown.filter((s) => inGroup(s, g)).sort((a, b) => (a.next_due || '9').localeCompare(b.next_due || '9') || b.amount - a.amount);
      if (!items.length) return '';
      return `<section style="margin-bottom:22px"><h3>${label} <span class="muted small">· ${items.length}${['active', 'cancelling'].includes(g) ? ` · ${fmt0(items.reduce((n, s) => n + s.monthly, 0))}/month` : ''}</span></h3>
        <div class="surface"><ul class="list">${items.map((s) => `<li class="tap" data-open="${s.id}">${catIcon({ color: s.category_color, icon: s.category_icon })}
          <div class="main"><div class="title">${esc(s.display)}${s.confirmed || s.type === 'bill' ? '' : ' <span class="tag" style="background:var(--amber-soft);color:var(--amber-ink)">new</span>'}${s.manual ? ' <span class="tag" style="background:var(--paper-2);color:var(--ink-3)">added by you</span>' : ''}</div>
          <div class="meta">${esc(CADENCE[s.cadence] || s.cadence)}${s.due_day ? ` on the ${ordinal(s.due_day)}` : ''} · ${esc(s.category_name || s.type)}
            ${['active', 'cancelling'].includes(s.status) && s.next_due ? ` · next ${relDay(s.next_due)}` : ''}
            ${['ended', 'lapsed'].includes(s.status) ? ` · last paid ${s.last_payment ? `${niceDate(s.last_payment.date, { day: 'numeric', month: 'short', year: 'numeric' })} (${fmt(s.last_payment.amount)})` : 'never'}` : ''}
            ${s.status === 'paused' ? ' · paused' : ''}${s.user_name ? ` · ${esc(s.user_name)}` : ''}</div></div>
          <div style="text-align:right"><div class="amt">${fmt(s.amount)}</div><div class="muted small">${fmt0(s.yearly)}/yr</div></div></li>`).join('')}</ul></div></section>`;
    }).join('') || '<div class="empty"><b>Nothing here</b>Change the filters, or add one.</div>'}`;
  on(box, 'click', '[data-sf]', (e, b) => { statusFilter = b.dataset.sf; allView(box, done); });
  on(box, 'click', '[data-tf]', (e, b) => { typeFilter = b.dataset.tf; allView(box, done); });
  on(box, 'click', '[data-open]', (e, li) => openSub(Number(li.dataset.open), done));
}

// ---------- by category ----------
async function categoryView(box, done) {
  const list = (await api('/subscriptions')).filter((s) => ['active', 'cancelling'].includes(s.status));
  const groups = {};
  for (const s of list) (groups[s.category_name || 'Uncategorised'] ||= { color: s.category_color, icon: s.category_icon, items: [] }).items.push(s);
  const total = list.reduce((n, s) => n + s.monthly, 0) || 1;
  const sorted = Object.entries(groups).map(([k, g]) => ({ name: k, ...g, monthly: g.items.reduce((n, s) => n + s.monthly, 0) })).sort((a, b) => b.monthly - a.monthly);
  box.innerHTML = sorted.length ? `<div class="surface pad catbars" style="margin-bottom:22px">${sorted.map((g) => `<div class="cb"><span>${esc(g.icon || '')} ${esc(g.name)} <span class="muted small">· ${g.items.length}</span></span><b class="money">${fmt(g.monthly)}/mo</b>
      <div class="bar"><i style="width:${g.monthly / total * 100}%;background:${g.color || 'var(--ink-2)'}"></i></div></div>`).join('')}</div>
    ${sorted.map((g) => `<section style="margin-bottom:18px"><h3>${esc(g.icon || '')} ${esc(g.name)} <span class="muted small">· ${fmt0(g.monthly * 12)}/yr</span></h3><div class="surface"><ul class="list">
      ${g.items.sort((a, b) => b.monthly - a.monthly).map((s) => `<li class="tap" data-open="${s.id}"><div class="main"><div class="title">${esc(s.display)}</div><div class="meta">${esc(CADENCE[s.cadence])}${s.next_due ? ` · next ${relDay(s.next_due)}` : ''}</div></div><div class="amt">${fmt(s.amount)}</div></li>`).join('')}
    </ul></div></section>`).join('')}` : '<div class="empty"><b>No ongoing regular payments yet</b></div>';
  on(box, 'click', '[data-open]', (e, li) => openSub(Number(li.dataset.open), done));
}

// ---------- history grid ----------
async function historyView(box, done) {
  const h = await api('/tracker/history?months=12');
  const cell = (c) => c.state === 'none' ? '<td class="r muted">·</td>'
    : c.state === 'paid' ? `<td class="r hc-paid" title="Paid">${fmt0(c.amount)}</td>`
    : c.state === 'missed' ? `<td class="r hc-missed" title="Due but not paid">missed</td>`
    : c.state === 'skipped' ? '<td class="r muted" title="Skipped">skip</td>'
    : c.state === 'part' ? `<td class="r hc-part" title="Partly paid">${fmt0(c.amount)}</td>` : `<td class="r muted" title="Still to come">${fmt0(c.expected)}</td>`;
  box.innerHTML = `<p class="muted small" style="margin-top:0">What came out each month. Green = paid, amber = due but not paid, grey = still to come.</p>
    <div class="grid-wrap"><table class="grid"><thead><tr><th>Payment</th>${h.months.map((m) => `<th class="r">${monthName(m, { month: 'short' })}</th>`).join('')}<th class="r">12 months</th></tr></thead>
    <tbody>${h.rows.map((r) => `<tr data-open="${r.subscription.id}" style="cursor:pointer"><td>${esc(r.subscription.display)}${['ended', 'lapsed'].includes(r.subscription.status) ? ' <span class="muted small">(ended)</span>' : ''}</td>${r.cells.map(cell).join('')}<td class="r"><b>${fmt0(r.total)}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td>${h.totals.map((v) => `<td class="r">${fmt0(v)}</td>`).join('')}<td class="r">${fmt0(h.totals.reduce((n, v) => n + v, 0))}</td></tr></tfoot></table></div>`;
  on(box, 'click', '[data-open]', (e, tr) => openSub(Number(tr.dataset.open), done));
}

// ---------- detail & edit ----------
async function openSub(id, done) {
  const s = (await api('/subscriptions')).find((x) => x.id === id);
  if (!s) return;
  const txs = await api(`/transactions?subscription_id=${id}&limit=24`).catch(() => ({ rows: [] }));
  const { el, close } = sheet(`<div class="row" style="gap:14px;margin-bottom:10px">${catIcon({ color: s.category_color, icon: s.category_icon }, 46)}<div style="flex:1;min-width:0"><h2 style="margin:0">${esc(s.display)}</h2>
      <div class="muted small">${STATUS[s.status] || s.status} · ${esc(CADENCE[s.cadence])}${s.due_day ? ` on the ${ordinal(s.due_day)}` : ''}${s.next_due && ['active', 'cancelling'].includes(s.status) ? ` · next ${relDay(s.next_due)}` : ''}</div></div>
      <div style="text-align:right"><b style="font-size:1.3rem">${fmt(s.amount)}</b><div class="muted small">${fmt0(s.yearly)}/yr</div></div></div>
    <div class="stat-row" style="margin:6px 0 12px"><div><b>${fmt0(s.total_paid)}</b><span>paid in total (${s.payments} payments)</span></div><div><b>${s.start_date ? niceDate(s.start_date, { month: 'short', year: 'numeric' }) : '—'}</b><span>started</span></div>
      <div><b>${s.last_payment ? niceDate(s.last_payment.date, { day: 'numeric', month: 'short' }) : '—'}</b><span>last payment${s.last_payment ? ` · ${fmt(s.last_payment.amount)}` : ''}</span></div></div>
    <div class="row" style="margin-bottom:14px">
      ${s.status !== 'active' ? '<button class="btn soft small" data-st="active">Mark ongoing</button>' : ''}
      ${s.status !== 'cancelling' && !['ended', 'lapsed', 'ignored'].includes(s.status) ? '<button class="btn soft small" data-st="cancelling">Cancelling</button>' : ''}
      ${s.status !== 'paused' && !['ended', 'lapsed', 'ignored'].includes(s.status) ? '<button class="btn soft small" data-st="paused">Pause</button>' : ''}
      ${!['ended', 'lapsed'].includes(s.status) ? '<button class="btn soft small" data-st="ended">It\'s ended</button>' : ''}
      ${s.status !== 'ignored' ? '<button class="btn ghost small" data-st="ignored">Not recurring</button>' : ''}</div>
    <button class="btn" data-edit style="width:100%">Edit details & payment date</button>
    ${txs.rows.length ? `<h3 style="margin-top:20px">Payments</h3><ul class="list">${txs.rows.map((t) => `<li><div class="main"><div class="title">${niceDate(t.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div><div class="meta">${esc(t.account_name || '')}</div></div><div class="amt">${fmt(Math.abs(t.amount))}</div></li>`).join('')}</ul>` : ''}
    ${s.notes ? `<p class="muted small" style="margin-top:12px">${esc(s.notes)}</p>` : ''}`);
  on(el, 'click', '[data-st]', async (e, b) => {
    const st = b.dataset.st;
    let body = { status: st, confirmed: 1 };
    if (st === 'ended') { const d = prompt('When did it end? (YYYY-MM-DD)', iso()); if (!d) return; body.end_date = d; }
    await api(`/subscriptions/${id}`, { method: 'PATCH', body }); close(); toast(`Marked ${STATUS[st].toLowerCase()}`); done();
  });
  el.querySelector('[data-edit]').onclick = () => { close(); editSheet(s, done); };
}

function editSheet(s, done) {
  const isNew = !s;
  s ||= { name: '', amount: '', cadence: 'monthly', type: 'subscription', due_day: '', start_date: iso(), status: 'active' };
  const { el, close } = sheet(`<h2>${isNew ? 'Add a regular payment' : `Edit ${esc(s.display)}`}</h2>
    ${isNew ? '<p class="muted small" style="margin-top:-8px">For anything Hearth hasn\'t spotted yet — a new subscription, something paid from an account it can\'t see, or a bill paid by cash or card.</p>' : ''}
    <form class="kv">
      <label class="f" style="grid-column:1/-1"><span>Name</span><input type="text" name="name" value="${esc(s.name || s.display || '')}" required placeholder="Netflix, window cleaner, car insurance…"></label>
      <label class="f"><span>Amount (£)</span><input type="number" step="0.01" name="amount" value="${s.amount}" required></label>
      <label class="f"><span>How often</span><select name="cadence">${Object.entries(CADENCE).map(([k, l]) => `<option value="${k}" ${s.cadence === k ? 'selected' : ''}>${l[0].toUpperCase()}${l.slice(1)}</option>`).join('')}</select></label>
      <label class="f"><span>Payment date (day of month)</span><input type="number" min="1" max="31" name="due_day" value="${s.due_day || ''}" placeholder="e.g. 15"></label>
      <label class="f"><span>Type</span><select name="type"><option value="subscription">Subscription</option><option value="bill" ${s.type === 'bill' ? 'selected' : ''}>Bill</option></select></label>
      <label class="f"><span>Category</span><select name="category_id">${opts(state.cats.filter((c) => c.kind === 'expense'), s.category_id, (c) => `${c.icon} ${c.name}`, 'Choose…')}</select></label>
      <label class="f"><span>Paid from</span><select name="account_id">${opts(state.accounts, s.account_id, (a) => a.name, 'Any account')}</select></label>
      <label class="f"><span>Whose is it</span><select name="user_id">${opts(state.users, s.user_id, (u) => u.name, 'Shared')}</select></label>
      <label class="f"><span>Started</span><input type="date" name="start_date" value="${(s.start_date || '').slice(0, 10)}"></label>
      ${isNew ? `<label class="f" style="grid-column:1/-1"><span>Matches bank payments containing (optional)</span><input type="text" name="match" placeholder="Leave empty to use the name"></label>` : `<label class="f"><span>Ended</span><input type="date" name="end_date" value="${(s.end_date || '').slice(0, 10)}"></label>`}
      <label class="f" style="grid-column:1/-1"><span>Notes</span><input type="text" name="notes" value="${esc(s.notes || '')}" placeholder="Account number, renewal terms, how to cancel…"></label>
      <div class="row" style="grid-column:1/-1">${!isNew ? '<button type="button" class="btn ghost" data-del>Delete</button>' : ''}<span class="spacer"></span><button class="btn">${isNew ? 'Add' : 'Save'}</button></div></form>`);
  el.querySelector('[data-del]')?.addEventListener('click', async () => { if (!confirm(`Stop tracking ${s.display}? Its payments stay in your transactions.`)) return; await api(`/subscriptions/${s.id}`, { method: 'DELETE' }); close(); done(); });
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    const body = { ...d, amount: Number(d.amount), due_day: d.due_day ? Number(d.due_day) : null, category_id: d.category_id ? Number(d.category_id) : null, account_id: d.account_id ? Number(d.account_id) : null,
      user_id: d.user_id ? Number(d.user_id) : null, start_date: d.start_date || null, confirmed: 1 };
    if (!isNew) { body.end_date = d.end_date || null; if (body.end_date && !['ended', 'lapsed'].includes(s.status)) body.status = 'ended'; }
    try { await api(isNew ? '/subscriptions' : `/subscriptions/${s.id}`, { method: isNew ? 'POST' : 'PATCH', body }); close(); toast(isNew ? 'Added — it now appears in This month' : 'Saved'); done(); }
    catch (err) { fail(err); }
  };
}
