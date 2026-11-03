// Account rescue from the command line: list users, set a new password.
const crypto = require('crypto');
const { CliError } = require('./util');

function db() {
  process.removeAllListeners('warning');
  return { q: require('../core/db').q, auth: require('../core/auth') };
}

function list() {
  const { q } = db();
  return q.all('SELECT id, name, email, role FROM users ORDER BY id');
}

function resetPassword({ email, password }, r) {
  if (!email || email === true) throw new CliError('Say whose password to reset: --email you@example.com');
  const { q, auth } = db();
  const u = q.get('SELECT id, name FROM users WHERE email=?', String(email).toLowerCase());
  if (!u) throw new CliError(`No user with the email ${email}. Users: ${list().map((x) => x.email).join(', ') || 'none yet'}`);
  const pw = password && password !== true ? String(password) : crypto.randomBytes(9).toString('base64url');
  if (pw.length < 8) throw new CliError('Passwords need at least 8 characters');
  q.run('UPDATE users SET pass_hash=? WHERE id=?', auth.hashPassword(pw), u.id);
  q.run('DELETE FROM sessions WHERE user_id=?', u.id);
  r.ok(`New password for ${u.name} (${email}): ${pw}`);
  r.info('They have been signed out everywhere. Ask them to change it under Settings → People & household.');
  return { email, password: pw };
}

module.exports = { list, resetPassword };
