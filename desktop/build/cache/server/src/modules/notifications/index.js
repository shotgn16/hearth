// Notifications — The in-app inbox (bell).
// Each module adds its API routes here; see docs/customising.md.
const { q } = require('../../core/db');

// Routes for signed-in users
function routes(api) {
  api.get('/notifications', (req, res) => res.json(q.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', req.user.id)));
  api.post('/notifications/read', (req, res) => { q.run('UPDATE notifications SET read=1 WHERE user_id=?', req.user.id); res.json({ ok: true }); });
}

module.exports = { name: 'notifications', title: 'Notifications', routes };
