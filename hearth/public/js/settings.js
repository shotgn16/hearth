import { state, api, esc, fmt, niceDate, relDay, sheet, toast, fail, on, opts, icons, loadRefs, token, iso } from './core.js';

const SECTIONS = [
  ['people', 'People & household', 'Add your partner or family, and people you spend on'],
  ['banks', 'Bank connections', 'superFin / SimpleFIN and other bank feeds'],
  ['import', 'Import statements', 'CSV, OFX or QIF files from any bank — years of history'],
  ['categories', 'Categories & tags', 'Names, colours and icons'],
  ['workflows', 'Workflows', 'When this happens, do that — automatically'],
  ['email', 'Email receipts', 'Mailboxes Hearth checks for receipts, invoices and bills'],
  ['calendars', 'Calendars', 'Google, Outlook and Exchange — kept as a local copy'],
  ['ai', 'Local AI', 'Ollama models, what the AI does for you, activity'],
  ['integrations', 'Integrations', 'Home Assistant, ntfy, price comparison'],
  ['data', 'Your data', 'Backup, export and sync timing'],
];

export async function renderSettings(el, parts) {
  const s = parts[0];
  if (!s) {
    el.innerHTML = `<div class="surface"><ul class="list">${SECTIONS.map(([k, l, d]) => `<li class="tap" onclick="location.hash='#/settings/${k}'"><div class="main"><div class="title">${l}</div><div class="meta">${d}</div></div><span class="muted">›</span></li>`).join('')}</ul></div>`;
    return;
  }
  document.querySelector('.topbar h1').textContent = SECTIONS.find((x) => x[0] === s)?.[1] || 'Settings';
  return ({ email: emailSettings, people, banks, import: importer, categories, workflows, calendars, integrations, data, ai: aiSettings })[s]?.(el);
}

// ---------- people ----------
async function people(el) {
  await loadRefs();
  const admin = state.me.user.role === 'admin';
  el.innerHTML = `<div class="settings-group"><h3>Household</h3><form id="hh" class="row"><input type="text" name="household_name" value="${esc(state.me.household.name)}" style="flex:1"><button class="btn soft">Rename</button></form></div>
    <div class="settings-group"><h3>Users <span class="muted small">— people who sign in</span>${admin ? '<button class="link btn small soft" data-adduser style="margin-left:auto">Add user</button>' : ''}</h3>
      <div class="surface"><ul class="list">${state.users.map((u) => `<li><span class="avatar" style="background:${u.color}">${esc(u.name[0])}</span><div class="main"><div class="title">${esc(u.name)}${u.id === state.me.user.id ? ' (you)' : ''}</div><div class="meta">${esc(u.email)} · ${u.role}</div></div>
        ${u.id === state.me.user.id || admin ? `<button class="btn small ghost" data-edituser="${u.id}">Edit</button>` : ''}</li>`).join('')}</ul></div></div>
    <div class="settings-group"><h3>People you spend on <span class="muted small">— kids, parents, pets</span><button class="link btn small soft" data-addperson style="margin-left:auto">Add</button></h3>
      <div class="surface"><ul class="list">${state.people.map((p) => `<li><span class="dot" style="background:${p.color};width:12px;height:12px"></span><div class="main"><div class="title">${esc(p.name)}</div><div class="meta">${p.user_id ? 'has a login' : 'tracked only'}</div></div>
        <input type="color" value="${p.color}" data-pcolor="${p.id}">${p.user_id ? '' : `<button class="btn small ghost" data-delperson="${p.id}">✕</button>`}</li>`).join('')}</ul></div></div>`;
  el.querySelector('#hh').onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: { household_name: e.target.household_name.value } }); state.me.household.name = e.target.household_name.value; toast('Saved'); };
  el.querySelector('[data-adduser]')?.addEventListener('click', () => {
    const { el: s, close } = sheet(`<h2>Add a user</h2><p class="muted">They'll sign in with their own email and password, and see the same household. Budgets can be shared or theirs alone.</p><form class="kv">
      <label class="f"><span>Name</span><input type="text" name="name" required></label><label class="f"><span>Email</span><input type="email" name="email" required></label>
      <label class="f"><span>Temporary password</span><input type="text" name="password" minlength="8" required></label><label class="f"><span>Colour</span><input type="color" name="color" value="#c2477e"></label>
      <label class="f"><span>Role</span><select name="role"><option value="member">Member</option><option value="admin">Admin (can manage users)</option></select></label>
      <div class="row end" style="grid-column:1/-1"><button class="btn">Add user</button></div></form>`);
    s.querySelector('form').onsubmit = async (e) => { e.preventDefault(); try { await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); close(); toast('User added'); people(el); } catch (err) { fail(err); } };
  });
  on(el, 'click', '[data-edituser]', (e, b) => {
    const u = state.users.find((x) => x.id === Number(b.dataset.edituser));
    const { el: s, close } = sheet(`<h2>${esc(u.name)}</h2><form class="kv"><label class="f"><span>Name</span><input type="text" name="name" value="${esc(u.name)}"></label><label class="f"><span>Colour</span><input type="color" name="color" value="${u.color}"></label>
      <label class="f" style="grid-column:1/-1"><span>New password (leave blank to keep)</span><input type="password" name="password" minlength="8"></label>
      <div class="row" style="grid-column:1/-1">${admin && u.id !== state.me.user.id ? '<button type="button" class="btn ghost" data-del>Remove user</button>' : ''}<span class="spacer"></span><button class="btn">Save</button></div></form>`);
    s.querySelector('[data-del]')?.addEventListener('click', async () => { if (confirm(`Remove ${u.name}? Their transactions stay.`)) { await api(`/users/${u.id}`, { method: 'DELETE' }); close(); people(el); } });
    s.querySelector('form').onsubmit = async (x) => { x.preventDefault(); const d = Object.fromEntries(new FormData(x.target)); if (!d.password) delete d.password; await api(`/users/${u.id}`, { method: 'PATCH', body: d }); close(); toast('Saved'); people(el); };
  });
  el.querySelector('[data-addperson]').onclick = async () => { const name = prompt('Name'); if (!name) return; await api('/people', { method: 'POST', body: { name } }); people(el); };
  on(el, 'change', '[data-pcolor]', async (e, i) => { await api(`/people/${i.dataset.pcolor}`, { method: 'PATCH', body: { color: i.value } }); });
  on(el, 'click', '[data-delperson]', async (e, b) => { await api(`/people/${b.dataset.delperson}`, { method: 'DELETE' }); people(el); });
}

// ---------- banks ----------
async function banks(el) {
  const list = await api('/connections');
  let haCals = [];
  if (state.me.ha) haCals = await api('/homeassistant/calendars').catch(() => []);
  const linked = new Set(list.filter((c) => c.provider === 'homeassistant').map((c) => c.url));
  const msAccts = (await api('/email/accounts').catch(() => [])).filter((a) => a.kind === 'microsoft');
  const msLinked = new Set(list.filter((c) => c.provider === 'microsoft').map((c) => c.url));
  const msBlock = `<div class="surface pad" style="margin-bottom:20px"><h3 style="margin-top:0">From Microsoft 365 / Outlook.com</h3>
    ${msAccts.length ? `<p class="muted small">Uses the Microsoft sign-in from Email receipts. Tick to keep a local copy of that account's calendar.</p><ul class="list">${msAccts.map((a) => `<li><div class="main"><div class="title">${esc(a.address || a.name)}</div><div class="meta">${a.signed_in ? 'Signed in' : 'Not signed in yet — finish signing in under Email receipts'}</div></div>
      <label class="switch"><input type="checkbox" data-mscal="${a.id}" data-name="${esc(a.address || a.name)}" ${msLinked.has(String(a.id)) ? 'checked' : ''} ${a.signed_in ? '' : 'disabled'}><i></i></label></li>`).join('')}</ul>`
      : '<p class="muted small">Sign in with Microsoft under <a href="#/settings/email">Email receipts</a> (choose "Outlook.com / Microsoft 365") and your Outlook calendar can be copied here too — no published link needed.</p>'}</div>`;
  const haBlock = state.me.ha ? `<div class="surface pad" style="margin-bottom:20px"><h3 style="margin-top:0">From Home Assistant</h3>
    <p class="muted small">Calendars you've already connected to Home Assistant (Google, Outlook, Microsoft 365/Exchange, CalDAV, local…). Tick to keep a local copy in Hearth.</p>
    ${haCals.length ? `<ul class="list">${haCals.map((c) => `<li><div class="main"><div class="title">${esc(c.name)}</div><div class="meta">${esc(c.entity_id)}</div></div>
      <label class="switch"><input type="checkbox" data-hacal="${esc(c.entity_id)}" data-name="${esc(c.name)}" ${linked.has(c.entity_id) ? 'checked' : ''}><i></i></label></li>`).join('')}</ul>` : '<p class="muted small">No calendar entities found in Home Assistant.</p>'}</div>` : '';
  el.innerHTML = `${msBlock}${haBlock}${list.length ? `<div class="surface" style="margin-bottom:20px"><ul class="list">${list.map((c) => `<li style="flex-wrap:wrap"><div class="main" style="min-width:200px"><div class="title">${esc(c.name)}</div><div class="meta">${c.provider} · ${c.last_sync ? `synced ${relDay(c.last_sync)}` : 'never synced'}${c.last_error ? ` · ⚠ ${esc(c.last_error)}` : ''}</div></div>
      <div class="row" style="gap:6px"><label class="row small"><span class="muted">Auto</span><label class="switch"><input type="checkbox" data-auto="${c.id}" ${c.auto_sync ? 'checked' : ''}><i></i></label></label>
      <button class="btn small soft" data-sync="${c.id}">Sync now</button><button class="btn small ghost" data-full="${c.id}">Re-pull history</button><button class="btn small ghost" data-del="${c.id}">Remove</button></div></li>`).join('')}</ul></div>` : ''}
    <div class="surface pad"><h3 style="margin-top:0">Connect superFin</h3>
      <p class="muted small">Paste the setup token or access URL your superFin / SimpleFIN Bridge account gives you. Hearth claims it once, stores the access details only in your local database, pulls every transaction the bank allows, then syncs on a schedule.</p>
      <form id="sf"><label class="f"><span>Setup token or access URL</span><input type="text" name="token" required placeholder="aHR0cHM6Ly9…  or  https://user:pass@…/simplefin"></label>
        <div class="kv"><label class="f"><span>Name</span><input type="text" name="name" value="superFin"></label><label class="f"><span>Accounts belong to</span><select name="owner_user_id"><option value="">Shared / joint</option>${opts(state.users, null)}</select></label>
        <label class="f"><span>Pull history from</span><input type="date" name="history_from" value="2000-01-01"></label></div>
        <button class="btn">Connect and import</button></form>
      <details class="adv" style="margin-top:14px"><summary>superFin uses a different API? Map any JSON bank feed</summary>
        <form id="gf" class="kv" style="margin-top:10px">
          <label class="f" style="grid-column:1/-1"><span>Accounts URL</span><input type="url" name="accounts_url" required></label>
          <label class="f" style="grid-column:1/-1"><span>Transactions URL (use {account_id} and {from})</span><input type="text" name="transactions_url" required placeholder="https://api…/accounts/{account_id}/transactions?from={from}"></label>
          <label class="f"><span>Auth header name</span><input type="text" name="auth_header_name" value="Authorization"></label><label class="f"><span>Auth header value</span><input type="text" name="auth_header" placeholder="Bearer …"></label>
          <label class="f"><span>Path to accounts list</span><input type="text" name="accounts_path" placeholder="data.accounts"></label><label class="f"><span>Path to transactions list</span><input type="text" name="transactions_path" placeholder="data.transactions"></label>
          <label class="f"><span>Account id / name / balance fields</span><input type="text" name="f_acc" value="id,name,balance"></label><label class="f"><span>Tx id / date / amount / description fields</span><input type="text" name="f_tx" value="id,date,amount,description"></label>
          <label class="row small"><input type="checkbox" name="invert_amounts"> Spending comes through as positive numbers</label>
          <div class="row end" style="grid-column:1/-1"><button class="btn">Connect</button></div></form></details></div>`;
  el.querySelector('#sf').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Connecting and importing…';
    try {
      const t = d.token.trim();
      const r = await api('/connections', { method: 'POST', body: { provider: 'simplefin', name: d.name, ...(t.startsWith('http') ? { access_url: t } : { setup_token: t }), history_from: d.history_from, owner_user_id: d.owner_user_id ? Number(d.owner_user_id) : null } });
      toast(`Connected ${r.accounts} accounts · ${r.added} transactions imported`); await loadRefs(); banks(el);
    } catch (err) { fail(err); b.disabled = false; b.textContent = 'Connect and import'; }
  };
  el.querySelector('#gf').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    const [ai, an, ab] = d.f_acc.split(',').map((s) => s.trim()); const [ti, td, ta, tdesc] = d.f_tx.split(',').map((s) => s.trim());
    try { const r = await api('/connections', { method: 'POST', body: { provider: 'generic', name: 'Bank feed', ...d, f_account_id: ai, f_account_name: an, f_balance: ab, f_tx_id: ti, f_tx_date: td, f_tx_amount: ta, f_tx_description: tdesc, invert_amounts: !!d.invert_amounts } }); toast(`Imported ${r.added}`); banks(el); }
    catch (err) { fail(err); }
  };
  on(el, 'click', '[data-sync],[data-full]', async (e, b) => { b.disabled = true; try { const r = await api(`/connections/${b.dataset.sync || b.dataset.full}/sync`, { method: 'POST', body: { full: !!b.dataset.full } }); toast(`${r.added} new transactions`); banks(el); } catch (err) { fail(err); b.disabled = false; } });
  on(el, 'change', '[data-auto]', (e, i) => api(`/connections/${i.dataset.auto}`, { method: 'PATCH', body: { auto_sync: i.checked } }));
  on(el, 'click', '[data-del]', async (e, b) => { if (confirm('Remove this connection? Imported transactions stay.')) { await api(`/connections/${b.dataset.del}`, { method: 'DELETE' }); banks(el); } });
}

// ---------- import ----------
async function importer(el) {
  el.innerHTML = `<p class="muted">Download statements from your bank's website (CSV, OFX/Money or QIF). You can drop several at once — duplicates are skipped automatically, so overlapping files are fine.</p>
    <label class="surface pad" style="display:block;text-align:center;border:2px dashed var(--line);cursor:pointer;padding:32px" id="drop">
      <input type="file" id="file" accept=".csv,.ofx,.qfx,.qif,.txt" multiple hidden><b>Choose files or drop them here</b><div class="muted small">Monzo, Starling, Barclays, HSBC, Lloyds, Nationwide, Santander, Amex, Revolut…</div></label>
    <div id="imp" style="margin-top:18px"></div>`;
  const input = el.querySelector('#file'), drop = el.querySelector('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = 'var(--amber)'; };
  drop.ondrop = (e) => { e.preventDefault(); handle([...e.dataTransfer.files]); };
  input.onchange = () => handle([...input.files]);
  async function handle(files) {
    const box = el.querySelector('#imp'); box.innerHTML = '';
    for (const file of files) {
      const text = await file.text();
      const card = document.createElement('div'); card.className = 'surface pad'; card.style.marginBottom = '16px'; box.append(card);
      let p = await api('/import/preview', { method: 'POST', body: { text } });
      const mapping = p.mapping ? { ...p.mapping } : null; const optsState = { invert: false, dateFormat: 'auto' };
      const draw = () => {
        card.innerHTML = `<b>${esc(file.name)}</b> <span class="muted small">· ${p.format.toUpperCase()} · ${p.count} transactions${p.range ? ` · ${niceDate(p.range[0], { day: 'numeric', month: 'short', year: 'numeric' })} to ${niceDate(p.range[1], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</span>
          ${mapping ? `<p class="muted small">Hearth guessed which column is which. Fix anything that looks wrong — the preview updates.</p><div class="kv" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            ${[['date', 'Date'], ['description', 'Description'], ['amount', 'Amount'], ['debit', 'Money out (if separate)'], ['credit', 'Money in (if separate)'], ['category', "Bank's category"], ['external_id', 'Transaction ID'], ['notes', 'Notes']].map(([k, l]) => `<label class="f"><span>${l}</span><select data-map="${k}"><option value="-1">—</option>${p.header.map((h, i) => `<option value="${i}" ${mapping[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}
            <label class="f"><span>Dates are</span><select data-opt="dateFormat"><option value="auto">Day first (UK)</option><option value="mdy" ${optsState.dateFormat === 'mdy' ? 'selected' : ''}>Month first (US)</option></select></label>
            <label class="f"><span>Signs</span><select data-opt="invert"><option value="">Spending is negative</option><option value="1" ${optsState.invert ? 'selected' : ''}>Spending is positive (credit cards)</option></select></label></div>` : ''}
          <div class="grid-wrap" style="max-height:260px;margin:8px 0 12px"><table class="grid"><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>${p.sample.map((t) => `<tr><td>${t.date}</td><td>${esc(t.description)}</td><td class="r ${t.amount > 0 ? 'in' : ''}">${fmt(t.amount)}</td></tr>`).join('')}</tbody></table></div>
          <div class="kv"><label class="f"><span>Into account</span><select data-acc><option value="">New account from this file</option>${opts(state.accounts, null)}</select></label>
          <label class="f"><span>Spent by</span><select data-user>${opts(state.users, state.me.user.id)}</select></label></div>
          <div class="row end"><button class="btn" data-go>Import ${p.count}</button></div>`;
      };
      draw();
      card.addEventListener('change', async (e) => {
        if (e.target.dataset.map) mapping[e.target.dataset.map] = Number(e.target.value);
        else if (e.target.dataset.opt) optsState[e.target.dataset.opt] = e.target.dataset.opt === 'invert' ? !!e.target.value : e.target.value;
        else return;
        p = await api('/import/preview', { method: 'POST', body: { text, mapping, options: optsState } }); draw();
      });
      card.addEventListener('click', async (e) => {
        if (!e.target.matches('[data-go]')) return;
        e.target.disabled = true; e.target.textContent = 'Importing and categorising…';
        let account_id = Number(card.querySelector('[data-acc]').value) || null;
        if (!account_id) { const a = await api('/accounts', { method: 'POST', body: { name: file.name.replace(/\.\w+$/, ''), owner_user_id: Number(card.querySelector('[data-user]').value) } }); account_id = a.id; await loadRefs(); }
        try {
          const r = await api('/import/commit', { method: 'POST', body: { text, mapping, options: optsState, account_id, user_id: Number(card.querySelector('[data-user]').value), run_workflows: true } });
          card.innerHTML = `<b>${esc(file.name)}</b><p>✓ ${r.added} imported${r.skipped ? `, ${r.skipped} duplicates skipped` : ''}. Subscriptions and categories have been worked out — check <a href="#/inbox">Needs attention</a> for anything unclear.</p>`;
        } catch (err) { fail(err); e.target.disabled = false; }
      });
    }
  }
}

// ---------- categories & tags ----------
async function categories(el) {
  await loadRefs();
  const row = (c, kind) => `<li><input type="text" value="${esc(c.icon || '')}" data-icon="${c.id}" style="width:52px;text-align:center" aria-label="Icon"><input type="color" value="${c.color}" data-color="${c.id}" data-kind="${kind}">
    <input type="text" value="${esc(c.name)}" data-name="${c.id}" data-kind="${kind}" style="flex:1">${kind === 'categories' ? `<select data-ckind="${c.id}" style="width:auto">${['expense', 'income', 'transfer'].map((k) => `<option ${c.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>` : ''}
    <button class="btn small ghost" data-del="${c.id}" data-kind="${kind}" aria-label="Delete">✕</button></li>`;
  el.innerHTML = `<div class="grid2" style="margin-top:0"><section><h3>Categories <button class="link btn small soft" data-add="categories">Add</button></h3><div class="surface"><ul class="list">${state.cats.map((c) => row(c, 'categories')).join('')}</ul></div>
    <p class="muted small">"Transfer" categories are left out of spending totals — use them for moving money between your own accounts.</p></section>
    <section><h3>Tags <button class="link btn small soft" data-add="tags">Add</button></h3><div class="surface"><ul class="list">${state.tags.map((t) => row(t, 'tags')).join('') || '<li class="muted">Tags cut across categories: "Holiday 2026", "Work expenses", "Wedding".</li>'}</ul></div></section></div>`;
  const patch = (kind, id, body) => api(`/${kind}/${id}`, { method: 'PATCH', body }).then(loadRefs).catch(fail);
  el.onchange = (e) => {
    const t = e.target, kind = t.dataset.kind || 'categories';
    if (t.dataset.icon) patch('categories', t.dataset.icon, { icon: t.value });
    if (t.dataset.color) patch(kind, t.dataset.color, { color: t.value });
    if (t.dataset.name) patch(kind, t.dataset.name, { name: t.value });
    if (t.dataset.ckind) patch('categories', t.dataset.ckind, { kind: t.value });
  };
  on(el, 'click', '[data-add]', async (e, b) => { const name = prompt('Name'); if (!name) return; await api(`/${b.dataset.add}`, { method: 'POST', body: { name } }).catch(fail); categories(el); });
  on(el, 'click', '[data-del]', async (e, b) => { if (confirm('Delete? Transactions keep their data but lose this label.')) { await api(`/${b.dataset.kind}/${b.dataset.del}`, { method: 'DELETE' }); categories(el); } });
}

// ---------- workflows ----------
const TRIGGERS = [['transaction_created', 'A transaction comes in'], ['large_transaction', 'A large transaction comes in'], ['budget_threshold', 'A budget reaches its warning level'],
  ['subscription_detected', 'A new subscription is spotted'], ['subscription_due', 'A regular payment is due in 3 days'], ['event_upcoming', 'A calendar event is within a week'],
  ['price_target', 'A watched price hits its target']];
const FIELDS = [['merchant', 'Merchant'], ['description', 'Description'], ['abs_amount', 'Amount (size)'], ['direction', 'Direction (in/out)'], ['category_id', 'Category'], ['account_id', 'Account'],
  ['person_id', 'Person'], ['user_id', 'User'], ['kind', 'Kind'], ['weekday', 'Weekday (0=Sun)'], ['day_of_month', 'Day of month'], ['pct', 'Budget % used'], ['price', 'Price'], ['days_until', 'Days until']];
const OPS = [['contains', 'contains'], ['not_contains', "doesn't contain"], ['equals', 'is'], ['not_equals', 'is not'], ['starts_with', 'starts with'], ['regex', 'matches pattern'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['between', 'between (a,b)'], ['in', 'one of (a,b,c)'], ['is_empty', 'is empty']];
const ACTIONS = [['set_category', 'Set category'], ['add_tag', 'Add tag'], ['set_person', 'Assign to person'], ['set_kind', 'Mark as'], ['set_color', 'Colour it'], ['set_merchant', 'Rename merchant'], ['append_note', 'Add a note'], ['notify', 'Send a notification'],
  ['mark_unexpected', 'Mark as unexpected cost'], ['mark_work_expense', 'Mark as work expense (to claim)'],
  ['ha_event', 'Fire a Home Assistant event'], ['ha_service', 'Call a Home Assistant service']];

async function workflows(el) {
  const list = await api('/rules');
  el.innerHTML = `<div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1">Workflows run on their own. Use them to file things your way, send notifications to your phones through Home Assistant, or trigger automations.</p><button class="btn" data-new>New workflow</button></div>
    ${state.me.ai?.enabled ? `<form id="dw" class="row" style="margin-bottom:18px"><input type="text" name="t" placeholder="Describe it: “ping Sam's phone when we spend over £100 at Amazon”" style="flex:1"><button class="btn soft">Build it</button></form>` : ''}
    ${list.length ? `<div class="surface"><ul class="list">${list.map((r) => `<li class="tap" data-edit="${r.id}"><label class="switch" onclick="event.stopPropagation()"><input type="checkbox" data-en="${r.id}" ${r.enabled ? 'checked' : ''}><i></i></label>
      <div class="main"><div class="title">${esc(r.name)}</div><div class="meta">When ${esc((TRIGGERS.find((t) => t[0] === r.trigger) || [, r.trigger])[1].toLowerCase())} · ran ${r.run_count} times</div></div><span class="muted">›</span></li>`).join('')}</ul></div>`
      : '<div class="empty"><b>No workflows yet</b>Try: "When a transaction over £100 comes in, notify Sam\'s phone".</div>'}`;
  el.querySelector('[data-new]').onclick = () => ruleSheet(null, () => workflows(el));
  el.querySelector('#dw')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Building…';
    try { const draft = await api('/ai/rule', { method: 'POST', body: { text: e.target.t.value } }); ruleSheet(draft, () => workflows(el)); toast('Draft ready — check it and save'); }
    catch (err) { fail(err); } b.disabled = false; b.textContent = 'Build it';
  });
  on(el, 'click', '[data-edit]', (e, li) => ruleSheet(list.find((r) => r.id === Number(li.dataset.edit)), () => workflows(el)));
  on(el, 'change', '[data-en]', (e, i) => api(`/rules/${i.dataset.en}`, { method: 'PATCH', body: { enabled: i.checked ? 1 : 0 } }));
}

async function ruleSheet(r, done) {
  const haServices = state.me.ha ? await api('/homeassistant/services').catch(() => []) : [];
  r ||= { name: '', trigger: 'transaction_created', match_all: 1, conditions: '[{"field":"merchant","op":"contains","value":""}]', actions: '[{"type":"set_category","value":""}]', priority: 100, stop_processing: 0 };
  let conds = JSON.parse(r.conditions), acts = JSON.parse(r.actions);
  const valueInput = (c, i) => {
    if (c.field === 'category_id') return `<select data-cv="${i}">${opts(state.cats, c.value, (x) => x.name, 'Choose…')}</select>`;
    if (c.field === 'account_id') return `<select data-cv="${i}">${opts(state.accounts, c.value, (x) => x.name, 'Choose…')}</select>`;
    if (c.field === 'person_id') return `<select data-cv="${i}">${opts(state.people, c.value, (x) => x.name, 'Choose…')}</select>`;
    if (c.field === 'user_id') return `<select data-cv="${i}">${opts(state.users, c.value, (x) => x.name, 'Choose…')}</select>`;
    if (c.field === 'direction') return `<select data-cv="${i}"><option value="out" ${c.value === 'out' ? 'selected' : ''}>out</option><option value="in" ${c.value === 'in' ? 'selected' : ''}>in</option></select>`;
    return `<input type="text" data-cv="${i}" value="${esc(c.value ?? '')}">`;
  };
  const actionInput = (a, i) => {
    switch (a.type) {
      case 'set_category': return `<select data-av="${i}">${opts(state.cats, a.value, (x) => `${x.icon} ${x.name}`, 'Choose…')}</select><label class="row small"><input type="checkbox" data-alearn="${i}" ${a.learn ? 'checked' : ''}> remember for this merchant</label>`;
      case 'add_tag': return `<input type="text" data-av="${i}" value="${esc(a.value ?? '')}" placeholder="Tag name" list="taglist"><datalist id="taglist">${state.tags.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>`;
      case 'set_person': return `<select data-av="${i}">${opts(state.people, a.value, (x) => x.name, 'Choose…')}</select>`;
      case 'set_kind': return `<select data-av="${i}">${['one_off', 'subscription', 'bill'].map((k) => `<option ${a.value === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`;
      case 'set_color': return `<input type="color" data-av="${i}" value="${a.value || '#d9962b'}">`;
      case 'notify': return `<input type="text" data-at="${i}" value="${esc(a.title || '')}" placeholder="Title, e.g. Big spend"><input type="text" data-am="${i}" value="${esc(a.message || '{amount} at {merchant}')}" placeholder="Message — use {amount}, {merchant}, {name}, {pct}">
        <div class="small muted" style="margin-top:6px">Send to (leave all unticked to use the services chosen in Settings → Integrations; it always appears in Hearth's inbox):</div><div class="chips" style="margin-top:6px">
        ${haServices.map((s) => `<button type="button" class="chip ${(a.ha_services || []).includes(s) ? 'on' : ''}" data-ha="${i}:${s}">${esc(s.replace('notify.', ''))}</button>`).join('')}
        ${!haServices.length ? '<span class="muted small">Connect Home Assistant (Settings → Integrations) to send to your phones, or switch on ntfy.</span>' : ''}</div>`;
      case 'mark_unexpected': case 'mark_work_expense': return '<span class="muted small">No settings needed.</span>';
      case 'ha_event': return `<input type="text" data-av="${i}" value="${esc(a.value || 'hearth_event')}" placeholder="Event type, e.g. hearth_big_spend"><div class="small muted">Use it as an Event trigger in a Home Assistant automation. Data includes merchant, amount, category_id and date.</div>`;
      case 'ha_service': return `<input type="text" data-av="${i}" value="${esc(a.value || '')}" placeholder="light.turn_on"><input type="text" data-ad="${i}" value="${esc(a.data || '')}" placeholder='{"entity_id":"light.hallway","color_name":"orange"}'><div class="small muted">Data is JSON; {merchant} and {amount} are filled in.</div>`;
      default: return `<input type="text" data-av="${i}" value="${esc(a.value ?? '')}">`;
    }
  };
  const { el, close } = sheet(`<h2>${r.id ? 'Edit workflow' : 'New workflow'}</h2><form id="rf">
    <label class="f"><span>Name</span><input type="text" name="name" value="${esc(r.name)}" required placeholder="Tag kids' spending"></label>
    <label class="f"><span>When</span><select name="trigger">${TRIGGERS.map(([k, l]) => `<option value="${k}" ${r.trigger === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="f"><span class="small muted" style="font-weight:600">If <select name="match_all" style="width:auto;padding:4px 8px;display:inline"><option value="1">all</option><option value="0" ${!r.match_all ? 'selected' : ''}>any</option></select> of these are true (none = always)</span><div id="conds" style="margin-top:8px"></div><button type="button" class="btn small soft" data-addc>+ Condition</button> <button type="button" class="btn small ghost" data-preview>Preview matches</button><div id="prev" class="small muted" style="margin-top:6px"></div></div>
    <div class="f"><span class="small muted" style="font-weight:600">Then</span><div id="acts" style="margin-top:8px"></div><button type="button" class="btn small soft" data-adda>+ Action</button></div>
    <details class="adv"><summary>Advanced</summary><div class="kv" style="margin-top:8px"><label class="f"><span>Order (lower runs first)</span><input type="number" name="priority" value="${r.priority}"></label><label class="row small"><input type="checkbox" name="stop_processing" ${r.stop_processing ? 'checked' : ''}> Stop other workflows after this one</label></div></details>
    <div class="row">${r.id ? '<button type="button" class="btn ghost" data-del>Delete</button>' : ''}${r.id && r.trigger === 'transaction_created' ? '<button type="button" class="btn ghost" data-apply>Apply to past transactions</button>' : ''}<span class="spacer"></span><button class="btn">Save</button></div></form>`, { wide: true });
  const drawC = () => { el.querySelector('#conds').innerHTML = conds.map((c, i) => `<div class="cond"><select data-cf="${i}">${FIELDS.map(([k, l]) => `<option value="${k}" ${c.field === k ? 'selected' : ''}>${l}</option>`).join('')}</select><select data-co="${i}">${OPS.map(([k, l]) => `<option value="${k}" ${c.op === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${valueInput(c, i)}<button type="button" class="btn small ghost" data-rc="${i}">✕</button></div>`).join(''); };
  const drawA = () => { el.querySelector('#acts').innerHTML = acts.map((a, i) => `<div class="surface pad" style="margin-bottom:8px;box-shadow:none;border:1px solid var(--line)"><div class="row"><select data-atype="${i}" style="flex:1">${ACTIONS.map(([k, l]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="btn small ghost" data-ra="${i}">✕</button></div><div style="margin-top:8px;display:grid;gap:6px">${actionInput(a, i)}</div></div>`).join(''); };
  drawC(); drawA();
  el.addEventListener('change', (e) => {
    const t = e.target, d = t.dataset;
    if (d.cf) { conds[d.cf].field = t.value; drawC(); } if (d.co) conds[d.co].op = t.value; if (d.cv) conds[d.cv].value = t.value;
    if (d.atype) { acts[d.atype] = { type: t.value }; drawA(); } if (d.av) acts[d.av].value = t.value; if (d.alearn) acts[d.alearn].learn = t.checked;
    if (d.at) acts[d.at].title = t.value; if (d.am) acts[d.am].message = t.value; if (d.ad) acts[d.ad].data = t.value;
  });
  on(el, 'click', '[data-addc]', () => { conds.push({ field: 'merchant', op: 'contains', value: '' }); drawC(); });
  on(el, 'click', '[data-rc]', (e, b) => { conds.splice(Number(b.dataset.rc), 1); drawC(); });
  on(el, 'click', '[data-adda]', () => { acts.push({ type: 'notify' }); drawA(); });
  on(el, 'click', '[data-ra]', (e, b) => { acts.splice(Number(b.dataset.ra), 1); drawA(); });
  on(el, 'click', '[data-ha]', (e, b) => { const [i, ...rest] = b.dataset.ha.split(':'); const svc = rest.join(':'); const s = new Set(acts[i].ha_services || []); s.has(svc) ? s.delete(svc) : s.add(svc); acts[i].ha_services = [...s]; b.classList.toggle('on'); });
  on(el, 'click', '[data-preview]', async () => { const p = await api('/rules/preview', { method: 'POST', body: { conditions: conds, match_all: el.querySelector('[name=match_all]').value === '1' } }); el.querySelector('#prev').innerHTML = `Matches ${p.count} existing transactions${p.sample.length ? `, e.g. ${p.sample.slice(0, 4).map((t) => `${esc(t.merchant)} ${fmt(t.amount)}`).join(', ')}` : ''}.`; });
  el.querySelector('[data-del]')?.addEventListener('click', async () => { await api(`/rules/${r.id}`, { method: 'DELETE' }); close(); done(); });
  el.querySelector('[data-apply]')?.addEventListener('click', async () => { const x = await api(`/rules/${r.id}/apply`, { method: 'POST' }); toast(`Applied to ${x.applied} transactions (notifications skipped)`); });
  el.querySelector('#rf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const body = { name: f.get('name'), trigger: f.get('trigger'), match_all: Number(f.get('match_all')), priority: Number(f.get('priority')), stop_processing: f.get('stop_processing') ? 1 : 0,
      conditions: conds.filter((c) => c.op === 'is_empty' || c.value !== ''), actions: acts.map((a) => (['set_category', 'set_person'].includes(a.type) ? { ...a, value: Number(a.value) } : a)) };
    try { await api(r.id ? `/rules/${r.id}` : '/rules', { method: r.id ? 'PATCH' : 'POST', body }); close(); toast('Workflow saved'); done(); } catch (err) { fail(err); }
  };
}

// ---------- email receipts ----------
const MS_HELP = `<b>One-time setup (about 5 minutes, free):</b><ol style="margin:6px 0 0;padding-left:18px">
  <li>Go to <b>entra.microsoft.com</b> → Applications → App registrations → <b>New registration</b>. Name it "Hearth" and choose <b>"Accounts in any organizational directory and personal Microsoft accounts"</b>. Leave the redirect URI empty.</li>
  <li>In the new app: <b>Authentication</b> → turn on <b>Allow public client flows</b> → Save.</li>
  <li><b>API permissions</b> → Add → Microsoft Graph → Delegated: <b>Mail.Read</b>, <b>Calendars.Read</b>, <b>User.Read</b>, <b>offline_access</b>.</li>
  <li>Copy the <b>Application (client) ID</b> from Overview into the box below.</li></ol>
  <p style="margin:6px 0 0">Sign-in for: Outlook.com / Hotmail → <b>Personal</b>; work or school → <b>Work or school</b> (or your tenant ID if your organisation only allows its own apps). Hearth only asks for read access.</p>`;
const PROVIDERS = {
  gmail: { label: 'Gmail', host: 'imap.gmail.com', port: 993, help: 'Turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords and paste it here. Tip: make a "Receipts" label with a filter and check only that.' },
  microsoft: { label: 'Outlook.com / Microsoft 365', kind: 'microsoft', help: MS_HELP },
  icloud: { label: 'iCloud Mail', host: 'imap.mail.me.com', port: 993, help: 'Create an app-specific password at account.apple.com → Sign-In and Security → App-Specific Passwords. Your username is your full iCloud email address.' },
  yahoo: { label: 'Yahoo Mail', host: 'imap.mail.yahoo.com', port: 993, help: 'Generate an app password in Yahoo Account Security → Generate app password.' },
  fastmail: { label: 'Fastmail', host: 'imap.fastmail.com', port: 993, help: 'Create an app password in Settings → Privacy & Security → Integrations (IMAP access).' },
  ews: { label: 'Exchange on-premises (EWS)', kind: 'ews', help: 'For your own Exchange Server 2013 or newer. The EWS address is usually https://mail.yourdomain.com/EWS/Exchange.asmx. Hearth signs in with NTLM, falling back to Basic. For Exchange Online / Microsoft 365, choose "Outlook.com / Microsoft 365" instead.' },
  other: { label: 'Other (IMAP)', host: '', port: 993, help: 'Use your provider\'s IMAP server, port 993 with SSL. A dedicated receipts mailbox or folder keeps things fast and private.' },
};
const KIND_LABEL = { imap: 'IMAP', microsoft: 'Microsoft', ews: 'Exchange' };
async function emailSettings(el) {
  const [list, s] = await Promise.all([api('/email/accounts'), api('/settings')]);
  const status = (a) => (a.kind === 'microsoft' && !a.signed_in ? '<span style="color:var(--amber)">not signed in</span>' : a.last_sync ? `checked ${relDay(a.last_sync)} ${new Date(a.last_sync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'not checked yet');
  const fnames = (a) => a.folders.map((f) => a.folder_names?.[f] || (f === 'inbox' ? 'Inbox' : f)).join(', ');
  el.innerHTML = `<p class="muted" style="margin-top:0">Hearth checks these mailboxes for receipts, invoices and bills, reads the amount, date, references and items (including PDF attachments), and matches each to a bill, payment and account. <b>Nothing is applied until you approve it</b> in <a href="#/receipts">Email receipts</a>. Only likely receipts are downloaded; everything stays on this server.</p>
    ${list.length ? `<div class="surface" style="margin-bottom:20px"><ul class="list">${list.map((a) => `<li style="flex-wrap:wrap"><div class="main" style="min-width:220px"><div class="title">${esc(a.name || a.address || a.username)} <span class="pill">${KIND_LABEL[a.kind] || 'IMAP'}</span></div>
      <div class="meta">${esc(a.address || a.username || '')} · ${esc(fnames(a))} · ${status(a)}${a.last_error ? ` · ⚠ ${esc(a.last_error)}` : ''}</div></div>
      <div class="row" style="gap:6px"><label class="switch" title="Check automatically"><input type="checkbox" data-en="${a.id}" ${a.enabled ? 'checked' : ''}><i></i></label>${a.kind === 'microsoft' && !a.signed_in ? `<button class="btn small" data-edit="${a.id}">Sign in</button>` : `<button class="btn small soft" data-sync="${a.id}">Check now</button>`}<button class="btn small ghost" data-edit="${a.id}">Edit</button><button class="btn small ghost" data-del="${a.id}">Remove</button></div></li>`).join('')}</ul></div>` : ''}
    <div class="row" style="margin-bottom:20px"><button class="btn" data-add>Connect a mailbox</button><span class="spacer"></span>
      <label class="row small">Check every <select id="every" style="width:auto">${[15, 30, 60, 180, 720].map((m) => `<option value="${m}" ${Number(s.email_check_minutes || 30) === m ? 'selected' : ''}>${m < 60 ? `${m} minutes` : m === 60 ? 'hour' : `${m / 60} hours`}</option>`).join('')}</select></label></div>`;
  el.querySelector('#every').onchange = (e) => api('/settings', { method: 'PUT', body: { email_check_minutes: Number(e.target.value) } }).then(() => toast('Saved'));
  el.querySelector('[data-add]').onclick = () => mailboxSheet(null, () => emailSettings(el));
  on(el, 'click', '[data-edit]', (e, b) => mailboxSheet(list.find((a) => a.id === Number(b.dataset.edit)), () => emailSettings(el)));
  on(el, 'change', '[data-en]', (e, i) => api(`/email/accounts/${i.dataset.en}`, { method: 'PATCH', body: { enabled: i.checked ? 1 : 0 } }));
  on(el, 'click', '[data-sync]', async (e, b) => { b.disabled = true; b.textContent = 'Checking…'; try { const r = await api(`/email/accounts/${b.dataset.sync}/sync`, { method: 'POST', body: {} }); toast(`Looked at ${r.scanned} new emails · ${r.found} receipts`); } catch (err) { fail(err); } emailSettings(el); });
  on(el, 'click', '[data-del]', async (e, b) => { if (!confirm('Remove this mailbox? Receipts already found stay in Hearth.')) return; await api(`/email/accounts/${b.dataset.del}`, { method: 'DELETE' }); emailSettings(el); });
}

function mailboxSheet(a, done) {
  const isNew = !a;
  a ||= { kind: 'imap', name: '', host: '', port: 993, secure: 1, username: '', password: '', folders: ['INBOX'], folder_names: {}, lookback_days: 90, user_id: state.me.user.id, graph_tenant: 'common' };
  const guess = a.kind === 'microsoft' ? 'microsoft' : a.kind === 'ews' ? 'ews' : Object.entries(PROVIDERS).find(([, p]) => p.host && p.host === a.host)?.[0] || (isNew ? 'gmail' : 'other');
  const tenant = a.graph_tenant || 'common', customTenant = !['common', 'consumers', 'organizations'].includes(tenant);
  let names = { ...(a.folder_names || {}) };
  const chip = (id, on) => `<button type="button" class="chip ${on ? 'on' : ''}" data-f="${esc(id)}">${esc(names[id] || (id === 'inbox' ? 'Inbox' : id))}</button>`;
  const { el, close } = sheet(`<h2>${isNew ? 'Connect a mailbox' : 'Edit mailbox'}</h2><form class="kv" id="mf">
    <label class="f"><span>Provider</span><select name="provider" ${isNew ? '' : 'disabled'}>${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}" ${k === guess ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
    <label class="f"><span>Name</span><input type="text" name="name" value="${esc(a.name || '')}" placeholder="Alex's email"></label>
    <div class="small muted" id="phelp" style="grid-column:1/-1;margin:0 0 6px;line-height:1.5"></div>
    <label class="f" data-k="microsoft"><span>Application (client) ID</span><input type="text" name="graph_client_id" value="${esc(a.graph_client_id || '')}" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off"></label>
    <label class="f" data-k="microsoft"><span>Account type</span><select name="graph_tenant_pick">
      <option value="common" ${tenant === 'common' ? 'selected' : ''}>Any (personal, work or school)</option><option value="consumers" ${tenant === 'consumers' ? 'selected' : ''}>Personal — Outlook.com, Hotmail, Live</option>
      <option value="organizations" ${tenant === 'organizations' ? 'selected' : ''}>Work or school — Microsoft 365</option><option value="custom" ${customTenant ? 'selected' : ''}>A specific tenant ID</option></select></label>
    <label class="f" data-k="microsoft" id="tenantbox" style="grid-column:1/-1${customTenant ? '' : ';display:none'}"><span>Tenant ID or domain</span><input type="text" name="graph_tenant" value="${customTenant ? esc(tenant) : ''}" placeholder="contoso.onmicrosoft.com"></label>
    <div data-k="microsoft" id="msbox" style="grid-column:1/-1">${a.kind === 'microsoft' && a.signed_in ? `<p class="small" style="margin:0"><span style="color:var(--green)">✓ Signed in as ${esc(a.address || 'your Microsoft account')}</span> <button type="button" class="btn small ghost" data-signin>Sign in again</button></p>` : ''}</div>
    <label class="f" data-k="ews" style="grid-column:1/-1"><span>EWS address</span><input type="url" name="ews_url" value="${esc(a.ews_url || '')}" placeholder="https://mail.yourdomain.com/EWS/Exchange.asmx"></label>
    <label class="f" data-k="ews"><span>Domain (optional)</span><input type="text" name="ews_domain" value="${esc(a.ews_domain || '')}" placeholder="CONTOSO"></label>
    <label class="f" data-k="imap ews"><span>Email / username</span><input type="text" name="username" value="${esc(a.username || '')}" autocomplete="off"></label>
    <label class="f" data-k="imap ews"><span id="pwlabel">App password</span><input type="password" name="password" value="${esc(a.password || '')}" autocomplete="new-password"></label>
    <label class="f" data-k="imap"><span>IMAP server</span><input type="text" name="host" value="${esc(a.host || '')}"></label>
    <label class="f" data-k="imap"><span>Port</span><input type="number" name="port" value="${a.port || 993}"></label>
    <label class="f" style="grid-column:1/-1"><span>Folders to check</span><div class="chips" id="folders" style="margin-top:6px">${a.folders.map((f) => chip(f, true)).join('')}<span class="muted small" id="fhint">${isNew ? '' : 'Press "Test" to choose from your folders'}</span></div></label>
    <label class="f"><span>On first check, look back</span><select name="lookback_days">${[[30, '1 month'], [90, '3 months'], [180, '6 months'], [365, '1 year'], [730, '2 years']].map(([v, l]) => `<option value="${v}" ${Number(a.lookback_days) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Whose mailbox</span><select name="user_id">${opts(state.users, a.user_id)}</select></label>
    <details class="adv" style="grid-column:1/-1"><summary>Advanced</summary><label class="row small" style="margin-top:8px" data-k="imap"><input type="checkbox" name="secure" ${a.secure ? 'checked' : ''}> Use SSL/TLS (port 993)</label>
      <label class="row small" data-k="imap ews"><input type="checkbox" name="allow_self_signed" ${a.allow_self_signed ? 'checked' : ''}> Allow a self-signed certificate (your own mail server)</label></details>
    <div class="row" style="grid-column:1/-1"><span class="small" id="tres"></span><span class="spacer"></span><button type="button" class="btn soft" data-test>Test</button><button class="btn" id="go"></button></div></form>`, { wide: true });
  const f = el.querySelector('#mf');
  const kind = () => PROVIDERS[f.provider.value].kind || 'imap';
  const setProv = (first) => {
    const p = PROVIDERS[f.provider.value], k = kind();
    el.querySelector('#phelp').innerHTML = k === 'microsoft' ? (a.signed_in ? 'Connected through your Entra app registration. Only change the client ID or account type if you\'ve made a new app — you\'ll need to sign in again.' : p.help) : esc(p.help);
    el.querySelectorAll('[data-k]').forEach((x) => { x.style.display = x.dataset.k.split(' ').includes(k) ? '' : 'none'; });
    if (k === 'microsoft' && !customTenant) el.querySelector('#tenantbox').style.display = 'none';
    el.querySelector('#pwlabel').textContent = k === 'ews' ? 'Password' : 'App password';
    el.querySelector('#go').textContent = k === 'microsoft' && !a.signed_in ? 'Save and sign in with Microsoft' : isNew ? 'Connect' : 'Save';
    el.querySelector('[data-test]').style.display = k === 'microsoft' && !a.signed_in ? 'none' : '';
    if (isNew && !first && k === 'imap') { if (p.host) f.host.value = p.host; f.port.value = p.port; }
    if (isNew) { const def = k === 'imap' ? 'INBOX' : 'inbox'; el.querySelector('#folders').innerHTML = chip(def, true) + `<span class="muted small" id="fhint">${k === 'microsoft' ? 'After signing in, press "Test" to choose other folders' : 'Press "Test" to choose from your folders'}</span>`; }
  };
  if (isNew && guess === 'gmail') { f.host.value = PROVIDERS.gmail.host; }
  f.provider.onchange = () => setProv(false); setProv(true);
  f.graph_tenant_pick.onchange = () => { el.querySelector('#tenantbox').style.display = f.graph_tenant_pick.value === 'custom' ? '' : 'none'; };
  on(el, 'click', '[data-f]', (e, b) => b.classList.toggle('on'));
  const body = () => {
    const d = Object.fromEntries(new FormData(f)), k = kind();
    const b = { id: a.id, kind: k, name: d.name || d.username || '', user_id: Number(d.user_id) || null, lookback_days: Number(d.lookback_days), allow_self_signed: d.allow_self_signed ? 1 : 0,
      folders: [...el.querySelectorAll('[data-f].on')].map((x) => x.dataset.f), folder_names: names };
    if (k === 'imap') Object.assign(b, { host: d.host.trim(), port: Number(d.port) || 993, secure: d.secure ? 1 : 0, username: d.username.trim(), password: d.password });
    if (k === 'ews') Object.assign(b, { ews_url: d.ews_url.trim(), ews_domain: d.ews_domain.trim(), username: d.username.trim(), password: d.password });
    if (k === 'microsoft') Object.assign(b, { graph_client_id: d.graph_client_id.trim(), graph_tenant: d.graph_tenant_pick === 'custom' ? (d.graph_tenant || '').trim() || 'common' : d.graph_tenant_pick, name: d.name || 'Microsoft' });
    return b;
  };
  const test = async (btn) => {
    const t = el.querySelector('#tres'); if (btn) btn.disabled = true; t.textContent = 'Connecting…';
    try {
      const r = await api('/email/accounts/test', { method: 'POST', body: body() });
      const chosen = new Set([...el.querySelectorAll('[data-f].on')].map((x) => x.dataset.f));
      names = Object.fromEntries(r.folders.map((x) => [x.id, x.name]));
      el.querySelector('#folders').innerHTML = r.folders.map((x) => chip(x.id, chosen.has(x.id))).join('');
      t.innerHTML = `<span style="color:var(--green)">✓ ${esc(r.message || 'Connected')} — pick the folders to check</span>`;
    } catch (err) { t.textContent = err.message; }
    if (btn) btn.disabled = false;
  };
  el.querySelector('[data-test]').onclick = (e) => test(e.target);
  // Microsoft device-code sign-in: show the code, poll until it's done
  let timer = null;
  const signIn = async (id) => {
    const box = el.querySelector('#msbox');
    try {
      const r = await api(`/email/accounts/${id}/microsoft/login`, { method: 'POST', body: {} });
      box.innerHTML = `<div class="surface pad" style="background:var(--bg-2, rgba(0,0,0,.03))"><p style="margin:0 0 8px">Open <a href="${esc(r.verification_uri)}" target="_blank" rel="noopener"><b>${esc(r.verification_uri.replace(/^https?:\/\//, ''))}</b></a> on any device and enter this code:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:.12em;margin:4px 0 8px"><span id="mscode">${esc(r.user_code)}</span> <button type="button" class="btn small ghost" data-copy>Copy</button></p>
        <p class="small muted" id="msstate" style="margin:0">Waiting for you to sign in… (the code lasts 15 minutes)</p></div>`;
      box.querySelector('[data-copy]').onclick = () => navigator.clipboard?.writeText(r.user_code).then(() => toast('Code copied'));
      clearInterval(timer);
      timer = setInterval(async () => {
        if (!document.body.contains(box)) return clearInterval(timer);
        const st = await api(`/email/accounts/${id}/microsoft/status`).catch(() => null);
        if (!st) return;
        if (st.status === 'failed') { clearInterval(timer); box.querySelector('#msstate').innerHTML = `<span style="color:var(--red)">${esc(st.message)}</span> <button type="button" class="btn small ghost" data-signin>Try again</button>`; }
        if (st.status === 'done' || (st.signed_in && st.status !== 'waiting')) {
          clearInterval(timer); a = { ...a, id, kind: 'microsoft', signed_in: true, address: st.address };
          box.innerHTML = `<p class="small" style="margin:0"><span style="color:var(--green)">✓ Signed in as ${esc(st.address || 'your Microsoft account')} — checking for receipts now.</span></p>`;
          setProv(true); el.querySelector('#go').textContent = 'Done'; test();
        }
      }, 3000);
    } catch (err) { box.innerHTML = `<p class="small" style="color:var(--red);margin:0">${esc(err.message)}</p>`; }
  };
  on(el, 'click', '[data-signin]', () => signIn(a.id));
  f.onsubmit = async (e) => {
    e.preventDefault(); const b = body(), k = b.kind;
    if (!b.folders.length) return toast('Pick at least one folder');
    try {
      const saved = await api(a.id ? `/email/accounts/${a.id}` : '/email/accounts', { method: a.id ? 'PATCH' : 'POST', body: b });
      if (k === 'microsoft' && !a.signed_in) { a = { ...a, ...saved, id: saved.id || a.id }; done(); return signIn(a.id); }
      clearInterval(timer); close(); toast(isNew && k !== 'microsoft' ? 'Connected — checking for receipts now' : 'Saved'); done();
    } catch (err) { fail(err); }
  };
}

// ---------- calendars ----------
async function calendars(el) {
  const list = await api('/calendars');
  let haCals = [];
  if (state.me.ha) haCals = await api('/homeassistant/calendars').catch(() => []);
  const linked = new Set(list.filter((c) => c.provider === 'homeassistant').map((c) => c.url));
  const msAccts = (await api('/email/accounts').catch(() => [])).filter((a) => a.kind === 'microsoft');
  const msLinked = new Set(list.filter((c) => c.provider === 'microsoft').map((c) => c.url));
  const msBlock = `<div class="surface pad" style="margin-bottom:20px"><h3 style="margin-top:0">From Microsoft 365 / Outlook.com</h3>
    ${msAccts.length ? `<p class="muted small">Uses the Microsoft sign-in from Email receipts. Tick to keep a local copy of that account's calendar.</p><ul class="list">${msAccts.map((a) => `<li><div class="main"><div class="title">${esc(a.address || a.name)}</div><div class="meta">${a.signed_in ? 'Signed in' : 'Not signed in yet — finish signing in under Email receipts'}</div></div>
      <label class="switch"><input type="checkbox" data-mscal="${a.id}" data-name="${esc(a.address || a.name)}" ${msLinked.has(String(a.id)) ? 'checked' : ''} ${a.signed_in ? '' : 'disabled'}><i></i></label></li>`).join('')}</ul>`
      : '<p class="muted small">Sign in with Microsoft under <a href="#/settings/email">Email receipts</a> (choose "Outlook.com / Microsoft 365") and your Outlook calendar can be copied here too — no published link needed.</p>'}</div>`;
  const haBlock = state.me.ha ? `<div class="surface pad" style="margin-bottom:20px"><h3 style="margin-top:0">From Home Assistant</h3>
    <p class="muted small">Calendars you've already connected to Home Assistant (Google, Outlook, Microsoft 365/Exchange, CalDAV, local…). Tick to keep a local copy in Hearth.</p>
    ${haCals.length ? `<ul class="list">${haCals.map((c) => `<li><div class="main"><div class="title">${esc(c.name)}</div><div class="meta">${esc(c.entity_id)}</div></div>
      <label class="switch"><input type="checkbox" data-hacal="${esc(c.entity_id)}" data-name="${esc(c.name)}" ${linked.has(c.entity_id) ? 'checked' : ''}><i></i></label></li>`).join('')}</ul>` : '<p class="muted small">No calendar entities found in Home Assistant.</p>'}</div>` : '';
  el.innerHTML = `${msBlock}${haBlock}${list.length ? `<div class="surface" style="margin-bottom:20px"><ul class="list">${list.map((c) => `<li><span class="dot" style="background:${c.color};width:12px;height:12px"></span><div class="main"><div class="title">${esc(c.name)}</div><div class="meta">${esc(c.provider)} · ${c.last_sync ? `synced ${relDay(c.last_sync)}` : 'not synced yet'}${c.last_error ? ` · ⚠ ${esc(c.last_error)}` : ''}</div></div>
      <button class="btn small soft" data-sync="${c.id}">Sync</button><button class="btn small ghost" data-del="${c.id}">Remove</button></li>`).join('')}</ul></div>` : ''}
    <div class="surface pad"><h3 style="margin-top:0">Add a calendar</h3>
      <form id="cf" class="kv"><label class="f"><span>Provider</span><select name="provider"><option value="google">Google</option><option value="outlook">Outlook.com</option><option value="exchange">Exchange / Microsoft 365</option><option value="ics">Other (iCal link)</option></select></label>
      <label class="f"><span>Name</span><input type="text" name="name" required placeholder="Family"></label>
      <label class="f" style="grid-column:1/-1"><span>Calendar link (ICS)</span><input type="text" name="url" required placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></label>
      <label class="f"><span>Username (only if the link needs a login)</span><input type="text" name="username"></label><label class="f"><span>Password</span><input type="password" name="password"></label>
      <label class="f"><span>Colour</span><input type="color" name="color" value="#c2477e"></label><div class="row end" style="grid-column:1/-1"><button class="btn">Add and sync</button></div></form>
      <details class="adv"><summary>Where do I find the link?</summary><div class="small" style="color:var(--ink-2)">
        <p><b>Google:</b> calendar.google.com → Settings → pick the calendar → Integrate calendar → "Secret address in iCal format".</p>
        <p><b>Outlook.com / Microsoft 365:</b> easiest is "From Microsoft 365 / Outlook.com" above. Or publish an ICS link: Outlook.com Settings → Calendar → Shared calendars → Publish a calendar → choose "Can view all details" → copy the ICS link.</p>
        <p><b>Exchange / Microsoft 365:</b> Outlook on the web → Settings → Calendar → Shared calendars → Publish a calendar → ICS link. On-premises Exchange: ask your admin to allow calendar publishing, or use the same steps in OWA.</p>
        <p>Hearth downloads the calendar every hour and keeps a full local copy (3 years back, 2 years ahead). Events you've attached costs to are kept even if they're deleted at the source.</p></div></details></div>`;
  on(el, 'change', '[data-hacal]', async (e, i) => {
    if (i.checked) { await api('/calendars', { method: 'POST', body: { name: i.dataset.name, provider: 'homeassistant', url: i.dataset.hacal, user_id: state.me.user.id } }); toast('Syncing — events appear in a moment'); }
    else { const c = list.find((x) => x.provider === 'homeassistant' && x.url === i.dataset.hacal); if (c) await api(`/calendars/${c.id}`, { method: 'DELETE' }); }
    setTimeout(() => calendars(el), 1500);
  });
  on(el, 'change', '[data-mscal]', async (e, i) => {
    if (i.checked) { await api('/calendars', { method: 'POST', body: { name: i.dataset.name, provider: 'microsoft', url: i.dataset.mscal, user_id: state.me.user.id, color: '#2f6fd1' } }); toast('Syncing — events appear in a moment'); }
    else { const c = list.find((x) => x.provider === 'microsoft' && x.url === i.dataset.mscal); if (c) await api(`/calendars/${c.id}`, { method: 'DELETE' }); }
    setTimeout(() => calendars(el), 1500);
  });
  el.querySelector('#cf').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    try { await api('/calendars', { method: 'POST', body: { name: d.name, provider: d.provider, url: d.url, color: d.color, user_id: state.me.user.id, credentials: d.username ? JSON.stringify({ username: d.username, password: d.password }) : null } }); toast('Added — syncing'); setTimeout(() => calendars(el), 2000); }
    catch (err) { fail(err); }
  };
  on(el, 'click', '[data-sync]', async (e, b) => { try { const r = await api(`/calendars/${b.dataset.sync}/sync`, { method: 'POST' }); toast(`${r.events} events synced`); calendars(el); } catch (err) { fail(err); } });
  on(el, 'click', '[data-del]', async (e, b) => { if (confirm('Remove this calendar and its local copy?')) { await api(`/calendars/${b.dataset.del}`, { method: 'DELETE' }); calendars(el); } });
}

// ---------- integrations ----------
async function integrations(el) {
  const [s, hs] = await Promise.all([api('/settings'), api('/homeassistant/status').catch(() => ({ connected: false }))]);
  const ha = s.homeassistant || {}, nt = s.ntfy || {}, ig = s.integrations || { pricerunner: true, url: true };
  const sup = hs.addon;
  el.innerHTML = `
    <div class="settings-group surface pad"><h3>Home Assistant ${hs.connected ? '<span class="tag" style="background:var(--green-soft);color:var(--green)">connected</span>' : ''}</h3>
      ${sup ? `<p class="muted small">Running as a Home Assistant add-on, so Hearth talks to Home Assistant directly — notifications, calendars and sensors need no setup.${hs.version ? ` Home Assistant ${esc(hs.version)}${hs.location ? ` · ${esc(hs.location)}` : ''}.` : ''}</p>`
        : `<p class="muted small">Send workflow notifications through Home Assistant's notify services, read its calendars, and publish sensors.</p>`}
      <form id="hf" class="kv">
        ${sup ? '' : `<label class="f"><span>Home Assistant URL</span><input type="url" name="url" value="${esc(ha.url || '')}" placeholder="http://homeassistant.local:8123"></label>
        <label class="f"><span>Long-lived access token</span><input type="password" name="token" value="${esc(ha.token || '')}"></label>`}
        <label class="f" style="grid-column:1/-1"><span>Send every notification to these HA services too (optional)</span><div class="chips" id="hasvc" style="margin-top:6px"><span class="muted small">${hs.connected ? 'Loading…' : 'Connect first'}</span></div></label>
        <div class="row end" style="grid-column:1/-1"><button class="btn">Save</button></div><div id="ht" class="small muted" style="grid-column:1/-1">${hs.error ? esc(hs.error) : ''}</div></form>
      ${hs.connected ? `<details class="adv"><summary>Sensors Hearth publishes</summary><p class="small muted">Updated every 15 minutes: <code>sensor.hearth_free_to_spend</code>, <code>sensor.hearth_spent_this_month</code>, <code>sensor.hearth_balance</code>, <code>sensor.hearth_needs_attention</code>, <code>sensor.hearth_next_payment</code>. Workflows can also fire events (e.g. <code>hearth_big_spend</code>) or call any HA service.</p></details>` : ''}</div>
    <div class="settings-group surface pad"><h3>ntfy</h3><form id="nf" class="kv">
      <label class="row" style="grid-column:1/-1"><label class="switch"><input type="checkbox" name="enabled" ${nt.enabled ? 'checked' : ''}><i></i></label> Also send notifications to a self-hosted ntfy topic</label>
      <label class="f"><span>Server</span><input type="url" name="url" value="${esc(nt.url || '')}" placeholder="https://ntfy.your.lan"></label><label class="f"><span>Topic</span><input type="text" name="topic" value="${esc(nt.topic || '')}"></label>
      <label class="f"><span>Token (optional)</span><input type="password" name="token" value="${esc(nt.token || '')}"></label><div class="row end" style="grid-column:1/-1"><button class="btn">Save</button></div></form></div>
    <div class="settings-group surface pad"><h3>Price comparison</h3><form id="pf">
      <label class="row" style="margin-bottom:10px"><label class="switch"><input type="checkbox" name="pricerunner" ${ig.pricerunner !== false ? 'checked' : ''}><i></i></label> PriceRunner — track the lowest price across UK retailers</label>
      <label class="row" style="margin-bottom:10px"><label class="switch"><input type="checkbox" name="url" ${ig.url !== false ? 'checked' : ''}><i></i></label> Any shop's product page</label>
      <label class="f"><span>Check prices every (hours)</span><input type="number" name="price_check_hours" value="${s.price_check_hours || 6}" style="max-width:120px"></label>
      <div class="row end"><button class="btn">Save</button></div></form></div>
    <p class="muted small">Local AI settings have moved to <a href="#/settings/ai">Settings → Local AI</a>.</p>`;
  const chosen = new Set(ha.default_services || []);
  if (hs.connected) api('/homeassistant/services').then((svcs) => {
    el.querySelector('#hasvc').innerHTML = svcs.map((x) => `<button type="button" class="chip ${chosen.has(x) ? 'on' : ''}" data-svc="${esc(x)}">${esc(x.replace('notify.', ''))}</button>`).join('') || '<span class="muted small">No notify services found</span>';
  }).catch((e) => { el.querySelector('#hasvc').textContent = e.message; });
  on(el, 'click', '[data-svc]', (e, b) => { b.classList.toggle('on'); b.classList.contains('on') ? chosen.add(b.dataset.svc) : chosen.delete(b.dataset.svc); });
  el.querySelector('#hf').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    await api('/settings', { method: 'PUT', body: { homeassistant: { url: d.url || ha.url || '', token: d.token || ha.token || '', default_services: [...chosen] } } }); toast('Saved'); integrations(el);
  };
  el.querySelector('#nf').onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); await api('/settings', { method: 'PUT', body: { ntfy: { ...d, enabled: !!d.enabled } } }); toast('Saved'); };
  el.querySelector('#pf').onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); await api('/settings', { method: 'PUT', body: { integrations: { pricerunner: !!d.pricerunner, url: !!d.url }, price_check_hours: Number(d.price_check_hours) } }); toast('Saved'); };
}

// ---------- local AI ----------
const FEATURES = [
  ['tools', 'Let the assistant look things up', 'Uses tool calling to query your transactions, budgets and forecast. Turn off for models that struggle with it.'],
  ['auto_categorise', 'File unknown transactions', 'After each sync, the fast model categorises anything the built-in rules missed. You glance over them in Needs attention.'],
  ['smart_notes', 'Help read quick notes', 'When a jotted note is unclear, the AI works out amount, date and category.'],
  ['monthly_review', 'Monthly review', 'On the 1st, writes a short review of last month and sends you a notification.'],
  ['weekly_checkin', 'Monday check-in', 'A two-sentence heads-up about the week ahead each Monday morning.'],
  ['receipts', 'Receipt scanning', 'Read receipt photos with your vision model and match them to bank payments.'],
];
async function aiSettings(el) {
  const s = await api('/settings');
  const o = s.ollama || {};
  el.innerHTML = `<div class="surface pad settings-group" id="aist"><span class="muted">Checking Ollama…</span></div>
    <form id="af">
    <div class="settings-group surface pad"><h3>Connection</h3><div class="kv">
      <label class="row" style="grid-column:1/-1"><label class="switch"><input type="checkbox" name="enabled" ${o.enabled !== false ? 'checked' : ''}><i></i></label> Use local AI</label>
      <label class="f" style="grid-column:1/-1"><span>Ollama address</span><input type="text" name="url" value="${esc(o.url || '')}" placeholder="Uses the add-on option if empty"></label>
    </div></div>
    <div class="settings-group surface pad"><h3>Models</h3><p class="muted small">Pick a model for each job. Leave a box empty to use the default from the add-on options.</p><div class="kv">
      <label class="f"><span>Chat & advice</span><select name="model" data-models data-cur="${esc(o.model || '')}"></select></label>
      <label class="f"><span>Background jobs (fast)</span><select name="fast_model" data-models data-cur="${esc(o.fast_model || '')}"></select></label>
      <label class="f"><span>Receipts (vision)</span><select name="vision_model" data-models data-cur="${esc(o.vision_model ?? '')}" data-allow-none></select></label>
      <label class="f"><span>Context window (tokens)</span><select name="num_ctx">${[4096, 8192, 16384, 32768].map((n) => `<option ${Number(o.num_ctx || 8192) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f"><span>Keep model loaded for</span><select name="keep_alive">${[['5m', '5 minutes'], ['10m', '10 minutes'], ['30m', '30 minutes'], ['1h', '1 hour'], ['-1', 'Always']].map(([v, l]) => `<option value="${v}" ${(o.keep_alive || '10m') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f"><span>Creativity</span><select name="temperature">${[['0.1', 'Precise'], ['0.3', 'Balanced'], ['0.6', 'Chatty']].map(([v, l]) => `<option value="${v}" ${String(o.temperature ?? '0.3') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div><p class="muted small">Tip: an 8k context suits 7–8B models on modest hardware; raise it if your GPU has room and answers lose track of long chats.</p></div>
    <div class="settings-group surface pad"><h3>What the AI does for you</h3>
      ${FEATURES.map(([k, l, d]) => `<label class="row" style="align-items:flex-start;margin-bottom:12px;flex-wrap:nowrap"><label class="switch" style="margin-top:2px"><input type="checkbox" name="f_${k}" ${(o.features?.[k] ?? state.me.ai.features?.[k]) ? 'checked' : ''}><i></i></label><span><b>${l}</b><br><span class="muted small">${d}</span></span></label>`).join('')}</div>
    <div class="settings-group surface pad"><h3>House rules for the assistant</h3><textarea name="persona" placeholder="e.g. We're saving for a house deposit, so nudge us towards that. Keep answers very short. Sam does the food shop.">${esc(o.persona || '')}</textarea></div>
    <div class="row end" style="margin-bottom:24px"><button class="btn">Save</button></div></form>
    <div class="settings-group"><h3>Tidy up <span class="muted small">— what the AI has filed</span></h3><div class="row"><button class="btn soft" data-run>Categorise leftovers now</button><button class="btn soft" data-accept>Accept AI categories</button><button class="btn ghost" data-undo>Undo AI categories</button></div></div>
    <div class="settings-group"><h3>Recent AI activity</h3><div class="surface"><ul class="list" id="ailog"><li class="muted">Loading…</li></ul></div></div>`;
  const status = el.querySelector('#aist');
  api('/ai/models').then((m) => {
    const names = m.models.map((x) => x.name);
    status.innerHTML = `<b>Connected to Ollama${m.version ? ` ${esc(m.version)}` : ''}</b> at ${esc(m.current.url)}<div class="muted small" style="margin-top:4px">${names.length} models installed${m.running.length ? ` · loaded now: ${m.running.map((r) => esc(r.name)).join(', ')}` : ' · none loaded right now'}</div>`;
    el.querySelectorAll('[data-models]').forEach((sel) => {
      const cur = sel.dataset.cur;
      sel.innerHTML = `<option value="">${sel.dataset.allowNone !== undefined ? 'None (hide receipt scanning)' : 'Default'}</option>${m.models.map((x) => `<option value="${esc(x.name)}" ${x.name === cur ? 'selected' : ''}>${esc(x.name)}${x.params ? ` · ${esc(x.params)}` : ''}</option>`).join('')}${cur && !names.includes(cur) ? `<option selected value="${esc(cur)}">${esc(cur)} (not installed)</option>` : ''}`;
    });
  }).catch((e) => {
    status.innerHTML = `<b>Can't reach Ollama</b><div class="muted small">${esc(e.message)}</div>`;
    el.querySelectorAll('[data-models]').forEach((sel) => { sel.outerHTML = `<input type="text" name="${sel.name}" value="${esc(sel.dataset.cur)}" placeholder="model name, e.g. qwen2.5:7b-instruct">`; });
  });
  api('/ai/log').then((rows) => {
    el.querySelector('#ailog').innerHTML = rows.slice(0, 25).map((r) => `<li><div class="main"><div class="title">${esc(r.task)} · ${esc(r.model)}</div><div class="meta">${relDay(r.created_at)} · ${(r.ms / 1000).toFixed(1)}s · ${r.ok ? esc(r.detail) : `failed: ${esc(r.detail)}`}</div></div></li>`).join('') || '<li class="muted">Nothing yet.</li>';
  });
  el.querySelector('#af').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    const features = Object.fromEntries(FEATURES.map(([k]) => [k, !!d[`f_${k}`]]));
    await api('/settings', { method: 'PUT', body: { ollama: { enabled: !!d.enabled, url: d.url || '', model: d.model || '', fast_model: d.fast_model || '', vision_model: d.vision_model ?? '', num_ctx: Number(d.num_ctx), keep_alive: d.keep_alive, temperature: Number(d.temperature), persona: d.persona || '', features } } });
    state.me = await api('/me'); toast('Saved'); aiSettings(el);
  };
  el.querySelector('[data-run]').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Working…'; try { const r = await api('/ai/categorise', { method: 'POST', body: { limit: 60 } }); toast(`AI filed ${r.updated} of ${r.looked_at || 0}`); } catch (err) { fail(err); } e.target.disabled = false; e.target.textContent = 'Categorise leftovers now'; };
  el.querySelector('[data-accept]').onclick = async () => { const r = await api('/ai/accept-categorise', { method: 'POST' }); toast(`Accepted ${r.accepted}`); };
  el.querySelector('[data-undo]').onclick = async () => { if (!confirm('Clear every category the AI chose that you haven\'t accepted?')) return; const r = await api('/ai/undo-categorise', { method: 'POST', body: {} }); toast(`Cleared ${r.undone}`); };
}

async function data(el) {
  const s = await api('/settings');
  const dg = s.digest || { enabled: true, hour: 8 };
  el.innerHTML = `<div class="settings-group surface pad"><h3>Timing</h3><form id="tf" class="kv">
      <label class="f"><span>Sync banks every (hours)</span><input type="number" name="bank_sync_hours" value="${s.bank_sync_hours || 4}"></label>
      <label class="f"><span>"Large transaction" means over (£)</span><input type="number" name="large_tx_threshold" value="${s.large_tx_threshold || 250}"></label>
      <label class="row"><label class="switch"><input type="checkbox" name="digest" ${dg.enabled ? 'checked' : ''}><i></i></label> Morning summary notification</label>
      <label class="f"><span>At (hour, 0–23)</span><input type="number" name="hour" min="0" max="23" value="${dg.hour}"></label>
      <div class="row end" style="grid-column:1/-1"><button type="button" class="btn soft" data-syncall>Sync everything now</button><button class="btn">Save</button></div></form></div>
    <div class="settings-group surface pad"><h3>Backup & export</h3><p class="muted small">All your data lives in a single file on this server (<code>data/hearth.db</code>). Back up that folder, or download a JSON copy here.</p>
      <div class="row"><button class="btn soft" data-backup>Download JSON backup</button><button class="btn soft" data-csv>Export all transactions (CSV)</button></div></div>`;
  el.querySelector('#tf').onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); await api('/settings', { method: 'PUT', body: { bank_sync_hours: Number(d.bank_sync_hours), large_tx_threshold: Number(d.large_tx_threshold), digest: { enabled: !!d.digest, hour: Number(d.hour) } } }); toast('Saved'); };
  el.querySelector('[data-syncall]').onclick = async (e) => { e.target.disabled = true; await api('/sync-all', { method: 'POST' }).catch(fail); e.target.disabled = false; toast('Synced'); };
  const dl = async (path, name) => { const r = await fetch(`api${path}`, { headers: { Authorization: `Bearer ${token()}` } }); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click(); };
  el.querySelector('[data-backup]').onclick = () => dl('/backup', `hearth-backup-${iso()}.json`);
  el.querySelector('[data-csv]').onclick = () => dl('/transactions/export.csv', `hearth-transactions-${iso()}.csv`);
}
