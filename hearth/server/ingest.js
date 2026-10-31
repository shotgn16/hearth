// Single entry point for every transaction, whatever its source (bank sync, file import, note, manual).
// Dedupes, cleans the merchant, categorises, runs workflows.
const crypto = require('crypto');
const { q, getSetting } = require('./db');
const { normaliseMerchant, guessCategory } = require('./categorize');
const { runRules } = require('./rules');

function importHash(t) {
  return t.external_id
    ? `ext:${t.account_id}:${t.external_id}`
    : crypto.createHash('sha1').update(`${t.account_id}|${t.date}|${Number(t.amount).toFixed(2)}|${(t.description || '').trim().toLowerCase()}|${t._seq || 0}`).digest('hex');
}

async function ingest(hid, list, { source = 'manual', userId = null, runWorkflows = true } = {}) {
  const result = { added: 0, skipped: 0, ids: [] };
  const seen = {};
  for (const raw of list) {
    if (!raw.date || raw.amount == null || isNaN(Number(raw.amount))) { result.skipped++; continue; }
    const t = { ...raw, amount: Number(raw.amount), date: String(raw.date).slice(0, 10) };
    if (!/^(19[9]\d|20\d\d)-\d\d-\d\d$/.test(t.date) || !Number.isFinite(t.amount)) { result.skipped++; continue; }
    // Two identical coffees on the same day are both real; give them a sequence number for hashing
    const k = `${t.account_id}|${t.date}|${t.amount}|${t.description}`;
    t._seq = seen[k] = (seen[k] ?? -1) + 1;
    const hash = importHash(t);
    if (q.get('SELECT 1 FROM transactions WHERE household_id=? AND import_hash=?', hid, hash)) { result.skipped++; continue; }
    const merchant = t.merchant || normaliseMerchant(t.description);
    let catId = t.category_id ?? null, by = catId ? 'user' : null;
    if (!catId) { const g = guessCategory(hid, merchant, t.description, t.amount); catId = g.id; by = g.by; }
    const r = q.run(`INSERT INTO transactions(household_id,account_id,date,amount,description,merchant,category_id,person_id,event_id,user_id,
                     notes,pending,external_id,import_hash,source,categorised_by,kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      hid, t.account_id ?? null, t.date, t.amount, t.description || '', merchant, catId, t.person_id ?? null, t.event_id ?? null,
      userId ?? t.user_id ?? null, t.notes ?? null, t.pending ? 1 : 0, t.external_id ?? null, hash, source, by, t.kind || 'one_off');
    const id = Number(r.lastInsertRowid);
    result.added++; result.ids.push(id);
    if (runWorkflows) {
      const tx = q.get('SELECT * FROM transactions WHERE id=?', id);
      await runRules(hid, 'transaction_created', tx);
      const threshold = getSetting(hid, 'large_tx_threshold', 250);
      if (Math.abs(tx.amount) >= threshold) await runRules(hid, 'large_transaction', tx);
    }
  }
  return result;
}

// ---------- File parsers ----------
function parseCSVText(text, delimiter) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const d = delimiter || ([',', ';', '\t', '|'].map((c) => [c, firstLine.split(c).length]).sort((a, b) => b[1] - a[1])[0][0]);
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some((x) => x !== '')) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) rows.push(row);
  return { delimiter: d, rows };
}

// Guess which column is which for common UK bank exports (Monzo, Starling, Barclays, HSBC, Nationwide, Lloyds, Amex, Revolut...)
function guessMapping(header) {
  const h = header.map((x) => x.toLowerCase().trim());
  // exact header match first; substring matches only for longer names so "id" doesn't match "paid out"
  const find = (...names) => {
    for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
    return h.findIndex((x) => names.some((n) => n.length > 3 && x.includes(n)));
  };
  return {
    date: find('transaction date', 'date', 'completed date', 'posted', 'started date'),
    description: find('description', 'name', 'payee', 'merchant', 'counter party', 'narrative', 'details', 'memo', 'reference'),
    amount: find('amount (gbp)', 'amount', 'value', 'total'),
    debit: find('paid out', 'debit', 'money out', 'out'),
    credit: find('paid in', 'credit', 'money in', 'in'),
    category: find('category', 'spending category'),
    external_id: find('transaction id', 'id', 'fitid'),
    notes: find('notes', 'notes and #tags'),
  };
}

function parseDate(s, fmt = 'auto') {
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2}|[A-Za-z]{3})[\/\-. ](\d{2,4})/);
  if (m) {
    const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    let [_, a, b, y] = m;
    b = months[String(b).toLowerCase()] || Number(b);
    a = Number(a); y = Number(y.length === 2 ? `20${y}` : y);
    const [day, mon] = fmt === 'mdy' ? [b, a] : [a, b]; // default UK day-first
    return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (/^\d{8}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // OFX 20261031
  const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
const num = (s) => { if (s == null || s === '') return null; const n = Number(String(s).replace(/[£$€,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return isNaN(n) ? null : n; };

function rowsToTransactions(rows, mapping, opts = {}) {
  const body = opts.hasHeader === false ? rows : rows.slice(1);
  return body.map((r) => {
    let amount = mapping.amount >= 0 ? num(r[mapping.amount]) : null;
    if (amount == null) amount = (num(r[mapping.credit]) || 0) - Math.abs(num(r[mapping.debit]) || 0);
    if (opts.invert) amount = -amount;
    return {
      date: parseDate(r[mapping.date], opts.dateFormat), description: r[mapping.description] ?? '', amount,
      external_id: mapping.external_id >= 0 ? r[mapping.external_id] || null : null,
      notes: mapping.notes >= 0 ? r[mapping.notes] || null : null, _category: mapping.category >= 0 ? r[mapping.category] : null,
    };
  }).filter((t) => t.date && t.amount != null);
}

function parseOFX(text) {
  const out = [];
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const tag = (n) => block.match(new RegExp(`<${n}>([^<\\r\\n]+)`, 'i'))?.[1]?.trim();
    out.push({ date: parseDate(tag('DTPOSTED')), amount: num(tag('TRNAMT')), description: [tag('NAME'), tag('MEMO')].filter(Boolean).join(' '), external_id: tag('FITID') });
  }
  return out.filter((t) => t.date);
}

function parseQIF(text) {
  const out = []; let cur = {};
  for (const line of text.split(/\r?\n/)) {
    const c = line[0], v = line.slice(1).trim();
    if (c === 'D') cur.date = parseDate(v.replace("'", '/'));
    else if (c === 'T' || c === 'U') cur.amount = num(v);
    else if (c === 'P') cur.description = v;
    else if (c === 'M') cur.notes = v;
    else if (c === '^') { if (cur.date) out.push(cur); cur = {}; }
  }
  return out;
}

module.exports = { ingest, parseCSVText, guessMapping, rowsToTransactions, parseOFX, parseQIF, parseDate };
