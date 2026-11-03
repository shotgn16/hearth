// Quick notes — Jot it down: free-text notes turned into spends, planned costs and price watches.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const notes = require('./notes');
const ai = require('../ai/ai');
const scheduler = require('../../jobs/scheduler');
const { wrap } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  api.get('/notes', (req, res) => res.json(q.all('SELECT * FROM notes WHERE household_id=? ORDER BY id DESC LIMIT 200', req.hid).map((n) => ({ ...n, parsed: JSON.parse(n.parsed || '{}') }))));
  api.post('/notes', wrap(async (req, res) => {
    const out = await notes.processNote(req.hid, req.user.id, req.body.text, { useAI: req.body.use_ai !== false && ai.cfg(req.hid).enabled && ai.cfg(req.hid).features.smart_notes, accountId: req.body.account_id });
    if (out.created?.kind === 'transaction') scheduler.afterNewTransactions(req.hid).catch(() => {});
    res.json(out);
  }));
  api.post('/notes/:id/file', wrap(async (req, res) => res.json(await notes.fileNote(req.hid, req.user.id, Number(req.params.id), req.body.parsed, req.body.account_id))));
  api.delete('/notes/:id', (req, res) => { q.run('DELETE FROM notes WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });
}

module.exports = { name: 'notes', title: 'Quick notes', routes };
