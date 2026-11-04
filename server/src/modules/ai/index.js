// Local AI — Ask Hearth (Ollama), suggestions you confirm, AI categorising and reviews.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const ai = require('./ai');
const aiT = require('./aitools');
const scheduler = require('../../jobs/scheduler');
const { wrap, err } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  // Streams newline-delimited JSON events: thread, tool, token, action, notice, done, error
  api.post('/ai/chat', async (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const emit = (e) => { try { res.write(`${JSON.stringify(e)}\n`); } catch {} };
    try { await ai.assistant(req.hid, req.user.id, { message: String(req.body.message || ''), threadId: Number(req.body.thread_id) || null }, emit); }
    catch (e) { emit({ type: 'error', message: e.message }); }
    res.end();
  });
  api.get('/ai/threads', (req, res) => res.json(q.all('SELECT * FROM ai_threads WHERE household_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 50', req.hid, req.user.id)));
  api.get('/ai/threads/:id', (req, res) => {
    const th = q.get('SELECT * FROM ai_threads WHERE id=? AND household_id=? AND user_id=?', req.params.id, req.hid, req.user.id);
    if (!th) return res.status(404).json({ error: 'Not found' });
    const msgs = q.all(`SELECT role, content, meta, created_at FROM ai_chats WHERE thread_id=? AND role IN ('user','assistant') ORDER BY id`, th.id).map((m) => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null }));
    const actions = q.all('SELECT * FROM ai_actions WHERE thread_id=? ORDER BY id', th.id);
    res.json({ thread: th, messages: msgs, actions });
  });
  api.delete('/ai/threads/:id', (req, res) => { q.run('DELETE FROM ai_chats WHERE thread_id=? AND household_id=?', req.params.id, req.hid); q.run('DELETE FROM ai_threads WHERE id=? AND household_id=? AND user_id=?', req.params.id, req.hid, req.user.id); res.json({ ok: true }); });
  api.get('/ai/actions', (req, res) => res.json(q.all('SELECT * FROM ai_actions WHERE household_id=? AND status=? ORDER BY id DESC LIMIT 50', req.hid, req.query.status || 'pending')));
  api.post('/ai/actions/:id/confirm', wrap(async (req, res) => {
    const a = q.get(`SELECT * FROM ai_actions WHERE id=? AND household_id=? AND status='pending'`, req.params.id, req.hid);
    if (!a) throw err('That suggestion has already been handled', 404);
    const result = aiT.executeAction(req.hid, req.user.id, a);
    q.run(`UPDATE ai_actions SET status='done', result=? WHERE id=?`, result, a.id);
    res.json({ ok: true, result });
  }));
  api.post('/ai/actions/:id/dismiss', (req, res) => { q.run(`UPDATE ai_actions SET status='dismissed' WHERE id=? AND household_id=?`, req.params.id, req.hid); res.json({ ok: true }); });
  api.get('/ai/models', wrap(async (req, res) => res.json(await ai.listModels(req.hid))));
  api.post('/ai/categorise', wrap(async (req, res) => res.json(await ai.aiCategorise(req.hid, Number(req.body.limit) || 40))));
  api.post('/ai/search', wrap(async (req, res) => res.json(await ai.nlSearch(req.hid, String(req.body.q || '')))));
  api.post('/ai/rule', wrap(async (req, res) => res.json(await ai.nlRule(req.hid, String(req.body.text || '')))));
  api.post('/ai/receipt', wrap(async (req, res) => {
    const r = await ai.readReceipt(req.hid, req.user.id, String(req.body.image || ''));
    if (!r.matched) scheduler.afterNewTransactions(req.hid).catch(() => {});
    res.json(r);
  }));
  api.get('/ai/reports', (req, res) => res.json(q.all('SELECT id, kind, period, title, content, created_at FROM ai_reports WHERE household_id=? ORDER BY created_at DESC LIMIT 24', req.hid)));
  api.post('/ai/review', wrap(async (req, res) => res.json(await ai.monthlyReview(req.hid, req.body.period))));
  api.post('/ai/budget-suggestions', wrap(async (req, res) => res.json(await ai.budgetSuggestions(req.hid, req.user.id))));
  api.post('/ai/subscription-review', wrap(async (req, res) => res.json(await ai.subscriptionReview(req.hid, req.user.id))));
  api.post('/ai/events/:id/estimate', wrap(async (req, res) => res.json(await ai.eventEstimate(req.hid, Number(req.params.id)))));
  api.get('/ai/log', (req, res) => res.json(q.all('SELECT * FROM ai_log WHERE household_id=? ORDER BY id DESC LIMIT 100', req.hid)));
  api.post('/ai/undo-categorise', (req, res) => {
    const n = q.run(`UPDATE transactions SET category_id=NULL, categorised_by=NULL WHERE household_id=? AND categorised_by='ai' AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))`,
      req.hid, req.body.ids ? 1 : null, JSON.stringify(req.body.ids || [])).changes;
    res.json({ undone: n });
  });
  api.post('/ai/accept-categorise', (req, res) => {
    const rows = q.all(`SELECT id, merchant, category_id FROM transactions WHERE household_id=? AND categorised_by='ai'`, req.hid);
    const { learnMerchant } = require('../transactions/categorize');
    for (const r of rows) learnMerchant(req.hid, r.merchant, r.category_id);
    q.run(`UPDATE transactions SET categorised_by='learned' WHERE household_id=? AND categorised_by='ai'`, req.hid);
    res.json({ accepted: rows.length });
  });
}

module.exports = { name: 'ai', title: 'Local AI', routes };
