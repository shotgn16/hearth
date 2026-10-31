// Bank connections. Credentials stay in the local database; only the bank aggregator is contacted.
//
// Providers:
//  - "simplefin": the SimpleFIN Bridge protocol (setup token -> access URL -> /accounts). If your "superFin"
//     service hands you a setup token / access URL, this is the one to use.
//  - "generic":  any aggregator with a JSON API. You give it an accounts URL, a transactions URL and auth header,
//     plus field names, and it maps the response. Use this if superFin turns out to be a different API.
const { q } = require('./db');
const { ingest } = require('./ingest');

const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');

async function claimSimplefin(setupToken) {
  const claimUrl = b64(setupToken.trim());
  const r = await fetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (!r.ok) throw new Error(`Claiming setup token failed (${r.status}). Tokens can only be claimed once.`);
  return (await r.text()).trim(); // access URL with embedded basic-auth credentials
}

async function simplefinFetch(accessUrl, startDate) {
  const u = new URL(accessUrl);
  const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
  u.username = ''; u.password = '';
  const url = `${u.toString().replace(/\/$/, '')}/accounts?pending=1${startDate ? `&start-date=${Math.floor(new Date(startDate) / 1000)}` : ''}`;
  const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!r.ok) throw new Error(`Bank sync failed (${r.status})`);
  const data = await r.json();
  return {
    errors: data.errors || [],
    accounts: (data.accounts || []).map((a) => ({
      external_id: a.id, name: a.name, institution: a.org?.name || a.org?.domain, currency: a.currency, balance: Number(a.balance),
      balance_date: a['balance-date'] ? new Date(a['balance-date'] * 1000).toISOString() : null,
      transactions: (a.transactions || []).map((t) => ({
        external_id: t.id, date: new Date((t.transacted_at || t.posted) * 1000).toISOString().slice(0, 10),
        amount: Number(t.amount), description: [t.payee, t.description].filter(Boolean).join(' — ') || t.memo || '', pending: !!t.pending,
      })),
    })),
  };
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
  const cfg = JSON.parse(conn.config || '{}');
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
      const res = await ingest(hid, a.transactions.map((t) => ({ ...t, account_id: acc.id, user_id: cfg.owner_user_id })), { source: 'bank' });
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
