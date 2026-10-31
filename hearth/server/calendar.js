// Calendar sync: Google, Outlook.com and Exchange/Microsoft 365 all publish iCalendar (ICS) feeds.
// Each feed is downloaded on a schedule and a full local copy of the events is kept in the database.
const ical = require('node-ical');
const { q } = require('./db');
const A = require('./analytics');

async function syncHomeAssistant(cal) {
  const ha = require('./ha');
  const seen = new Set(); let count = 0;
  // fetch a year at a time: 3 years back, 2 years ahead
  for (let y = -3; y < 2; y++) {
    const start = A.addDays(new Date(), y * 365).toISOString(), end = A.addDays(new Date(), (y + 1) * 365).toISOString();
    const evs = await ha.calendarEvents(cal.household_id, cal.url, start, end);
    for (const ev of evs) {
      const s = ev.start?.dateTime || ev.start?.date, e = ev.end?.dateTime || ev.end?.date;
      if (!s) continue;
      const uid = `${ev.uid || ev.summary}::${s}`;
      if (seen.has(uid)) continue; seen.add(uid);
      q.run(`INSERT INTO events(household_id,calendar_id,uid,title,start,end,location,description,source) VALUES(?,?,?,?,?,?,?,?,?)
             ON CONFLICT(calendar_id,uid) DO UPDATE SET title=excluded.title, start=excluded.start, end=excluded.end, location=excluded.location, description=excluded.description`,
        cal.household_id, cal.id, uid, ev.summary || '(untitled)', new Date(s.length === 10 ? `${s}T12:00:00` : s).toISOString(), e ? new Date(e.length === 10 ? `${e}T12:00:00` : e).toISOString() : null,
        ev.location || '', String(ev.description || '').slice(0, 2000), 'homeassistant');
      count++;
    }
  }
  return { seen, count };
}

async function syncCalendar(cal) {
  try {
    if (cal.provider === 'homeassistant') {
      const { seen, count } = await syncHomeAssistant(cal);
      for (const e of q.all('SELECT id, uid, budget, estimated_cost FROM events WHERE calendar_id=?', cal.id)) if (!seen.has(e.uid) && e.budget == null && e.estimated_cost == null) q.run('DELETE FROM events WHERE id=?', e.id);
      q.run('UPDATE calendars SET last_sync=?, last_error=NULL WHERE id=?', new Date().toISOString(), cal.id);
      return { events: count };
    }
    const headers = {};
    const creds = cal.credentials ? JSON.parse(cal.credentials) : null;
    if (creds?.username) headers.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
    const url = cal.url.replace(/^webcals?:\/\//i, 'https://');
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Calendar feed returned ${r.status}`);
    const data = ical.sync.parseICS(await r.text());
    const from = A.addDays(new Date(), -365 * 3), to = A.addDays(new Date(), 365 * 2);
    const seen = new Set();
    let count = 0;
    const upsert = (uid, ev, start, end) => {
      seen.add(uid);
      q.run(`INSERT INTO events(household_id,calendar_id,uid,title,start,end,location,description,source) VALUES(?,?,?,?,?,?,?,?,?)
             ON CONFLICT(calendar_id,uid) DO UPDATE SET title=excluded.title, start=excluded.start, end=excluded.end, location=excluded.location, description=excluded.description`,
        cal.household_id, cal.id, uid, String(ev.summary?.val ?? ev.summary ?? '(untitled)'), new Date(start).toISOString(), end ? new Date(end).toISOString() : null,
        String(ev.location?.val ?? ev.location ?? ''), String(ev.description?.val ?? ev.description ?? '').slice(0, 2000), cal.provider);
      count++;
    };
    for (const ev of Object.values(data)) {
      if (ev.type !== 'VEVENT' || !ev.start) continue;
      const dur = ev.end ? new Date(ev.end) - new Date(ev.start) : 0;
      if (ev.rrule) {
        for (const occ of ev.rrule.between(from, to, true).slice(0, 500)) {
          const key = occ.toISOString().slice(0, 10);
          if (ev.exdate && Object.keys(ev.exdate).some((k) => k.startsWith(key))) continue;
          const override = ev.recurrences?.[key];
          upsert(`${ev.uid}::${key}`, override || ev, override?.start || occ, override?.end || new Date(occ.getTime() + dur));
        }
      } else if (new Date(ev.start) >= from && new Date(ev.start) <= to) upsert(ev.uid, ev, ev.start, ev.end);
    }
    // remove events deleted at the source — but keep any you've attached budgets/costs to
    const existing = q.all('SELECT id, uid, budget, estimated_cost FROM events WHERE calendar_id=?', cal.id);
    for (const e of existing) if (!seen.has(e.uid) && e.budget == null && e.estimated_cost == null) q.run('DELETE FROM events WHERE id=?', e.id);
    q.run('UPDATE calendars SET last_sync=?, last_error=NULL WHERE id=?', new Date().toISOString(), cal.id);
    return { events: count };
  } catch (e) {
    q.run('UPDATE calendars SET last_error=? WHERE id=?', e.message, cal.id);
    throw e;
  }
}

// What did similar past events actually cost? Matches by title words, then sums linked + same-day spending.
function eventCostHistory(hid, eventId) {
  const ev = q.get('SELECT * FROM events WHERE id=? AND household_id=?', eventId, hid);
  if (!ev) return null;
  const words = ev.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !['with', 'from', 'meeting', 'call'].includes(w));
  const similar = words.length ? q.all(`SELECT * FROM events WHERE household_id=? AND id!=? AND start<? AND (${words.map(() => 'LOWER(title) LIKE ?').join(' OR ')}) ORDER BY start DESC LIMIT 10`,
    hid, ev.id, A.iso(new Date()), ...words.map((w) => `%${w}%`)) : [];
  const withCost = similar.map((s) => {
    const linked = q.get('SELECT COALESCE(SUM(-amount),0) v FROM transactions WHERE event_id=? AND amount<0', s.id).v;
    return { ...s, actual: Math.round(linked * 100) / 100 };
  });
  const linkedNow = q.all('SELECT * FROM transactions WHERE event_id=? ORDER BY date', ev.id);
  const spent = linkedNow.reduce((s, t) => s - t.amount, 0);
  const costed = withCost.filter((s) => s.actual > 0);
  const suggested = costed.length ? Math.round(costed.reduce((s, x) => s + x.actual, 0) / costed.length) : null;
  // candidate transactions around the event date to link with one tap
  const nearby = q.all(`SELECT * FROM transactions WHERE household_id=? AND event_id IS NULL AND amount<0 AND date BETWEEN ? AND ? ORDER BY ABS(julianday(date)-julianday(?)) LIMIT 15`,
    hid, A.iso(A.addDays(ev.start, -2)), A.iso(A.addDays(ev.start, 2)), ev.start.slice(0, 10));
  return { event: ev, spent: Math.round(spent * 100) / 100, transactions: linkedNow, similar: withCost, suggested_budget: suggested, nearby };
}

module.exports = { syncCalendar, eventCostHistory };
