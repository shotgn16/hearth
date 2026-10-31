// Email receipts. Hearth checks your mailbox(es) over IMAP on a schedule, picks out receipts, invoices and bills,
// reads the amount, date, references and items (from the email, PDF attachments, or photos via your vision model),
// and works out which bill/subscription, bank transaction and account each one belongs to.
//
// Nothing is applied until someone approves it. Approving can link the receipt to a transaction, tick off that
// month's payment in the tracker, or add it as a spend — and Hearth remembers the sender for next time.
const fs = require('fs');
const path = require('path');
const { q } = require('./db');
const { config, log } = require('./config');

const RECEIPT_DIR = path.join(config.dataDir, 'receipts');
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00`);
const addDays = (s, n) => iso(new Date(at(s).getTime() + n * 86400000));
const r2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- detection & extraction
const SUBJECT_YES = /\b(receipt|invoice|your order|order confirm|order #|order no|payment (received|confirmation|successful)|thanks for (your )?(order|purchase|payment)|bill (is ready|available)|your (bill|statement)|statement is ready|direct debit|renewal|renewed|subscription|booking confirm|tax invoice|purchase|e-?ticket|refund)\b/i;
const SUBJECT_NO = /\b(\d+% off|sale ends|deal|offer|newsletter|webinar|last chance|recommended for you|you might like|reset your password|verify your|security alert|sign[- ]in)\b/i;
const FROM_YES = /\b(receipt|invoice|billing|bills|orders?|payments?|noreply|no-reply|do-not-reply|accounts?|customerservice|notifications?)\b/i;
const MONEY = /(?:£|GBP\s?)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/gi;
const TOTAL_LINE = /\b(grand total|order total|total (paid|charged|due|amount|to pay|inc\.? vat|including vat)|amount (paid|charged|due|of|debited|to be collected|collected)|you paid|payment (of|amount)|balance (due|to pay)|total|amount)\b[^\n£]{0,40}?(?:£|GBP\s?)\s?(?<amt>\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/gi;

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n').replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&pound;/g, '£').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#163;/g, '£').replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function receiptScore({ subject = '', fromName = '', fromEmail = '', text = '', attachments = [] }) {
  let s = 0;
  if (SUBJECT_YES.test(subject)) s += 3;
  if (SUBJECT_NO.test(subject)) s -= 4;
  if (FROM_YES.test(`${fromName} ${fromEmail}`)) s += 1;
  const hasTotal = new RegExp(TOTAL_LINE.source, 'i').test(text);
  if (hasTotal) s += 3;
  else if (new RegExp(MONEY.source, 'i').test(text)) s += 1;
  if (/\b(order|invoice|receipt|reference|account) (number|no\.?|#)/i.test(text)) s += 1;
  if (attachments.some((a) => /pdf/i.test(a.contentType) && /(invoice|receipt|bill|statement|order)/i.test(a.filename || ''))) s += 3;
  if (/unsubscribe/i.test(text) && !hasTotal) s -= 1;
  return s;
}

const toNum = (v) => Number(String(v).replace(/,/g, ''));

function extractHeuristic({ subject, fromName, fromEmail, text, date }) {
  const totals = [];
  for (const m of text.matchAll(TOTAL_LINE)) {
    const label = m[1].toLowerCase();
    const weight = /grand total|order total|total (paid|charged|due|to pay)|amount (paid|charged|due|debited|to be collected|collected)|you paid|balance due/.test(label) ? 3 : /total/.test(label) ? 2 : 1;
    totals.push({ v: toNum(m.groups.amt), weight, idx: m.index });
  }
  let total = null;
  if (totals.length) { totals.sort((a, b) => b.weight - a.weight || b.idx - a.idx); total = totals[0].v; }
  else { const all = [...text.matchAll(MONEY)].map((m) => toNum(m[1])).filter((v) => v > 0); if (all.length) total = Math.max(...all); }
  const ref = [...text.matchAll(/\b(?:order|invoice|receipt|booking|transaction|confirmation)\s*(?:number|no\.?|#|id|ref(?:erence)?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{4,24})\b/gi)].map((m) => m[1]).find((v) => /\d/.test(v)) || null;
  const acct = text.match(/\b(?:account|customer|policy|membership|reference)\s*(?:number|no\.?|#|ref)\s*[:#]?\s*([A-Z0-9][A-Z0-9\- ]{3,20}[A-Z0-9])\b/i)?.[1]?.trim() || null;
  let rdate = null;
  const dm = text.match(/\b(?:date|order date|invoice date|payment date|paid on|issued)\s*[:\-]?\s*(\d{1,2}[\/\-. ](?:\d{1,2}|[A-Za-z]{3,9})[\/\-. ]\d{2,4})/i);
  if (dm) { const { parseDate } = require('./ingest'); rdate = parseDate(dm[1].replace(/\s+/g, ' ').replace(/([A-Za-z]{3})[a-z]+/, '$1')); }
  if (!rdate || isNaN(at(rdate))) rdate = iso(date || new Date());
  const items = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:(\d+)\s*x\s*)?([A-Za-z][^£\n]{2,60}?)\s{1,}(?:£|GBP\s?)\s?(\d+(?:\.\d{2}))\s*$/);
    if (m && !/total|vat|delivery|subtotal|discount|balance|amount/i.test(m[2])) items.push({ name: m[2].trim().replace(/[:\-–]+$/, '').trim(), price: toNum(m[3]), qty: m[1] ? Number(m[1]) : 1 });
    if (items.length >= 25) break;
  }
  return { merchant: merchantFrom(fromName, fromEmail, subject), total, receipt_date: rdate, order_ref: ref, account_ref: acct, items };
}

function merchantFrom(fromName = '', fromEmail = '', subject = '') {
  let n = String(fromName).replace(/["']/g, '').replace(/\.(co\.uk|com|uk|net|org)\b/gi, '').replace(/\b(no-?reply|noreply|do[- ]not[- ]reply|team|customer (service|care)|billing|receipts?|orders?|notifications?|uk|ltd|limited|plc)\b/gi, '').replace(/[|·<>]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!n || /@/.test(n)) {
    const dom = String(fromEmail).split('@')[1] || '';
    const parts = dom.split('.').filter((p) => !['co', 'uk', 'com', 'org', 'net', 'io', 'email', 'mail', 'e', 'em', 'info', 'mailer', 'notifications', 'billing'].includes(p));
    n = parts.at(-1) || dom;
  }
  n = n.replace(/\.(co\.uk|com|uk)$/i, '');
  return n.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) || 'Unknown sender';
}

async function pdfText(buf) {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text || '').slice(0, 30000);
  } catch (e) { log.debug('pdf text failed', e.message); return ''; }
}

async function extractAI(hid, msg, base) {
  const ai = require('./ai'); const c = ai.cfg(hid);
  if (!c.enabled) return null;
  try {
    const out = await ai.askJSON(hid, `Read this email receipt/invoice/bill from a UK household's mailbox. Reply JSON:
{"is_receipt": true|false, "merchant": short company name, "total": number (the amount actually paid or due, in pounds), "currency": "GBP"|..., "date": "YYYY-MM-DD" (payment/order date),
 "order_ref": string|null, "account_ref": customer/account/policy number or null, "items": [{"name","price","qty"}], "kind": "one_off"|"subscription"|"bill"|"refund"}
A rule-based reader guessed: ${JSON.stringify({ merchant: base.merchant, total: base.total, date: base.receipt_date, order_ref: base.order_ref })}.
From: ${msg.fromName} <${msg.fromEmail}>  Subject: ${msg.subject}  Sent: ${iso(msg.date || new Date())}
---
${msg.text.slice(0, 6000)}`, { model: c.fastModel, task: 'email_receipt' });
    return out;
  } catch (e) { log.debug('AI receipt extraction failed', e.message); return null; }
}

async function extractImageAI(hid, buf, base) {
  const ai = require('./ai'); const c = ai.cfg(hid);
  if (!c.enabled || !c.visionModel) return null;
  try {
    return await ai.askJSON(hid, `Read this receipt image. Reply JSON {"merchant","total","date":"YYYY-MM-DD","order_ref","items":[{"name","price","qty"}]}. Hint: ${JSON.stringify({ merchant: base.merchant })}`,
      { model: c.visionModel, images: [buf.toString('base64')], task: 'email_receipt_image' });
  } catch (e) { log.debug('vision receipt failed', e.message); return null; }
}

// ---------------------------------------------------------------- matching
const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'ltd', 'limited', 'plc', 'uk', 'com', 'pymts', 'payment', 'payments', 'card', 'bill'].includes(w)));
function similarity(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if ([...B].some((x) => x === w || (w.length > 4 && (x.startsWith(w) || w.startsWith(x))))) n++;
  return n / Math.min(A.size, B.size);
}
const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';
const domainRoot = (email) => { const d = domainOf(email).split('.'); return d.filter((p) => !['co', 'uk', 'com', 'org', 'net', 'io', 'email', 'mail', 'e', 'em', 'info'].includes(p)).at(-1) || ''; };

function learned(hid, fromEmail) {
  return q.get('SELECT * FROM email_sender_map WHERE household_id=? AND sender=?', hid, String(fromEmail).toLowerCase())
    || q.get('SELECT * FROM email_sender_map WHERE household_id=? AND sender=?', hid, `@${domainOf(fromEmail)}`);
}

function match(hid, r) {
  const tracker = require('./tracker');
  const reasons = []; let conf = 0;
  const memo = learned(hid, r.from_email);
  const names = `${r.merchant} ${r.from_name} ${domainRoot(r.from_email)}`;
  // 1) which bill / subscription?
  let sub = null, subScore = 0;
  for (const s of q.all(`SELECT * FROM subscriptions WHERE household_id=? AND status!='ignored'`, hid)) {
    // a name match alone is weak (Amazon orders aren't Amazon Prime); bills vary in amount so their name counts a bit more
    let sc = similarity(names, `${s.name || ''} ${s.merchant}`) * (s.type === 'bill' ? 0.5 : 0.4);
    if (r.total && s.amount && Math.abs(r.total - s.amount) <= Math.max(0.5, s.amount * 0.05)) sc += 0.35;
    if (memo?.subscription_id === s.id) sc += 0.6;
    if (r.account_ref && s.notes && s.notes.includes(r.account_ref)) sc += 0.4;
    if (sc > subScore) { subScore = sc; sub = s; }
  }
  if (subScore < 0.45) sub = null;
  if (sub) {
    if (memo?.subscription_id === sub.id) reasons.push(`You've filed receipts from ${r.from_email.split('@')[1] || r.from_email} under ${sub.name || sub.merchant} before`);
    else reasons.push(`Looks like your ${sub.name || sub.merchant} ${sub.type === 'bill' ? 'bill' : 'subscription'}`);
    if (r.total && sub.amount && Math.abs(r.total - sub.amount) <= Math.max(0.5, sub.amount * 0.05)) reasons.push(`Same amount as usual (£${sub.amount.toFixed(2)})`);
    else if (r.total && sub.amount) reasons.push(`Amount differs from usual (£${sub.amount.toFixed(2)})`);
    conf = Math.min(0.9, subScore);
  }
  // 2) which bank transaction?
  let tx = null, txScore = 0;
  if (r.total) {
    const cands = q.all(`SELECT t.*, a.name account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE t.household_id=? AND t.amount<0 AND ABS(ABS(t.amount)-?) <= ?
      AND t.date BETWEEN ? AND ? AND t.id NOT IN (SELECT transaction_id FROM email_receipts WHERE status='approved' AND transaction_id IS NOT NULL)`,
    hid, r.total, Math.max(0.02, r.total * 0.01), addDays(r.receipt_date, -5), addDays(r.receipt_date, 10));
    for (const t of cands) {
      let sc = 0.4 + similarity(names, `${t.merchant} ${t.description}`) * 0.4;
      if (sub && t.subscription_id === sub.id) sc += 0.3;
      sc -= Math.abs((at(t.date) - at(r.receipt_date)) / 86400000) * 0.01;
      if (sc > txScore) { txScore = sc; tx = t; }
    }
    if (tx && txScore < 0.45 && !(sub && tx.subscription_id === sub.id)) tx = null;
  }
  if (tx) { reasons.push(`Matches the £${Math.abs(tx.amount).toFixed(2)} payment to ${tx.merchant} on ${tx.date}${tx.account_name ? ` from ${tx.account_name}` : ''}`); conf = Math.max(conf, Math.min(0.95, txScore + (sub ? 0.15 : 0))); }
  // 3) which account?
  const accountId = tx?.account_id || sub?.account_id || memo?.account_id || null;
  if (!tx && accountId) { const a = q.get('SELECT name FROM accounts WHERE id=?', accountId); if (a) reasons.push(`Usually paid from ${a.name}`); }
  // 4) which payment in the tracker (for bills/subscriptions)?
  let due = null;
  if (sub) {
    const occ = tracker.occurrences({ ...sub, end_date: null }, addDays(r.receipt_date, -20), addDays(r.receipt_date, 20));
    due = occ.sort((a, b) => Math.abs(at(a) - at(r.receipt_date)) - Math.abs(at(b) - at(r.receipt_date)))[0] || null;
  }
  // 5) what to do with it
  const action = tx ? 'link' : sub && due ? 'mark_paid' : r.total ? 'add_spend' : 'none';
  if (action === 'add_spend') reasons.push('No matching payment found in your accounts yet — it can be added as a spend');
  if (!sub && !tx) conf = r.total ? 0.3 : 0.1;
  return { subscription_id: sub?.id || null, transaction_id: tx?.id || null, account_id: accountId, due_date: due, action, confidence: r2(conf), reasons, category_id: sub?.category_id || memo?.category_id || null };
}

// ---------------------------------------------------------------- processing one message
async function processMessage(hid, acct, folder, uid, source) {
  const { simpleParser } = require('mailparser');
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const messageId = parsed.messageId || `${acct.id}:${folder}:${uid}`;
  if (q.get('SELECT 1 FROM email_receipts WHERE household_id=? AND message_id=?', hid, messageId)) return null;
  const fromAddr = parsed.from?.value?.[0] || {};
  const msg = { subject: parsed.subject || '', fromName: fromAddr.name || '', fromEmail: (fromAddr.address || '').toLowerCase(), date: parsed.date || new Date(),
    text: (parsed.text && parsed.text.trim().length > 40 ? parsed.text : htmlToText(parsed.html)).slice(0, 40000), attachments: parsed.attachments || [] };
  // mislabelled character sets turn £ into � or Â£ — put the pound sign back before reading amounts
  msg.text = msg.text.replace(/Â£/g, '£').replace(/\uFFFD(?=\s?\d)/g, '£');
  const memo = learned(hid, msg.fromEmail);
  if (memo?.ignore) return null;
  // PDFs: read their text too (many bills are only in the attachment)
  for (const a of msg.attachments) if (/pdf/i.test(a.contentType) && a.size < 10e6) { const t = await pdfText(a.content); if (t) msg.text += `\n\n[Attachment ${a.filename}]\n${t}`; }
  const score = receiptScore(msg) + (memo ? 3 : 0);
  if (score < 4) return null;
  let ex = extractHeuristic(msg);
  let by = 'rules';
  if (!ex.total || score < 6) {
    const aiOut = await extractAI(hid, msg, ex);
    if (aiOut) {
      if (aiOut.is_receipt === false && !memo) return null;
      ex = { ...ex, merchant: aiOut.merchant || ex.merchant, total: Number(aiOut.total) || ex.total, receipt_date: /^\d{4}-\d{2}-\d{2}$/.test(aiOut.date || '') ? aiOut.date : ex.receipt_date,
        order_ref: aiOut.order_ref || ex.order_ref, account_ref: aiOut.account_ref || ex.account_ref, items: Array.isArray(aiOut.items) && aiOut.items.length ? aiOut.items.slice(0, 25) : ex.items, currency: aiOut.currency || 'GBP' };
      by = 'ai';
    }
  }
  if (!ex.total) {
    const img = msg.attachments.find((a) => /^image\/(jpe?g|png|webp)/i.test(a.contentType) && a.size > 20000 && a.size < 8e6);
    if (img) { const v = await extractImageAI(hid, img.content, ex); if (v?.total) { ex = { ...ex, total: Number(v.total), merchant: v.merchant || ex.merchant, receipt_date: v.date || ex.receipt_date, items: v.items || ex.items }; by = 'vision'; } }
  }
  const r = { household_id: hid, email_account_id: acct.id, message_id: messageId, folder, uid, from_name: msg.fromName, from_email: msg.fromEmail, subject: msg.subject,
    received_at: (msg.date instanceof Date ? msg.date : new Date(msg.date)).toISOString(), body_text: msg.text.slice(0, 20000), ...ex, extracted_by: by };
  r.suggested = match(hid, r);
  const id = Number(q.run(`INSERT INTO email_receipts(household_id,email_account_id,message_id,folder,uid,from_name,from_email,subject,received_at,body_text,merchant,total,currency,receipt_date,order_ref,account_ref,items,extracted_by,suggested)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, hid, acct.id, messageId, folder, uid, r.from_name, r.from_email, r.subject, r.received_at, r.body_text, r.merchant, r.total ?? null, ex.currency || 'GBP',
    r.receipt_date, r.order_ref, r.account_ref, JSON.stringify(r.items || []), by, JSON.stringify(r.suggested)).lastInsertRowid);
  // keep PDFs and images so you can open them later
  const saved = [];
  for (const a of msg.attachments) {
    if (!/pdf|^image\//i.test(a.contentType) || a.size > 15e6 || a.related) continue;
    const dir = path.join(RECEIPT_DIR, String(id)); fs.mkdirSync(dir, { recursive: true });
    const name = (a.filename || `attachment-${saved.length + 1}${/pdf/i.test(a.contentType) ? '.pdf' : '.jpg'}`).replace(/[^\w.\- ]/g, '_').slice(0, 100);
    fs.writeFileSync(path.join(dir, name), a.content); saved.push({ name, type: a.contentType, size: a.size });
  }
  if (saved.length) q.run('UPDATE email_receipts SET attachments=? WHERE id=?', JSON.stringify(saved), id);
  return id;
}

// ---------------------------------------------------------------- IMAP
function client(acct) {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow({ host: acct.host, port: Number(acct.port) || 993, secure: !!acct.secure, auth: { user: acct.username, pass: acct.password }, logger: false,
    tls: { rejectUnauthorized: acct.allow_self_signed ? false : true }, socketTimeout: 60000, greetingTimeout: 20000 });
}

// Header-only check used by every mailbox type before downloading a full message
function looksLikely(hid, { subject = '', fromName = '', fromEmail = '', hasDoc = false }) {
  const memo = learned(hid, fromEmail);
  if (memo?.ignore) return false;
  const pre = (SUBJECT_YES.test(subject) ? 3 : 0) + (SUBJECT_NO.test(subject) ? -4 : 0) + (FROM_YES.test(`${fromName} ${fromEmail}`) ? 1 : 0) + (hasDoc ? 2 : 0) + (memo ? 4 : 0);
  return pre >= 2;
}

// Returns the mailbox's folders as [{ id, name }]
async function testConnection(acct) {
  if (acct.kind === 'microsoft') return require('./microsoft').test(acct);
  if (acct.kind === 'ews') return require('./ews').test(acct);
  const c = client(acct);
  await c.connect();
  try { const list = await c.list(); return { folders: list.map((f) => ({ id: f.path, name: f.path })), message: 'Connected' }; } finally { await c.logout().catch(() => {}); }
}

const BATCH = 200;
const running = new Map();
// one check per mailbox at a time; a second request waits for the one already running
function syncAccount(acct, opts = {}) {
  if (running.has(acct.id)) return running.get(acct.id);
  const p = doSync(acct, opts).finally(() => running.delete(acct.id));
  running.set(acct.id, p); return p;
}
async function doSync(acct, { full = false } = {}) {
  const hid = acct.household_id;
  if (acct.kind === 'microsoft' || acct.kind === 'ews') {
    const provider = require(acct.kind === 'microsoft' ? './microsoft' : './ews');
    try {
      const r = await provider.sync(acct, { full, looksLikely: (m) => looksLikely(hid, m), processMessage });
      q.run('UPDATE email_accounts SET state=?, last_sync=?, last_error=NULL WHERE id=?', JSON.stringify(r.state), new Date().toISOString(), acct.id);
      return { found: r.found, scanned: r.scanned };
    } catch (e) { q.run('UPDATE email_accounts SET last_error=?, last_sync=? WHERE id=?', e.message, new Date().toISOString(), acct.id); throw e; }
  }
  const state = full ? {} : JSON.parse(acct.state || '{}');
  const folders = JSON.parse(acct.folders || '["INBOX"]');
  const c = client(acct);
  let found = 0, scanned = 0;
  try {
    await c.connect();
    for (const folder of folders) {
      const lock = await c.getMailboxLock(folder);
      try {
        const box = c.mailbox; const st = state[folder] || {};
        let uids;
        const since = new Date(Date.now() - (Number(acct.lookback_days) || 90) * 86400000);
        const firstRun = !st.uidvalidity || String(st.uidvalidity) !== String(box.uidValidity);
        if (firstRun) {
          uids = await c.search({ since }, { uid: true });
          // some servers handle SINCE badly: fall back to the most recent messages and filter by date below
          if (!uids?.length && box.exists) uids = await c.search({ seq: `${Math.max(1, box.exists - 2999)}:*` }, { uid: true });
        } else {
          uids = (await c.search({ uid: `${(st.lastUid || 0) + 1}:*` }, { uid: true })).filter((u) => u > (st.lastUid || 0));
        }
        uids = (uids || []).sort((a, b) => a - b);
        let lastUid = st.lastUid || 0;
        for (let i = 0; i < uids.length; i += BATCH) {
          const chunk = uids.slice(i, i + BATCH);
          // cheap first pass on headers only; download full messages only for likely receipts
          const likely = [];
          for await (const m of c.fetch(chunk, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
            scanned++;
            lastUid = Math.max(lastUid, m.uid);
            const env = m.envelope || {}; const from = env.from?.[0] || {};
            if (firstRun && env.date && new Date(env.date) < since) continue;
            const fromEmail = (from.address || '').toLowerCase();
            const hasDoc = JSON.stringify(m.bodyStructure || {}).match(/"(application\/pdf|image\/(jpeg|png))"|invoice|receipt/i);
            if (looksLikely(hid, { subject: env.subject || '', fromName: from.name || '', fromEmail, hasDoc: !!hasDoc })) likely.push(m.uid);
          }
          for (const uid of likely) {
            const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
            if (!msg?.source) continue;
            try { if (await processMessage(hid, acct, folder, uid, msg.source)) found++; } catch (e) { log.warning('receipt processing failed', e.message); }
          }
        }
        state[folder] = { uidvalidity: String(box.uidValidity), lastUid };
      } finally { lock.release(); }
    }
    q.run('UPDATE email_accounts SET state=?, last_sync=?, last_error=NULL WHERE id=?', JSON.stringify(state), new Date().toISOString(), acct.id);
  } catch (e) {
    q.run('UPDATE email_accounts SET last_error=?, last_sync=? WHERE id=?', e.responseText || e.message, new Date().toISOString(), acct.id);
    throw e;
  } finally { await c.logout().catch(() => {}); }
  return { found, scanned };
}

// ---------------------------------------------------------------- review & approval
function list(hid, status = 'pending') {
  return q.all(`SELECT r.id, r.from_name, r.from_email, r.subject, r.received_at, r.merchant, r.total, r.currency, r.receipt_date, r.order_ref, r.account_ref, r.items, r.attachments,
      r.extracted_by, r.suggested, r.status, r.subscription_id, r.transaction_id, r.account_id, r.due_date, r.action, r.approved_at, ea.name mailbox
    FROM email_receipts r LEFT JOIN email_accounts ea ON ea.id=r.email_account_id WHERE r.household_id=? AND r.status=? ORDER BY r.received_at DESC LIMIT 300`, hid, status)
    .map(decorate(hid));
}
const decorate = (hid) => (r) => {
  const sug = JSON.parse(r.suggested || '{}');
  const pick = (id, table, cols) => (id ? q.get(`SELECT ${cols} FROM ${table} WHERE id=? AND household_id=?`, id, hid) : null);
  const subId = r.status === 'approved' ? r.subscription_id : sug.subscription_id;
  const txId = r.status === 'approved' ? r.transaction_id : sug.transaction_id;
  const accId = r.status === 'approved' ? r.account_id : sug.account_id;
  return { ...r, items: JSON.parse(r.items || '[]'), attachments: JSON.parse(r.attachments || '[]'), suggested: sug,
    subscription: pick(subId, 'subscriptions', 'id, COALESCE(name, merchant) display, amount, cadence, type, account_id'),
    transaction: pick(txId, 'transactions', 'id, date, amount, merchant, account_id'),
    account: pick(accId, 'accounts', 'id, name') };
};

function detail(hid, id) {
  const r = q.get('SELECT * FROM email_receipts WHERE id=? AND household_id=?', id, hid);
  if (!r) return null;
  const d = decorate(hid)(r);
  // alternatives to choose from when changing the match
  const amt = r.total || 0; const date = r.receipt_date || iso(new Date());
  d.candidates = {
    transactions: q.all(`SELECT t.id, t.date, t.amount, t.merchant, a.name account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE t.household_id=? AND t.amount<0
      AND t.date BETWEEN ? AND ? ORDER BY ABS(ABS(t.amount)-?) ASC, ABS(julianday(t.date)-julianday(?)) ASC LIMIT 15`, hid, addDays(date, -21), addDays(date, 21), amt, date),
    subscriptions: q.all(`SELECT id, COALESCE(name, merchant) display, amount, cadence, type, status FROM subscriptions WHERE household_id=? AND status!='ignored' ORDER BY display`, hid),
    due_dates: d.subscription ? require('./tracker').occurrences({ ...q.get('SELECT * FROM subscriptions WHERE id=?', d.subscription.id), end_date: null }, addDays(date, -45), addDays(date, 45)) : [],
  };
  return d;
}

function approve(hid, userId, id, o = {}) {
  const r = q.get('SELECT * FROM email_receipts WHERE id=? AND household_id=?', id, hid);
  if (!r) throw new Error('Receipt not found');
  if (r.status === 'approved') throw new Error('Already approved');
  const sug = JSON.parse(r.suggested || '{}');
  const pickO = (k) => (o[k] !== undefined ? (o[k] === '' ? null : o[k]) : sug[k] ?? null);
  const subId = pickO('subscription_id'), accountId = pickO('account_id'), action = pickO('action') || 'none';
  let txId = pickO('transaction_id'); const dueDate = pickO('due_date');
  const total = o.total !== undefined ? Number(o.total) : r.total; const date = o.receipt_date || r.receipt_date;
  const items = JSON.parse(r.items || '[]');
  const note = `Receipt: ${r.merchant}${r.order_ref ? ` #${r.order_ref}` : ''}${items.length ? ` — ${items.slice(0, 12).map((i) => `${i.name} £${Number(i.price).toFixed(2)}`).join(', ')}` : ''}`.slice(0, 1500);
  const tracker = require('./tracker');
  if (action === 'link' && txId) {
    const t = q.get('SELECT * FROM transactions WHERE id=? AND household_id=?', txId, hid);
    if (t) {
      q.run('UPDATE transactions SET notes=? WHERE id=?', [t.notes, note].filter(Boolean).join(' · ').slice(0, 2000), t.id);
      if (subId && !t.subscription_id) { const s = q.get('SELECT type FROM subscriptions WHERE id=?', subId); q.run('UPDATE transactions SET subscription_id=?, kind=? WHERE id=?', subId, s?.type || 'subscription', t.id); }
    }
  }
  if (action === 'mark_paid' && subId && dueDate) tracker.mark(hid, subId, dueDate, 'paid', { amount: total, paid_date: date, note: `Email receipt from ${r.merchant}` });
  if (action === 'add_spend' && total) {
    const s = subId ? q.get('SELECT * FROM subscriptions WHERE id=?', subId) : null;
    const cat = o.category_id || s?.category_id || sug.category_id || null;
    const res = require('./ingest').ingest(hid, [{ date, amount: -Math.abs(total), description: r.merchant, merchant: s ? (s.name || s.merchant) : undefined, category_id: cat, account_id: accountId, notes: note, external_id: `email:${r.message_id}` }], { source: 'email', userId, runWorkflows: true });
    return res.then((x) => finish(x.ids[0]));
  }
  return finish(txId);

  function finish(finalTx) {
    if (action === 'add_spend' && finalTx && subId) { const s = q.get('SELECT type FROM subscriptions WHERE id=?', subId); q.run('UPDATE transactions SET subscription_id=?, kind=? WHERE id=?', subId, s?.type || 'subscription', finalTx); }
    q.run(`UPDATE email_receipts SET status='approved', subscription_id=?, transaction_id=?, account_id=?, due_date=?, action=?, total=?, receipt_date=?, approved_by=?, approved_at=? WHERE id=?`,
      subId, action === 'link' || action === 'add_spend' ? finalTx : null, accountId, dueDate, action, total, date, userId, new Date().toISOString(), id);
    // remember this sender for next time (still needs approval, but the suggestion will be right)
    if (subId || accountId) q.run(`INSERT INTO email_sender_map(household_id,sender,subscription_id,account_id,category_id) VALUES(?,?,?,?,?)
      ON CONFLICT(household_id,sender) DO UPDATE SET subscription_id=excluded.subscription_id, account_id=COALESCE(excluded.account_id, email_sender_map.account_id), ignore=0`, hid, r.from_email, subId, accountId, o.category_id || null);
    return { ok: true, transaction_id: finalTx || null };
  }
}

function ignore(hid, id, { sender = false } = {}) {
  const r = q.get('SELECT * FROM email_receipts WHERE id=? AND household_id=?', id, hid);
  if (!r) throw new Error('Receipt not found');
  q.run(`UPDATE email_receipts SET status='ignored' WHERE id=?`, id);
  if (sender) q.run(`INSERT INTO email_sender_map(household_id,sender,ignore) VALUES(?,?,1) ON CONFLICT(household_id,sender) DO UPDATE SET ignore=1`, hid, r.from_email);
}

function undo(hid, id) {
  const r = q.get('SELECT * FROM email_receipts WHERE id=? AND household_id=?', id, hid);
  if (!r) throw new Error('Receipt not found');
  if (r.status === 'approved' && r.action === 'mark_paid' && r.subscription_id && r.due_date) require('./tracker').mark(hid, r.subscription_id, r.due_date, 'due');
  if (r.status === 'approved' && r.action === 'add_spend' && r.transaction_id) q.run(`DELETE FROM transactions WHERE id=? AND household_id=? AND source='email'`, r.transaction_id, hid);
  q.run(`UPDATE email_receipts SET status='pending', approved_at=NULL, approved_by=NULL, transaction_id=NULL, action=NULL WHERE id=?`, id);
}

function rematch(hid, id) {
  const r = q.get('SELECT * FROM email_receipts WHERE id=? AND household_id=?', id, hid);
  if (!r || r.status !== 'pending') return;
  q.run('UPDATE email_receipts SET suggested=? WHERE id=?', JSON.stringify(match(hid, r)), id);
}

// re-check pending suggestions (e.g. the bank payment has since arrived)
function rematchPending(hid) { for (const r of q.all(`SELECT id FROM email_receipts WHERE household_id=? AND status='pending'`, hid)) rematch(hid, r.id); }

function attachmentPath(hid, id, name) {
  const r = q.get('SELECT attachments FROM email_receipts WHERE id=? AND household_id=?', id, hid);
  const a = r && JSON.parse(r.attachments || '[]').find((x) => x.name === name);
  if (!a) return null;
  return { file: path.join(RECEIPT_DIR, String(id), a.name), type: a.type, name: a.name };
}

module.exports = { looksLikely, syncAccount, testConnection, processMessage, list, detail, approve, ignore, undo, rematch, rematchPending, attachmentPath, match, receiptScore, extractHeuristic, htmlToText };
