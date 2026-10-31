// SQLite database (Node's built-in node:sqlite — no native build step, all data in one local file)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const { config } = require('./config');
const DATA_DIR = config.dataDir;
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'hearth.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS households (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currency TEXT DEFAULT 'GBP', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT DEFAULT 'member', color TEXT DEFAULT '#3b82f6', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device_id INTEGER, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT DEFAULT '#8b5cf6', user_id INTEGER);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id INTEGER, name TEXT NOT NULL, institution TEXT, type TEXT DEFAULT 'current',
  currency TEXT DEFAULT 'GBP', balance REAL DEFAULT 0, balance_date TEXT, color TEXT DEFAULT '#0ea5e9',
  connection_id INTEGER, external_id TEXT, shared INTEGER DEFAULT 1, archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, parent_id INTEGER, color TEXT DEFAULT '#64748b', icon TEXT DEFAULT '•',
  kind TEXT DEFAULT 'expense', UNIQUE(household_id, name));
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  date TEXT NOT NULL, amount REAL NOT NULL, description TEXT, merchant TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  event_id INTEGER, user_id INTEGER, notes TEXT, color TEXT,
  kind TEXT DEFAULT 'one_off', subscription_id INTEGER, pending INTEGER DEFAULT 0,
  external_id TEXT, import_hash TEXT, source TEXT DEFAULT 'manual',
  categorised_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(household_id, import_hash));
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(household_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions(household_id, merchant);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT DEFAULT '#f59e0b', UNIQUE(household_id, name));
CREATE TABLE IF NOT EXISTS transaction_tags (transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(transaction_id, tag_id));
CREATE TABLE IF NOT EXISTS merchant_map (household_id INTEGER, merchant TEXT, category_id INTEGER,
  PRIMARY KEY(household_id, merchant));
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL, amount REAL, cadence TEXT, interval_days REAL, next_date TEXT, last_date TEXT,
  category_id INTEGER, type TEXT DEFAULT 'subscription', status TEXT DEFAULT 'active', confirmed INTEGER DEFAULT 0, occurrences INTEGER DEFAULT 0,
  UNIQUE(household_id, merchant));
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, enabled INTEGER DEFAULT 1, priority INTEGER DEFAULT 100,
  trigger TEXT DEFAULT 'transaction_created', match_all INTEGER DEFAULT 1,
  conditions TEXT DEFAULT '[]', actions TEXT DEFAULT '[]', stop_processing INTEGER DEFAULT 0,
  last_run TEXT, run_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, amount REAL NOT NULL, period TEXT DEFAULT 'monthly',
  start_date TEXT, end_date TEXT, category_ids TEXT DEFAULT '[]', tag_ids TEXT DEFAULT '[]',
  scope TEXT DEFAULT 'shared', user_id INTEGER, person_id INTEGER, event_id INTEGER,
  alert_pct INTEGER DEFAULT 80, rollover INTEGER DEFAULT 0, color TEXT DEFAULT '#10b981');
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT DEFAULT 'savings', target_amount REAL NOT NULL, current_amount REAL DEFAULT 0,
  target_date TEXT, account_id INTEGER, scope TEXT DEFAULT 'shared', user_id INTEGER,
  color TEXT DEFAULT '#6366f1', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS goal_contributions (id INTEGER PRIMARY KEY, goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
  amount REAL, date TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS calendars (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  user_id INTEGER, name TEXT, provider TEXT, url TEXT, credentials TEXT, color TEXT DEFAULT '#ec4899',
  enabled INTEGER DEFAULT 1, last_sync TEXT, last_error TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  calendar_id INTEGER REFERENCES calendars(id) ON DELETE CASCADE, uid TEXT,
  title TEXT NOT NULL, start TEXT NOT NULL, end TEXT, location TEXT, description TEXT,
  budget REAL, estimated_cost REAL, person_id INTEGER, color TEXT, notes TEXT, source TEXT DEFAULT 'manual',
  UNIQUE(calendar_id, uid));
CREATE INDEX IF NOT EXISTS idx_events_start ON events(household_id, start);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  user_id INTEGER, text TEXT NOT NULL, parsed TEXT, status TEXT DEFAULT 'new',
  transaction_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  user_id INTEGER, query TEXT NOT NULL, url TEXT, target_price REAL, provider TEXT DEFAULT 'url',
  last_price REAL, lowest_price REAL, best_store TEXT, best_url TEXT, last_checked TEXT, last_error TEXT,
  history TEXT DEFAULT '[]', enabled INTEGER DEFAULT 1, notified_at TEXT);
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY, household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, name TEXT, config TEXT, last_sync TEXT, last_error TEXT, auto_sync INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, household_id INTEGER, user_id INTEGER, title TEXT, body TEXT, url TEXT,
  read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings (household_id INTEGER, key TEXT, value TEXT, PRIMARY KEY(household_id, key));
CREATE TABLE IF NOT EXISTS plan_cells (household_id INTEGER, month TEXT, category_id INTEGER, user_id INTEGER DEFAULT 0,
  amount REAL, note TEXT, PRIMARY KEY(household_id, month, category_id, user_id));
CREATE TABLE IF NOT EXISTS saved_views (id INTEGER PRIMARY KEY, household_id INTEGER, user_id INTEGER, name TEXT, kind TEXT DEFAULT 'transactions',
  config TEXT, pinned INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_chats (id INTEGER PRIMARY KEY, household_id INTEGER, user_id INTEGER, role TEXT, content TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`;
db.exec(SCHEMA);

// Additive migrations for databases created by earlier versions
const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN ha_user_id TEXT',
  'ALTER TABLE ai_chats ADD COLUMN thread_id INTEGER',
  'ALTER TABLE ai_chats ADD COLUMN meta TEXT',
  `CREATE TABLE IF NOT EXISTS ai_threads (id INTEGER PRIMARY KEY, household_id INTEGER, user_id INTEGER, title TEXT,
     created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS ai_actions (id INTEGER PRIMARY KEY, household_id INTEGER, user_id INTEGER, thread_id INTEGER,
     type TEXT, payload TEXT, summary TEXT, status TEXT DEFAULT 'pending', result TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS ai_reports (id INTEGER PRIMARY KEY, household_id INTEGER, kind TEXT, period TEXT, title TEXT, content TEXT,
     data TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(household_id, kind, period))`,
  `CREATE TABLE IF NOT EXISTS ai_log (id INTEGER PRIMARY KEY, household_id INTEGER, task TEXT, model TEXT, ms INTEGER, ok INTEGER,
     detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE INDEX IF NOT EXISTS idx_tx_catby ON transactions(household_id, categorised_by)',
  // 1.2: subscription tracker
  'ALTER TABLE subscriptions ADD COLUMN name TEXT',
  'ALTER TABLE subscriptions ADD COLUMN due_day INTEGER',
  'ALTER TABLE subscriptions ADD COLUMN start_date TEXT',
  'ALTER TABLE subscriptions ADD COLUMN end_date TEXT',
  'ALTER TABLE subscriptions ADD COLUMN notes TEXT',
  'ALTER TABLE subscriptions ADD COLUMN manual INTEGER DEFAULT 0',
  'ALTER TABLE subscriptions ADD COLUMN account_id INTEGER',
  'ALTER TABLE subscriptions ADD COLUMN user_id INTEGER',
  'ALTER TABLE subscriptions ADD COLUMN person_id INTEGER',
  `CREATE TABLE IF NOT EXISTS subscription_payments (id INTEGER PRIMARY KEY, household_id INTEGER, subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
     due_date TEXT, status TEXT, amount REAL, paid_date TEXT, note TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(subscription_id, due_date))`,
  // 1.2: unexpected costs and work expenses
  'ALTER TABLE transactions ADD COLUMN unexpected INTEGER DEFAULT 0',
  'ALTER TABLE transactions ADD COLUMN work_expense INTEGER DEFAULT 0',
  'ALTER TABLE transactions ADD COLUMN claim_status TEXT',
  'ALTER TABLE transactions ADD COLUMN claim_ref TEXT',
  'ALTER TABLE transactions ADD COLUMN claimed_at TEXT',
  'ALTER TABLE transactions ADD COLUMN reimbursed_at TEXT',
  'ALTER TABLE transactions ADD COLUMN reimbursement_tx_id INTEGER',
  'ALTER TABLE budgets ADD COLUMN flag TEXT',
  // 1.2: email receipts (IMAP)
  `CREATE TABLE IF NOT EXISTS email_accounts (id INTEGER PRIMARY KEY, household_id INTEGER, user_id INTEGER, name TEXT, host TEXT, port INTEGER DEFAULT 993,
     secure INTEGER DEFAULT 1, username TEXT, password TEXT, folders TEXT DEFAULT '["INBOX"]', lookback_days INTEGER DEFAULT 90, enabled INTEGER DEFAULT 1,
     state TEXT DEFAULT '{}', last_sync TEXT, last_error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS email_receipts (id INTEGER PRIMARY KEY, household_id INTEGER, email_account_id INTEGER, message_id TEXT, folder TEXT, uid INTEGER,
     from_name TEXT, from_email TEXT, subject TEXT, received_at TEXT, body_text TEXT, merchant TEXT, total REAL, currency TEXT DEFAULT 'GBP', receipt_date TEXT,
     order_ref TEXT, account_ref TEXT, items TEXT DEFAULT '[]', attachments TEXT DEFAULT '[]', extracted_by TEXT, suggested TEXT DEFAULT '{}',
     status TEXT DEFAULT 'pending', subscription_id INTEGER, transaction_id INTEGER, account_id INTEGER, due_date TEXT, action TEXT,
     approved_by INTEGER, approved_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(household_id, message_id))`,
  'CREATE INDEX IF NOT EXISTS idx_receipts_status ON email_receipts(household_id, status)',
  'ALTER TABLE email_accounts ADD COLUMN allow_self_signed INTEGER DEFAULT 0',
  // Microsoft 365 / Outlook.com (Entra app + Graph) and on-premises Exchange (EWS)
  "ALTER TABLE email_accounts ADD COLUMN kind TEXT DEFAULT 'imap'",
  'ALTER TABLE email_accounts ADD COLUMN address TEXT',
  'ALTER TABLE email_accounts ADD COLUMN graph_client_id TEXT',
  "ALTER TABLE email_accounts ADD COLUMN graph_tenant TEXT DEFAULT 'common'",
  'ALTER TABLE email_accounts ADD COLUMN graph_refresh_token TEXT',
  "ALTER TABLE email_accounts ADD COLUMN folder_names TEXT DEFAULT '{}'",
  'ALTER TABLE email_accounts ADD COLUMN ews_url TEXT',
  'ALTER TABLE email_accounts ADD COLUMN ews_domain TEXT',
  'CREATE INDEX IF NOT EXISTS idx_receipts_tx ON email_receipts(transaction_id)',
  `CREATE TABLE IF NOT EXISTS email_sender_map (household_id INTEGER, sender TEXT, subscription_id INTEGER, account_id INTEGER, category_id INTEGER,
     ignore INTEGER DEFAULT 0, PRIMARY KEY(household_id, sender))`,
];
for (const m of MIGRATIONS) { try { db.exec(m); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; } }

// Small helpers so route code stays readable
const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
  tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
};

function getSetting(hid, key, fallback = null) {
  const r = q.get('SELECT value FROM settings WHERE household_id=? AND key=?', hid, key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
function setSetting(hid, key, value) {
  q.run('INSERT INTO settings(household_id,key,value) VALUES(?,?,?) ON CONFLICT(household_id,key) DO UPDATE SET value=excluded.value',
    hid, key, JSON.stringify(value));
}

module.exports = { db, q, getSetting, setSetting, DATA_DIR };
