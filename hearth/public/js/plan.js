import { state, api, esc, fmt, fmt0, niceDate, sheet, toast, fail, on, opts, iso } from './core.js';
import { budgetRow } from './home.js';
import { actionCard, bindActionCards } from './ask.js';

let tab = 'budgets', plannerYear = new Date().getFullYear(), plannerUser = 0;

export async function renderPlan(el, parts) {
  if (parts[0]) tab = parts[0];
  el.innerHTML = `<div class="seg">${[['budgets', 'Budgets'], ['goals', 'Savings & targets'], ['planner', 'Year planner']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="pb"></div>`;
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; renderPlan(el, []); });
  const box = el.querySelector('#pb');
  if (tab === 'budgets') return budgets(box);
  if (tab === 'goals') return goals(box);
  return planner(box);
}

async function budgets(box) {
  const list = await api('/budgets/status');
  const groups = { shared: list.filter((b) => b.scope === 'shared'), individual: list.filter((b) => b.scope === 'individual'), person: list.filter((b) => b.scope === 'person') };
  box.innerHTML = `<div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1">Budgets can be shared by the whole household, belong to one of you, or track spending for someone (like a child).</p>${state.me.ai?.enabled ? '<button class="btn soft" data-suggest>Suggest some</button>' : ''}<button class="btn" data-new>New budget</button></div><div id="bsug"></div>
    ${list.length ? '' : '<div class="empty"><b>No budgets yet</b>Start with one, like groceries. Hearth checks it every time money moves and only tells you when it matters.</div>'}
    ${[['shared', 'Together'], ['individual', 'Individual'], ['person', 'For someone']].map(([k, l]) => groups[k].length ? `<section style="margin-bottom:22px"><h3>${l}</h3><div class="surface pad">${groups[k].map((b) => `<div data-edit="${b.id}" style="cursor:pointer">${budgetRow(b)}</div>`).join('')}</div></section>` : '').join('')}`;
  box.querySelector('[data-new]').onclick = () => budgetSheet(null, () => budgets(box));
  box.querySelector('[data-suggest]')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Looking at your spending…';
    try {
      const acts = await api('/ai/budget-suggestions', { method: 'POST' });
      const sug = box.querySelector('#bsug');
      sug.innerHTML = `<div class="surface pad" style="margin-bottom:20px"><b>Suggested from your last 6 months</b>${acts.map(actionCard).join('') || '<p class="muted">Nothing to add — your main spending is already covered.</p>'}</div>`;
      bindActionCards(sug); sug.addEventListener('click', (x) => { if (x.target.matches('[data-confirm]')) setTimeout(() => budgets(box), 600); });
    } catch (err) { fail(err); }
    e.target.disabled = false; e.target.textContent = 'Suggest some';
  });
  on(box, 'click', '[data-edit]', (e, d) => budgetSheet(list.find((b) => b.id === Number(d.dataset.edit)), () => budgets(box)));
}

function budgetSheet(b, done) {
  b ||= { name: '', amount: '', period: 'monthly', scope: 'shared', category_ids: '[]', alert_pct: 80, color: '#2f7d5b' };
  const selCats = JSON.parse(b.category_ids || '[]');
  const { el, close } = sheet(`<h2>${b.id ? 'Edit budget' : 'New budget'}</h2><form>
    <div class="kv"><label class="f"><span>Name</span><input type="text" name="name" value="${esc(b.name)}" required placeholder="Groceries"></label>
    <label class="f"><span>Amount (£)</span><input type="number" step="1" name="amount" value="${b.amount}" required></label>
    <label class="f"><span>Every</span><select name="period">${[['weekly', 'Week'], ['monthly', 'Month'], ['quarterly', 'Quarter'], ['yearly', 'Year'], ['custom', 'Custom dates']].map(([v, l]) => `<option value="${v}" ${b.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Who it's for</span><select name="scope"><option value="shared" ${b.scope === 'shared' ? 'selected' : ''}>Everyone together</option><option value="individual" ${b.scope === 'individual' ? 'selected' : ''}>One user's own spending</option><option value="person" ${b.scope === 'person' ? 'selected' : ''}>Spending for a person</option></select></label>
    <label class="f" data-show="individual"><span>User</span><select name="user_id">${opts(state.users, b.user_id)}</select></label>
    <label class="f" data-show="person"><span>Person</span><select name="person_id">${opts(state.people, b.person_id)}</select></label>
    <label class="f" data-show="custom"><span>Start</span><input type="date" name="start_date" value="${b.start_date || iso()}"></label>
    <label class="f" data-show="custom"><span>End</span><input type="date" name="end_date" value="${b.end_date || ''}"></label>
    <label class="f"><span>Warn me at (%)</span><input type="number" name="alert_pct" value="${b.alert_pct}"></label>
    <label class="f"><span>Colour</span><input type="color" name="color" value="${b.color}"></label></div>
    <div class="f"><span class="small muted" style="font-weight:600">Categories (leave empty for all spending)</span><div class="chips" style="margin-top:8px">${state.cats.filter((c) => c.kind === 'expense').map((c) => `<button type="button" class="chip ${selCats.includes(c.id) ? 'on' : ''}" data-c="${c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div></div>
    <div class="row" style="margin-top:16px">${b.id ? '<button type="button" class="btn ghost" data-del>Delete</button>' : ''}<span class="spacer"></span><button class="btn">Save</button></div></form>`);
  const f = el.querySelector('form');
  const sync = () => el.querySelectorAll('[data-show]').forEach((x) => x.classList.toggle('hidden', ![f.scope.value, f.period.value].includes(x.dataset.show)));
  f.scope.onchange = f.period.onchange = sync; sync();
  on(el, 'click', '[data-c]', (e, c) => c.classList.toggle('on'));
  el.querySelector('[data-del]')?.addEventListener('click', async () => { await api(`/budgets/${b.id}`, { method: 'DELETE' }); close(); done(); });
  f.onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f));
    const body = { ...d, amount: Number(d.amount), alert_pct: Number(d.alert_pct), category_ids: [...el.querySelectorAll('[data-c].on')].map((c) => Number(c.dataset.c)),
      user_id: d.scope === 'individual' ? Number(d.user_id) : null, person_id: d.scope === 'person' ? Number(d.person_id) : null,
      start_date: d.period === 'custom' ? d.start_date : null, end_date: d.period === 'custom' ? d.end_date : null };
    try { await api(b.id ? `/budgets/${b.id}` : '/budgets', { method: b.id ? 'PATCH' : 'POST', body }); close(); toast('Budget saved'); done(); } catch (err) { fail(err); }
  };
}

async function goals(box) {
  const list = await api('/goals/status');
  box.innerHTML = `<div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1">Savings pots, spending caps and targets — for the household or just you.</p><button class="btn" data-new>New target</button></div>
    ${list.length ? `<div class="surface"><ul class="list">${list.map((g) => `<li style="flex-wrap:wrap"><div class="main" style="min-width:220px"><div class="title">${esc(g.name)} <span class="muted small">· ${g.scope === 'individual' ? esc(state.users.find((u) => u.id === g.user_id)?.name || 'Individual') : 'Together'}</span></div>
      <div class="bar" style="margin:8px 0 4px"><i style="width:${g.pct}%;background:${g.color}"></i></div>
      <div class="meta">${fmt0(g.current_amount)} of ${fmt0(g.target_amount)} (${g.pct}%)${g.target_date ? ` · by ${niceDate(g.target_date, { month: 'short', year: 'numeric' })}` : ''}${g.monthly_needed ? ` · ${fmt0(g.monthly_needed)}/month needed` : ''}</div></div>
      <div class="row" style="gap:6px"><button class="btn small" data-add="${g.id}">Add money</button><button class="btn small soft" data-edit="${g.id}">Edit</button></div></li>`).join('')}</ul></div>`
      : '<div class="empty"><b>No targets yet</b>Set one — a holiday, an emergency fund, a new car — and Hearth works out what to put aside each month.</div>'}`;
  box.querySelector('[data-new]').onclick = () => goalSheet(null, () => goals(box));
  on(box, 'click', '[data-edit]', (e, b) => goalSheet(list.find((g) => g.id === Number(b.dataset.edit)), () => goals(box)));
  on(box, 'click', '[data-add]', async (e, b) => { const v = Number(prompt('How much are you adding? (£)')); if (!v) return; await api(`/goals/${b.dataset.add}/contribute`, { method: 'POST', body: { amount: v } }); toast('Added'); goals(box); });
}

function goalSheet(g, done) {
  g ||= { name: '', target_amount: '', current_amount: 0, target_date: '', scope: 'shared', color: '#3c6e9e' };
  const { el, close } = sheet(`<h2>${g.id ? 'Edit target' : 'New target'}</h2><form class="kv">
    <label class="f" style="grid-column:1/-1"><span>Name</span><input type="text" name="name" value="${esc(g.name)}" required placeholder="Summer holiday"></label>
    <label class="f"><span>Target (£)</span><input type="number" name="target_amount" value="${g.target_amount}" required></label>
    <label class="f"><span>Saved so far (£)</span><input type="number" step="0.01" name="current_amount" value="${g.current_amount}"></label>
    <label class="f"><span>By (optional)</span><input type="date" name="target_date" value="${g.target_date || ''}"></label>
    <label class="f"><span>Linked savings account</span><select name="account_id">${opts(state.accounts, g.account_id, (a) => a.name, 'None')}</select></label>
    <label class="f"><span>Whose</span><select name="scope"><option value="shared">Together</option><option value="individual" ${g.scope === 'individual' ? 'selected' : ''}>Just one of us</option></select></label>
    <label class="f"><span>User</span><select name="user_id">${opts(state.users, g.user_id || state.me.user.id)}</select></label>
    <label class="f"><span>Colour</span><input type="color" name="color" value="${g.color}"></label>
    <div class="row" style="grid-column:1/-1">${g.id ? '<button type="button" class="btn ghost" data-del>Delete</button>' : ''}<span class="spacer"></span><button class="btn">Save</button></div></form>`);
  el.querySelector('[data-del]')?.addEventListener('click', async () => { await api(`/goals/${g.id}`, { method: 'DELETE' }); close(); done(); });
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    const body = { ...d, target_amount: Number(d.target_amount), current_amount: Number(d.current_amount) || 0, account_id: d.account_id ? Number(d.account_id) : null, user_id: d.scope === 'individual' ? Number(d.user_id) : null, target_date: d.target_date || null };
    await api(g.id ? `/goals/${g.id}` : '/goals', { method: g.id ? 'PATCH' : 'POST', body }); close(); done();
  };
}

// The spreadsheet you'd normally keep: categories down, months across. Type a plan; actuals fill in by themselves.
async function planner(box) {
  const p = await api(`/planner?year=${plannerYear}&user_id=${plannerUser}`);
  const mLabel = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short' });
  const rows = p.rows.filter((r) => r.category.kind !== 'transfer');
  const sumPlan = (i, kind) => rows.filter((r) => r.category.kind === kind).reduce((s, r) => s + (r.cells[i].plan ?? 0), 0);
  const sumAct = (i, kind) => rows.filter((r) => r.category.kind === kind).reduce((s, r) => s + r.cells[i].actual, 0);
  const cell = (r, c) => {
    const exp = r.category.kind === 'expense'; const act = exp ? -c.actual : c.actual; const plan = c.plan == null ? null : Math.abs(c.plan);
    const over = exp && plan != null && act > plan;
    return `<td class="cell-plan r"><input type="number" step="1" data-m="${c.month}" data-c="${r.category.id}" value="${plan ?? ''}" placeholder="–" aria-label="${esc(r.category.name)} plan ${c.month}"><span class="act ${over ? 'over' : ''}">${act ? fmt0(act) : ''}</span></td>`;
  };
  box.innerHTML = `<div class="row" style="margin-bottom:12px">
      <div class="seg" style="margin:0"><button data-y="-1">‹</button><button class="on">${plannerYear}</button><button data-y="1">›</button></div>
      <select id="pu" style="width:auto"><option value="0">Household</option>${state.users.map((u) => `<option value="${u.id}" ${u.id === plannerUser ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <span class="spacer"></span><button class="btn small soft" data-fill>Fill from my last 3 months</button></div>
    <p class="muted small" style="margin:0 0 10px">Type what you plan to spend; the small figure under each cell is what actually happened. Amber means over plan. Plans feed straight into your forecast.</p>
    <div class="grid-wrap"><table class="grid"><thead><tr><th>Category</th>${p.months.map((m) => `<th class="r">${mLabel(m)}</th>`).join('')}<th class="r">Year</th></tr></thead>
    <tbody>${['income', 'expense'].map((kind) => rows.filter((r) => r.category.kind === kind).map((r) => {
      const yrPlan = r.cells.reduce((s, c) => s + Math.abs(c.plan ?? 0), 0); const yrAct = r.cells.reduce((s, c) => s + (kind === 'expense' ? -c.actual : c.actual), 0);
      return `<tr><td><span class="dot" style="background:${r.category.color}"></span> ${esc(r.category.name)}</td>${r.cells.map((c) => cell(r, c)).join('')}<td class="r"><b>${fmt0(yrPlan)}</b><span class="act">${fmt0(yrAct)}</span></td></tr>`;
    }).join('')).join('')}</tbody>
    <tfoot><tr><td>Left over (plan)</td>${p.months.map((m, i) => { const has = rows.some((r) => r.cells[i].plan != null); const v = sumPlan(i, 'income') - sumPlan(i, 'expense'); return `<td class="r money ${v < 0 ? '' : 'in'}">${has ? fmt0(v) : '–'}<span class="act">${fmt0(sumAct(i, 'income') + sumAct(i, 'expense'))}</span></td>`; }).join('')}<td></td></tr></tfoot></table></div>`;
  on(box, 'click', '[data-y]', (e, b) => { plannerYear += Number(b.dataset.y); planner(box); });
  box.querySelector('#pu').onchange = (e) => { plannerUser = Number(e.target.value); planner(box); };
  box.querySelector('[data-fill]').onclick = async () => { await api('/planner/autofill', { method: 'POST', body: { year: plannerYear, user_id: plannerUser } }); toast('Filled empty future months from your recent averages'); planner(box); };
  box.addEventListener('change', async (e) => {
    const i = e.target; if (!i.dataset.m) return;
    const kind = state.cats.find((c) => c.id === Number(i.dataset.c))?.kind;
    const v = i.value === '' ? null : (kind === 'income' ? 1 : -1) * Math.abs(Number(i.value));
    try { await api('/planner', { method: 'PUT', body: { month: i.dataset.m, category_id: Number(i.dataset.c), user_id: plannerUser, amount: v } }); } catch (err) { fail(err); }
  });
  // spreadsheet-style keyboard: Enter moves down, arrows move between cells
  box.addEventListener('keydown', (e) => {
    const i = e.target; if (!i.dataset?.m) return;
    const td = i.closest('td'), tr = td.parentElement, idx = [...tr.children].indexOf(td);
    let target = null;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.altKey)) target = tr.nextElementSibling?.children[idx];
    if (e.key === 'ArrowUp' && e.altKey) target = tr.previousElementSibling?.children[idx];
    if (e.key === 'Tab') return;
    if (target) { e.preventDefault(); target.querySelector('input')?.focus(); target.querySelector('input')?.select(); }
  });
}
