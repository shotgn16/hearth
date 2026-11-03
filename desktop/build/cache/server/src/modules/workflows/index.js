// Workflows — When this happens, if these conditions match, do these things.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const rules = require('./rules');
const { wrap, err, crud } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  crud(api, 'rules', ['name', 'enabled', 'priority', 'trigger', 'match_all', 'conditions', 'actions', 'stop_processing'], { json: ['conditions', 'actions'], order: 'priority, id' });
  api.post('/rules/preview', (req, res) => res.json(rules.previewRule(req.hid, req.body.conditions || [], req.body.match_all !== false)));
  api.post('/rules/:id/apply', wrap(async (req, res) => {
    const r = q.get('SELECT * FROM rules WHERE id=? AND household_id=?', req.params.id, req.hid);
    if (!r || r.trigger !== 'transaction_created') throw err('Only transaction workflows can be applied to past transactions');
    const conds = JSON.parse(r.conditions); const hits = rules.previewRule(req.hid, conds, !!r.match_all, 100000);
    const noNotify = { ...r, actions: JSON.stringify(JSON.parse(r.actions).filter((a) => a.type !== 'notify')) };
    q.run('UPDATE rules SET actions=? WHERE id=?', noNotify.actions, r.id);
    try { for (const t of hits.sample) await rules.runRules(req.hid, 'transaction_created', t, { onlyRuleId: r.id }); }
    finally { q.run('UPDATE rules SET actions=? WHERE id=?', r.actions, r.id); }
    res.json({ applied: hits.count });
  }));
}

module.exports = { name: 'workflows', title: 'Workflows', routes };
