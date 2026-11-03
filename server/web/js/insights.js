import { state, api, esc, fmt, fmt0, niceDate, on, iso, token } from './core.js';
import { lineChart, barChart } from './charts.js';
import { md } from './ask.js';

let tab = 'overview', horizonTab = 'months';
const YEAR_COLORS = ['#b8c4bd', '#7d8a84', '#3c6e9e', '#d9962b', '#2f7d5b'];

export async function renderInsights(el, parts = []) {
  if (parts[0]) tab = parts[0];
  el.innerHTML = `<div class="seg">${[['overview', 'This month'], ['trends', 'Year on year'], ['forecast', 'Looking ahead'], ['reports', 'Reports'], ...(state.me.ai?.enabled ? [['reviews', 'AI reviews']] : [])].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="ib"></div>`;
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; renderInsights(el, []); });
  const box = el.querySelector('#ib');
  if (tab === 'overview') return overview(box);
  if (tab === 'trends') return trends(box);
  if (tab === 'forecast') return forecast(box);
  if (tab === 'reviews') return reviews(box);
  return reports(box);
}

async function overview(box) {
  const d = await api('/insights');
  const total = d.thisMonth.total, max = d.thisMonth.categories[0]?.total || 1;
  const m = d.months.slice(-12);
  box.innerHTML = `<div class="grid2" style="margin-top:0"><div>
      <section><h3>Where it went this month · ${fmt0(total)}</h3><div class="surface pad catbars">${d.thisMonth.categories.map((c) => `<div class="cb"><span>${esc(c.icon || '')} ${esc(c.name)} <span class="muted small">· ${c.n}</span></span><b class="money">${fmt(c.total)}</b>
        <div class="bar"><i style="width:${c.total / max * 100}%;background:${c.color}"></i></div></div>`).join('') || '<p class="muted">No spending yet this month.</p>'}</div></section>
    </div><div>
      <section><h3>Worth knowing</h3>${d.cards.map((c) => `<div class="insight ${c.tone}"><b>${esc(c.title)}</b><span>${esc(c.body)}</span></div>`).join('') || '<p class="muted">Nothing unusual.</p>'}</section>
      <section style="margin-top:22px"><h3>Top places · last 90 days</h3><div class="surface"><ul class="list">${d.topMerchants.map((t) => `<li><div class="main"><div class="title">${esc(t.merchant)}</div><div class="meta">${t.n} visits</div></div><div class="amt">${fmt(t.total)}</div></li>`).join('')}</ul></div></section>
    </div></div>
    <section style="margin-top:26px"><h3>Last 12 months</h3><div class="surface pad">${barChart(m.map((x) => niceDate(`${x.month}-01`, { month: 'short' })), [{ name: 'In', color: 'var(--green)', values: m.map((x) => x.income) }, { name: 'Out', color: 'var(--ink-2)', values: m.map((x) => x.spending) }])}</div></section>`;
}

async function trends(box) {
  const years = (await api('/yearly')).slice(-5);
  const cur = String(new Date().getFullYear());
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  box.innerHTML = `<div class="stat-row">${years.slice(-3).reverse().map((y) => `<div><b>${fmt0(y.spending)}</b><span>spent in ${y.year}${y.year === cur ? ' so far' : ''} · saved ${fmt0(y.saved)}</span></div>`).join('')}</div>
    <section><h3>Monthly spending, year against year</h3><div class="surface pad">${lineChart(months, years.map((y, i) => ({ name: y.year, color: YEAR_COLORS[YEAR_COLORS.length - years.length + i], width: y.year === cur ? 3 : 1.8,
      values: y.months.map((v, mi) => ((y.year === cur && mi > new Date().getMonth()) || !v ? null : v)) })))}</div></section>
    <section style="margin-top:22px"><h3>Each year</h3><div class="grid-wrap"><table class="grid"><thead><tr><th>Year</th>${months.map((m) => `<th class="r">${m}</th>`).join('')}<th class="r">Spent</th><th class="r">In</th><th class="r">Saved</th></tr></thead>
      <tbody>${years.map((y) => `<tr><td><b>${y.year}</b></td>${y.months.map((v) => `<td class="r">${v ? fmt0(v) : ''}</td>`).join('')}<td class="r"><b>${fmt0(y.spending)}</b></td><td class="r in">${fmt0(y.income)}</td><td class="r">${fmt0(y.saved)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

async function forecast(box) {
  const f = await api('/forecast?months=24&years=5');
  const body = () => {
    if (horizonTab === 'weeks') return lineChart(f.daily.map((d) => niceDate(d.date)), [{ name: 'Balance', color: 'var(--amber)', values: f.daily.map((d) => d.balance) }], { area: true });
    if (horizonTab === 'months') return lineChart(f.monthly.map((m) => niceDate(`${m.month}-01`, { month: 'short', year: '2-digit' })), [{ name: 'Balance', color: 'var(--amber)', values: f.monthly.map((m) => m.balance) }, { name: 'Spending', color: 'var(--ink-2)', values: f.monthly.map((m) => m.spending), dash: true }, { name: 'Income', color: 'var(--green)', values: f.monthly.map((m) => m.income), dash: true }]);
    return lineChart([String(new Date().getFullYear()), ...f.yearly.map((y) => String(y.year))], [{ name: 'Balance', color: 'var(--amber)', values: [f.balance, ...f.yearly.map((y) => y.balance)] }], { area: true });
  };
  box.innerHTML = `<div class="stat-row"><div><b>${fmt0(f.balance)}</b><span>across all accounts now</span></div><div><b class="in">${fmt0(f.avgIncome)}</b><span>typical monthly income</span></div>
      <div><b>${fmt0(f.avgSpending)}</b><span>typical monthly spending</span></div><div><b>${fmt0(f.subscriptionsMonthly)}</b><span>of that is regular payments</span></div></div>
    <div class="seg">${[['weeks', 'Next 8 weeks'], ['months', 'Next 2 years'], ['years', 'Next 5 years']].map(([k, l]) => `<button data-h="${k}" class="${horizonTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="surface pad" id="fc">${body()}</div>
    <p class="muted small">Built from your regular payments (on their exact dates), seasonal patterns from past years, typical income, your Year planner and any event budgets. Change a plan or add an event and this updates.</p>
    <section style="margin-top:18px"><h3>Month by month</h3><div class="grid-wrap"><table class="grid"><thead><tr><th>Month</th><th class="r">Income</th><th class="r">Spending</th><th class="r">Of which events</th><th class="r">Balance</th></tr></thead>
    <tbody>${f.monthly.map((m) => `<tr><td>${niceDate(`${m.month}-01`, { month: 'long', year: 'numeric' })}</td><td class="r in">${fmt0(m.income)}</td><td class="r">${fmt0(m.spending)}</td><td class="r">${m.events ? fmt0(m.events) : ''}</td><td class="r"><b>${fmt0(m.balance)}</b></td></tr>`).join('')}</tbody></table></div></section>`;
  on(box, 'click', '[data-h]', (e, b) => { horizonTab = b.dataset.h; box.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('on', x === b)); box.querySelector('#fc').innerHTML = body(); });
}

// Pivot table builder — the spreadsheet "pivot" without the spreadsheet
const R = { rows: 'category', cols: 'month', measure: 'spending', from: `${new Date().getFullYear()}-01-01`, to: '', user_id: '', person_id: '' };
async function reports(box) {
  const dims = [['category', 'Category'], ['merchant', 'Merchant'], ['person', 'Person'], ['user', 'Spent by'], ['account', 'Account'], ['event', 'Event'], ['kind', 'Kind'], ['month', 'Month'], ['week', 'Week'], ['year', 'Year'], ['weekday', 'Weekday']];
  const sel = (name, list, v, extra = '') => `<select name="${name}">${extra}${list.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  box.innerHTML = `<form class="kv" id="rf" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
    <label class="f"><span>Rows</span>${sel('rows', dims, R.rows)}</label><label class="f"><span>Columns</span>${sel('cols', [['none', 'Nothing (just totals)'], ...dims], R.cols)}</label>
    <label class="f"><span>Show</span>${sel('measure', [['spending', 'Spending'], ['income', 'Income'], ['net', 'Net'], ['count', 'Number of transactions'], ['average', 'Average amount']], R.measure)}</label>
    <label class="f"><span>From</span><input type="date" name="from" value="${R.from}"></label><label class="f"><span>To</span><input type="date" name="to" value="${R.to}"></label>
    <label class="f"><span>Spent by</span><select name="user_id"><option value="">Everyone</option>${state.users.map((u) => `<option value="${u.id}" ${String(u.id) === R.user_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
  </form><div id="pv"></div>`;
  const run = async () => {
    Object.assign(R, Object.fromEntries(new FormData(box.querySelector('#rf'))));
    const p = await api('/pivot', { method: 'POST', body: { rows: R.rows, cols: R.cols, measure: R.measure, from: R.from || null, to: R.to || null, filter: { user_id: R.user_id || null } } });
    const f = R.measure === 'count' ? (v) => v.toLocaleString() : fmt0;
    box.querySelector('#pv').innerHTML = `<div class="row" style="margin:4px 0 10px"><span class="muted small">${p.rows.length} rows</span><span class="spacer"></span><button class="btn small ghost" data-csv>Download CSV</button></div>
      <div class="grid-wrap"><table class="grid"><thead><tr><th>${esc(dims.find((d) => d[0] === R.rows)[1])}</th>${p.cols.map((c) => `<th class="r">${esc(c)}</th>`).join('')}${p.cols.length > 1 ? '<th class="r">Total</th>' : ''}</tr></thead>
      <tbody>${p.rows.map((r) => `<tr><td>${esc(r.key)}</td>${r.cells.map((v) => `<td class="r">${v ? f(v) : ''}</td>`).join('')}${p.cols.length > 1 ? `<td class="r"><b>${f(r.total)}</b></td>` : ''}</tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td>${p.colTotals.map((v) => `<td class="r">${f(v)}</td>`).join('')}${p.cols.length > 1 ? `<td class="r">${f(p.grandTotal)}</td>` : ''}</tr></tfoot></table></div>`;
    box.querySelector('[data-csv]').onclick = () => {
      const lines = [[R.rows, ...p.cols, 'Total'], ...p.rows.map((r) => [r.key, ...r.cells, r.total])].map((l) => l.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `hearth-report-${iso()}.csv`; a.click();
    };
  };
  box.querySelector('#rf').onchange = run;
  run();
}

async function reviews(box) {
  const list = await api('/ai/reports');
  const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15);
  box.innerHTML = `<div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1">Written by your local model at the start of each month. Nothing leaves your network.</p>
    <select id="rp" style="width:auto">${Array.from({ length: 12 }, (_, i) => { const d = new Date(last.getFullYear(), last.getMonth() - i, 15); const v = iso(d).slice(0, 7); return `<option value="${v}">${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</option>`; }).join('')}</select>
    <button class="btn" data-write>Write review</button></div>
    ${list.length ? list.map((r) => `<article class="surface pad review" style="margin-bottom:16px"><div class="muted small">${r.kind === 'monthly' ? niceDate(`${r.period}-15`, { month: 'long', year: 'numeric' }) : esc(r.title)} · written ${niceDate(r.created_at)}</div>${md(r.content)}</article>`).join('')
      : '<div class="empty"><b>No reviews yet</b>Pick a month and press Write review, or wait for the 1st — Hearth writes one automatically.</div>'}`;
  box.querySelector('[data-write]').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Writing… (a minute or so)';
    try { await api('/ai/review', { method: 'POST', body: { period: box.querySelector('#rp').value } }); reviews(box); } catch (err) { alert(err.message); e.target.disabled = false; e.target.textContent = 'Write review'; }
  };
}
