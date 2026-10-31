import { state, api, esc, fmt, amt, relDay, niceDate, catIcon, cat, sheet, toast, fail, on, opts, icons, iso, token, loadRefs } from './core.js';

const F = { q: '', from: '', to: '', category_id: '', account_id: '', person_id: '', user_id: '', kind: '', direction: '', uncategorised: '', tag_id: '', categorised_by: '', min: '', max: '', unexpected: '', work_expense: '', subscription_id: '', sort: 'date', dir: 'desc' };
let mode = null, offset = 0, rows = [], selected = new Set();

export async function renderMoney(el, _parts, qs) {
  for (const [k, v] of qs) if (k in F) F[k] = v;
  mode ||= (() => { try { return localStorage.getItem('hl_money_mode'); } catch { return null; } })() || (innerWidth >= 900 ? 'grid' : 'list');
  const views = await api('/saved_views').catch(() => []);
  el.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <form class="search smart" id="sf">${icons.search}<input type="search" id="q" placeholder="${state.me.ai?.enabled ? 'Search, or ask: “coffee over £5 in September”' : 'Search merchant, description, notes'}" value="${esc(F.q)}">
        ${state.me.ai?.enabled ? `<button type="submit" class="smart-btn" title="Understand my search with local AI" aria-label="Smart search">${icons.ai.replace('<svg', '<svg width="18"')}</button>` : ''}</form>
      <div class="seg" style="margin:0"><button data-mode="list" class="${mode === 'list' ? 'on' : ''}" aria-label="List view">${icons.list.replace('<svg', '<svg width="18"')}</button><button data-mode="grid" class="${mode === 'grid' ? 'on' : ''}" aria-label="Spreadsheet view">${icons.grid.replace('<svg', '<svg width="18"')}</button></div>
      <button class="btn small" data-add>Add</button>
    </div>
    <div class="chips scroll" id="quick">
      ${chip('This month', { from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: '' })}
      ${chip('Last month', { from: iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)), to: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 0)) })}
      ${chip('This year', { from: `${new Date().getFullYear()}-01-01`, to: '' })}
      ${chip('Money in', { direction: 'in' })}${chip('Subscriptions', { kind: 'subscription' })}${chip('Bills', { kind: 'bill' })}${chip('One-offs', { kind: 'one_off' })}${chip('Uncategorised', { uncategorised: '1' })}${chip('Unexpected', { unexpected: '1' })}${chip('Work expenses', { work_expense: '1' })}${chip('Filed by AI', { categorised_by: 'ai' })}
      ${views.map((v) => `<button class="chip" data-view="${v.id}">★ ${esc(v.name)}</button>`).join('')}
      <button class="chip" data-filters>More filters</button>
    </div>
    <div class="row small muted" style="margin:10px 2px" id="totals"></div>
    <div id="bulk"></div><div id="rows"></div>
    <div class="row" style="justify-content:center;margin-top:14px"><button class="btn soft small hidden" data-more>Load more</button></div>`;
  // Smart search: the local model turns plain English into filters (press Enter or the sparkle)
  el.querySelector('#sf').onsubmit = async (e) => {
    e.preventDefault(); const text = el.querySelector('#q').value.trim();
    if (!state.me.ai?.enabled || text.split(/\s+/).length < 2) { F.q = text; return load(el, true); }
    const btn = el.querySelector('.smart-btn'); btn?.classList.add('busy');
    try {
      const f = await api('/ai/search', { method: 'POST', body: { q: text } });
      for (const k of Object.keys(F)) if (!['sort', 'dir'].includes(k)) F[k] = '';
      Object.assign(F, f); el.querySelector('#q').value = F.q || '';
      const bits = Object.entries(f).filter(([k]) => k !== 'q').map(([k, v]) => k === 'category_id' ? state.cats.find((c) => String(c.id) === v)?.name : k === 'person_id' ? state.people.find((p) => String(p.id) === v)?.name : k === 'user_id' ? `by ${state.users.find((u) => String(u.id) === v)?.name}` : k === 'min' ? `over £${v}` : k === 'max' ? `under £${v}` : `${k.replace('_', ' ')} ${v}`).filter(Boolean);
      toast(`Showing: ${[f.q ? `"${f.q}"` : null, ...bits].filter(Boolean).join(', ') || 'everything'}`);
      await load(el, true); syncChips(el);
    } catch (err) { fail(err); } finally { btn?.classList.remove('busy'); }
  };
  let t; el.querySelector('#q').oninput = (e) => { if (state.me.ai?.enabled && e.target.value.trim().split(/\s+/).length > 2) return; clearTimeout(t); t = setTimeout(() => { F.q = e.target.value; load(el, true); }, 250); };
  on(el, 'click', '[data-mode]', (e, b) => { mode = b.dataset.mode; try { localStorage.setItem('hl_money_mode', mode); } catch {} renderMoney(el, [], new URLSearchParams()); });
  on(el, 'click', '[data-chip]', (e, b) => { const p = JSON.parse(b.dataset.chip); const active = b.classList.contains('on'); for (const k of Object.keys(p)) F[k] = active ? '' : p[k]; load(el, true); syncChips(el); });
  on(el, 'click', '[data-view]', (e, b) => { const v = views.find((x) => x.id === Number(b.dataset.view)); Object.assign(F, JSON.parse(v.config || '{}')); load(el, true); });
  on(el, 'click', '[data-filters]', () => filterSheet(el));
  on(el, 'click', '[data-add]', () => addSheet(() => load(el, true)));
  on(el, 'click', '[data-more]', () => { offset += 200; load(el, false); });
  syncChips(el);
  await load(el, true);
}

const chip = (label, p) => `<button class="chip" data-chip='${esc(JSON.stringify(p))}'>${esc(label)}</button>`;
function syncChips(el) { el.querySelectorAll('[data-chip]').forEach((b) => { const p = JSON.parse(b.dataset.chip); b.classList.toggle('on', Object.entries(p).every(([k, v]) => F[k] === v)); }); }

async function load(el, reset) {
  if (reset) { offset = 0; rows = []; selected.clear(); }
  const qs = new URLSearchParams(Object.entries(F).filter(([, v]) => v !== '' && v != null)); qs.set('limit', 200); qs.set('offset', offset);
  const data = await api(`/transactions?${qs}`);
  rows = reset ? data.rows : rows.concat(data.rows);
  const tot = data.totals;
  el.querySelector('#totals').innerHTML = `<span>${tot.n.toLocaleString()} transactions</span><span>· out <b class="money">${fmt(tot.out_total)}</b></span><span>· in <b class="money in">${fmt(tot.in_total)}</b></span>
    <span class="spacer"></span><button class="btn small ghost" data-save>Save view</button><button class="btn small ghost" data-export>Export CSV</button><a class="btn small ghost" href="#/settings/import">Import</a>`;
  el.querySelector('[data-export]').onclick = async () => {
    const r = await fetch(`api/transactions/export.csv?${qs}`, { headers: { Authorization: `Bearer ${token()}` } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `hearth-${iso()}.csv`; a.click();
  };
  el.querySelector('[data-save]').onclick = async () => { const name = prompt('Name this view'); if (!name) return; await api('/saved_views', { method: 'POST', body: { name, config: F, user_id: state.me.user.id } }); toast('Saved — it appears in the chips above'); renderMoney(el, [], new URLSearchParams()); };
  el.querySelector('[data-more]').classList.toggle('hidden', rows.length >= tot.n);
  (mode === 'grid' ? gridView : listView)(el);
}

function listView(el) {
  const box = el.querySelector('#rows');
  if (!rows.length) { box.innerHTML = `<div class="empty"><b>No transactions here</b>Connect a bank or import a statement in <a href="#/settings/banks">Settings</a>, or tap Add.</div>`; return; }
  let html = '', day = null, dayRows = [];
  const flush = () => { if (!dayRows.length) return; const net = dayRows.reduce((s, r) => s + r.amount, 0); html += `<div class="day-head"><span>${relDay(day)}</span><span class="money">${fmt(net)}</span></div><div class="surface"><ul class="list">${dayRows.map(li).join('')}</ul></div>`; dayRows = []; };
  for (const r of rows) { if (r.date !== day) { flush(); day = r.date; } dayRows.push(r); }
  flush();
  box.innerHTML = html;
  box.onclick = (e) => { const li = e.target.closest('[data-tx]'); if (li) txSheet(rows.find((r) => r.id === Number(li.dataset.tx)), () => load(el, true)); };
}
const li = (r) => `<li class="tap" data-tx="${r.id}" ${r.color ? `style="box-shadow:inset 3px 0 0 ${r.color};padding-left:8px"` : ''}>${catIcon(cat(r.category_id))}
  <div class="main"><div class="title">${esc(r.merchant || r.description)}</div><div class="meta">${esc(r.category_name || 'Uncategorised')}${r.person_name ? ` · ${esc(r.person_name)}` : ''}${r.event_title ? ` · ${esc(r.event_title)}` : ''}${r.kind !== 'one_off' ? ` · ${r.kind === 'bill' ? 'bill' : 'subscription'}` : ''}${r.pending ? ' · pending' : ''}${r.unexpected ? ' · <span class="tag" style="background:var(--amber-soft);color:var(--amber-ink)">unexpected</span>' : ''}${r.work_expense ? ` · <span class="tag" style="background:var(--paper-2);color:var(--ink-2)">work · ${r.claim_status === 'paid_back' ? 'paid back' : r.claim_status === 'claimed' ? 'claimed' : 'to claim'}</span>` : ''}
  ${r.tags.map((t) => `<span class="tag" style="background:${t.color}22;color:${t.color}">${esc(t.name)}</span>`).join(' ')}</div></div><div class="amt">${amt(r.amount)}</div></li>`;

// Spreadsheet mode: inline editing, sort by header, multi-select and bulk changes
function gridView(el) {
  const box = el.querySelector('#rows');
  const col = (k, label, cls = '') => `<th class="${cls}" data-sort="${k}">${label}${F.sort === k ? (F.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  box.innerHTML = `<div class="grid-wrap"><table class="grid"><thead><tr><th><input type="checkbox" data-all aria-label="Select all"></th>${col('date', 'Date')}${col('merchant', 'Merchant')}${col('amount', 'Amount', 'r')}${col('category', 'Category')}<th>Person</th><th>Kind</th>${col('account', 'Account')}<th>Notes</th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${r.id}" class="${selected.has(r.id) ? 'sel' : ''}"><td><input type="checkbox" data-sel ${selected.has(r.id) ? 'checked' : ''} aria-label="Select"></td>
      <td><input type="date" data-f="date" value="${r.date}" style="width:140px;min-width:0"></td>
      <td><input type="text" data-f="merchant" value="${esc(r.merchant)}" title="${esc(r.description)}" style="min-width:180px"></td>
      <td class="r"><input type="number" step="0.01" data-f="amount" value="${r.amount}" style="width:100px;min-width:0;text-align:right" class="${r.amount > 0 ? 'in' : ''}"></td>
      <td><select data-f="category_id" style="min-width:190px"><option value="">—</option>${state.cats.map((c) => `<option value="${c.id}" ${c.id === r.category_id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></td>
      <td><select data-f="person_id">${opts(state.people, r.person_id, (p) => p.name, '—')}</select></td>
      <td><select data-f="kind">${['one_off', 'subscription', 'bill'].map((k) => `<option ${k === r.kind ? 'selected' : ''} value="${k}">${k.replace('_', '-')}</option>`).join('')}</select></td>
      <td class="muted">${esc(r.account_name || '')}</td>
      <td><input type="text" data-f="notes" value="${esc(r.notes || '')}"></td>
</tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td colspan="2">${rows.length} shown</td><td class="r money">${fmt(rows.reduce((s, r) => s + r.amount, 0))}</td><td colspan="5"></td></tr></tfoot></table></div>`;
  on(box, 'click', '[data-sort]', (e, th) => { F.dir = F.sort === th.dataset.sort && F.dir === 'desc' ? 'asc' : 'desc'; F.sort = th.dataset.sort; load(el, true); });
  box.onchange = async (e) => {
    const tr = e.target.closest('tr[data-id]'); const id = Number(tr?.dataset.id);
    if (e.target.matches('[data-all]')) { rows.forEach((r) => (e.target.checked ? selected.add(r.id) : selected.delete(r.id))); gridView(el); return bulkBar(el); }
    if (e.target.matches('[data-sel]')) { e.target.checked ? selected.add(id) : selected.delete(id); tr.classList.toggle('sel', e.target.checked); return bulkBar(el); }
    const f = e.target.dataset.f; if (!f) return;
    let v = e.target.value; if (['category_id', 'person_id'].includes(f)) v = v ? Number(v) : ''; if (f === 'amount') v = Number(v);
    try {
      const r = await api(`/transactions/${id}`, { method: 'PATCH', body: { [f]: v } });
      Object.assign(rows.find((x) => x.id === id), { [f]: v });
      toast(f === 'category_id' && r.also_updated > 1 ? `Saved — ${r.also_updated - 1} more from that merchant updated too` : 'Saved', 1400);
    } catch (err) { fail(err); }
  };
  bulkBar(el);
}

function bulkBar(el) {
  const b = el.querySelector('#bulk');
  if (!selected.size) { b.innerHTML = ''; return; }
  b.innerHTML = `<div class="bulkbar"><b>${selected.size} selected</b><span class="spacer"></span>
    <select data-b="category_id"><option value="">Set category…</option>${state.cats.map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select>
    <select data-b="person_id"><option value="">Assign to…</option>${opts(state.people, null)}</select>
    <select data-b="add_tag"><option value="">Add tag…</option>${opts(state.tags, null)}</select>
    <select data-b="kind"><option value="">Mark as…</option><option value="one_off">One-off</option><option value="subscription">Subscription</option><option value="bill">Bill</option></select>
    <input type="color" data-b="color" title="Colour" value="#d9962b">
    <button class="btn small soft" data-bdel>Delete</button><button class="btn small soft" data-bclear>Clear</button></div>`;
  b.onchange = async (e) => {
    const k = e.target.dataset.b; if (!k || !e.target.value) return;
    const v = ['category_id', 'person_id', 'add_tag'].includes(k) ? Number(e.target.value) : e.target.value;
    await api('/transactions/bulk', { method: 'POST', body: { ids: [...selected], patch: { [k]: v } } });
    toast(`Updated ${selected.size}`); load(el, true);
  };
  b.querySelector('[data-bdel]').onclick = async () => { if (!confirm(`Delete ${selected.size} transactions? This can't be undone.`)) return; await api('/transactions/bulk-delete', { method: 'POST', body: { ids: [...selected] } }); load(el, true); };
  b.querySelector('[data-bclear]').onclick = () => { selected.clear(); gridView(el); };
}

function filterSheet(el) {
  const { el: s, close } = sheet(`<h2>Filters</h2><form class="kv">
    <label class="f"><span>From</span><input type="date" name="from" value="${F.from}"></label><label class="f"><span>To</span><input type="date" name="to" value="${F.to}"></label>
    <label class="f"><span>Category</span><select name="category_id">${opts(state.cats, F.category_id, (c) => `${c.icon} ${c.name}`, 'Any')}</select></label>
    <label class="f"><span>Account</span><select name="account_id">${opts(state.accounts, F.account_id, (a) => a.name, 'Any')}</select></label>
    <label class="f"><span>For person</span><select name="person_id">${opts(state.people, F.person_id, (p) => p.name, 'Anyone')}</select></label>
    <label class="f"><span>Spent by user</span><select name="user_id">${opts(state.users, F.user_id, (u) => u.name, 'Anyone')}</select></label>
    <label class="f"><span>Tag</span><select name="tag_id">${opts(state.tags, F.tag_id, (t) => t.name, 'Any')}</select></label>
    <label class="f"><span>Direction</span><select name="direction"><option value="">Both</option><option value="out" ${F.direction === 'out' ? 'selected' : ''}>Money out</option><option value="in" ${F.direction === 'in' ? 'selected' : ''}>Money in</option></select></label>
    <div class="row end" style="grid-column:1/-1"><button type="button" class="btn ghost" data-reset>Clear all</button><button class="btn">Apply</button></div></form>`);
  s.querySelector('[data-reset]').onclick = () => { for (const k of Object.keys(F)) if (!['sort', 'dir'].includes(k)) F[k] = ''; close(); load(el, true); syncChips(el); };
  s.querySelector('form').onsubmit = (e) => { e.preventDefault(); Object.assign(F, Object.fromEntries(new FormData(e.target))); close(); load(el, true); syncChips(el); };
}

function addSheet(done) {
  const { el, close } = sheet(`<h2>Add a transaction</h2><form class="kv">
    <label class="f"><span>Amount (£)</span><input type="number" step="0.01" name="amount" required></label>
    <label class="f"><span>Type</span><select name="dir"><option value="-1">Money out</option><option value="1">Money in</option></select></label>
    <label class="f" style="grid-column:1/-1"><span>What / where</span><input type="text" name="description" required></label>
    <label class="f"><span>Date</span><input type="date" name="date" value="${iso()}"></label>
    <label class="f"><span>Account</span><select name="account_id">${opts(state.accounts, state.accounts[0]?.id)}</select></label>
    <label class="f"><span>Category</span><select name="category_id">${opts(state.cats, null, (c) => `${c.icon} ${c.name}`, 'Work it out for me')}</select></label>
    <label class="f"><span>For</span><select name="person_id">${opts(state.people, null, (p) => p.name, 'Everyone')}</select></label>
    <div class="row end" style="grid-column:1/-1"><button class="btn">Add</button></div></form>`);
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('/transactions', { method: 'POST', body: { date: f.date, amount: Math.abs(Number(f.amount)) * Number(f.dir), description: f.description, account_id: Number(f.account_id) || null,
        category_id: f.category_id ? Number(f.category_id) : null, person_id: f.person_id ? Number(f.person_id) : null } });
      close(); toast('Added'); done?.();
    } catch (err) { fail(err); }
  };
}

export async function txSheet(t, done) {
  const events = await api(`/events?from=${t.date.slice(0, 4) - 1}-01-01&to=${Number(t.date.slice(0, 4)) + 1}-12-31`).catch(() => []);
  const near = events.filter((e) => Math.abs(new Date(e.start) - new Date(t.date)) < 45 * 86400000);
  const { el, close } = sheet(`<div class="row" style="gap:14px;margin-bottom:14px">${catIcon(cat(t.category_id), 48)}<div style="flex:1;min-width:0"><h2 style="margin:0">${esc(t.merchant)}</h2>
      <div class="muted small">${relDay(t.date)} · ${esc(t.account_name || 'No account')} · from ${esc(t.source)}</div></div><div style="font-size:1.4rem;font-weight:700">${amt(t.amount)}</div></div>
    <p class="muted small" style="margin-top:0">${esc(t.description)}</p><div id="txrcpt"></div>
    <form class="kv">
      <label class="f"><span>Category</span><select name="category_id">${opts(state.cats, t.category_id, (c) => `${c.icon} ${c.name}`, 'Uncategorised')}</select></label>
      <label class="f"><span>For</span><select name="person_id">${opts(state.people, t.person_id, (p) => p.name, 'Everyone')}</select></label>
      <label class="f"><span>Event</span><select name="event_id">${opts(near, t.event_id, (e) => `${niceDate(e.start)} · ${e.title}`, 'None')}</select></label>
      <label class="f"><span>Kind</span><select name="kind">${[['one_off', 'One-off'], ['subscription', 'Subscription'], ['bill', 'Bill']].map(([v, l]) => `<option value="${v}" ${v === t.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f"><span>Merchant name</span><input type="text" name="merchant" value="${esc(t.merchant)}"></label>
      <label class="f"><span>Colour</span><div class="row"><input type="color" name="color" value="${t.color || '#d9962b'}"><label class="row small"><input type="checkbox" name="nocolor" ${t.color ? '' : 'checked'}> none</label></div></label>
      <label class="f" style="grid-column:1/-1"><span>Notes</span><input type="text" name="notes" value="${esc(t.notes || '')}"></label>
      <div class="f" style="grid-column:1/-1"><span class="small muted" style="font-weight:600">Tags</span><div class="chips" style="margin-top:6px">${state.tags.map((g) => `<button type="button" class="chip ${t.tags.some((x) => x.id === g.id) ? 'on' : ''}" data-tag="${g.id}"><i class="dot" style="background:${g.color}"></i>${esc(g.name)}</button>`).join('')}<button type="button" class="chip" data-newtag>+ New tag</button></div></div>
      <div class="row" style="grid-column:1/-1;gap:18px;margin-bottom:6px">
        <label class="row" style="gap:8px"><label class="switch"><input type="checkbox" name="unexpected" ${t.unexpected ? 'checked' : ''}><i></i></label> Unexpected cost</label>
        <label class="row" style="gap:8px"><label class="switch"><input type="checkbox" name="work_expense" ${t.work_expense ? 'checked' : ''}><i></i></label> Work expense</label>
        <select name="claim_status" style="width:auto" ${t.work_expense ? '' : 'disabled'}>${[['to_claim', 'To claim'], ['claimed', 'Claimed'], ['paid_back', 'Paid back']].map(([v, l]) => `<option value="${v}" ${(t.claim_status || 'to_claim') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="row small" style="grid-column:1/-1"><input type="checkbox" name="learn" checked> Use this category for every transaction from ${esc(t.merchant)}</label>
      <div class="row" style="grid-column:1/-1"><button type="button" class="btn ghost" data-del>Delete</button><span class="spacer"></span><button class="btn">Save</button></div></form>`);
  api(`/transactions/${t.id}/receipts`).then((rs) => {
    if (!rs.length) return;
    el.querySelector('#txrcpt').innerHTML = `<div class="parsed" style="margin:0 0 14px">${rs.map((r) => `<div class="small">🧾 <b>Receipt from ${esc(r.merchant)}</b>${r.order_ref ? ` · ref ${esc(r.order_ref)}` : ''}${r.attachments.map((a) => ` · <a href="api/email/receipts/${r.id}/file/${encodeURIComponent(a.name)}?t=${token()}" target="_blank" rel="noopener">${esc(a.name)}</a>`).join('')} · <a href="#/receipts/approved">details</a></div>`).join('')}</div>`;
  }).catch(() => {});
  el.querySelector('[name=work_expense]').onchange = (e) => { el.querySelector('[name=claim_status]').disabled = !e.target.checked; };
  on(el, 'click', '[data-tag]', async (e, b) => { const on_ = b.classList.toggle('on'); await api(`/transactions/${t.id}`, { method: 'PATCH', body: on_ ? { add_tag: Number(b.dataset.tag) } : { remove_tag: Number(b.dataset.tag) } }); });
  on(el, 'click', '[data-newtag]', async () => { const name = prompt('Tag name'); if (!name) return; const g = await api('/tags', { method: 'POST', body: { name } }); await api(`/transactions/${t.id}`, { method: 'PATCH', body: { add_tag: g.id } }); await loadRefs(); close(); done?.(); });
  el.querySelector('[data-del]').onclick = async () => { if (!confirm('Delete this transaction?')) return; await api(`/transactions/${t.id}`, { method: 'DELETE' }); close(); done?.(); };
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const body = { person_id: f.person_id ? Number(f.person_id) : '', event_id: f.event_id ? Number(f.event_id) : '', kind: f.kind, merchant: f.merchant, notes: f.notes, color: f.nocolor ? '' : f.color, learn: !!f.learn, apply_to_merchant: !!f.learn,
      unexpected: f.unexpected ? 1 : 0, work_expense: f.work_expense ? 1 : 0 };
    if (f.work_expense && t.work_expense) body.claim_status = f.claim_status || 'to_claim';
    if (String(f.category_id || '') !== String(t.category_id || '')) body.category_id = f.category_id ? Number(f.category_id) : '';
    const r = await api(`/transactions/${t.id}`, { method: 'PATCH', body });
    close(); toast(r.also_updated > 1 ? `Saved — ${r.also_updated - 1} more from ${t.merchant} updated` : 'Saved'); done?.();
  };
}
