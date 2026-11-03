// Price watch — Watch product prices (PriceRunner or any shop) and time purchases.
// Each module adds its API routes here; see docs/customising.md.
const { q, getSetting } = require('../../core/db');
const prices = require('./prices');
const { wrap, crud } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  crud(api, 'watches', ['user_id', 'query', 'url', 'target_price', 'provider', 'enabled'], { after: async (req, row) => { if (row?.url) prices.checkWatch(row).catch(() => {}); } });
  api.post('/watches/:id/check', wrap(async (req, res) => res.json(await prices.checkWatch(q.get('SELECT * FROM watches WHERE id=? AND household_id=?', req.params.id, req.hid)))));
  api.get('/watch/search', (req, res) => {
    const integ = getSetting(req.hid, 'integrations', { pricerunner: true, url: true });
    res.json(prices.searchLinks(req.query.q || '').filter((l) => !l.provider || integ[l.provider] !== false));
  });
  api.get('/watches/:id/advice', (req, res) => { const w = q.get('SELECT * FROM watches WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ advice: prices.timingAdvice(JSON.parse(w?.history || '[]')) }); });
}

module.exports = { name: 'prices', title: 'Price watch', routes };
