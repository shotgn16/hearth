// Email receipts: everything Hearth found in your mailbox, what it thinks each one is, and an approval queue.
// Nothing changes until you approve — and you can change what it's matched to first.
import { state, api, esc, fmt, niceDate, relDay, sheet, toast, fail, on, opts, token } from './core.js';
import { setBadge } from './app.js';

let tab = 'pending';
const ACTION = {
  link: (r) => `Attach to the ${r.transaction ? `${fmt(Math.abs(r.transaction.amount))} payment on ${niceDate(r.transaction.date)}` : 'payment'}`,
  mark_paid: (r) => `Mark ${r.subscription?.display || 'the bill'} as paid${r.suggested?.due_date || r.due_date ? ` for ${niceDate(r.due_date || r.suggested.due_date, { month: 'long' })}` : ''}`,
  add_spend: () => 'Add it as a new spend',
  none: () => 'Just keep the receipt',
};
const fileUrl = (r, a) => `api/email/receipts/${r.id}/file/${encodeURIComponent(a.name)}`;
const confLabel = (c) => (c >= 0.8 ? ['High', 'ok'] : c >= 0.5 ? ['Medium', 'due'] : ['Low', '']);

export async function renderReceipts(el, parts = []) {
  if (parts[0]) tab = parts[0];
  const [counts, accounts] = await Promise.all([api('/email/receipts/counts'), api('/email/accounts')]);
  if (!accounts.length) {
    el.innerHTML = `<div class="empty"><b>Connect your email to collect receipts</b>Hearth checks your mailbox for receipts, invoices and bills, works out which bill and payment each belongs to, and asks you to approve it.
      <div style="margin-top:16px"><a class="btn" href="#/settings/email">Connect a mailbox</a></div></div>`;
    return;
  }
  el.innerHTML = `<div class="row" style="margin-bottom:14px"><div class="seg" style="margin:0">${[['pending', `To approve${counts.pending ? ` · ${counts.pending}` : ''}`], ['approved', 'Approved'], ['ignored', 'Not receipts']]
      .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="spacer"></span>
    <button class="btn soft small" data-check>Check email now</button><a class="btn ghost small" href="#/settings/email">Mailboxes</a></div>
    <div id="rb"></div>`;
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; renderReceipts(el); });
  el.querySelector('[data-check]').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Checking…';
    let found = 0;
    for (const a of accounts.filter((x) => x.enabled)) { try { found += (await api(`/email/accounts/${a.id}/sync`, { method: 'POST', body: {} })).found; } catch (err) { fail(err); } }
    toast(found ? `${found} new receipt${found > 1 ? 's' : ''} found` : 'No new receipts'); renderReceipts(el);
  };
  const list = await api(`/email/receipts?status=${tab}`);
  const box = el.querySelector('#rb');
  if (!list.length) {
    box.innerHTML = `<div class="empty"><b>${tab === 'pending' ? 'Nothing to approve' : tab === 'approved' ? 'No approved receipts yet' : 'Nothing here'}</b>${tab === 'pending' ? `Hearth checks your email every ${30} minutes. New receipts appear here for you to approve.` : ''}</div>`;
    return;
  }
  const confident = list.filter((r) => tab === 'pending' && (r.suggested?.confidence || 0) >= 0.8);
  box.innerHTML = `${confident.length > 1 ? `<div class="attention calm" style="margin:0 0 14px"><span>✓</span><span style="flex:1">${confident.length} receipts are a confident match</span><button class="btn small" data-batch>Approve those ${confident.length}</button></div>` : ''}
    <div class="receipt-list">${list.map((r) => card(r)).join('')}</div>`;
  box.querySelector('[data-batch]')?.addEventListener('click', async () => {
    if (!confirm(`Approve ${confident.length} receipts exactly as suggested?`)) return;
    const res = await api('/email/receipts/approve-batch', { method: 'POST', body: { ids: confident.map((r) => r.id) } });
    toast(`Approved ${res.approved}`); refreshBadge(); renderReceipts(el);
  });
  on(box, 'click', '[data-approve]', async (e, b) => {
    b.disabled = true;
    try { await api(`/email/receipts/${b.dataset.approve}/approve`, { method: 'POST', body: {} }); toast('Approved'); b.closest('.receipt').remove(); refreshBadge(); }
    catch (err) { fail(err); b.disabled = false; }
  });
  on(box, 'click', '[data-change]', (e, b) => changeSheet(Number(b.dataset.change), () => { refreshBadge(); renderReceipts(el); }));
  on(box, 'click', '[data-ignore]', async (e, b) => {
    const r = list.find((x) => x.id === Number(b.dataset.ignore));
    const sender = confirm(`Not a receipt. Also ignore everything from ${r.from_email} in future?\n\nOK = ignore this sender · Cancel = just this email`);
    await api(`/email/receipts/${r.id}/ignore`, { method: 'POST', body: { sender } }); b.closest('.receipt').remove(); refreshBadge();
  });
  on(box, 'click', '[data-undo]', async (e, b) => { await api(`/email/receipts/${b.dataset.undo}/undo`, { method: 'POST' }); toast('Moved back to To approve'); renderReceipts(el); });
  on(box, 'click', '[data-view]', (e, b) => viewEmail(Number(b.dataset.view)));
}

function refreshBadge() { api('/inbox').then((i) => setBadge(i.filter((x) => !x.soft).length)).catch(() => {}); }

function card(r) {
  const s = r.suggested || {}; const [cl, cc] = confLabel(s.confidence || 0);
  const act = r.status === 'approved' ? r.action : s.action;
  return `<article class="receipt surface pad">
    <div class="row" style="align-items:flex-start;gap:12px">
      <div style="flex:1;min-width:0"><div class="title" style="font-weight:700;font-size:1.05rem">${esc(r.merchant || r.from_name)}${r.total != null ? ` · ${fmt(r.total)}` : ''}</div>
        <div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.subject)} · ${relDay(r.received_at)}${r.mailbox ? ` · ${esc(r.mailbox)}` : ''}</div>
        <div class="muted small">${r.order_ref ? `Ref ${esc(r.order_ref)} · ` : ''}${r.account_ref ? `Account ${esc(r.account_ref)} · ` : ''}${r.items.length ? `${r.items.length} item${r.items.length > 1 ? 's' : ''}` : ''}
          ${r.attachments.map((a) => ` · <a href="#" data-file="${fileUrl(r, a)}">${esc(a.name)}</a>`).join('')}</div></div>
      ${r.status === 'pending' ? `<span class="pill ${cc}" title="How sure Hearth is">${cl} match</span>` : ''}
    </div>
    <div class="match">
      <div class="match-grid">
        <div><span class="muted small">Bill / subscription</span><b>${r.subscription ? esc(r.subscription.display) : '—'}</b></div>
        <div><span class="muted small">Payment</span><b>${r.transaction ? `${fmt(Math.abs(r.transaction.amount))} · ${niceDate(r.transaction.date)}` : act === 'add_spend' ? 'New spend' : '—'}</b></div>
        <div><span class="muted small">Account</span><b>${r.account ? esc(r.account.name) : '—'}</b></div>
      </div>
      ${r.status === 'pending' && s.reasons?.length ? `<ul class="reasons">${s.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="small" style="margin-top:6px">${r.status === 'approved' ? `✓ Approved ${relDay(r.approved_at)} — ${esc(ACTION[act || 'none'](r))}` : `<b>When approved:</b> ${esc(ACTION[act || 'none'](r))}`}</div>
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      ${r.status === 'pending' ? `<button class="btn small" data-approve="${r.id}">Approve</button><button class="btn small soft" data-change="${r.id}">Change</button><button class="btn small ghost" data-ignore="${r.id}">Not a receipt</button>`
        : r.status === 'approved' ? `<button class="btn small ghost" data-undo="${r.id}">Undo approval</button>` : `<button class="btn small ghost" data-undo="${r.id}">It is a receipt</button>`}
      <span class="spacer"></span><button class="btn small ghost" data-view="${r.id}">View email</button></div>
  </article>`;
}

async function changeSheet(id, done) {
  const r = await api(`/email/receipts/${id}`);
  const s = r.suggested || {};
  const sel = { subscription_id: s.subscription_id || '', transaction_id: s.transaction_id || '', account_id: s.account_id || '', due_date: s.due_date || '', action: s.action || 'none' };
  const { el, close } = sheet(`<h2>What is this receipt for?</h2>
    <p class="muted small" style="margin-top:-8px">${esc(r.merchant)} · ${r.total != null ? fmt(r.total) : 'no amount found'} · ${niceDate(r.receipt_date, { day: 'numeric', month: 'short', year: 'numeric' })} — ${esc(r.subject)}</p>
    <form class="kv" id="cf">
      <label class="f"><span>Amount (£)</span><input type="number" step="0.01" name="total" value="${r.total ?? ''}"></label>
      <label class="f"><span>Date</span><input type="date" name="receipt_date" value="${r.receipt_date || ''}"></label>
      <label class="f" style="grid-column:1/-1"><span>Bill or subscription</span><select name="subscription_id"><option value="">Not a regular payment</option>${r.candidates.subscriptions.map((x) => `<option value="${x.id}" ${String(x.id) === String(sel.subscription_id) ? 'selected' : ''}>${esc(x.display)} · ${fmt(x.amount)} ${esc(x.cadence)}${x.status !== 'active' ? ` (${esc(x.status)})` : ''}</option>`).join('')}</select></label>
      <div class="f" style="grid-column:1/-1"><span class="small muted" style="font-weight:600">Payment it belongs to</span>
        <ul class="list pick" id="txpick">${r.candidates.transactions.map((t) => `<li class="tap ${String(t.id) === String(sel.transaction_id) ? 'on' : ''}" data-tx="${t.id}"><div class="main"><div class="title">${esc(t.merchant)}</div><div class="meta">${niceDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' })}${t.account_name ? ` · ${esc(t.account_name)}` : ''}</div></div><div class="amt">${fmt(Math.abs(t.amount))}</div></li>`).join('')}
          <li class="tap ${!sel.transaction_id ? 'on' : ''}" data-tx=""><div class="main"><div class="title">None of these</div><div class="meta">The payment isn't in your accounts (cash, another card…)</div></div></li></ul></div>
      <label class="f"><span>Paid from</span><select name="account_id">${opts(state.accounts, sel.account_id, (a) => a.name, 'Not sure')}</select></label>
      <label class="f" data-due><span>For the payment due</span><select name="due_date"><option value="">—</option>${r.candidates.due_dates.map((d) => `<option value="${d}" ${d === sel.due_date ? 'selected' : ''}>${niceDate(d, { day: 'numeric', month: 'long', year: 'numeric' })}</option>`).join('')}</select></label>
      <label class="f" style="grid-column:1/-1"><span>When approved</span><select name="action">
        <option value="link">Attach it to the payment above</option><option value="mark_paid">Mark the bill as paid (no bank payment to attach)</option>
        <option value="add_spend">Add it as a new spend</option><option value="none">Just keep the receipt</option></select></label>
      <div class="row" style="grid-column:1/-1"><span class="muted small" id="hint"></span><span class="spacer"></span><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Approve</button></div>
    </form>`, { wide: true });
  const f = el.querySelector('#cf');
  f.action.value = sel.action;
  const sync = () => {
    const hasTx = !!sel.transaction_id, hasSub = !!f.subscription_id.value;
    if (f.action.value === 'link' && !hasTx) f.action.value = hasSub ? 'mark_paid' : 'add_spend';
    el.querySelector('[data-due]').classList.toggle('hidden', !hasSub);
    el.querySelector('#hint').textContent = f.action.value === 'link' ? 'The receipt\'s details are added to that payment.' : f.action.value === 'mark_paid' ? 'Ticks off that month in Regular payments.' : f.action.value === 'add_spend' ? 'Creates a transaction for it.' : '';
  };
  on(el, 'click', '[data-tx]', (e, li) => { el.querySelectorAll('#txpick li').forEach((x) => x.classList.toggle('on', x === li)); sel.transaction_id = li.dataset.tx; if (sel.transaction_id) f.action.value = 'link'; sync(); });
  f.subscription_id.onchange = async () => {
    // refresh which payment dates the chosen bill has around this receipt
    if (!f.subscription_id.value) return sync();
    const dates = await api(`/tracker/due-dates?subscription_id=${f.subscription_id.value}&around=${r.receipt_date || ''}`).catch(() => []);
    const near = dates.slice().sort((a, b) => Math.abs(new Date(a) - new Date(r.receipt_date)) - Math.abs(new Date(b) - new Date(r.receipt_date)))[0];
    f.due_date.innerHTML = `<option value="">—</option>${dates.map((d) => `<option value="${d}" ${d === near ? 'selected' : ''}>${niceDate(d, { day: 'numeric', month: 'long', year: 'numeric' })}</option>`).join('')}`;
    if (!sel.transaction_id && f.action.value !== 'add_spend') f.action.value = 'mark_paid';
    sync();
  };
  f.action.onchange = sync; sync();
  f.onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f));
    const body = { subscription_id: d.subscription_id ? Number(d.subscription_id) : '', transaction_id: sel.transaction_id ? Number(sel.transaction_id) : '', account_id: d.account_id ? Number(d.account_id) : '',
      due_date: d.due_date || '', action: d.action, total: d.total === '' ? undefined : Number(d.total), receipt_date: d.receipt_date || undefined };
    if (body.action === 'mark_paid' && (!body.subscription_id || !body.due_date)) return toast('Pick the bill and which payment it was for');
    if (body.action === 'link' && !body.transaction_id) return toast('Pick the payment to attach it to');
    try { await api(`/email/receipts/${id}/approve`, { method: 'POST', body }); close(); toast('Approved — Hearth will remember this sender'); done(); } catch (err) { fail(err); }
  };
}

async function viewEmail(id) {
  const r = await api(`/email/receipts/${id}`);
  sheet(`<h2>${esc(r.subject)}</h2><p class="muted small" style="margin-top:-8px">From ${esc(r.from_name)} &lt;${esc(r.from_email)}&gt; · ${new Date(r.received_at).toLocaleString('en-GB')}</p>
    ${r.items.length ? `<table class="grid" style="margin-bottom:12px"><tbody>${r.items.map((i) => `<tr><td>${i.qty > 1 ? `${i.qty} × ` : ''}${esc(i.name)}</td><td class="r">${fmt(i.price)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${r.attachments.map((a) => `<a class="btn soft small" style="margin:0 6px 10px 0" href="#" data-file="${fileUrl(r, a)}">Open ${esc(a.name)}</a>`).join('')}
    <pre class="email-text">${esc(r.body_text || '')}</pre><div class="row end"><button class="btn" data-close>Close</button></div>`, { wide: true });
}
