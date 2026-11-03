// Sign-in & users — First-run setup, signing in (including Home Assistant ingress), sessions, users.
// Each module adds its API routes here; see docs/customising.md.
const crypto = require('crypto');
const { q } = require('../../core/db');
const { config } = require('../../core/config');
const auth = require('../../core/auth');
const { haIdentity } = require('../../core/ingress');
const { seedCategories } = require('../transactions/categorize');
const ai = require('../ai/ai');
const { wrap, err } = require('../../core/http');

// Slow down password guessing: 8 wrong attempts per email or 20 per address in 15 minutes, then a 15-minute pause
const failures = new Map();
const tooMany = (k, max) => { const f = failures.get(k); return f && f.n >= max && Date.now() - f.t < 15 * 60000; };
const failed = (k) => { const f = failures.get(k); failures.set(k, f && Date.now() - f.t < 15 * 60000 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); };

// The Hearth phone app checks an address is really Hearth before opening it. Its connect screen runs from the app
// itself (capacitor://localhost on iPhone/iPad, http://localhost on Android), so only /api/status answers it.
const APP_ORIGINS = ['capacitor://localhost', 'http://localhost', 'https://localhost'];
function allowPhoneApp(req, res) {
  if (APP_ORIGINS.includes(req.headers.origin)) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
}

// Routes that work before signing in
function publicRoutes(api) {
  api.options('/status', (req, res) => { allowPhoneApp(req, res); res.setHeader('Access-Control-Allow-Methods', 'GET'); res.status(204).end(); });
  api.get('/status', (req, res) => {
    allowPhoneApp(req, res);
    const ha = haIdentity(req);
    res.json({ needsSetup: !q.get('SELECT 1 FROM users LIMIT 1'), version: config.version, addon: config.isAddon, ha_user: ha ? { name: ha.name } : null });
  });

  // Opening Hearth from the HA sidebar signs you in as your HA user once linked
  api.post('/ingress-session', wrap(async (req, res) => {
    const ha = haIdentity(req);
    if (!ha) return res.json({ ok: false });
    let u = q.get('SELECT * FROM users WHERE ha_user_id=?', ha.id);
    if (!u && config.autoCreateHaUsers) {
      const hh = q.get('SELECT id FROM households ORDER BY id LIMIT 1');
      if (hh) {
        const uid = Number(q.run('INSERT INTO users(household_id,name,email,pass_hash,role,ha_user_id) VALUES(?,?,?,?,?,?)', hh.id, ha.name, `${ha.username || ha.id}@homeassistant.local`,
          auth.hashPassword(crypto.randomBytes(24).toString('hex')), 'member', ha.id).lastInsertRowid);
        q.run('INSERT INTO people(household_id,name,user_id) VALUES(?,?,?)', hh.id, ha.name, uid);
        u = q.get('SELECT * FROM users WHERE id=?', uid);
      }
    }
    if (!u) return res.json({ ok: false, link: true, ha_user: { name: ha.name } });
    res.json({ ok: true, token: auth.createSession(u.id) });
  }));

  api.post('/setup', wrap(async (req, res) => {
    if (q.get('SELECT 1 FROM users LIMIT 1')) throw err('Already set up', 403);
    const { household, name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) throw err('Name, email and a password of 8+ characters are required');
    const hid = Number(q.run('INSERT INTO households(name) VALUES(?)', household || `${name}'s household`).lastInsertRowid);
    const uid = Number(q.run('INSERT INTO users(household_id,name,email,pass_hash,role,ha_user_id) VALUES(?,?,?,?,?,?)', hid, name, email.toLowerCase(), auth.hashPassword(password), 'admin', haIdentity(req)?.id || null).lastInsertRowid);
    q.run('INSERT INTO people(household_id,name,user_id,color) VALUES(?,?,?,?)', hid, name, uid, '#3b82f6');
    seedCategories(hid);
    q.run('INSERT INTO accounts(household_id,owner_user_id,name,type) VALUES(?,?,?,?)', hid, uid, 'Cash', 'cash');
    res.json({ token: auth.createSession(uid) });
  }));
  api.post('/login', wrap(async (req, res) => {
    const { email, password } = req.body;
    const ek = `e:${String(email || '').toLowerCase()}`, ik = `i:${req.socket.remoteAddress}`;
    if (tooMany(ek, 8) || tooMany(ik, 20)) throw err('Too many wrong passwords — wait 15 minutes and try again', 429);
    const u = q.get('SELECT * FROM users WHERE email=?', String(email || '').toLowerCase());
    if (!u || !auth.verifyPassword(password || '', u.pass_hash)) { failed(ek); failed(ik); throw err('Email or password is wrong', 401); }
    failures.delete(ek);
    const ha = haIdentity(req);
    if (ha && !u.ha_user_id && !q.get('SELECT 1 FROM users WHERE ha_user_id=?', ha.id)) q.run('UPDATE users SET ha_user_id=? WHERE id=?', ha.id, u.id);
    res.json({ token: auth.createSession(u.id) });
  }));
}

// Routes for signed-in users
function routes(api) {
  api.post('/logout', (req, res) => { auth.endSession(req.user.token); res.json({ ok: true }); });
  api.get('/security', (req, res) => res.json({ encryption: 'AES-256-GCM', key_file: process.env.HEARTH_SECRET_KEY ? 'environment variable' : 'hearth.key in the data folder',
    sessions: auth.sessionCount(req.user.id), session_days: 30, https: req.secure || req.headers['x-forwarded-proto'] === 'https' || !!req.headers['x-ingress-path'] }));
  api.post('/security/sign-out-others', (req, res) => res.json({ ended: auth.endOtherSessions(req.user.id, req.user.token) }));
  api.get('/me', (req, res) => res.json({ user: (({ token, ...u }) => u)(req.user), household: q.get('SELECT * FROM households WHERE id=?', req.hid),
    addon: config.isAddon, ha: require('../homeassistant/ha').available(req.hid), ha_linked: !!q.get('SELECT ha_user_id FROM users WHERE id=?', req.user.id)?.ha_user_id,
    ai: (() => { const c = ai.cfg(req.hid); return { enabled: c.enabled, vision: !!c.visionModel, features: c.features }; })() }));
  // users
  api.get('/users', (req, res) => res.json(q.all('SELECT id,name,email,role,color,created_at FROM users WHERE household_id=?', req.hid)));
  api.post('/users', wrap(async (req, res) => {
    if (req.user.role !== 'admin') throw err('Only an admin can add people', 403);
    const { name, email, password, color, role } = req.body;
    if (!password || password.length < 8) throw err('Password must be 8+ characters');
    const uid = Number(q.run('INSERT INTO users(household_id,name,email,pass_hash,role,color) VALUES(?,?,?,?,?,?)', req.hid, name, email.toLowerCase(), auth.hashPassword(password), role || 'member', color || '#ec4899').lastInsertRowid);
    q.run('INSERT INTO people(household_id,name,user_id,color) VALUES(?,?,?,?)', req.hid, name, uid, color || '#ec4899');
    res.json({ id: uid });
  }));
  api.patch('/users/:id', wrap(async (req, res) => {
    if (req.user.role !== 'admin' && Number(req.params.id) !== req.user.id) throw err('Not allowed', 403);
    const { name, color, password, role } = req.body;
    if (name) q.run('UPDATE users SET name=? WHERE id=? AND household_id=?', name, req.params.id, req.hid);
    if (color) q.run('UPDATE users SET color=? WHERE id=? AND household_id=?', color, req.params.id, req.hid);
    if (password) {
      if (String(password).length < 8) throw err('Password must be 8+ characters');
      if (q.run('UPDATE users SET pass_hash=? WHERE id=? AND household_id=?', auth.hashPassword(password), req.params.id, req.hid).changes)
        auth.endOtherSessions(Number(req.params.id), Number(req.params.id) === req.user.id ? req.user.token : null); // a new password signs out other devices
    }
    if (role && req.user.role === 'admin') q.run('UPDATE users SET role=? WHERE id=? AND household_id=?', role, req.params.id, req.hid);
    res.json({ ok: true });
  }));
  api.delete('/users/:id', wrap(async (req, res) => {
    if (req.user.role !== 'admin' || Number(req.params.id) === req.user.id) throw err('Not allowed', 403);
    q.run('DELETE FROM users WHERE id=? AND household_id=?', req.params.id, req.hid); res.json({ ok: true });
  }));
}

module.exports = { name: 'auth', title: 'Sign-in & users', publicRoutes, routes };
