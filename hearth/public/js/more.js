import { state, api, esc, fmt, fmt0, niceDate, relDay, catIcon, cat, sheet, toast, fail, on, opts, icons, iso, amt } from './core.js';
import { spark } from './charts.js';
import { jotSheet } from './app.js';
import { md, actionCard, bindActionCards } from './ask.js';

export async function renderMore(el) {
  const items = [['inbox', 'Needs attention', icons.inbox, 'Quick decisions Hearth needs from you'], ['calendar', 'Events & costs', icons.calendar, 'Your calendars, with budgets and real costs'],
    ['subscriptions', 'Regular payments', icons.repeat, 'Subscriptions and bills, found automatically'], ['watch', 'Price watch', icons.watch, 'Things you want, and when to buy them'],
    ['ask', 'Ask Hearth', icons.ai, 'Budget and buying advice from your local AI'], ['notes', 'Notes', icons.note, 'Everything you have jotted'], ['insights', 'Insights', icons.insights, 'Trends, forecasts and reports'],
    ['settings', 'Settings', icons.settings, 'Banks, people, workflows, integrations, local AI']];
  el.innerHTML = `<div class="surface"><ul class="list">${items.map(([r, l, i, d]) => `<li class="tap" onclick="location.hash='#/${r}'"><span class="ico" style="background:var(--paper-2)">${i.replace('<svg', '<svg width="20"')}</span><div class="main"><div class="title">${l}</div><div class="meta">${d}</div></div><span class="muted">›</span></li>`).join('')}</ul></div>`;
}

// ---------- events & costs ----------
let calRange = 'upcoming';
export async function renderCalendar(el) {
  const today = iso();
  const ranges = { upcoming: [today, iso(new Date(Date.now() + 120 * 86400000))], past: [iso(new Date(Date.now() - 365 * 86400000)), today] };
  const [from, to] = ranges[calRange];
  const evs = await api(`/events?from=${from}&to=${to}${calRange === 'past' ? '&costed=1' : ''}`);
  const list = calRange === 'past' ? evs.reverse() : evs;
  el.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="seg" style="margin:0"><button data-r="upcoming" class="${calRange === 'upcoming' ? 'on' : ''}">Upcoming</button><button data-r="past" class="${calRange === 'past' ? 'on' : ''}">Past costs</button></div>
    <span class="spacer"></span><a class="btn small ghost" href="#/settings/calendars">Calendars</a><button class="btn small" data-new>Add event</button></div>
    <p class="muted small" style="margin-top:0">Give an event a budget and it shows up in your forecast. Link spending to it and next time Hearth suggests what it really costs.</p>
    ${list.length ? `<div class="surface"><ul class="list">${list.map((e) => {
      const cost = e.budget ?? e.estimated_cost;
      return `<li class="tap" data-ev="${e.id}"><div class="cal-date" style="width:44px;padding:0"><b>${new Date(e.start).getDate()}</b><span>${niceDate(e.start, { month: 'short' })}</span></div>
        <span class="dot" style="background:${e.color}"></span><div class="main"><div class="title">${esc(e.title)}</div><div class="meta">${relDay(e.start)}${e.calendar_name ? ` · ${esc(e.calendar_name)}` : ''}${e.location ? ` · ${esc(e.location)}` : ''}</div></div>
        <div class="amt">${e.spent ? `${fmt0(e.spent)}${cost ? `<div class="muted small">of ${fmt0(cost)}</div>` : ''}` : cost ? `<span class="muted small">budget</span> ${fmt0(cost)}` : '<span class="muted small">no cost</span>'}</div></li>`;
    }).join('')}</ul></div>` : `<div class="empty"><b>No events ${calRange === 'past' ? 'with costs' : 'coming up'}</b>Connect Google, Outlook or Exchange in <a href="#/settings/calendars">Calendars</a>, or add one yourself.</div>`}`;
  on(el, 'click', '[data-r]', (e, b) => { calRange = b.dataset.r; renderCalendar(el); });
  on(el, 'click', '[data-ev]', (e, li) => eventSheet(Number(li.dataset.ev), () => renderCalendar(el)));
  el.querySelector('[data-new]').onclick = () => {
    const { el: s, close } = sheet(`<h2>Add an event</h2><form class="kv"><label class="f" style="grid-column:1/-1"><span>What</span><input type="text" name="title" required placeholder="Ella's birthday party"></label>
      <label class="f"><span>Date</span><input type="date" name="start" value="${iso()}" required></label><label class="f"><span>Budget (£)</span><input type="number" name="budget"></label>
      <label class="f"><span>For</span><select name="person_id">${opts(state.people, null, (p) => p.name, 'Everyone')}</select></label>
      <div class="row end" style="grid-column:1/-1"><button class="btn">Add</button></div></form>`);
    s.querySelector('form').onsubmit = async (x) => { x.preventDefault(); const d = Object.fromEntries(new FormData(x.target)); await api('/events', { method: 'POST', body: { ...d, budget: d.budget ? Number(d.budget) : null, person_id: d.person_id ? Number(d.person_id) : null } }); close(); renderCalendar(el); };
  };
}

async function eventSheet(id, done) {
  const c = await api(`/events/${id}/costs`); const e = c.event;
  const { el, close } = sheet(`<h2>${esc(e.title)}</h2><p class="muted" style="margin-top:-10px">${niceDate(e.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${e.location ? ` · ${esc(e.location)}` : ''}</p>
    <form class="kv"><label class="f"><span>Budget (£)</span><input type="number" name="budget" value="${e.budget ?? ''}" placeholder="${c.suggested_budget ? `Suggested ${c.suggested_budget}` : ''}"></label>
      <label class="f"><span>For</span><select name="person_id">${opts(state.people, e.person_id, (p) => p.name, 'Everyone')}</select></label>
      <label class="f" style="grid-column:1/-1"><span>Notes</span><input type="text" name="notes" value="${esc(e.notes || '')}"></label>
      <div class="row end" style="grid-column:1/-1">${c.suggested_budget && !e.budget ? `<button type="button" class="btn soft" data-sugg>Use ${fmt0(c.suggested_budget)} (what similar events cost)</button>` : ''}${state.me.ai?.enabled ? '<button type="button" class="btn soft" data-est>Estimate with AI</button>' : ''}<button class="btn">Save</button></div></form>
    <div id="est"></div>
    <h3 style="margin-top:8px">Spent on this · ${fmt(c.spent)}</h3>
    ${c.transactions.length ? `<ul class="list">${c.transactions.map((t) => `<li>${catIcon(cat(t.category_id), 32)}<div class="main"><div class="title">${esc(t.merchant)}</div><div class="meta">${niceDate(t.date)}</div></div><div class="amt">${amt(t.amount)}</div><button class="btn small ghost" data-unlink="${t.id}">✕</button></li>`).join('')}</ul>` : '<p class="muted small">Nothing linked yet.</p>'}
    ${c.nearby.length ? `<h3>Spending around that day — tap to link</h3><ul class="list">${c.nearby.map((t) => `<li class="tap" data-link="${t.id}">${catIcon(cat(t.category_id), 32)}<div class="main"><div class="title">${esc(t.merchant)}</div><div class="meta">${niceDate(t.date)}</div></div><div class="amt">${amt(t.amount)}</div></li>`).join('')}</ul>` : ''}
    ${c.similar.length ? `<h3>Similar past events</h3><ul class="list">${c.similar.map((s) => `<li><div class="main"><div class="title">${esc(s.title)}</div><div class="meta">${niceDate(s.start, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div><div class="amt">${s.actual ? fmt0(s.actual) : '<span class="muted small">no spend linked</span>'}</div></li>`).join('')}</ul>` : ''}`, { wide: true });
  const f = el.querySelector('form');
  el.querySelector('[data-sugg]')?.addEventListener('click', () => { f.budget.value = c.suggested_budget; });
  el.querySelector('[data-est]')?.addEventListener('click', async (x) => {
    x.target.disabled = true; x.target.textContent = 'Thinking…';
    try {
      const r = await api(`/ai/events/${id}/estimate`, { method: 'POST' });
      el.querySelector('#est').innerHTML = `<div class="parsed" style="margin-bottom:12px"><b>About ${fmt0(r.estimate)}</b> <span class="muted small">(${fmt0(r.low)}–${fmt0(r.high)})</span>
        <ul class="small">${(r.breakdown || []).map((b) => `<li>${esc(b.item)} · ${fmt0(b.amount)}</li>`).join('')}</ul>${r.note ? `<p class="small muted">${esc(r.note)}</p>` : ''}
        <button type="button" class="btn small" data-use="${Math.round(r.estimate)}">Use ${fmt0(r.estimate)} as the budget</button></div>`;
      el.querySelector('[data-use]').onclick = (y) => { f.budget.value = y.target.dataset.use; };
    } catch (err) { fail(err); }
    x.target.disabled = false; x.target.textContent = 'Estimate with AI';
  });
  f.onsubmit = async (x) => { x.preventDefault(); const d = Object.fromEntries(new FormData(f)); await api(`/events/${id}`, { method: 'PATCH', body: { budget: d.budget === '' ? '' : Number(d.budget), person_id: d.person_id ? Number(d.person_id) : '', notes: d.notes } }); toast('Saved'); close(); done(); };
  on(el, 'click', '[data-link]', async (x, li) => { await api(`/events/${id}/link`, { method: 'POST', body: { transaction_ids: [Number(li.dataset.link)] } }); close(); eventSheet(id, done); });
  on(el, 'click', '[data-unlink]', async (x, b) => { await api(`/events/${id}/link`, { method: 'POST', body: { transaction_ids: [Number(b.dataset.unlink)], unlink: true } }); close(); eventSheet(id, done); });
}

// ---------- subscriptions & bills ----------
export async function renderSubscriptions(el) {
  const subs = await api('/subscriptions');
  const perYear = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 };
  const active = subs.filter((s) => s.status === 'active');
  const yearly = (list) => list.reduce((s, x) => s + x.amount * (perYear[x.cadence] || 12), 0);
  const group = (title, list) => list.length ? `<section style="margin-bottom:22px"><h3>${title} · ${fmt0(yearly(list) / 12)}/month</h3><div class="surface"><ul class="list">${list.map((s) => `<li>${catIcon({ color: s.category_color, icon: s.category_icon })}
    <div class="main"><div class="title">${esc(s.merchant)}${s.confirmed ? '' : ' <span class="tag" style="background:var(--amber-soft);color:var(--amber-ink)">new</span>'}</div><div class="meta">${s.cadence} · next ${relDay(s.next_date)} · ${fmt0(s.amount * (perYear[s.cadence] || 12))}/year</div></div>
    <div class="amt">${fmt(s.amount)}</div><select data-s="${s.id}" style="width:auto;padding:6px"><option value="">⋯</option><option value="subscription">It's a subscription</option><option value="bill">It's a bill</option><option value="ignored">Not recurring</option><option value="cancelled">I've cancelled it</option></select></li>`).join('')}</ul></div></section>` : '';
  el.innerHTML = `<div class="stat-row"><div><b>${fmt0(yearly(active) / 12)}</b><span>a month goes out on autopilot</span></div><div><b>${fmt0(yearly(active.filter((s) => s.type === 'subscription')))}</b><span>a year on subscriptions</span></div>
    <div class="row" style="align-items:center"><button class="btn soft small" data-detect>Scan again</button>${state.me.ai?.enabled ? '<button class="btn soft small" data-aireview>Ask AI what to cut</button>' : ''}</div></div><div id="subai"></div>
    ${group('Subscriptions', active.filter((s) => s.type === 'subscription'))}${group('Bills', active.filter((s) => s.type === 'bill'))}
    ${group('Marked to cancel', subs.filter((s) => s.status === 'cancelling'))}${group('Stopped or cancelled', subs.filter((s) => ['lapsed', 'cancelled'].includes(s.status)))}
    ${subs.length ? '' : '<div class="empty"><b>Nothing found yet</b>Hearth spots regular payments after it has seen two or three of them.</div>'}`;
  el.querySelector('[data-aireview]')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Reviewing…';
    try {
      const r = await api('/ai/subscription-review', { method: 'POST' });
      el.querySelector('#subai').innerHTML = `<div class="surface pad" style="margin-bottom:20px">${md(r.summary || '')}${r.suggestions.length ? `<ul class="small">${r.suggestions.map((x) => `<li><b>${esc(x.merchant)}</b> — ${esc(x.reason)}${x.yearly_saving ? ` (about ${fmt0(x.yearly_saving)}/yr)` : ''}</li>`).join('')}</ul>` : ''}${r.actions.map(actionCard).join('')}</div>`;
      bindActionCards(el.querySelector('#subai'));
    } catch (err) { fail(err); }
    e.target.disabled = false; e.target.textContent = 'Ask AI what to cut';
  });
  el.querySelector('[data-detect]').onclick = async () => { const r = await api('/subscriptions/detect', { method: 'POST' }); toast(`Found ${r.length} regular payments`); renderSubscriptions(el); };
  el.addEventListener('change', async (e) => {
    const s = e.target.dataset.s; if (!s || !e.target.value) return; const v = e.target.value;
    await api(`/subscriptions/${s}`, { method: 'PATCH', body: ['subscription', 'bill'].includes(v) ? { type: v, confirmed: 1 } : { status: v, confirmed: 1 } });
    renderSubscriptions(el);
  });
}

// ---------- price watch ----------
export async function renderWatch(el) {
  const [list, settings] = await Promise.all([api('/watches'), api('/settings')]);
  const integ = settings.integrations || { pricerunner: true, url: true };
  el.innerHTML = `<form id="ws" class="row" style="margin-bottom:14px"><div class="search">${icons.search}<input type="search" name="q" placeholder="What do you want to buy?" required></div><button class="btn">Find prices</button></form>
    <div id="wsr"></div>
    ${list.length ? `<div class="surface"><ul class="list">${list.map((w) => {
      const hist = JSON.parse(w.history || '[]').map((h) => h.price);
      const good = w.last_price && ((w.target_price && w.last_price <= w.target_price) || (w.lowest_price && w.last_price <= w.lowest_price));
      return `<li style="flex-wrap:wrap"><div class="main" style="min-width:200px"><div class="title">${esc(w.query)}${good ? ' <span class="tag" style="background:var(--green-soft);color:var(--green)">good time to buy</span>' : ''}</div>
        <div class="meta">${w.last_price ? `${fmt(w.last_price)} at ${esc(w.best_store || 'shop')} · lowest ${fmt(w.lowest_price)}` : w.url ? 'Not checked yet' : 'Add a product link to track the price'}${w.target_price ? ` · target ${fmt(w.target_price)}` : ''}${w.last_error ? ` · ${esc(w.last_error)}` : ''}</div></div>
        ${spark(hist, 'var(--amber)')}<div class="row" style="gap:6px">${w.best_url || w.url ? `<a class="btn small soft" href="${esc(w.best_url || w.url)}" target="_blank" rel="noopener">Open</a>` : ''}<button class="btn small soft" data-check="${w.id}">Check</button><button class="btn small ghost" data-edit="${w.id}">Edit</button></div></li>`;
    }).join('')}</ul></div>` : '<div class="empty"><b>Nothing on your list</b>Search for something above, or jot "want a new TV under 400" and Hearth adds it here.</div>'}
    <p class="muted small">Only the product link or search words leave this server — never your financial data. ${integ.pricerunner === false ? 'PriceRunner is switched off in Settings.' : ''}</p>`;
  el.querySelector('#ws').onsubmit = async (e) => {
    e.preventDefault(); const q = e.target.q.value;
    const links = await api(`/watch/search?q=${encodeURIComponent(q)}`);
    el.querySelector('#wsr').innerHTML = `<div class="surface pad" style="margin-bottom:16px"><b>Compare ${esc(q)}</b><p class="muted small">Open a comparison site, copy the product page link you like, then paste it below — Hearth will check the price and tell you when it's a good time to buy.</p>
      <div class="chips">${links.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join('')}</div>
      <form id="wa" class="kv" style="margin-top:12px"><label class="f"><span>Product page link (PriceRunner or any shop)</span><input type="url" name="url" placeholder="https://www.pricerunner.com/pl/…"></label>
      <label class="f"><span>Tell me when it's under (£)</span><input type="number" name="target_price"></label><div class="row end" style="grid-column:1/-1"><button class="btn">Watch it</button></div></form></div>`;
    el.querySelector('#wa').onsubmit = async (x) => {
      x.preventDefault(); const d = Object.fromEntries(new FormData(x.target));
      await api('/watches', { method: 'POST', body: { query: q, url: d.url || null, target_price: d.target_price ? Number(d.target_price) : null, provider: /pricerunner/i.test(d.url || '') ? 'pricerunner' : 'url', user_id: state.me.user.id } });
      toast('Watching — first price check is running'); setTimeout(() => renderWatch(el), 2500);
    };
  };
  on(el, 'click', '[data-check]', async (e, b) => {
    b.disabled = true; b.textContent = 'Checking…';
    try { const r = await api(`/watches/${b.dataset.check}/check`, { method: 'POST' }); sheet(`<h2>${fmt(r.price)} at ${esc(r.store || 'the shop')}</h2>${r.offers?.length > 1 ? `<ul class="list">${r.offers.map((o) => `<li><div class="main">${esc(o.store || 'Shop')}</div><div class="amt">${fmt(o.price)}</div></li>`).join('')}</ul>` : ''}${(r.advice || []).map((a) => `<div class="insight info"><span>${esc(a)}</span></div>`).join('')}<div class="row end"><button class="btn" data-close>OK</button></div>`); renderWatch(el); }
    catch (err) { fail(err); b.disabled = false; b.textContent = 'Check'; }
  });
  on(el, 'click', '[data-edit]', (e, b) => {
    const w = list.find((x) => x.id === Number(b.dataset.edit));
    const { el: s, close } = sheet(`<h2>${esc(w.query)}</h2><form><label class="f"><span>Name</span><input type="text" name="query" value="${esc(w.query)}"></label><label class="f"><span>Product link</span><input type="url" name="url" value="${esc(w.url || '')}"></label>
      <label class="f"><span>Target price (£)</span><input type="number" name="target_price" value="${w.target_price ?? ''}"></label><div class="row"><button type="button" class="btn ghost" data-del>Remove</button><span class="spacer"></span><button class="btn">Save</button></div></form>`);
    s.querySelector('[data-del]').onclick = async () => { await api(`/watches/${w.id}`, { method: 'DELETE' }); close(); renderWatch(el); };
    s.querySelector('form').onsubmit = async (x) => { x.preventDefault(); const d = Object.fromEntries(new FormData(x.target)); await api(`/watches/${w.id}`, { method: 'PATCH', body: { ...d, target_price: d.target_price ? Number(d.target_price) : null, url: d.url || null, provider: /pricerunner/i.test(d.url) ? 'pricerunner' : 'url' } }); close(); renderWatch(el); };
  });
}

// ---------- notes ----------
export async function renderNotes(el) {
  const notes = await api('/notes');
  const label = { spend: 'Spend', planned: 'Future cost', watch: 'Price watch' };
  el.innerHTML = `<div class="row" style="margin-bottom:12px"><p class="muted" style="margin:0;flex:1">Everything you've jotted, and what Hearth made of it.</p><button class="btn" data-jot2>Jot something</button></div>
    ${notes.length ? `<div class="surface"><ul class="list">${notes.map((n) => `<li><div class="main"><div class="title">${esc(n.text)}</div><div class="meta">${relDay(n.created_at)} · ${n.status === 'filed' ? `filed as ${label[n.parsed.type] || 'note'}${n.parsed.amount != null ? ` · ${fmt(Math.abs(n.parsed.amount))}` : ''}${cat(n.parsed.category_id) ? ` · ${esc(cat(n.parsed.category_id).name)}` : ''}` : 'needs a check'}</div></div>
      <button class="btn small ghost" data-del="${n.id}" aria-label="Delete note">✕</button></li>`).join('')}</ul></div>` : '<div class="empty"><b>No notes yet</b>Tap + and type anything like "£30 petrol" or "school trip £25 on Friday".</div>'}`;
  el.querySelector('[data-jot2]').onclick = () => jotSheet();
  on(el, 'click', '[data-del]', async (e, b) => { await api(`/notes/${b.dataset.del}`, { method: 'DELETE' }); b.closest('li').remove(); });
}
