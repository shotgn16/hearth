// Calendars & events — Calendar copies (Home Assistant, Microsoft, iCal) and event budgets.
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');
const A = require('../insights/analytics');
const cal = require('./calendar');
const { wrap, crud } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  crud(api, 'calendars', ['user_id', 'name', 'provider', 'url', 'credentials', 'color', 'enabled'], { secret: ['credentials'], after: async (req, row) => { if (row?.url) cal.syncCalendar(row).catch(() => {}); } });
  api.post('/calendars/:id/sync', wrap(async (req, res) => res.json(await cal.syncCalendar(q.get('SELECT * FROM calendars WHERE id=? AND household_id=?', req.params.id, req.hid)))));
  api.get('/events', (req, res) => {
    const from = req.query.from || A.iso(A.addDays(new Date(), -30)), to = req.query.to || A.iso(A.addDays(new Date(), 90));
    res.json(q.all(`SELECT e.*, cl.name calendar_name, COALESCE(e.color, cl.color, '#ec4899') color,
      (SELECT ROUND(COALESCE(SUM(-amount),0),2) FROM transactions WHERE event_id=e.id AND amount<0) spent
      FROM events e LEFT JOIN calendars cl ON cl.id=e.calendar_id WHERE e.household_id=? AND substr(e.start,1,10) BETWEEN ? AND ?
      ${req.query.costed === '1' ? 'AND (e.budget IS NOT NULL OR e.estimated_cost IS NOT NULL OR EXISTS(SELECT 1 FROM transactions WHERE event_id=e.id))' : ''}
      ORDER BY e.start`, req.hid, from, to));
  });
  api.post('/events', (req, res) => {
    const b = req.body;
    const r = q.run('INSERT INTO events(household_id,title,start,end,location,budget,estimated_cost,person_id,color,notes) VALUES(?,?,?,?,?,?,?,?,?,?)',
      req.hid, b.title, b.start, b.end || null, b.location || null, b.budget ?? null, b.estimated_cost ?? null, b.person_id ?? null, b.color || null, b.notes || null);
    res.json(q.get('SELECT * FROM events WHERE id=?', Number(r.lastInsertRowid)));
  });
  api.patch('/events/:id', (req, res) => {
    for (const k of ['title', 'start', 'end', 'location', 'budget', 'estimated_cost', 'person_id', 'color', 'notes']) if (req.body[k] !== undefined) q.run(`UPDATE events SET ${k}=? WHERE id=? AND household_id=?`, req.body[k] === '' ? null : req.body[k], req.params.id, req.hid);
    res.json(q.get('SELECT * FROM events WHERE id=?', req.params.id));
  });
  api.delete('/events/:id', (req, res) => { q.run('DELETE FROM events WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true }); });
  api.get('/events/:id/costs', (req, res) => res.json(cal.eventCostHistory(req.hid, Number(req.params.id))));
  api.post('/events/:id/link', (req, res) => { for (const id of req.body.transaction_ids || []) q.run('UPDATE transactions SET event_id=? WHERE id=? AND household_id=?', req.body.unlink ? null : req.params.id, id, req.hid); res.json({ ok: true }); });
}

module.exports = { name: 'calendar', title: 'Calendars & events', routes };
