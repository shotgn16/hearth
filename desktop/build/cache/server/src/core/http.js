// Small helpers shared by every module's routes.
const { q } = require('./db');
const { encrypt } = require('./secrets');

// What the browser sees instead of a stored secret
const MASK = '••••••';
// Household settings whose `.token` is stored encrypted and never sent back
const SECRET_SETTINGS = ['homeassistant', 'ntfy'];

// Wrap an async route: errors become { error } JSON with their status (400 by default)
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(e.status || 400).json({ error: e.message }); });
// Create an error with an HTTP status: throw err('Not found', 404)
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

/**
 * Standard list / create / update / delete routes for a simple household-scoped table.
 *   crud(api, 'tags', ['name', 'color'], { order: 'name' })
 * Options: json (fields stored as JSON), order (SQL ORDER BY), secret (fields stored encrypted and masked),
 * after(req, row) (runs after create/update, e.g. to start a sync).
 */
function crud(api, table, fields, { json = [], order = 'id', after, secret = [] } = {}) {
  const enc = (k, v) => (secret.includes(k) ? (v ? encrypt(typeof v === 'string' ? v : JSON.stringify(v)) : null) : json.includes(k) && typeof v !== 'string' ? JSON.stringify(v ?? []) : v === '' ? null : v);
  const hide = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, secret.includes(k) && v ? MASK : v])) : row);
  api.get(`/${table}`, (req, res) => res.json(q.all(`SELECT * FROM ${table} WHERE household_id=? ORDER BY ${order}`, req.hid).map(hide)));
  api.post(`/${table}`, wrap(async (req, res) => {
    const keys = fields.filter((f) => req.body[f] !== undefined);
    const r = q.run(`INSERT INTO ${table}(household_id${keys.map((k) => `,${k}`).join('')}) VALUES(?${keys.map(() => ',?').join('')})`, req.hid, ...keys.map((k) => enc(k, req.body[k])));
    const row = q.get(`SELECT * FROM ${table} WHERE id=?`, Number(r.lastInsertRowid));
    if (after) await after(req, row);
    res.json(hide(row));
  }));
  api.patch(`/${table}/:id`, wrap(async (req, res) => {
    const keys = fields.filter((f) => req.body[f] !== undefined && !(secret.includes(f) && req.body[f] === MASK));
    if (keys.length) q.run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=? AND household_id=?`, ...keys.map((k) => enc(k, req.body[k])), req.params.id, req.hid);
    const row = q.get(`SELECT * FROM ${table} WHERE id=? AND household_id=?`, req.params.id, req.hid);
    if (after) await after(req, row);
    res.json(hide(row));
  }));
  api.delete(`/${table}/:id`, (req, res) => { q.run(`DELETE FROM ${table} WHERE id=? AND household_id=?`, req.params.id, req.hid); res.json({ ok: true }); });
}

module.exports = { MASK, SECRET_SETTINGS, wrap, err, crud };
