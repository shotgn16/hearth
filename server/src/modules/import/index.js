// Import statements — CSV, OFX/QFX and QIF statement import with preview.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const ING = require('../transactions/ingest');
const scheduler = require('../../jobs/scheduler');
const { wrap } = require('../../core/http');

function parseFile(text, format) {
  const fmt = format || (/<OFX>|<STMTTRN>/i.test(text) ? 'ofx' : /^!Type:/m.test(text) ? 'qif' : 'csv');
  if (fmt === 'ofx') return { format: 'ofx', transactions: ING.parseOFX(text) };
  if (fmt === 'qif') return { format: 'qif', transactions: ING.parseQIF(text) };
  const { rows, delimiter } = ING.parseCSVText(text);
  return { format: 'csv', rows, delimiter, header: rows[0] || [], mapping: ING.guessMapping(rows[0] || []) };
}

// Routes for signed-in users
function routes(api) {
  api.post('/import/preview', wrap(async (req, res) => {
    const p = parseFile(req.body.text, req.body.format);
    if (p.format !== 'csv') return res.json({ format: p.format, count: p.transactions.length, sample: p.transactions.slice(0, 10) });
    const mapping = req.body.mapping || p.mapping;
    const txs = ING.rowsToTransactions(p.rows, mapping, req.body.options || {});
    res.json({ format: 'csv', header: p.header, mapping, rows: p.rows.slice(0, 6), count: txs.length, sample: txs.slice(0, 10),
      range: txs.length ? [txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date), txs.reduce((m, t) => (t.date > m ? t.date : m), txs[0].date)] : null });
  }));
  api.post('/import/commit', wrap(async (req, res) => {
    const p = parseFile(req.body.text, req.body.format);
    let txs = p.format === 'csv' ? ING.rowsToTransactions(p.rows, req.body.mapping || p.mapping, req.body.options || {}) : p.transactions;
    // map bank-provided category names onto ours when they match
    const cats = q.all('SELECT id, name FROM categories WHERE household_id=?', req.hid);
    // Hearth's own recognition wins; the bank's category is only a fallback for merchants Hearth doesn't know
    const { guessCategory, normaliseMerchant } = require('../transactions/categorize');
    txs = txs.map((t) => {
      const own = guessCategory(req.hid, normaliseMerchant(t.description), t.description, t.amount).id;
      const bank = t._category ? cats.find((c) => c.name.toLowerCase().startsWith(String(t._category).toLowerCase().split(/[ &]/)[0]))?.id ?? null : null;
      return { ...t, account_id: req.body.account_id || null, person_id: req.body.person_id || null, category_id: own || bank || null };
    });
    const r = await ING.ingest(req.hid, txs, { source: `import:${p.format}`, userId: req.body.user_id || req.user.id, runWorkflows: req.body.run_workflows !== false });
    await scheduler.afterNewTransactions(req.hid);
    res.json({ added: r.added, skipped: r.skipped });
  }));
}

module.exports = { name: 'import', title: 'Import statements', routes };
