import { state, api, esc, fmt, fmt0, niceDate, relDay, catIcon, cat, sheet, toast, fail, on, opts } from './core.js';
import { horizon } from './charts.js';
import { setBadge, route } from './app.js';
import { bindActionCards } from './ask.js';

export async function renderHome(el) {
  const d = await api('/dashboard');
  setBadge(d.inboxCount);
  if (!d.insights.months.length && !d.accounts.some((a) => a.balance)) {
    el.innerHTML = `<div class="hero"><p class="greet">Welcome, ${esc(state.me.user.name)}.</p><h2>Let's get your money in, then Hearth does the rest.</h2>
      <p class="sub">Connect your bank or drop in a few old statements. Hearth sorts, categorises and spots subscriptions on its own — you'll only hear about things that need you.</p></div>
      <div class="surface" style="margin-top:22px"><ul class="list">
        <li class="tap" onclick="location.hash='#/settings/banks'"><div class="main"><div class="title">Connect your bank</div><div class="meta">superFin / SimpleFIN or any bank feed</div></div><span class="muted">›</span></li>
        <li class="tap" onclick="location.hash='#/settings/import'"><div class="main"><div class="title">Import statements</div><div class="meta">CSV, OFX or QIF — years of history in one go</div></div><span class="muted">›</span></li>
        <li class="tap" onclick="location.hash='#/settings/people'"><div class="main"><div class="title">Add your partner or family</div><div class="meta">Shared and individual budgets</div></div><span class="muted">›</span></li>
        <li class="tap" onclick="location.hash='#/settings/calendars'"><div class="main"><div class="title">Bring in your calendars</div><div class="meta">Put budgets on birthdays, holidays and trips</div></div><span class="muted">›</span></li>
        <li class="tap" onclick="location.hash='#/settings/ai'"><div class="main"><div class="title">Check your local AI</div><div class="meta">Pick models for chat, background jobs and receipts</div></div><span class="muted">›</span></li>
      </ul></div>`;
    return;
  }
  const f = d.free, h = new Date().getHours();
  const greet = `${h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'}, ${state.me.user.name}.`;
  const until = f.payday ? `payday on ${niceDate(f.payday, { weekday: 'short', day: 'numeric', month: 'short' })}` : `${niceDate(f.until)}`;
  const perDay = f.free / f.days;
  const headline = f.free >= 0
    ? `You've got <span class="money">${fmt0(f.free)}</span> free until ${until}.`
    : `Bills before ${until} come to <span class="money">${fmt0(-f.free)}</span> more than you have to hand.`;
  const sub = f.free >= 0
    ? `That's about ${fmt0(perDay)} a day, after ${fmt0(f.committed)} of bills, subscriptions and planned costs already set aside.`
    : `Moving money from savings or pushing a planned cost back would cover it. Ask Hearth for options.`;
  const low = d.forecast.lowPoint;
  el.innerHTML = `
    <div class="hero"><p class="greet">${esc(greet)}</p><h2>${headline}</h2><p class="sub">${sub}</p></div>
    <div class="horizon">${horizon(d.forecast.daily, { low })}</div>
    <p class="muted small" style="margin:0">Next 8 weeks${low ? ` · lowest point ${fmt0(low.balance)} on ${niceDate(low.date)}` : ''}</p>
    ${d.inboxCount ? `<a class="attention" href="#/inbox"><span class="n">${d.inboxCount}</span> ${d.inboxCount === 1 ? 'thing needs' : 'things need'} a quick decision</a>`
      : `<a class="attention calm" href="#/inbox"><span>✓</span> Nothing needs you right now</a>`}
    <div class="grid2">
      <div>
        <section><h3>Coming up <a href="#/calendar">All events</a></h3>
          <div class="surface"><ul class="list">${d.upcoming.length ? d.upcoming.map((u) => `<li><div class="main"><div class="title">${esc(u.title)}</div><div class="meta">${relDay(u.date)} · ${u.type === 'sub' ? 'regular payment' : 'planned cost'}</div></div><div class="amt">${fmt(u.amount)}</div></li>`).join('')
            : '<li class="muted">Nothing due in the next three weeks.</li>'}</ul></div></section>
        <section style="margin-top:26px"><h3>Worth knowing <a href="#/insights">Insights</a></h3>
          ${d.insights.cards.slice(0, 4).map((c) => `<div class="insight ${c.tone}"><b>${esc(c.title)}</b><span>${esc(c.body)}</span></div>`).join('') || '<p class="muted">Insights appear once there are a few weeks of transactions.</p>'}</section>
      </div>
      <div>
        <section><h3>Budgets <a href="#/plan">Plan</a></h3>
          <div class="surface pad">${d.budgets.length ? d.budgets.map(budgetRow).join('') : '<p class="muted" style="margin:0">No budgets yet. <a href="#/plan">Add one</a> and Hearth will keep an eye on it.</p>'}</div></section>
        ${d.goals.length ? `<section style="margin-top:26px"><h3>Goals</h3><div class="surface pad">${d.goals.map((g) => `<div style="margin-bottom:12px"><div class="row"><b style="flex:1">${esc(g.name)}</b><span class="money small">${fmt0(g.current_amount)} of ${fmt0(g.target_amount)}</span></div>
          <div class="bar" style="margin-top:6px"><i style="width:${g.pct}%;background:${g.color}"></i></div>${g.monthly_needed ? `<div class="muted small" style="margin-top:4px">${fmt0(g.monthly_needed)}/month gets you there by ${niceDate(g.target_date, { month: 'short', year: 'numeric' })}</div>` : ''}</div>`).join('')}</div></section>` : ''}
        <section style="margin-top:26px"><h3>Accounts <a href="#/settings/banks">Connect</a></h3>
          <div class="surface"><ul class="list">${d.accounts.map((a) => `<li><span class="dot" style="background:${a.color};width:10px;height:10px"></span><div class="main"><div class="title">${esc(a.name)}</div><div class="meta">${esc(a.institution || a.type)}</div></div><div class="amt">${fmt(a.balance)}</div></li>`).join('')}</ul></div></section>
      </div>
    </div>`;
}

export function budgetRow(b) {
  const over = b.pct > 100 || !b.on_track;
  const who = b.scope === 'individual' ? state.users.find((u) => u.id === b.user_id)?.name : b.scope === 'person' ? state.people.find((p) => p.id === b.person_id)?.name : null;
  return `<div style="margin-bottom:14px"><div class="row" style="gap:6px"><b style="flex:1">${esc(b.name)}${who ? ` <span class="muted small">· ${esc(who)}</span>` : ''}</b>
    <span class="money small">${fmt0(b.spent)} / ${fmt0(b.amount)}</span></div>
    <div class="bar ${over ? 'over' : ''}" style="margin-top:6px"><i style="width:${Math.min(100, b.pct)}%;${over ? '' : `background:${b.color}`}"></i></div>
    <div class="muted small" style="margin-top:4px">${b.remaining >= 0 ? `${fmt0(b.remaining)} left` : `${fmt0(-b.remaining)} over`} · ${b.days_left ? `${b.days_left} days to go` : 'last day'}${!b.on_track && b.pct <= 100 ? ` · heading for ${fmt0(b.projected)}` : ''}</div></div>`;
}

// ---------- Needs attention: one-tap decisions only ----------
export async function renderInbox(el) {
  const items = await api('/inbox');
  setBadge(items.filter((i) => !i.soft).length);
  if (!items.length) { el.innerHTML = `<div class="empty"><b>All clear</b>Hearth has filed everything it could. New things will show up here only when they need you.</div>`; return; }
  const topCats = state.cats.filter((c) => c.kind === 'expense').slice(0, 40);
  el.innerHTML = `<p class="muted" style="margin-top:-8px">Each decision teaches Hearth, so you'll see fewer of these over time.</p>
    <div class="surface"><ul class="list">${items.map((i) => `<li data-id="${i.id}" style="flex-wrap:wrap">
      <div class="main" style="min-width:200px"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.body)}</div></div>
      <div class="row" style="gap:6px">${actions(i, topCats)}<button class="btn small ghost" data-dismiss="${i.id}" title="Dismiss">✕</button></div></li>`).join('')}</ul></div>`;
  bindActionCards(el);
  on(el, 'click', '[data-aiaccept]', async (e, b) => { const r = await api('/ai/accept-categorise', { method: 'POST' }); toast(`Accepted ${r.accepted} — Hearth will file those merchants the same way from now on`); b.closest('li').remove(); });
  on(el, 'click', '[data-dismiss]', async (e, b) => { await api('/inbox/dismiss', { method: 'POST', body: { id: b.dataset.dismiss } }); b.closest('li').remove(); setBadge(Math.max(0, items.length - 1)); });
  on(el, 'change', 'select[data-cat]', async (e, s) => {
    try {
      const r = await api(`/transactions/${s.dataset.cat}`, { method: 'PATCH', body: { category_id: Number(s.value) } });
      toast(r.also_updated > 1 ? `Done — and ${r.also_updated - 1} more from the same place` : 'Done — Hearth will remember'); s.closest('li').remove();
    } catch (err) { fail(err); }
  });
  on(el, 'click', '[data-sub]', async (e, b) => {
    const [id, yes] = b.dataset.sub.split(':');
    await api(`/subscriptions/${id}`, { method: 'PATCH', body: yes === '1' ? { confirmed: 1 } : { status: 'ignored', confirmed: 1 } });
    toast(yes === '1' ? 'Tracking it' : 'Got it — not a subscription'); b.closest('li').remove();
  });
  on(el, 'click', '[data-event]', (e, b) => {
    const ev = items.find((i) => i.id === `event-${b.dataset.event}`).event;
    const { el: s, close } = sheet(`<h2>${esc(ev.title)}</h2><form><label class="f"><span>Budget for this (£)</span><input type="number" step="1" name="budget" required></label><div class="row end"><button class="btn">Save budget</button></div></form>`);
    s.querySelector('form').onsubmit = async (x) => { x.preventDefault(); await api(`/events/${ev.id}`, { method: 'PATCH', body: { budget: Number(x.target.budget.value) } }); close(); route(); };
  });
  on(el, 'click', '[data-note]', async (e, b) => {
    const it = items.find((i) => i.id === `note-${b.dataset.note}`);
    const { jotSheet } = await import('./app.js'); await api(`/notes/${it.note.id}`, { method: 'DELETE' }); jotSheet(it.note.text);
  });
}

function actions(i, cats) {
  if (i.type === 'categorise') return `<select data-cat="${i.tx.id}" style="width:auto"><option value="">Choose category…</option>${cats.map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select>`;
  if (i.type === 'subscription') return `<button class="btn small" data-sub="${i.sub.id}:1">Yes, track it</button><button class="btn small soft" data-sub="${i.sub.id}:0">No</button>`;
  if (i.type === 'budget') return `<a class="btn small soft" href="#/plan">View</a>`;
  if (i.type === 'event') return `<button class="btn small soft" data-event="${i.event.id}">Set budget</button>`;
  if (i.type === 'note') return `<button class="btn small" data-note="${i.note.id}">Fix</button>`;
  if (i.type === 'ai_check') return `<a class="btn small soft" href="#/money?categorised_by=ai">Review</a><button class="btn small" data-aiaccept>Looks right</button>`;
  if (i.type === 'ai_action') return `<span class="act-card" style="border:0;padding:0;margin:0;background:none" data-act="${i.action.id}"><span class="row" style="gap:6px"><button class="btn small" data-confirm="${i.action.id}">Confirm</button></span></span>`;
  return '';
}
