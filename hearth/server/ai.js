// Local AI via Ollama. Everything is assembled on this server and sent only to YOUR Ollama instance.
//
//  • Assistant: tool-calling agent that looks up your real data (spending, budgets, forecast…), streams its answer,
//    keeps conversation threads, and proposes actions (create budget, watch a price…) that you confirm.
//    Models without tool support fall back to a data snapshot in the prompt.
//  • Per-task models: chat model, fast model (background jobs), vision model (receipts).
//  • Features: categorising, note reading, receipt scanning, natural-language search, describe-a-workflow,
//    monthly reviews, budget suggestions, subscription review, event cost estimates.
const { q, getSetting } = require('./db');
const { config, log } = require('./config');
const A = require('./analytics');
const T = require('./aitools');

const DEFAULT_FEATURES = { auto_categorise: true, monthly_review: true, weekly_checkin: false, smart_notes: true, receipts: true, tools: true };

function cfg(hid) {
  const s = getSetting(hid, 'ollama', {}) || {};
  return {
    url: (s.url || config.ollama.url).replace(/\/$/, ''),
    model: s.model || config.ollama.model,
    fastModel: s.fast_model || config.ollama.fastModel || s.model || config.ollama.model,
    visionModel: s.vision_model ?? config.ollama.visionModel,
    numCtx: Number(s.num_ctx) || 8192,
    keepAlive: s.keep_alive || '10m',
    temperature: s.temperature != null ? Number(s.temperature) : 0.3,
    enabled: s.enabled !== false,
    features: { ...DEFAULT_FEATURES, ...(s.features || {}) },
    persona: s.persona || '',
  };
}

function logAI(hid, task, model, started, ok, detail = '') {
  try { q.run('INSERT INTO ai_log(household_id,task,model,ms,ok,detail) VALUES(?,?,?,?,?,?)', hid, task, model, Date.now() - started, ok ? 1 : 0, String(detail).slice(0, 400)); } catch {}
}

async function post(c, path, body, timeoutMs = 300000) {
  return fetch(`${c.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    .catch((e) => { throw new Error(`Can't reach Ollama at ${c.url} (${e.cause?.code || e.name === 'TimeoutError' ? 'timed out' : e.message}). Check the address in Settings → Local AI.`); });
}

// One non-streaming chat call
async function chat(hid, messages, { model, json = false, temperature, tools, task = 'chat', images } = {}) {
  const c = cfg(hid);
  if (!c.enabled) throw new Error('Local AI is switched off in Settings');
  const m = model || c.model; const started = Date.now();
  if (images?.length) messages = [...messages.slice(0, -1), { ...messages.at(-1), images }];
  const r = await post(c, '/api/chat', { model: m, messages, stream: false, keep_alive: c.keepAlive, ...(json ? { format: 'json' } : {}), ...(tools ? { tools } : {}),
    options: { temperature: temperature ?? c.temperature, num_ctx: c.numCtx } });
  if (!r.ok) { const t = await r.text(); logAI(hid, task, m, started, false, t); const e = new Error(`Ollama (${m}) returned ${r.status}: ${t.slice(0, 200)}`); e.body = t; throw e; }
  const data = await r.json(); logAI(hid, task, m, started, true, `${data.eval_count || 0} tokens`);
  return data.message || { content: '' };
}

// Back-compat helper used by the notes parser: returns text, uses the fast model
async function chatRaw(hid, messages, opts = {}) { return (await chat(hid, messages, { model: cfg(hid).fastModel, task: 'note', ...opts })).content; }

// Ask for JSON and parse it, retrying once if the model wanders off-format
async function askJSON(hid, prompt, { model, task = 'json', system, images, temperature = 0 } = {}) {
  const msgs = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  for (let i = 0; i < 2; i++) {
    const out = (await chat(hid, msgs, { model, json: true, task, images, temperature })).content;
    try { return JSON.parse(out.trim().replace(/^```(json)?|```$/g, '')); } catch { msgs.push({ role: 'assistant', content: out }, { role: 'user', content: 'That was not valid JSON. Reply with only the JSON object.' }); }
  }
  throw new Error('The AI did not return usable data. Try a larger model or rephrase.');
}

// Streaming call; yields tokens via onToken and returns the full message (content + tool_calls)
async function chatStream(hid, messages, { model, tools, onToken, task = 'chat' }) {
  const c = cfg(hid); const m = model || c.model; const started = Date.now();
  const r = await post(c, '/api/chat', { model: m, messages, stream: true, keep_alive: c.keepAlive, ...(tools ? { tools } : {}), options: { temperature: c.temperature, num_ctx: c.numCtx } });
  if (!r.ok) { const t = await r.text(); logAI(hid, task, m, started, false, t); const e = new Error(`Ollama (${m}) returned ${r.status}: ${t.slice(0, 200)}`); e.body = t; throw e; }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = '', content = '', toolCalls = [], tokens = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new Error(j.error);
      if (j.message?.content) { content += j.message.content; onToken?.(j.message.content); }
      if (j.message?.tool_calls?.length) toolCalls.push(...j.message.tool_calls);
      if (j.done) tokens = j.eval_count || 0;
    }
  }
  logAI(hid, task, m, started, true, `${tokens} tokens${toolCalls.length ? `, ${toolCalls.length} tool calls` : ''}`);
  return { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

async function listModels(hid) {
  const c = cfg(hid);
  const get = (p) => fetch(`${c.url}${p}`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Ollama returned ${r.status}`))))
    .catch((e) => { throw new Error(`Can't reach Ollama at ${c.url} (${e.cause?.code || e.message})`); });
  const [tags, ps, ver] = await Promise.all([get('/api/tags'), get('/api/ps').catch(() => ({ models: [] })), get('/api/version').catch(() => ({}))]);
  return { version: ver.version, models: (tags.models || []).map((m) => ({ name: m.name, size: m.size, family: m.details?.family, params: m.details?.parameter_size, quant: m.details?.quantization_level })),
    running: (ps.models || []).map((m) => ({ name: m.name, until: m.expires_at, vram: m.size_vram })), current: c };
}

// ---------- prompts ----------
function snapshot(hid, userId) {
  const f = T.freeUntilPayday(hid);
  const month = q.get(`SELECT ROUND(COALESCE(SUM(-t.amount),0),2) v FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.household_id=? AND t.date>=? AND t.amount<0 AND COALESCE(c.kind,'expense')!='transfer'`, hid, A.iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12))).v;
  const user = q.get('SELECT name FROM users WHERE id=?', userId)?.name;
  const members = q.all('SELECT name FROM users WHERE household_id=?', hid).map((u) => u.name);
  const people = q.all('SELECT name FROM people WHERE household_id=? AND user_id IS NULL', hid).map((p) => p.name);
  const cats = q.all("SELECT name FROM categories WHERE household_id=? AND kind='expense'", hid).map((c) => c.name);
  return `Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${A.iso(new Date())}). You're talking to ${user || 'a household member'}.
Household members: ${members.join(', ')}${people.length ? `. Also tracks spending for: ${people.join(', ')}` : ''}. Currency GBP.
Right now: total balance £${f.balance}; £${f.free} free until ${f.payday ? `payday ${f.payday}` : f.until} (${f.days} days) after £${f.committed} already committed; £${month} spent this month.
Expense categories: ${cats.join(', ')}.`;
}

function fullContext(hid) {
  // Used only when the model can't call tools: give it the important numbers up front
  const ins = A.insights(hid);
  const part = (label, v) => `${label}: ${JSON.stringify(v)}`;
  return [
    part('This month by category', ins.thisMonth.categories.slice(0, 12).map((c) => [c.name, c.total])),
    part('Last 12 months income/spending', ins.months.slice(-12).map((m) => [m.month, m.income, m.spending])),
    part('Top merchants 90 days', ins.topMerchants.map((m) => [m.merchant, m.total])),
    part('Budgets', q.all('SELECT * FROM budgets WHERE household_id=?', hid).map((b) => A.budgetStatus(hid, b)).map((b) => [b.name, b.spent, b.amount, b.period, b.projected])),
    part('Goals', q.all('SELECT * FROM goals WHERE household_id=?', hid).map(A.goalStatus).map((g) => [g.name, g.current_amount, g.target_amount, g.target_date, g.monthly_needed])),
    part('Subscriptions & bills', q.all(`SELECT merchant, amount, cadence, next_date FROM subscriptions WHERE household_id=? AND status='active'`, hid)),
    part('Upcoming events', q.all('SELECT title, substr(start,1,10) d, budget, estimated_cost FROM events WHERE household_id=? AND start>=? ORDER BY start LIMIT 12', hid, A.iso(new Date()))),
    part('Forecast', A.forecast(hid, { months: 6, years: 1 }).monthly.map((m) => [m.month, m.balance])),
  ].join('\n');
}

function systemPrompt(hid, userId, withTools) {
  const c = cfg(hid);
  return `You are Hearth, a calm, practical money assistant for a busy UK household. The people you help have very little headspace: be brief, specific and kind.
Rules:
- Use real numbers from the data. ${withTools ? 'Call tools to look things up instead of guessing; call several if needed. Never invent figures.' : 'Only use the figures given below; if something is not there, say you don\'t have it.'}
- Lead with the answer in one or two sentences, then at most 3 short bullet points of concrete actions.
- Write money as £1,234 (no pence unless under £10). Dates like "Fri 14 Nov".
${withTools ? `- When a clear next step would help (a budget, a goal, a price watch, a planned cost, a recategorisation, a subscription to cancel), call the matching propose_* tool. Nothing changes until they confirm, so mention that a suggestion card is ready.
- For "can I afford" or "should I buy" questions, call check_purchase. For "where/when to buy", suggest sensible UK retailers and seasonal timing (Black Friday late Nov, Boxing Day/January sales, Prime Day in July) and offer a price watch.` : ''}
- You are not a regulated financial adviser; for investments, pensions or debt decisions, suggest speaking to one (MoneyHelper is free).
${c.persona ? `Extra instructions from the household: ${c.persona}` : ''}

${snapshot(hid, userId)}${withTools ? '' : `\n\n${fullContext(hid)}`}`;
}

// ---------- the assistant ----------
function thread(hid, userId, threadId, firstMessage) {
  if (threadId) { const t = q.get('SELECT * FROM ai_threads WHERE id=? AND household_id=? AND user_id=?', threadId, hid, userId); if (t) return t; }
  const title = String(firstMessage).replace(/\s+/g, ' ').slice(0, 60);
  const id = Number(q.run('INSERT INTO ai_threads(household_id,user_id,title) VALUES(?,?,?)', hid, userId, title).lastInsertRowid);
  return q.get('SELECT * FROM ai_threads WHERE id=?', id);
}

/**
 * Run one assistant turn. emit(event) receives:
 *   {type:'thread', id, title} · {type:'tool', name, label} · {type:'token', text} · {type:'action', action} · {type:'done', content} · {type:'error', message}
 */
async function assistant(hid, userId, { message, threadId }, emit) {
  const c = cfg(hid);
  const th = thread(hid, userId, threadId, message);
  emit({ type: 'thread', id: th.id, title: th.title });
  const history = q.all(`SELECT role, content FROM ai_chats WHERE thread_id=? AND role IN ('user','assistant') ORDER BY id DESC LIMIT 12`, th.id).reverse();
  q.run('INSERT INTO ai_chats(household_id,user_id,thread_id,role,content) VALUES(?,?,?,?,?)', hid, userId, th.id, 'user', message);
  q.run('UPDATE ai_threads SET updated_at=CURRENT_TIMESTAMP WHERE id=?', th.id);

  let useTools = c.features.tools !== false;
  const trace = [], actions = [];
  const base = (withTools) => [{ role: 'system', content: systemPrompt(hid, userId, withTools) }, ...history, { role: 'user', content: message }];
  let messages = base(useTools);
  let final = '';
  for (let step = 0; step < 6; step++) {
    let msg;
    try {
      msg = await chatStream(hid, messages, { tools: useTools ? T.DEFINITIONS : undefined, onToken: (t) => emit({ type: 'token', text: t }), task: 'assistant' });
    } catch (e) {
      if (useTools && /tool|function/i.test(e.body || e.message)) { // model can't use tools: fall back to a data snapshot
        log.info('Model has no tool support, falling back to context mode');
        useTools = false; messages = base(false); emit({ type: 'notice', text: 'This model can\'t look things up, so it is answering from a summary of your data.' });
        step--; continue;
      }
      throw e;
    }
    if (!msg.tool_calls?.length) { final = msg.content; break; }
    messages.push(msg);
    for (const call of msg.tool_calls) {
      const name = call.function?.name; let args = call.function?.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      const label = T.describe(name, args); emit({ type: 'tool', name, label }); trace.push(label);
      let result;
      try { result = await T.run(hid, userId, th.id, name, args); } catch (e) { result = { error: e.message }; }
      if (result?.id && result.status === 'pending') { actions.push(result); emit({ type: 'action', action: result }); }
      messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result).slice(0, 12000) });
    }
    if (step === 5) { // safety: ask for a final answer without more tools
      const msg2 = await chatStream(hid, [...messages, { role: 'user', content: 'Please answer now using what you found.' }], { onToken: (t) => emit({ type: 'token', text: t }), task: 'assistant' });
      final = msg2.content;
    }
  }
  q.run('INSERT INTO ai_chats(household_id,user_id,thread_id,role,content,meta) VALUES(?,?,?,?,?,?)', hid, userId, th.id, 'assistant', final, JSON.stringify({ trace, actions: actions.map((a) => a.id) }));
  emit({ type: 'done', content: final });
  return final;
}

// ---------- features ----------
async function aiCategorise(hid, limit = 40) {
  const c = cfg(hid);
  const cats = q.all('SELECT id, name, kind FROM categories WHERE household_id=?', hid);
  const txs = q.all('SELECT id, merchant, description, amount FROM transactions WHERE household_id=? AND category_id IS NULL ORDER BY date DESC LIMIT ?', hid, limit);
  if (!txs.length) return { updated: 0 };
  // Show the model a few of your own past decisions so it follows your style
  const examples = q.all(`SELECT t.merchant, c.name FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.household_id=? AND t.categorised_by IN ('user','learned') GROUP BY t.merchant ORDER BY MAX(t.id) DESC LIMIT 25`, hid);
  const out = await askJSON(hid, `Categorise UK bank transactions. Negative amounts are spending.
Categories (id=name): ${cats.map((x) => `${x.id}=${x.name}`).join(', ')}.
How this household files things: ${examples.map((e) => `${e.merchant} → ${e.name}`).join('; ') || 'no examples yet'}.
Reply as {"results":[{"id":<transaction id>,"category_id":<id>,"confidence":0-1}]}. Use confidence below 0.5 when unsure.
Transactions:\n${txs.map((t) => `${t.id}: ${t.merchant} | ${t.description} | ${t.amount}`).join('\n')}`, { model: c.fastModel, task: 'categorise' });
  let updated = 0;
  for (const r of out.results || []) {
    if ((r.confidence ?? 1) < 0.5) continue;
    if (cats.some((x) => x.id === Number(r.category_id)) && txs.some((t) => t.id === Number(r.id))) {
      q.run(`UPDATE transactions SET category_id=?, categorised_by='ai' WHERE id=? AND category_id IS NULL`, Number(r.category_id), Number(r.id)); updated++;
    }
  }
  return { updated, looked_at: txs.length };
}

// "coffee over £5 in September" → filters for the Money screen
async function nlSearch(hid, text) {
  const cats = q.all('SELECT id, name FROM categories WHERE household_id=?', hid);
  const people = q.all('SELECT id, name FROM people WHERE household_id=?', hid);
  const users = q.all('SELECT id, name FROM users WHERE household_id=?', hid);
  const f = await askJSON(hid, `Today is ${A.iso(new Date())}. Turn this search into filters for a transactions list.
Return JSON with any of: q (text to match merchant/description), from, to (YYYY-MM-DD), category_id (from ${cats.map((c) => `${c.id}=${c.name}`).join(', ')}),
min, max (pounds, positive), direction ("in"|"out"), kind ("subscription"|"bill"|"one_off"), person_id (from ${people.map((p) => `${p.id}=${p.name}`).join(', ')}),
user_id (who spent it, from ${users.map((u) => `${u.id}=${u.name}`).join(', ')}). Omit anything not mentioned. Search: "${text}"`, { model: cfg(hid).fastModel, task: 'search' });
  const allowed = ['q', 'from', 'to', 'category_id', 'min', 'max', 'direction', 'kind', 'person_id', 'user_id'];
  return Object.fromEntries(Object.entries(f).filter(([k, v]) => allowed.includes(k) && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
}

// "notify Sam when we spend over £100 at Amazon" → workflow draft
async function nlRule(hid, text) {
  const cats = q.all('SELECT id, name FROM categories WHERE household_id=?', hid);
  const people = q.all('SELECT id, name FROM people WHERE household_id=?', hid);
  const users = q.all('SELECT id, name FROM users WHERE household_id=?', hid);
  let services = []; try { services = await require('./ha').notifyServices(hid); } catch { /* HA not connected */ }
  const r = await askJSON(hid, `Convert this request into a workflow rule for a finance app. Reply JSON:
{"name": short name, "trigger": one of transaction_created|large_transaction|budget_threshold|subscription_detected|subscription_due|event_upcoming|price_target,
 "match_all": true|false, "conditions": [{"field": merchant|description|abs_amount|direction|category_id|account_id|person_id|user_id|kind|weekday|day_of_month|pct|price|days_until,
 "op": contains|not_contains|equals|not_equals|starts_with|regex|gt|gte|lt|lte|between|in, "value": string}],
 "actions": [{"type": set_category|add_tag|set_person|set_kind|set_color|set_merchant|append_note|notify, "value": string (ids for category/person), "title": for notify, "message": for notify, "ha_services": [notify services to send to, from the list] }]}
Categories: ${cats.map((c) => `${c.id}=${c.name}`).join(', ')}. People: ${people.map((p) => `${p.id}=${p.name}`).join(', ')}. Users: ${users.map((u) => u.name).join(', ')}. Home Assistant notify services (phones are mobile_app_<name>): ${services.join(', ') || 'none'}.
In notify messages you can use {amount}, {merchant}, {name}, {pct}. direction is "out" for spending. Request: "${text}"`, { task: 'workflow' });
  for (const a of r.actions || []) if (a.type === 'notify') a.ha_services = (a.ha_services || []).filter((s) => services.includes(s));
  return { name: r.name || 'New workflow', trigger: r.trigger || 'transaction_created', match_all: r.match_all === false ? 0 : 1, conditions: JSON.stringify(r.conditions || []), actions: JSON.stringify(r.actions || []), priority: 100, stop_processing: 0 };
}

// Read a receipt photo; match it to an existing bank transaction if there is one, otherwise add it
async function readReceipt(hid, userId, imageB64) {
  const c = cfg(hid);
  if (!c.visionModel) throw new Error('Set a vision model in Settings → Local AI to scan receipts');
  const cats = q.all('SELECT id, name FROM categories WHERE household_id=?', hid);
  const r = await askJSON(hid, `Read this receipt. Reply JSON: {"merchant": shop name, "date": "YYYY-MM-DD" or null, "total": number, "items": [{"name": string, "price": number}],
"category_id": best fit from ${cats.map((x) => `${x.id}=${x.name}`).join(', ')}, "summary": very short description of what was bought}. Today is ${A.iso(new Date())}.`,
  { model: c.visionModel, images: [imageB64.replace(/^data:image\/\w+;base64,/, '')], task: 'receipt' });
  if (!r.total) throw new Error("Couldn't read a total from that photo — try a flatter, brighter picture");
  const date = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : A.iso(new Date());
  const itemsNote = (r.items || []).slice(0, 30).map((i) => `${i.name} £${Number(i.price).toFixed(2)}`).join(', ');
  const match = q.get(`SELECT * FROM transactions WHERE household_id=? AND ABS(ABS(amount)-?)<0.02 AND date BETWEEN ? AND ? ORDER BY ABS(julianday(date)-julianday(?)) LIMIT 1`,
    hid, Number(r.total), A.iso(A.addDays(date, -4)), A.iso(A.addDays(date, 4)), date);
  if (match) {
    q.run('UPDATE transactions SET notes=? WHERE id=?', [match.notes, `Receipt: ${r.summary || ''}${itemsNote ? ` — ${itemsNote}` : ''}`].filter(Boolean).join(' · ').slice(0, 2000), match.id);
    return { matched: true, transaction_id: match.id, receipt: r };
  }
  const { ingest } = require('./ingest');
  const res = await ingest(hid, [{ date, amount: -Math.abs(Number(r.total)), description: r.merchant || 'Receipt', category_id: cats.some((x) => x.id === Number(r.category_id)) ? Number(r.category_id) : null,
    notes: `Receipt: ${r.summary || ''}${itemsNote ? ` — ${itemsNote}` : ''}`.slice(0, 2000), account_id: q.get("SELECT id FROM accounts WHERE household_id=? AND type='cash'", hid)?.id || null }], { source: 'receipt', userId });
  return { matched: false, transaction_id: res.ids[0], receipt: r };
}

function monthBounds(period) { const [y, m] = period.split('-').map(Number); return [`${period}-01`, A.iso(new Date(y, m, 0, 12))]; }

async function monthlyReview(hid, period) {
  period ||= A.iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)).slice(0, 7);
  const [from, to] = monthBounds(period);
  const [py, pm] = period.split('-').map(Number);
  const prev = A.iso(new Date(py, pm - 2, 15)).slice(0, 7); const [pf, pt] = monthBounds(prev);
  const ly = `${py - 1}-${String(pm).padStart(2, '0')}`; const [lf, lt] = monthBounds(ly);
  const data = {
    month: period, totals: A.monthlyTotals(hid, 14).filter((m) => [period, prev, ly].includes(m.month)),
    by_category: (await T.run(hid, null, null, 'spending_by_category', { from, to })).categories.slice(0, 12),
    change_vs_previous_month: (await T.run(hid, null, null, 'compare_periods', { a_from: pf, a_to: pt, b_from: from, b_to: to })).biggest_changes.slice(0, 8),
    change_vs_same_month_last_year: (await T.run(hid, null, null, 'compare_periods', { a_from: lf, a_to: lt, b_from: from, b_to: to })).biggest_changes.slice(0, 5),
    budgets: q.all('SELECT * FROM budgets WHERE household_id=?', hid).map((b) => A.budgetStatus(hid, b, new Date(`${to}T12:00:00`))).map((b) => ({ name: b.name, spent: b.spent, amount: b.amount })),
    goals: (await T.run(hid, null, null, 'get_goals', {})),
    new_subscriptions: q.all(`SELECT merchant, amount, cadence FROM subscriptions WHERE household_id=? AND status='active' AND occurrences<=3 AND last_date BETWEEN ? AND ?`, hid, from, to),
    biggest_purchases: q.all(`SELECT date, merchant, ROUND(-amount,2) amount FROM transactions WHERE household_id=? AND date BETWEEN ? AND ? AND amount<0 AND kind='one_off' ORDER BY amount ASC LIMIT 5`, hid, from, to),
  };
  const label = new Date(`${period}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const text = (await chat(hid, [{ role: 'system', content: 'You write short, warm, plain-English monthly money reviews for a busy UK household. No jargon, no lecturing.' },
    { role: 'user', content: `Write the ${label} review from this data. Format:
First line: a one-sentence headline (no heading marks).
Then 3–5 bullet points ("- ") covering: how the month went vs last month and last year, what drove it, budgets that went over or under, progress on goals, anything new (subscriptions, big purchases).
Then one line starting "Next month:" with a single practical suggestion.
Use £ and whole pounds. Data: ${JSON.stringify(data)}` }], { task: 'review', temperature: 0.4 })).content.trim();
  const title = text.split('\n')[0].replace(/^[#*\s]+/, '');
  q.run(`INSERT INTO ai_reports(household_id,kind,period,title,content,data) VALUES(?,?,?,?,?,?) ON CONFLICT(household_id,kind,period) DO UPDATE SET title=excluded.title, content=excluded.content, data=excluded.data, created_at=CURRENT_TIMESTAMP`,
    hid, 'monthly', period, title, text, JSON.stringify(data));
  return q.get('SELECT * FROM ai_reports WHERE household_id=? AND kind=? AND period=?', hid, 'monthly', period);
}

async function budgetSuggestions(hid, userId) {
  const six = A.iso(new Date(new Date().getFullYear(), new Date().getMonth() - 6, 1, 12)), end = A.iso(new Date(new Date().getFullYear(), new Date().getMonth(), 0, 12));
  const stats = q.all(`SELECT c.id, c.name, substr(t.date,1,7) m, SUM(-t.amount) v FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.household_id=? AND t.date BETWEEN ? AND ? AND t.amount<0 AND c.kind='expense' AND t.kind='one_off' GROUP BY c.id, m`, hid, six, end);
  const byCat = {};
  for (const s of stats) (byCat[s.name] ||= []).push(s.v);
  const summary = Object.entries(byCat).map(([name, vals]) => { const avg = vals.reduce((a, b) => a + b, 0) / 6; return { category: name, monthly_avg: Math.round(avg), highest_month: Math.round(Math.max(...vals)), lowest_month: Math.round(Math.min(...vals)), months_with_spend: vals.length }; })
    .filter((x) => x.monthly_avg > 15).sort((a, b) => b.monthly_avg - a.monthly_avg);
  const existing = q.all('SELECT name, amount, category_ids FROM budgets WHERE household_id=?', hid);
  const out = await askJSON(hid, `Suggest up to 5 monthly budgets for this household's day-to-day (non-subscription) spending. Prefer the categories with the most spend and variation; skip ones already budgeted.
Set amounts slightly below the average where there is room to save, at the average for essentials. Reply JSON {"budgets":[{"name","categories":[category names],"amount":number,"reason": one short sentence}]}.
Spending, last 6 months: ${JSON.stringify(summary)}. Existing budgets: ${JSON.stringify(existing)}`, { task: 'budget_suggestions' });
  const actions = await Promise.all((out.budgets || []).slice(0, 5).map((b) => T.run(hid, userId, null, 'propose_budget', { name: b.name, amount: b.amount, period: 'monthly', categories: b.categories, reason: b.reason })));
  return actions.filter((a) => a.id);
}

async function subscriptionReview(hid, userId) {
  const subs = (await T.run(hid, null, null, 'get_subscriptions', {}));
  if (!subs.items.length) return { text: 'No subscriptions found yet.', actions: [] };
  const usage = subs.items.filter((s) => s.type === 'subscription').map((s) => s.merchant);
  const out = await askJSON(hid, `Review these UK household subscriptions and bills. Spot overlaps (e.g. several video streaming services), price rises, things often forgotten, and bills that are usually cheaper if switched (energy, broadband, mobile, insurance).
Reply JSON {"summary": two sentences, "suggestions":[{"merchant": exact merchant from the list, "action": "cancel"|"review"|"switch", "reason": short, "yearly_saving": number or null}]}.
Data: ${JSON.stringify(subs)}`, { task: 'subscription_review' });
  const actions = [];
  for (const s of out.suggestions || []) if (s.action === 'cancel' && usage.some((m) => m.toLowerCase() === String(s.merchant).toLowerCase())) actions.push(await T.run(hid, userId, null, 'propose_cancel_subscription', { merchant: s.merchant, reason: s.reason }));
  q.run(`INSERT INTO ai_reports(household_id,kind,period,title,content,data) VALUES(?,?,?,?,?,?) ON CONFLICT(household_id,kind,period) DO UPDATE SET content=excluded.content, data=excluded.data, created_at=CURRENT_TIMESTAMP`,
    hid, 'subscriptions', A.iso(new Date()).slice(0, 7), 'Subscription check', out.summary || '', JSON.stringify(out.suggestions || []));
  return { summary: out.summary, suggestions: out.suggestions || [], actions: actions.filter((a) => a.id) };
}

async function eventEstimate(hid, eventId) {
  const { eventCostHistory } = require('./calendar');
  const h = eventCostHistory(hid, eventId); if (!h) throw new Error('Event not found');
  const out = await askJSON(hid, `Estimate what this UK household event will cost them. Use their past similar events where available; otherwise typical UK costs. Be realistic, not lavish.
Reply JSON {"estimate": number, "low": number, "high": number, "breakdown": [{"item": string, "amount": number}], "note": one short sentence}.
Event: ${JSON.stringify({ title: h.event.title, date: h.event.start.slice(0, 10), location: h.event.location, description: (h.event.description || '').slice(0, 300) })}.
Past similar events and what they really cost: ${JSON.stringify(h.similar.map((s) => ({ title: s.title, date: s.start.slice(0, 10), spent: s.actual })))}`, { task: 'event_estimate' });
  return out;
}

async function weeklyCheckin(hid) {
  const o = await T.run(hid, null, null, 'get_overview', {});
  const b = await T.run(hid, null, null, 'get_budgets', {});
  const e = await T.run(hid, null, null, 'upcoming_events', { days: 7 });
  const text = (await chat(hid, [{ role: 'user', content: `Write a two-sentence Monday money check-in for a busy household, friendly and specific, max 240 characters. Data: ${JSON.stringify({ o, b, e })}` }], { model: cfg(hid).fastModel, task: 'checkin', temperature: 0.5 })).content.trim();
  return text;
}

module.exports = { cfg, chat, chatRaw, askJSON, listModels, assistant, aiCategorise, nlSearch, nlRule, readReceipt, monthlyReview, budgetSuggestions, subscriptionReview, eventEstimate, weeklyCheckin, DEFAULT_FEATURES };
