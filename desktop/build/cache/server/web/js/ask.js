// Ask Hearth: streaming chat with your local model, conversation threads, a trace of what it looked up,
// and suggestion cards you confirm before anything changes.
import { state, api, esc, fmt0, sheet, toast, fail, on, token, icons, relDay } from './core.js';

let currentThread = null;

// Very small, safe markdown: paragraphs, bullets, bold
export function md(text) {
  const lines = esc(text).split('\n');
  let html = '', list = false;
  for (const raw of lines) {
    const l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^\s*([-*•]|\d+\.)\s+/.test(l)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${l.replace(/^\s*([-*•]|\d+\.)\s+/, '')}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (l.trim()) html += `<p>${l.replace(/^#+\s*/, '')}</p>`;
  }
  if (list) html += '</ul>';
  return html;
}

export function actionCard(a) {
  if (a.status && a.status !== 'pending') return `<div class="act-card done" data-act="${a.id}"><span>${esc(a.summary)}</span><b>${a.status === 'done' ? esc(a.result || 'Done') : 'Dismissed'}</b></div>`;
  return `<div class="act-card" data-act="${a.id}"><span>${esc(a.summary)}</span><div class="row" style="gap:6px"><button class="btn small" data-confirm="${a.id}">Confirm</button><button class="btn small ghost" data-dismiss-act="${a.id}">Not now</button></div></div>`;
}

export function bindActionCards(root) {
  on(root, 'click', '[data-confirm]', async (e, b) => {
    b.disabled = true;
    try { const r = await api(`/ai/actions/${b.dataset.confirm}/confirm`, { method: 'POST' }); const card = b.closest('.act-card'); card.classList.add('done'); card.querySelector('.row').outerHTML = `<b>${esc(r.result)}</b>`; toast(r.result); }
    catch (err) { fail(err); b.disabled = false; }
  });
  on(root, 'click', '[data-dismiss-act]', async (e, b) => { await api(`/ai/actions/${b.dataset.dismissAct}/dismiss`, { method: 'POST' }); const card = b.closest('.act-card'); card.classList.add('done'); card.querySelector('.row').outerHTML = '<b>Dismissed</b>'; });
}

// Stream an assistant turn; calls handlers as events arrive
async function stream(body, h) {
  const r = await fetch('api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) throw new Error(`Couldn't start the chat (${r.status})`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
      const ev = JSON.parse(line); h[ev.type]?.(ev);
    }
  }
}

const PROMPTS = [
  ['How are we doing this month?', 'Overview'], ['Where could we cut back without noticing?', 'Save'], ['Can we afford a £1,500 holiday in the spring?', 'Afford'],
  ['Should I buy a new washing machine now or wait?', 'Buy'], ['What did we spend on eating out this year compared with last?', 'Compare'], ["What's coming up in the next two weeks that will cost money?", 'Ahead'],
];

export async function renderAsk(el, parts) {
  if (!state.me.ai?.enabled) { el.innerHTML = `<div class="empty"><b>Local AI is switched off</b>Turn it on in <a href="#/settings/ai">Settings → Local AI</a>.</div>`; return; }
  const threads = await api('/ai/threads').catch(() => []);
  if (parts[0] === 'new') currentThread = null; else if (parts[0]) currentThread = Number(parts[0]);
  el.innerHTML = `<div class="ask-layout">
    <aside class="threads"><button class="btn soft small" data-new style="width:100%;margin-bottom:10px">New conversation</button>
      ${threads.map((t) => `<a href="#/ask/${t.id}" class="thread ${t.id === currentThread ? 'on' : ''}"><span>${esc(t.title)}</span><small>${relDay(t.updated_at)}</small></a>`).join('') || '<p class="muted small">Your conversations appear here.</p>'}</aside>
    <div class="ask-main"><div class="chat" id="chat"></div>
      <form class="composer" id="cf"><input type="text" name="m" placeholder="Ask about your money…" autocomplete="off" required><button class="btn" aria-label="Send">Send</button></form></div></div>`;
  const chat = el.querySelector('#chat');
  bindActionCards(chat);
  el.querySelector('[data-new]').onclick = () => { currentThread = null; location.hash = '#/ask/new'; };

  if (currentThread) {
    const t = await api(`/ai/threads/${currentThread}`).catch(() => null);
    if (t) {
      const acts = Object.fromEntries(t.actions.map((a) => [a.id, a]));
      chat.innerHTML = t.messages.map((m) => m.role === 'user' ? `<div class="msg user">${esc(m.content)}</div>`
        : `<div class="msg assistant">${m.meta?.trace?.length ? `<div class="trace">${m.meta.trace.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}${md(m.content)}${(m.meta?.actions || []).map((id) => (acts[id] ? actionCard(acts[id]) : '')).join('')}</div>`).join('');
    }
  } else {
    chat.innerHTML = `<div class="ask-hello"><img src="icon.svg" width="44" height="44" alt=""><h2>What would you like to know?</h2>
      <p class="muted">Answers come from your own model at home, looking things up in your real data. It can suggest budgets, goals or price watches — nothing changes until you confirm.</p>
      <div class="chips" style="justify-content:center">${PROMPTS.map(([p]) => `<button class="chip" data-p>${esc(p)}</button>`).join('')}</div>
      <div class="quick-tools">${[['review', 'Write last month\'s review'], ['budgets', 'Suggest budgets'], ['subs', 'Check my subscriptions'], ['buy', 'Should I buy…?']].concat(state.me.ai.vision ? [['receipt', 'Scan a receipt']] : [])
        .map(([k, l]) => `<button class="btn soft small" data-tool="${k}">${l}</button>`).join('')}</div></div>`;
  }
  scrollTo(0, document.body.scrollHeight);

  const send = async (text) => {
    chat.querySelector('.ask-hello')?.remove();
    chat.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div><div class="msg assistant pending"><div class="trace"></div><div class="body"><span class="typing"><i></i><i></i><i></i></span></div></div>`);
    const box = chat.lastElementChild, body = box.querySelector('.body'), trace = box.querySelector('.trace');
    let content = '', first = true;
    const input = el.querySelector('[name=m]'); input.disabled = true;
    try {
      await stream({ message: text, thread_id: currentThread }, {
        thread: (e) => { if (!currentThread) { currentThread = e.id; history.replaceState(null, '', `#/ask/${e.id}`); } },
        tool: (e) => { trace.insertAdjacentHTML('beforeend', `<span>${esc(e.label)}</span>`); },
        notice: (e) => { trace.insertAdjacentHTML('beforeend', `<span class="warn">${esc(e.text)}</span>`); },
        token: (e) => { if (first) { body.innerHTML = ''; first = false; } content += e.text; body.innerHTML = md(content); scrollTo(0, document.body.scrollHeight); },
        action: (e) => { box.insertAdjacentHTML('beforeend', actionCard(e.action)); },
        error: (e) => { body.innerHTML = `<p>Couldn't get an answer: ${esc(e.message)}</p><p class="small"><a href="#/settings/ai">Check Local AI settings</a></p>`; },
        done: (e) => { if (e.content) body.innerHTML = md(e.content); },
      });
    } catch (err) { body.innerHTML = `<p>${esc(err.message)}</p>`; }
    box.classList.remove('pending'); input.disabled = false; input.focus();
    scrollTo(0, document.body.scrollHeight);
  };
  el.querySelector('#cf').onsubmit = (e) => { e.preventDefault(); const t = e.target.m.value.trim(); if (!t) return; e.target.m.value = ''; send(t); };
  on(el, 'click', '[data-p]', (e, b) => send(b.textContent));
  on(el, 'click', '[data-tool]', (e, b) => quickTool(b.dataset.tool, chat, send));
}

async function quickTool(kind, chat, send) {
  if (kind === 'buy') {
    const { el, close } = sheet(`<h2>Should I buy…?</h2><form class="kv"><label class="f" style="grid-column:1/-1"><span>What</span><input type="text" name="item" required placeholder="Dyson V15 vacuum"></label>
      <label class="f"><span>Price (£)</span><input type="number" name="price" required></label><label class="f"><span>Need it by (optional)</span><input type="text" name="when" placeholder="Christmas"></label>
      <div class="row end" style="grid-column:1/-1"><button class="btn">Ask</button></div></form>`);
    el.querySelector('form').onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); close(); send(`Should I buy ${d.item} for £${d.price}${d.when ? ` (I'd like it by ${d.when})` : ''}? Is it affordable, where's best to buy it in the UK, and is now a good time or should I wait?`); };
    return;
  }
  if (kind === 'receipt') return (await import('./app.js')).receiptSheet();
  const hello = chat.querySelector('.ask-hello'); if (hello) hello.querySelector('.quick-tools').innerHTML = '<span class="muted">Working on it — this can take a minute on a home server…</span>';
  try {
    if (kind === 'review') { const r = await api('/ai/review', { method: 'POST', body: {} }); chat.innerHTML = `<div class="msg assistant"><div class="trace"><span>Monthly review · ${esc(r.period)}</span></div>${md(r.content)}</div>`; }
    if (kind === 'budgets') { const acts = await api('/ai/budget-suggestions', { method: 'POST' }); chat.innerHTML = `<div class="msg assistant"><p>${acts.length ? 'Here are some budgets that fit how you actually spend. Confirm the ones you want:' : 'Your spending is already well covered by budgets.'}</p>${acts.map(actionCard).join('')}</div>`; }
    if (kind === 'subs') { const r = await api('/ai/subscription-review', { method: 'POST' }); chat.innerHTML = `<div class="msg assistant">${md(r.summary || '')}${r.suggestions.length ? `<ul>${r.suggestions.map((s) => `<li><b>${esc(s.merchant)}</b> — ${esc(s.action)}: ${esc(s.reason)}${s.yearly_saving ? ` (save ~${fmt0(s.yearly_saving)}/yr)` : ''}</li>`).join('')}</ul>` : ''}${r.actions.map(actionCard).join('')}</div>`; }
  } catch (err) { chat.innerHTML = `<div class="msg assistant"><p>${esc(err.message)}</p></div>`; }
}
