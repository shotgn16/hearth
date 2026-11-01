// Unexpected costs and work expenses
import { state, api, esc, fmt, fmt0, niceDate, relDay, catIcon, cat, sheet, toast, fail, on, iso, token } from './core.js';
import { barChart } from './charts.js';
import { txSheet } from './money.js';

let tab = 'unexpected', workStatus = 'to_claim';
const CLAIM = { to_claim: 'To claim', claimed: 'Claimed', paid_back: 'Paid back' };

export async function renderExpenses(el, parts = []) {
  if (parts[0]) tab = parts[0];
  el.innerHTML = `<div class="row" style="margin-bottom:14px"><div class="seg" style="margin:0"><button data-tab="unexpected" class="${tab === 'unexpected' ? 'on' : ''}">Unexpected costs</button><button data-tab="work" class="${tab === 'work' ? 'on' : ''}">Work expenses</button></div>
    <span class="spacer"></span><button class="btn small" data-add>Add</button></div><div id="xb"></div>`;
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; renderExpenses(el); });
  el.querySelector('[data-add]').onclick = () => addSheet(tab, () => renderExpenses(el));
  return tab === 'work' ? work(el.querySelector('#xb'), () => renderExpenses(el)) : unexpected(el.querySelector('#xb'), () => renderExpenses(el));
}

const txRow = (t, extra = '') => `<li class="tap" data-tx="${t.id}">${extra}${catIcon(cat(t.category_id))}<div class="main"><div class="title">${esc(t.merchant)}</div>
  <div class="meta">${niceDate(t.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(t.category_name || 'Uncategorised')}${t.person_name ? ` · ${esc(t.person_name)}` : ''}${t.notes ? ` · ${esc(t.notes)}` : ''}</div></div>
  <div class="amt">${fmt(Math.abs(t.amount))}</div></li>`;

async function openTx(id, done) {
  const t = (await api(`/transactions?id=${id}`)).rows[0];
  if (t) txSheet(t, done);
}

// ---------- unexpected ----------
async function unexpected(box, done) {
  const u = await api('/expenses/unexpected');
  const over = u.average_per_month && u.this_month > u.average_per_month;
  box.innerHTML = `<p class="muted" style="margin-top:0">Costs you didn't plan for — repairs, vet bills, fines, things that broke. Seeing them over time shows how much to keep aside each month.</p>
    <div class="stat-row"><div><b ${over ? 'style="color:var(--amber-ink)"' : ''}>${fmt0(u.this_month)}</b><span>this month</span></div><div><b>${fmt0(u.average_per_month)}</b><span>a typical month</span></div>
      <div><b>${fmt0(u.year_total)}</b><span>last 12 months</span></div><div><b>${fmt0(Math.ceil((u.year_total / 12) / 10) * 10)}</b><span>worth putting aside monthly</span></div></div>
    <div class="surface pad" style="margin-bottom:22px">${barChart(u.monthly.map((m) => new Date(`${m.month}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })), [{ name: 'Unexpected', color: 'var(--amber)', values: u.monthly.map((m) => m.total) }], { height: 180 })}</div>
    ${u.suggestions.length ? `<section style="margin-bottom:22px"><h3>Were any of these unexpected?</h3><div class="surface"><ul class="list">${u.suggestions.map((t) => `<li><div class="main"><div class="title">${esc(t.merchant)} · ${fmt(Math.abs(t.amount))}</div>
      <div class="meta">${niceDate(t.date)}${t.usual ? ` · you usually spend about ${fmt(t.usual)} there` : ' · a large one-off'}</div></div>
      <div class="row" style="gap:6px"><button class="btn small" data-yes="${t.id}">Yes</button><button class="btn small ghost" data-no="${t.id}">No</button></div></li>`).join('')}</ul></div></section>` : ''}
    <div class="grid2" style="margin-top:0"><section><h3>Recent unexpected costs <a href="#/money?unexpected=1">All</a></h3>
      ${u.items.length ? `<div class="surface"><ul class="list">${u.items.slice(0, 30).map((t) => txRow(t)).join('')}</ul></div>` : '<div class="empty"><b>None flagged yet</b>Open any transaction and switch on "Unexpected", or jot "emergency plumber £180".</div>'}</section>
      <section><h3>By category · 12 months</h3><div class="surface pad catbars">${u.by_category.map((c) => `<div class="cb"><span>${esc(c.icon || '')} ${esc(c.category)} <span class="muted small">· ${c.n}</span></span><b class="money">${fmt0(c.total)}</b>
        <div class="bar"><i style="width:${c.total / (u.by_category[0]?.total || 1) * 100}%;background:${c.color || 'var(--amber)'}"></i></div></div>`).join('') || '<p class="muted" style="margin:0">Nothing yet.</p>'}</div>
        <p class="muted small">Tip: create a budget with <b>Only unexpected costs</b> (Plan → New budget) to cap or plan for these.</p></section></div>`;
  on(box, 'click', '[data-yes]', async (e, b) => { await api(`/transactions/${b.dataset.yes}`, { method: 'PATCH', body: { unexpected: 1 } }); toast('Marked unexpected'); unexpected(box, done); });
  on(box, 'click', '[data-no]', async (e, b) => { await api('/expenses/unexpected/dismiss', { method: 'POST', body: { id: b.dataset.no } }); b.closest('li').remove(); });
  on(box, 'click', '[data-tx]', (e, li) => openTx(Number(li.dataset.tx), () => unexpected(box, done)));
}

// ---------- work expenses ----------
async function work(box, done) {
  const w = await api(`/expenses/work?status=${workStatus}`);
  const sel = new Set();
  box.innerHTML = `<p class="muted" style="margin-top:0">Things to claim back from work. Mark them claimed when you submit them, then paid back when the money arrives.</p>
    <div class="stat-row"><div><b ${w.totals.to_claim ? 'style="color:var(--amber-ink)"' : ''}>${fmt(w.totals.to_claim)}</b><span>to claim${w.oldest_unclaimed ? ` · oldest ${relDay(w.oldest_unclaimed)}` : ''}</span></div>
      <div><b>${fmt(w.totals.claimed)}</b><span>claimed, waiting to be paid</span></div><div><b>${fmt(w.totals.paid_back)}</b><span>paid back</span></div><div><b>${fmt0(w.totals.year)}</b><span>this year</span></div></div>
    <div class="row" style="margin-bottom:12px"><div class="seg" style="margin:0">${Object.entries(CLAIM).map(([k, l]) => `<button data-ws="${k}" class="${workStatus === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="spacer"></span>
      <button class="btn ghost small" data-csv>Download for an expense claim</button></div>
    <div id="wbulk"></div>
    ${w.items.length ? `<div class="surface"><ul class="list">${w.items.map((t) => txRow(t, `<input type="checkbox" data-sel="${t.id}" aria-label="Select" data-stop>`).replace('</div></div>', `${t.claim_ref ? ` · ref ${esc(t.claim_ref)}` : ''}${t.claimed_at ? ` · claimed ${niceDate(t.claimed_at)}` : ''}${t.reimbursed_at ? ` · paid back ${niceDate(t.reimbursed_at)}` : ''}</div></div>`)).join('')}</ul></div>`
      : `<div class="empty"><b>Nothing ${CLAIM[workStatus].toLowerCase()}</b>Switch on "Work expense" on any transaction, or jot "£45 client lunch".</div>`}`;
  const bulk = () => {
    const b = box.querySelector('#wbulk'); const items = w.items.filter((t) => sel.has(t.id)); const total = items.reduce((n, t) => n + Math.abs(t.amount), 0);
    b.innerHTML = sel.size ? `<div class="bulkbar"><b>${sel.size} selected · ${fmt(total)}</b><span class="spacer"></span>
      ${workStatus !== 'claimed' ? '<button class="btn small soft" data-to="claimed">Mark claimed</button>' : ''}${workStatus !== 'paid_back' ? '<button class="btn small soft" data-to="paid_back">Mark paid back</button>' : ''}
      ${workStatus !== 'to_claim' ? '<button class="btn small soft" data-to="to_claim">Back to "to claim"</button>' : ''}<button class="btn small soft" data-to="none">Not a work expense</button></div>` : '';
  };
  on(box, 'change', '[data-sel]', (e, c) => { c.checked ? sel.add(Number(c.dataset.sel)) : sel.delete(Number(c.dataset.sel)); bulk(); });
  on(box, 'click', '[data-ws]', (e, b) => { workStatus = b.dataset.ws; work(box, done); });
  on(box, 'click', '[data-tx]', (e, li) => { if (e.target.matches('input')) return; openTx(Number(li.dataset.tx), () => work(box, done)); });
  on(box, 'click', '[data-to]', async (e, b) => {
    const to = b.dataset.to; const ids = [...sel];
    if (to === 'claimed') { const ref = prompt('Claim reference (optional)') ?? null; await api('/expenses/work/status', { method: 'POST', body: { ids, status: 'claimed', claim_ref: ref || null } }); return work(box, done); }
    if (to === 'paid_back') return paidBackSheet(ids, w.items.filter((t) => sel.has(t.id)).reduce((n, t) => n + Math.abs(t.amount), 0), () => work(box, done));
    await api('/expenses/work/status', { method: 'POST', body: { ids, status: to } }); work(box, done);
  });
  box.querySelector('[data-csv]').onclick = async () => {
    const r = await fetch(`api/transactions/export.csv?work_expense=1&claim_status=${workStatus}`, { headers: { Authorization: `Bearer ${token()}` } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `work-expenses-${workStatus}-${iso()}.csv`; a.click();
  };
}

async function paidBackSheet(ids, total, done) {
  const cands = await api(`/expenses/work/reimbursements?amount=${total}`);
  const { el, close } = sheet(`<h2>Paid back · ${fmt(total)}</h2><p class="muted">If the repayment has arrived in a connected account, pick it — Hearth keeps it out of your income figures.</p>
    <ul class="list">${cands.map((c) => `<li class="tap" data-r="${c.id}"><div class="main"><div class="title">${esc(c.merchant)}</div><div class="meta">${niceDate(c.date)}</div></div><div class="amt in">+${fmt(c.amount)}</div></li>`).join('')}</ul>
    <div class="row end" style="margin-top:12px"><button class="btn ghost" data-none>It arrived some other way</button></div>`);
  const go = async (rid) => { await api('/expenses/work/status', { method: 'POST', body: { ids, status: 'paid_back', reimbursement_tx_id: rid || null } }); close(); toast('Marked paid back'); done(); };
  on(el, 'click', '[data-r]', (e, li) => go(Number(li.dataset.r)));
  el.querySelector('[data-none]').onclick = () => go(null);
}

function addSheet(kind, done) {
  const { el, close } = sheet(`<h2>Add ${kind === 'work' ? 'a work expense' : 'an unexpected cost'}</h2><p class="muted small" style="margin-top:-8px">For something not already in your transactions. To flag an existing one, open it in Money and switch on ${kind === 'work' ? '"Work expense"' : '"Unexpected"'}.</p>
    <form class="kv"><label class="f" style="grid-column:1/-1"><span>What</span><input type="text" name="description" required placeholder="${kind === 'work' ? 'Train to Leeds for client meeting' : 'Boiler repair'}"></label>
    <label class="f"><span>Amount (£)</span><input type="number" step="0.01" name="amount" required></label><label class="f"><span>Date</span><input type="date" name="date" value="${iso()}"></label>
    <label class="f"><span>Category</span><select name="category_id"><option value="">Work it out for me</option>${state.cats.filter((c) => c.kind === 'expense').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Paid from</span><select name="account_id">${state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
    <label class="f" style="grid-column:1/-1"><span>Notes</span><input type="text" name="notes"></label>
    <div class="row end" style="grid-column:1/-1"><button class="btn">Add</button></div></form>`);
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    try {
      const t = await api('/transactions', { method: 'POST', body: { date: d.date, amount: -Math.abs(Number(d.amount)), description: d.description, notes: d.notes || null, category_id: d.category_id ? Number(d.category_id) : null, account_id: Number(d.account_id) || null } });
      await api(`/transactions/${t.id}`, { method: 'PATCH', body: kind === 'work' ? { work_expense: 1 } : { unexpected: 1 } });
      close(); toast('Added'); done();
    } catch (err) { fail(err); }
  };
}
