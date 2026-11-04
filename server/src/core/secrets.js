// Encryption at rest for everything that would let someone into your accounts or read your documents:
// bank feed access, mailbox passwords and sign-in tokens, Home Assistant / ntfy / calendar logins, and receipt files.
//
// AES-256-GCM (authenticated: tampering is detected). The 256-bit key lives in its own file, hearth.key, next to the
// database (readable only by Hearth), or in the HEARTH_SECRET_KEY environment variable. A copy of hearth.db on its
// own reveals none of these secrets. Values written before encryption existed are upgraded on start-up.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { config, log } = require('./config');

const PREFIX = 'enc:v1:';
const FILE_MAGIC = Buffer.from('HEARTHE1');
const KEY_FILE = path.join(config.dataDir, 'hearth.key');

function loadKey() {
  const env = process.env.HEARTH_SECRET_KEY;
  if (env) {
    const k = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : crypto.createHash('sha256').update(env).digest();
    return k;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  try {
    const k = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
    if (k.length === 32) { try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* read-only fs */ } return k; }
    log.error('hearth.key is damaged — secrets saved with it cannot be read; reconnect bank feeds and mailboxes');
  } catch { /* first start */ }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, k.toString('base64'), { mode: 0o600 });
  log.info('Created encryption key (hearth.key)');
  return k;
}
const KEY = loadKey();
// separate keys for separate jobs, derived from the master key
const sub = (label) => crypto.createHmac('sha256', KEY).update(label).digest();
const DATA_KEY = sub('hearth:data:v1');
const SIGN_KEY = sub('hearth:sign:v1');

const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);

function encrypt(value) {
  if (value == null || value === '' || isEncrypted(value)) return value;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const ct = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

// Plain (not yet encrypted) values pass straight through, so old data keeps working
function decrypt(value) {
  if (!isEncrypted(value)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    log.warning('A stored secret could not be decrypted (wrong or replaced hearth.key?)');
    return null;
  }
}

// Files (receipt PDFs and images)
function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([FILE_MAGIC, iv, c.getAuthTag(), ct]);
}
function decryptBuffer(buf) {
  if (!buf.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) return buf; // older plain file
  const o = FILE_MAGIC.length;
  const d = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, buf.subarray(o, o + 12));
  d.setAuthTag(buf.subarray(o + 12, o + 28));
  return Buffer.concat([d.update(buf.subarray(o + 28)), d.final()]);
}
const writeFileEncrypted = (file, buf) => fs.writeFileSync(file, encryptBuffer(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)), { mode: 0o600 });
const readFileDecrypted = (file) => decryptBuffer(fs.readFileSync(file));

// Password-protected exports (backups): key stretched from the passphrase with scrypt
const EXPORT_MAGIC = 'hearth-encrypted-backup';
function encryptWithPassphrase(text, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return JSON.stringify({ format: EXPORT_MAGIC, version: 1, cipher: 'aes-256-gcm', kdf: { name: 'scrypt', N: 1 << 15, r: 8, p: 1, salt: salt.toString('base64') },
    iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: ct.toString('base64') });
}
function decryptWithPassphrase(json, passphrase) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  if (o.format !== EXPORT_MAGIC) throw new Error('Not an encrypted Hearth backup');
  const key = crypto.scryptSync(passphrase, Buffer.from(o.kdf.salt, 'base64'), 32, { N: o.kdf.N, r: o.kdf.r, p: o.kdf.p, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(Buffer.from(o.tag, 'base64'));
  try { return Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]).toString('utf8'); } catch { throw new Error('Wrong passphrase, or the file has been changed'); }
}

// Session tokens are stored only as keyed hashes, so the database never holds a usable sign-in
const hashToken = (t) => crypto.createHmac('sha256', SIGN_KEY).update(String(t)).digest('hex');

module.exports = { encrypt, decrypt, isEncrypted, encryptBuffer, decryptBuffer, writeFileEncrypted, readFileDecrypted,
  encryptWithPassphrase, decryptWithPassphrase, hashToken, KEY_FILE };
