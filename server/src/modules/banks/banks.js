// Bank connections. Credentials stay in the local database; only the bank aggregator is contacted.
//
// Providers:
//  - "simplefin": the SimpleFIN Bridge protocol (setup token -> access URL -> /accounts). If your "superFin"
//     service hands you a setup token / access URL, this is the one to use.
//  - "generic":  any aggregator with a JSON API. You give it an accounts URL, a transactions URL and auth header,
//     plus field names, and it maps the response. Use this if superFin turns out to be a different API.
const { q } = require('../../core/db');
const { ingest } = require('../transactions/ingest');

const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');

async function claimSimplefin(setupToken) {
  const claimUrl = b64(setupToken.trim().replace(/\s+/g, ''));
  if (!/^https:\/\//.test(claimUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(claimUrl)) throw new Error("That doesn't look like a SimpleFIN setup token — copy the whole token again");
  const r = await fetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' }, signal: AbortSignal.timeout(30000) });
  if (r.status === 403) throw new Error('This setup token has already been used or has expired. Create a new one in your bank feed (e.g. Synci → Destinations) and paste that.');
  if (!r.ok) throw new Error(`Claiming the setup token failed (${r.status})`);
  return (await r.text()).trim(); // access URL with embedded basic-auth credentials
}

// SimpleFIN servers allow at most 90 days per request, and expect only a handful of requests a day.
const WINDOW_DAYS = 90;
const MAX_WINDOWS = 9; // first import reaches back up to ~2 years (or until history runs out)

async function simplefinRequest(accessUrl, params) {
  const u = new URL(accessUrl);
  const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
  u.username = ''; u.password = '';
  const url = `${u.toString().replace(/\/$/, '')}/accounts?${new URLSearchParams({ version: '2', pending: '1', ...params })}`;
  const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(120000) });
  if (r.status === 403 || r.status === 401) throw new Error('The bank feed refused access — the connection may have been removed or disabled. Reconnect it with a new setup token.');
  if (!r.ok) { const t = (await r.text().catch(() => '')).slice(0, 200); throw new Error(`Bank sync failed (${r.status})${t ? `: ${t}` : ''}`); }
  return r.json();
}

async function simplefinFetch(accessUrl, startDate) {
  const DAY = 86400;
  const now = Math.floor(Date.now() / 1000) + DAY; // end-date is exclusive; include today
  const from = startDate ? Math.floor(new Date(startDate) / 1000) : now - WINDOW_DAYS * DAY;
  const accounts = new Map(); const errors = new Set();
  let end = now, windows = 0, emptyRun = 0;
  while (end > from && windows < MAX_WINDOWS) {
    const start = Math.max(from, end - WINDOW_DAYS * DAY);
    const data = await simplefinRequest(accessUrl, { 'start-date': String(start), 'end-date': String(end) });
    windows++;
    for (const e of data.errlist || []) errors.add(e.msg || e.code);
    for (const e of data.errors || []) errors.add(String(e));
    const orgs = Object.fromEntries((data.connections || []).map((c) => [c.conn_id, c.name || c.org_name]));
    let got = 0;
    for (const a of data.accounts || []) {
      let acc = accounts.get(a.id);
      if (!acc) {
        acc = { external_id: a.id, name: a.name, institution: a.org?.name || a.org?.domain || orgs[a.conn_id] || null, currency: /^[A-Z]{3}$/.test(a.currency || '') ? a.currency : 'GBP',
          balance: Number(a.balance) || 0, balance_date: a['balance-date'] ? new Date(a['balance-date'] * 1000).toISOString() : null, tx: new Map() };
        accounts.set(a.id, acc);
      }
      for (const t of a.transactions || []) {
        const key = t.id != null ? String(t.id) : `${t.posted}|${t.amount}|${t.description}`;
        if (acc.tx.has(key)) continue; got++;
        // pending payments may have no posted date yet (0): use when it happened, or today
        const when = Number(t.transacted_at) || Number(t.posted) || (t.pending ? Math.floor(Date.now() / 1000) : 0);
        const amount = Number(String(t.amount ?? '').replace(/[^0-9.\-]/g, ''));
        if (!when || when < 631152000 || !Number.isFinite(amount)) continue; // no usable date (before 1990) or amount
        acc.tx.set(key, { external_id: t.id != null ? String(t.id) : null, date: new Date(when * 1000).toISOString().slice(0, 10),
          amount, description: [t.payee, t.description].filter(Boolean).join(' — ') || t.memo || '', pending: !!t.pending || !Number(t.posted) });
      }
    }
    // stop reaching back once a whole window comes back empty (history has run out)
    emptyRun = got ? 0 : emptyRun + 1;
    if (emptyRun >= 1 && windows > 1) break;
    end = start;
  }
  return { errors: [...errors], accounts: [...accounts.values()].map(({ tx, ...a }) => ({ ...a, transactions: [...tx.values()] })) };
}

const pick = (obj, path) => String(path || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);

async function genericFetch(cfg, startDate) {
  const headers = { Accept: 'application/json', ...(cfg.auth_header ? { [cfg.auth_header_name || 'Authorization']: cfg.auth_header } : {}) };
  const ar = await fetch(cfg.accounts_url, { headers });
  if (!ar.ok) throw new Error(`Accounts request failed (${ar.status})`);
  const accRaw = pick(await ar.json(), cfg.accounts_path) ?? [];
  const accounts = [];
  for (const a of accRaw) {
    const id = pick(a, cfg.f_account_id || 'id');
    const txUrl = cfg.transactions_url.replace('{account_id}', encodeURIComponent(id)).replace('{from}', startDate || '');
    const tr = await fetch(txUrl, { headers });
    const txRaw = tr.ok ? pick(await tr.json(), cfg.transactions_path) ?? [] : [];
    accounts.push({
      external_id: String(id), name: pick(a, cfg.f_account_name || 'name'), institution: pick(a, cfg.f_institution || 'institution'),
      currency: pick(a, cfg.f_currency || 'currency') || 'GBP', balance: Number(pick(a, cfg.f_balance || 'balance') || 0),
      transactions: txRaw.map((t) => ({
        external_id: String(pick(t, cfg.f_tx_id || 'id')), date: String(pick(t, cfg.f_tx_date || 'date')).slice(0, 10),
        amount: Number(pick(t, cfg.f_tx_amount || 'amount')) * (cfg.invert_amounts ? -1 : 1),
        description: pick(t, cfg.f_tx_description || 'description') || '', pending: !!pick(t, cfg.f_tx_pending || 'pending'),
      })),
    });
  }
  return { accounts, errors: [] };
}

async function syncConnection(conn, { full = false } = {}) {
  const cfg = JSON.parse(require('../../core/secrets').decrypt(conn.config) || '{}');
  const hid = conn.household_id;
  // First sync pulls as much history as the provider allows; later syncs overlap 14 days to catch pending→posted
  const start = full || !conn.last_sync ? cfg.history_from || '2000-01-01' : new Date(new Date(conn.last_sync) - 14 * 86400000).toISOString().slice(0, 10);
  try {
    const data = conn.provider === 'simplefin' ? await simplefinFetch(cfg.access_url, start) : await genericFetch(cfg, start);
    let added = 0;
    for (const a of data.accounts) {
      let acc = q.get('SELECT * FROM accounts WHERE household_id=? AND connection_id=? AND external_id=?', hid, conn.id, a.external_id);
      if (!acc) {
        const r = q.run('INSERT INTO accounts(household_id,owner_user_id,name,institution,currency,balance,balance_date,connection_id,external_id) VALUES(?,?,?,?,?,?,?,?,?)',
          hid, cfg.owner_user_id || null, a.name, a.institution, a.currency || 'GBP', a.balance, a.balance_date, conn.id, a.external_id);
        acc = { id: Number(r.lastInsertRowid) };
      } else q.run('UPDATE accounts SET balance=?, balance_date=? WHERE id=?', a.balance, a.balance_date || new Date().toISOString(), acc.id);
      // drop stale pending rows that have since posted under a new id
      q.run(`DELETE FROM transactions WHERE account_id=? AND pending=1 AND source='bank'`, acc.id);
      // workflows and alerts only for new activity, not for history pulled in on the first import
      const res = await ingest(hid, a.transactions.map((t) => ({ ...t, account_id: acc.id, user_id: cfg.owner_user_id })), { source: 'bank', runWorkflows: !full && !!conn.last_sync });
      added += res.added;
    }
    q.run('UPDATE connections SET last_sync=?, last_error=? WHERE id=?', new Date().toISOString(), data.errors.join('; ') || null, conn.id);
    return { added, accounts: data.accounts.length, warnings: data.errors };
  } catch (e) {
    q.run('UPDATE connections SET last_error=? WHERE id=?', e.message, conn.id);
    throw e;
  }
}

module.exports = { claimSimplefin, syncConnection };
