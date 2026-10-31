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

// Recognise the device a person signs in from, so it can be targeted by notification workflows
function parseUA(ua = '') {
  let platform = 'Unknown', browser = 'Browser';
  if (/iPhone/.test(ua)) platform = 'iPhone';
  else if (/iPad/.test(ua)) platform = 'iPad';
  else if (/Android/.test(ua)) platform = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/Windows/.test(ua)) platform = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) platform = 'Mac';
  else if (/CrOS/.test(ua)) platform = 'ChromeOS';
  else if (/Linux/.test(ua)) platform = 'Linux';
  if (/Home ?Assistant/i.test(ua)) browser = 'Home Assistant app';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { platform, browser };
}

function registerDevice(userId, fingerprint, ua) {
  const { platform, browser } = parseUA(ua);
  const existing = q.get('SELECT * FROM devices WHERE user_id=? AND fingerprint=?', userId, fingerprint);
  if (existing) {
    q.run('UPDATE devices SET last_seen=CURRENT_TIMESTAMP, user_agent=?, platform=?, browser=? WHERE id=?', ua, platform, browser, existing.id);
    return existing.id;
  }
  const r = q.run('INSERT INTO devices(user_id,fingerprint,name,platform,browser,user_agent) VALUES(?,?,?,?,?,?)',
    userId, fingerprint, `${platform} · ${browser}`, platform, browser, ua);
  return Number(r.lastInsertRowid);
}

function createSession(userId, deviceId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString();
  q.run('INSERT INTO sessions(token,user_id,device_id,expires_at) VALUES(?,?,?,?)', token, userId, deviceId, expires);
  return token;
}

function authMiddleware(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.headers.cookie || '').match(/hl_token=([a-f0-9]+)/)?.[1];
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const s = q.get(`SELECT s.*, u.household_id, u.name, u.email, u.role, u.color FROM sessions s JOIN users u ON u.id=s.user_id
                   WHERE s.token=? AND s.expires_at > ?`, token, new Date().toISOString());
  if (!s) return res.status(401).json({ error: 'Session expired' });
  req.user = { id: s.user_id, household_id: s.household_id, name: s.name, email: s.email, role: s.role, color: s.color, device_id: s.device_id };
  req.hid = s.household_id;
  if (s.device_id) q.run('UPDATE devices SET last_seen=CURRENT_TIMESTAMP WHERE id=?', s.device_id);
  next();
}

module.exports = { hashPassword, verifyPassword, registerDevice, createSession, authMiddleware, parseUA };
