// Bank connections — SimpleFIN (Synci, superFin, SimpleFIN Bridge) and custom JSON bank feeds.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const { encrypt } = require('../../core/secrets');
const banks = require('./banks');
const scheduler = require('../../jobs/scheduler');
const { wrap, err } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  api.get('/connections', (req, res) => res.json(q.all('SELECT id,provider,name,last_sync,last_error,auto_sync FROM connections WHERE household_id=?', req.hid)));
  api.post('/connections', wrap(async (req, res) => {
    const { provider = 'simplefin', name, setup_token, access_url, history_from, owner_user_id, ...rest } = req.body;
    let config;
    if (provider === 'simplefin') config = { access_url: access_url || await banks.claimSimplefin(setup_token), history_from, owner_user_id };
    else config = { ...rest, history_from, owner_user_id };
    const id = Number(q.run('INSERT INTO connections(household_id,provider,name,config) VALUES(?,?,?,?)', req.hid, provider, name || 'superFin', encrypt(JSON.stringify(config))).lastInsertRowid);
    // the token is already used up, so keep the connection even if the first import fails — "Sync now" retries it
    try {
      const result = await banks.syncConnection(q.get('SELECT * FROM connections WHERE id=?', id), { full: true });
      await scheduler.afterNewTransactions(req.hid);
      res.json({ id, ...result });
    } catch (e) { res.json({ id, added: 0, accounts: 0, error: `Connected, but the first import failed: ${e.message}. Press "Sync now" to try again.` }); }
  }));
  api.post('/connections/:id/sync', wrap(async (req, res) => {
    const c = q.get('SELECT * FROM connections WHERE id=? AND household_id=?', req.params.id, req.hid);
    if (!c) throw err('Not found', 404);
    const r = await banks.syncConnection(c, { full: !!req.body.full });
    await scheduler.afterNewTransactions(req.hid);
    res.json(r);
  }));
  api.patch('/connections/:id', (req, res) => { if (req.body.auto_sync !== undefined) q.run('UPDATE connections SET auto_sync=? WHERE id=? AND household_id=?', req.body.auto_sync ? 1 : 0, req.params.id, req.hid); if (req.body.name) q.run('UPDATE connections SET name=? WHERE id=? AND household_id=?', req.body.name, req.params.id, req.hid); res.json({ ok: true }); });
  api.delete('/connections/:id', (req, res) => { q.run('DELETE FROM connections WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });
}

module.exports = { name: 'banks', title: 'Bank connections', routes };
