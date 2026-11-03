// Quick notes: type "£12 lunch with Sam", "petrol 45 yesterday", "Ella's dentist £60 next Tue",
// "school trip £25 on 14/11" or "want a new TV under 400". The app works out what it is and files it.
const { q } = require('../../core/db');
const { normaliseMerchant, guessCategory, categoryIdByName } = require('../transactions/categorize');
const { ingest } = require('../transactions/ingest');
const A = require('../insights/analytics');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const KEYWORDS = [
  [/lunch|dinner|breakfast|brunch|coffee|meal|restaurant|drinks|pub/i, 'Restaurants & Cafés'], [/takeaway|deliveroo|pizza|chippy/i, 'Takeaway & Delivery'],
  [/petrol|diesel|fuel|charging/i, 'Fuel'], [/train|bus|taxi|uber|parking|tube/i, 'Transport'], [/grocer|food shop|supermarket|milk|bread/i, 'Supermarkets'],
  [/dentist|doctor|prescription|pharmacy|optician/i, 'Health & Pharmacy'], [/present|gift|birthday|wedding|christening|card/i, 'Gifts & Events'],
  [/school|nursery|childcare|kids|trip|uniform|club/i, 'Kids & Family'], [/vet|dog|cat|pet/i, 'Pets'], [/cinema|tickets|concert|gig|theatre/i, 'Entertainment'],
  [/clothes|shoes|jacket|dress/i, 'Clothing'], [/plumber|electrician|boiler|roofer|locksmith|builder|handyman|appliance/i, 'Home & DIY'],
  [/mechanic|garage|mot\b|tyres?|car repair|breakdown/i, 'Transport'], [/hotel|mileage|conference|client/i, 'Travel'], [/haircut|barber|salon/i, 'Other'], [/holiday|hotel|flight/i, 'Travel'], [/diy|paint|tools|garden/i, 'Home & DIY'],
];

function parseWhen(text, now = new Date()) {
  const t = text.toLowerCase();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (/\btoday\b|\bjust now\b/.test(t)) return { date: base, explicit: true };
  if (/\byesterday\b/.test(t)) return { date: A.addDays(base, -1), explicit: true };
  if (/\btomorrow\b/.test(t)) return { date: A.addDays(base, 1), explicit: true };
  const m = t.match(/\b(next|last|this)?\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/);
  if (m) {
    const target = WEEKDAYS.findIndex((w) => w.startsWith(m[2]));
    let diff = target - base.getDay();
    if (m[1] === 'last') diff = diff >= 0 ? diff - 7 : diff;
    else if (m[1] === 'next') diff = diff <= 0 ? diff + 7 : diff + (diff < 3 ? 7 : 0);
    else if (diff < 0) diff += 7;
    return { date: A.addDays(base, diff), explicit: true };
  }
  const dm = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (dm) { const y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : base.getFullYear(); return { date: new Date(y, Number(dm[2]) - 1, Number(dm[1]), 12), explicit: true }; }
  const mn = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/) || t.match(/\b(?:in\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (mn) {
    const day = mn.length === 3 ? Number(mn[1]) : 1; const mon = MONTHS.indexOf((mn[2] || mn[1]).slice(0, 3));
    let d = new Date(base.getFullYear(), mon, day, 12); if (d < A.addDays(base, -60)) d = new Date(base.getFullYear() + 1, mon, day, 12);
    return { date: d, explicit: true };
  }
  return { date: base, explicit: false };
}

function heuristicParse(hid, text) {
  const amountM = text.match(/(?:£|gbp\s?)?\b(\d{1,6}(?:[.,]\d{1,2})?)\s?(?:quid|pounds|gbp|£)?/i);
  const amount = amountM ? Number(amountM[1].replace(',', '.')) : null;
  const { date, explicit } = parseWhen(text);
  const isFuture = A.iso(date) > A.iso(new Date());
  const wantsToBuy = /\b(want|need|buy|looking for|get a new|save for|saving for)\b/i.test(text) && !/\b(spent|paid|bought)\b/i.test(text);
  const isIncome = /\b(got paid|received|refund|sold|income|earned)\b/i.test(text);
  const people = q.all('SELECT * FROM people WHERE household_id=?', hid);
  const person = people.find((p) => new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}('s)?\\b`, 'i').test(text));
  let category = null;
  for (const [re, name] of KEYWORDS) if (re.test(text)) { category = categoryIdByName(hid, name); break; }
  const cleaned = text.replace(amountM?.[0] || '', '')
    .replace(/\b(spent|paid|yesterday|today|tomorrow|quid|pounds|under|about|around|roughly)\b/gi, ' ')
    .replace(/\b(next|last|this)\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/gi, ' ').replace(/\bon\s+\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?/gi, ' ')
    .replace(/\b(want|need|buy|looking for|get)\s+(a|an|some)?\s*(new)?\b/gi, (m) => (wantsToBuy ? ' ' : m))
    .replace(/^\s*(on|for|at)\b|\b(on|for|at)\s*$/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!category) category = guessCategory(hid, normaliseMerchant(cleaned), cleaned, isIncome ? 1 : -1).id;
  const events = q.all('SELECT * FROM events WHERE household_id=? AND start BETWEEN ? AND ?', hid, A.iso(A.addDays(date, -3)), A.iso(A.addDays(date, 3)));
  const event = events.find((e) => e.title.toLowerCase().split(/\W+/).some((w) => w.length > 3 && text.toLowerCase().includes(w)));
  const type = wantsToBuy ? 'watch' : isFuture ? 'planned' : 'spend';
  const work = /\b(work|business|client|expenses?|claim(able)?|reimburs\w*|mileage)\b/i.test(text);
  const unexpectedCost = /\b(unexpected|emergency|surprise|out of the blue|broke|broken|repair|fixed|replace(ment)?|fine|penalty|vet)\b/i.test(text);
  const confidence = type === 'watch' ? (cleaned.length > 1 ? 0.85 : 0.3) : (amount ? 0.4 : 0) + (category ? 0.3 : 0) + (explicit ? 0.15 : 0.1) + 0.1;
  return { type, amount: amount != null ? (isIncome ? amount : -amount) : null, date: A.iso(date), description: cleaned || text, category_id: category,
    person_id: person?.id || null, event_id: event?.id || null, work_expense: work ? 1 : 0, unexpected: unexpectedCost && !work ? 1 : 0, confidence: Math.round(confidence * 100) / 100 };
}

async function aiParse(hid, text, base) {
  const { chatRaw } = require('../ai/ai');
  const cats = q.all('SELECT id, name FROM categories WHERE household_id=?', hid);
  const people = q.all('SELECT id, name FROM people WHERE household_id=?', hid);
  const out = await chatRaw(hid, [{ role: 'user', content: `Today is ${A.iso(new Date())}. Parse this quick money note into JSON with keys:
type ("spend" past purchase, "planned" future cost, "watch" something they want to buy, "income"), amount (number, negative for spending),
date (YYYY-MM-DD), description (short), category_id (from: ${cats.map((c) => `${c.id}=${c.name}`).join(', ')}), person_id (from: ${people.map((p) => `${p.id}=${p.name}`).join(', ') || 'none'} or null).
A rule-based guess was: ${JSON.stringify(base)}. Note: "${text}"` }], { json: true, temperature: 0 });
  const p = JSON.parse(out);
  return { ...base, ...p, type: p.type === 'income' ? 'spend' : p.type || base.type, confidence: Math.max(base.confidence, 0.8), by: 'ai' };
}

async function processNote(hid, userId, text, { useAI = true, accountId = null } = {}) {
  let parsed = heuristicParse(hid, text);
  if (useAI && (parsed.confidence < 0.8 || !parsed.category_id)) { try { parsed = await aiParse(hid, text, parsed); } catch { /* AI optional */ } }
  const noteId = Number(q.run('INSERT INTO notes(household_id,user_id,text,parsed,status) VALUES(?,?,?,?,?)', hid, userId, text, JSON.stringify(parsed), 'new').lastInsertRowid);
  const confident = (parsed.amount != null || parsed.type === 'watch') && parsed.confidence >= 0.7;
  let created = null;
  if (confident) created = fileNote(hid, userId, noteId, parsed, accountId);
  else q.run(`UPDATE notes SET status='needs_review' WHERE id=?`, noteId);
  if (created?.then) created = await created;
  return { id: noteId, parsed, status: confident ? 'filed' : 'needs_review', created };
}

async function fileNote(hid, userId, noteId, p, accountId = null) {
  let created;
  if (p.type === 'watch') {
    const r = q.run('INSERT INTO watches(household_id,user_id,query,target_price) VALUES(?,?,?,?)', hid, userId, p.description, p.amount ? Math.abs(p.amount) : null);
    created = { kind: 'watch', id: Number(r.lastInsertRowid) };
  } else if (p.type === 'planned') {
    const r = q.run(`INSERT INTO events(household_id,title,start,estimated_cost,person_id,notes,source) VALUES(?,?,?,?,?,?,'note')`,
      hid, p.description, p.date, p.amount ? Math.abs(p.amount) : null, p.person_id, 'From quick note');
    created = { kind: 'event', id: Number(r.lastInsertRowid) };
  } else {
    const res = await ingest(hid, [{ date: p.date, amount: p.amount, description: p.description, merchant: normaliseMerchant(p.description),
      category_id: p.category_id, person_id: p.person_id, event_id: p.event_id, account_id: accountId, notes: 'From quick note' }], { source: 'note', userId });
    created = { kind: 'transaction', id: res.ids[0] };
    if (created.id && (p.work_expense || p.unexpected)) q.run(`UPDATE transactions SET work_expense=?, claim_status=?, unexpected=? WHERE id=?`, p.work_expense ? 1 : 0, p.work_expense ? 'to_claim' : null, p.unexpected ? 1 : 0, created.id);
    if (created.id) q.run('UPDATE notes SET transaction_id=? WHERE id=?', created.id, noteId);
  }
  q.run(`UPDATE notes SET status='filed', parsed=? WHERE id=?`, JSON.stringify(p), noteId);
  return created;
}

module.exports = { processNote, fileNote, heuristicParse, parseWhen };
