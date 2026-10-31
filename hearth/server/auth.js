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

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString();
  q.run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', token, userId, expires);
  return token;
}

function authMiddleware(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.headers.cookie || '').match(/hl_token=([a-f0-9]+)/)?.[1];
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const s = q.get(`SELECT s.*, u.household_id, u.name, u.email, u.role, u.color FROM sessions s JOIN users u ON u.id=s.user_id
                   WHERE s.token=? AND s.expires_at > ?`, token, new Date().toISOString());
  if (!s) return res.status(401).json({ error: 'Session expired' });
  req.user = { id: s.user_id, household_id: s.household_id, name: s.name, email: s.email, role: s.role, color: s.color, token };
  req.hid = s.household_id;
  next();
}

module.exports = { hashPassword, verifyPassword, createSession, authMiddleware };
