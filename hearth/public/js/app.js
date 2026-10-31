import { state, api, token, setToken, loadRefs, icons, esc, sheet, toast, fail, fmt, niceDate, cat, $, on } from './core.js';
import { renderHome, renderInbox } from './home.js';
import { renderMoney, txSheet } from './money.js';
import { renderPlan } from './plan.js';
import { renderInsights } from './insights.js';
import { renderMore, renderCalendar, renderWatch, renderNotes } from './more.js';
import { renderSubscriptions } from './subs.js';
import { renderExpenses } from './expenses.js';
import { renderReceipts } from './receipts.js';
import { renderAsk } from './ask.js';
import { renderSettings } from './settings.js';

const app = $('#app');
// Inside Home Assistant's ingress panel the URL is session-specific, so skip the offline service worker there
export const inIngress = /\/api\/hassio_ingress\//.test(document.baseURI);
if ('serviceWorker' in navigator && !inIngress) navigator.serviceWorker.register('sw.js').catch(() => {});
try { const th = localStorage.getItem('hl_theme'); if (th) document.documentElement.dataset.theme = th; } catch {}

const ROUTES = {
  '': ['Today', renderHome, 'home'], inbox: ['Needs attention', renderInbox, 'home'], money: ['Money', renderMoney, 'money'],
  plan: ['Plan', renderPlan, 'plan'], insights: ['Insights', renderInsights, 'insights'], more: ['More', renderMore, 'more'],
  calendar: ['Events & costs', renderCalendar, 'more'], subscriptions: ['Regular payments', renderSubscriptions, 'more'], expenses: ['Unexpected & work', renderExpenses, 'more'], receipts: ['Email receipts', renderReceipts, 'more'],
  watch: ['Price watch', renderWatch, 'more'], ask: ['Ask Hearth', renderAsk, 'more'], notes: ['Notes', renderNotes, 'more'],
  settings: ['Settings', renderSettings, 'more'],
};

function shell() {
  const nav = [['', 'Today', icons.home], ['money', 'Money', icons.money], ['plan', 'Plan', icons.plan], ['insights', 'Insights', icons.insights]];
  const extra = [['inbox', 'Needs attention', icons.inbox], ['calendar', 'Events & costs', icons.calendar], ['subscriptions', 'Regular payments', icons.repeat], ['expenses', 'Unexpected & work', icons.alert], ['receipts', 'Email receipts', icons.mail],
    ['watch', 'Price watch', icons.watch], ['ask', 'Ask Hearth', icons.ai], ['notes', 'Notes', icons.note], ['settings', 'Settings', icons.settings]];
  app.innerHTML = `<div class="shell">
    <nav class="rail" aria-label="Main">
      <div class="brand"><img src="icon.svg" width="30" height="30" alt="">Hearth</div>
      <button class="jot-wide" data-jot>${icons.jot.replace('<svg', '<svg width="20" height="20"')} Jot a cost</button>
      ${nav.map(([r, l, i]) => `<a href="#/${r}" data-r="${r}">${i}${l}</a>`).join('')}
      <div class="sep"></div>
      ${extra.map(([r, l, i]) => `<a href="#/${r}" data-r="${r}">${i}${l}${r === 'inbox' ? '<span class="badge hidden" data-badge></span>' : ''}</a>`).join('')}
    </nav>
    <main id="view" tabindex="-1"></main>
    <nav class="tabs" aria-label="Main">
      <a href="#/" data-r="">${icons.home}Today<span class="badge hidden" data-badge></span></a>
      <a href="#/money" data-r="money">${icons.money}Money</a>
      <button class="jot" data-jot aria-label="Jot a cost">${icons.jot}</button>
      <a href="#/plan" data-r="plan">${icons.plan}Plan</a>
      <a href="#/more" data-r="more">${icons.more}More</a>
    </nav></div>`;
  on(app, 'click', '[data-jot]', () => jotSheet());
}

export function setBadge(n) {
  state.inboxCount = n;
  document.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = n; b.classList.toggle('hidden', !n); });
}

export async function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/');
  if (parts[0] === 'jot') { location.hash = '#/'; return jotSheet(); }
  document.querySelectorAll('.scrim').forEach((x) => x.remove()); // close any open sheet when moving to another screen
  const r = ROUTES[parts[0]] || ROUTES[''];
  document.querySelectorAll('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === parts[0] || (r[2] === 'more' && a.dataset.r === 'more' && !document.querySelector(`.tabs [data-r="${parts[0]}"]`))));
  const view = $('#view');
  document.title = `${r[0]} · Hearth`;
  view.innerHTML = `<div class="topbar">${r[2] === 'more' && parts[0] !== 'more' ? `<button class="back" onclick="history.back()" aria-label="Back">‹</button>` : ''}<h1>${esc(r[0])}</h1>
    <button class="bell" data-bell aria-label="Notifications">${icons.bell}<span class="badge hidden" data-unread></span></button>
    <button class="avatar" style="background:${state.me.user.color}" title="${esc(state.me.user.name)}" data-me>${esc(state.me.user.name[0])}</button></div><div id="body"></div>`;
  $('[data-me]', view).onclick = () => meSheet();
  $('[data-bell]', view).onclick = () => notificationsSheet();
  api('/notifications').then((n) => { const u = n.filter((x) => !x.read).length; const b = $('[data-unread]', view); if (b) { b.textContent = u; b.classList.toggle('hidden', !u); } }).catch(() => {});
  try { await r[1]($('#body', view), parts.slice(1), new URLSearchParams(query || '')); } catch (e) { $('#body', view).innerHTML = `<div class="empty"><b>Couldn't load this screen</b>${esc(e.message)}</div>`; }
  view.focus({ preventScroll: true });
}

// ---------- quick jot: the "do it for me" entry point ----------
export function jotSheet(prefill = '') {
  const { el, close } = sheet(`<h2>Jot it down</h2>
    <form id="jf"><textarea class="jot-input" name="text" placeholder="e.g. £12 lunch with Sam" required>${esc(prefill)}</textarea>
    <div class="jot-examples">${['£12 lunch with Sam', 'petrol 48 yesterday', "Ella's dentist £60 next Tue", 'school trip £25 on 14/11', 'want a new TV under 400']
      .map((x) => `<button type="button">${esc(x)}</button>`).join('')}</div>
    <p class="muted small">Write it however it comes out. Hearth works out the amount, date, category and who it's for, and files it as a spend, a future cost or something to watch the price of.</p>
    <div class="row">${state.me.ai?.vision ? '<button class="btn soft" type="button" data-receipt>📷 Scan a receipt</button>' : ''}<span class="spacer"></span><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn" type="submit">File it</button></div></form><div id="jres"></div>`);
  el.querySelector('[data-receipt]')?.addEventListener('click', () => { close(); receiptSheet(); });
  on(el, 'click', '.jot-examples button', (e, b) => { el.querySelector('textarea').value = b.textContent; el.querySelector('textarea').focus(); });
  el.querySelector('textarea').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('form').requestSubmit(); } });
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = el.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Working it out…';
    try {
      const r = await api('/notes', { method: 'POST', body: { text: e.target.text.value } });
      const p = r.parsed, c = cat(p.category_id);
      const what = { spend: 'Added as a spend', planned: 'Added as a future cost', watch: 'Added to price watch' }[p.type] || 'Saved';
      if (r.status === 'filed') {
        close(); toast(`${what}: ${p.description}${p.amount != null ? ` · ${fmt(Math.abs(p.amount))}` : ''}${c ? ` · ${c.name}` : ''}`);
        route();
      } else {
        el.querySelector('#jres').innerHTML = `<div class="parsed"><b>Nearly there — check this</b>
          <p class="small muted">Saved to Needs attention. Fix anything below and file it.</p>
          <form id="fix" class="kv">
            <label class="f"><span>What</span><input type="text" name="description" value="${esc(p.description)}"></label>
            <label class="f"><span>Amount (£)</span><input type="number" step="0.01" name="amount" value="${p.amount != null ? Math.abs(p.amount) : ''}" required></label>
            <label class="f"><span>Date</span><input type="date" name="date" value="${p.date}"></label>
            <label class="f"><span>Type</span><select name="type"><option value="spend">Spent it</option><option value="planned" ${p.type === 'planned' ? 'selected' : ''}>Future cost</option><option value="watch" ${p.type === 'watch' ? 'selected' : ''}>Want to buy</option></select></label>
            <label class="f"><span>Category</span><select name="category_id">${state.cats.map((x) => `<option value="${x.id}" ${x.id === p.category_id ? 'selected' : ''}>${esc(x.icon)} ${esc(x.name)}</option>`).join('')}</select></label>
            <label class="f"><span>For</span><select name="person_id"><option value="">Everyone</option>${state.people.map((x) => `<option value="${x.id}" ${x.id === p.person_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
            <div class="row end" style="grid-column:1/-1"><button class="btn">File it</button></div></form></div>`;
        el.querySelector('#fix').onsubmit = async (ev) => {
          ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
          await api(`/notes/${r.id}/file`, { method: 'POST', body: { parsed: { ...p, ...f, amount: -Math.abs(Number(f.amount)), category_id: Number(f.category_id), person_id: f.person_id ? Number(f.person_id) : null } } });
          close(); toast('Filed'); route();
        };
        btn.disabled = false; btn.textContent = 'File it';
      }
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'File it'; }
  };
}

// Photo of a receipt → your vision model reads it → matched to the bank transaction or added
export function receiptSheet() {
  const { el, close } = sheet(`<h2>Scan a receipt</h2><p class="muted">Take a photo or pick one. Your local vision model reads it; if the bank has already sent that payment, the items are added to it instead of creating a duplicate.</p>
    <label class="surface pad" style="display:block;text-align:center;border:2px dashed var(--line);cursor:pointer;padding:28px"><input type="file" accept="image/*" capture="environment" hidden id="rimg"><b>Take or choose a photo</b></label>
    <div id="rres" style="margin-top:14px"></div>`);
  el.querySelector('#rimg').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const res = el.querySelector('#rres'); res.innerHTML = '<p class="muted">Reading the receipt — this can take a little while on a home server…</p>';
    try {
      const img = await shrink(f, 1400);
      const r = await api('/ai/receipt', { method: 'POST', body: { image: img } });
      const rc = r.receipt;
      res.innerHTML = `<div class="parsed"><b>${esc(rc.merchant || 'Receipt')} · ${fmt(rc.total)}</b><p class="small muted">${r.matched ? 'Matched to the payment your bank already sent — items added to its notes.' : 'Added as a new spend.'}</p>
        ${(rc.items || []).length ? `<ul class="small">${rc.items.slice(0, 12).map((i) => `<li>${esc(i.name)} · ${fmt(i.price)}</li>`).join('')}</ul>` : ''}<div class="row end"><button class="btn" data-close>Done</button></div></div>`;
      route();
    } catch (err) { res.innerHTML = `<p>${esc(err.message)}</p>`; }
  };
}
function shrink(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85)); URL.revokeObjectURL(img.src);
    }; img.onerror = reject; img.src = URL.createObjectURL(file);
  });
}

// Everything Hearth has told you, in one place (the same messages also go to your phones via Home Assistant)
async function notificationsSheet() {
  const list = await api('/notifications');
  const { el } = sheet(`<h2>Notifications</h2>${list.length ? `<ul class="list">${list.map((n) => `<li class="tap" data-go="${esc(n.url || '')}" style="${n.read ? 'opacity:.65' : ''}"><div class="main"><div class="title">${esc(n.title)}</div><div class="meta" style="white-space:normal">${esc(n.body)}</div></div><span class="muted small">${niceDate(n.created_at)}</span></li>`).join('')}</ul>`
    : '<p class="muted">Nothing yet. Budget alerts, new subscriptions, price drops and your morning summary will appear here.</p>'}`);
  on(el, 'click', '[data-go]', (e, li) => { const u = li.dataset.go; const h = u.includes('#') ? u.slice(u.indexOf('#')) : '#/'; location.hash = h; });
  api('/notifications/read', { method: 'POST' }).then(() => document.querySelectorAll('[data-unread]').forEach((b) => b.classList.add('hidden'))).catch(() => {});
}

function meSheet() {
  const { el, close } = sheet(`<h2>${esc(state.me.user.name)}</h2><p class="muted">${esc(state.me.user.email)} · ${esc(state.me.household.name)}</p>
    <div class="row">
    <button class="btn soft" data-a="theme">Light / dark</button><a class="btn soft" href="#/settings" data-close>Settings</a></div>
    <div class="row end" style="margin-top:18px"><button class="btn ghost" data-a="out">Sign out</button></div>`);
  on(el, 'click', '[data-a]', async (e, b) => {
    if (b.dataset.a === 'out') { await api('/logout', { method: 'POST' }).catch(() => {}); setToken(null); location.reload(); }
    if (b.dataset.a === 'theme') {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('hl_theme', next); } catch {}
    }
  });
}

// ---------- auth ----------
async function authScreen() {
  const { needsSetup, ha_user } = await api('/status');
  // Opened from the Home Assistant sidebar: sign in automatically if this HA user is already linked
  if (ha_user) {
    const r = await api('/ingress-session', { method: 'POST', body: {} }).catch(() => ({}));
    if (r.token) { setToken(r.token); return boot(); }
  }
  app.innerHTML = `<div class="auth"><img src="icon.svg" width="56" height="56" alt="">
    <h1>${needsSetup ? 'Set up Hearth' : 'Welcome back'}</h1>
    <p class="muted">${needsSetup ? `Create the first account. You can add your partner or family afterwards. Everything is stored on this server only.${ha_user ? ` It will be linked to your Home Assistant login (${esc(ha_user.name)}), so next time you're signed in automatically.` : ''}`
      : ha_user ? `You're signed in to Home Assistant as ${esc(ha_user.name)}. Sign in to Hearth once to link the two — after that, opening Hearth from the sidebar signs you straight in.` : 'Sign in to your household.'}</p>
    <form id="af">${needsSetup ? `<label class="f"><span>Household name</span><input type="text" name="household" placeholder="The Smiths"></label>
      <label class="f"><span>Your name</span><input type="text" name="name" required autocomplete="name" value="${esc(ha_user?.name || '')}"></label>` : ''}
      <label class="f"><span>Email</span><input type="email" name="email" required autocomplete="email"></label>
      <label class="f"><span>Password${needsSetup ? ' (8+ characters)' : ''}</span><input type="password" name="password" required minlength="${needsSetup ? 8 : 1}" autocomplete="${needsSetup ? 'new-password' : 'current-password'}"></label>
      <button class="btn" style="width:100%">${needsSetup ? 'Create household' : 'Sign in'}</button></form></div>`;
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target));
      const { token: t } = await api(needsSetup ? '/setup' : '/login', { method: 'POST', body });
      setToken(t); boot();
    } catch (err) { fail(err); }
  };
}

async function boot() {
  if (!token()) return authScreen();
  try { state.me = await api('/me'); } catch { return authScreen(); }
  await loadRefs();
  shell();
  window.addEventListener('hashchange', route);
  await route();
  api('/inbox').then((i) => setBadge(i.filter((x) => !x.soft).length)).catch(() => {});
}
boot();

export { txSheet };
