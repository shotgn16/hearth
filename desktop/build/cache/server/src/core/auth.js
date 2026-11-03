const crypto = require('crypto');
const { q } = require('./db');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

const { hashToken } = require('./secrets');
const DAY = 86400000;
const SESSION_DAYS = 30; // signed out after 30 days without opening Hearth; using it keeps you signed in

// Upgrade sessions saved before tokens were hashed
for (const r of q.all('SELECT token FROM sessions WHERE hashed IS NOT 1')) q.run('UPDATE sessions SET token=?, hashed=1 WHERE token=?', hashToken(r.token), r.token);
q.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q.run('INSERT INTO sessions(token,user_id,expires_at,hashed,last_seen) VALUES(?,?,?,1,?)', hashToken(token), userId, new Date(Date.now() + SESSION_DAYS * DAY).toISOString(), new Date().toISOString());
  return token;
}
const endSession = (token) => q.run('DELETE FROM sessions WHERE token=?', hashToken(token));
// Sign a user out everywhere except (optionally) the session making the request
const endOtherSessions = (userId, keepToken) => q.run('DELETE FROM sessions WHERE user_id=? AND token IS NOT ?', userId, keepToken ? hashToken(keepToken) : null).changes;
const sessionCount = (userId) => q.get('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND expires_at > ?', userId, new Date().toISOString()).n;

function authMiddleware(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : null;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Not signed in' });
  const h = hashToken(token), now = new Date();
  const s = q.get(`SELECT s.*, u.household_id, u.name, u.email, u.role, u.color FROM sessions s JOIN users u ON u.id=s.user_id
                   WHERE s.token=? AND s.expires_at > ?`, h, now.toISOString());
  if (!s) return res.status(401).json({ error: 'Session expired' });
  // sliding expiry, written at most once an hour
  if (!s.last_seen || now - new Date(s.last_seen) > 3600000) q.run('UPDATE sessions SET expires_at=?, last_seen=? WHERE token=?', new Date(now.getTime() + SESSION_DAYS * DAY).toISOString(), now.toISOString(), h);
  req.user = { id: s.user_id, household_id: s.household_id, name: s.name, email: s.email, role: s.role, color: s.color, token };
  req.hid = s.household_id;
  next();
}

module.exports = { hashPassword, verifyPassword, createSession, endSession, endOtherSessions, sessionCount, authMiddleware };
