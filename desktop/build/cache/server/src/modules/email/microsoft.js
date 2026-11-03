// Microsoft 365 / Outlook.com / Exchange Online through Microsoft Graph.
//
// Uses your own free Entra ID app registration (public client) and the OAuth device-code sign-in:
// Hearth shows a short code, you enter it at microsoft.com/devicelogin, and Hearth keeps a refresh token.
// No redirect URL is needed, so it works inside Home Assistant's ingress panel. Same approach as LifeHub.
//
// Read-only scopes: Mail.Read (receipts) and Calendars.Read (calendar copies).
const { q } = require('../../core/db');
const { log } = require('../../core/config');

const SCOPES = 'offline_access User.Read Mail.Read Calendars.Read';
// Overridable only for local testing
const LOGIN = () => (process.env.MS_LOGIN_BASE || 'https://login.microsoftonline.com').replace(/\/$/, '');
const GRAPH = () => (process.env.MS_GRAPH_BASE || 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');

const tokens = new Map();          // account id → { token, expires }
const logins = new Map();          // account id → { status, message, user_code, verification_uri, expires }

const authority = (a) => `${LOGIN()}/${encodeURIComponent((a.graph_tenant || 'common').trim() || 'common')}/oauth2/v2.0`;
const errText = (j) => (j?.error_description ? String(j.error_description).split('\n')[0] : j?.error?.message || (typeof j?.error === 'string' ? j.error : JSON.stringify(j || {}).slice(0, 200)));
const form = (o) => new URLSearchParams(o).toString();

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

// Step 1: ask Microsoft for a sign-in code
async function startLogin(acct) {
  if (!acct.graph_client_id) throw new Error('Enter the Application (client) ID from your Entra app registration first');
  const { ok, j } = await post(`${authority(acct)}/devicecode`, { client_id: acct.graph_client_id.trim(), scope: SCOPES });
  if (!ok) throw new Error(`Microsoft: ${errText(j)}`);
  const info = { status: 'waiting', user_code: j.user_code, verification_uri: j.verification_uri || j.verification_url, message: j.message,
    expires: Date.now() + (Number(j.expires_in) || 900) * 1000 };
  logins.set(acct.id, info);
  poll(acct, j.device_code, Math.max(2, Number(j.interval) || 5)).catch((e) => logins.set(acct.id, { ...info, status: 'failed', message: e.message }));
  return info;
}

// Step 2: wait (in the background) for the person to finish signing in
async function poll(acct, deviceCode, interval) {
  const info = logins.get(acct.id);
  while (Date.now() < info.expires) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const { ok, j } = await post(`${authority(acct)}/token`, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: acct.graph_client_id.trim(), device_code: deviceCode });
    if (ok) {
      store(acct.id, j);
      const me = await graph(acct.id, '/me?$select=mail,userPrincipalName,displayName').catch(() => ({}));
      const address = me.mail || me.userPrincipalName || '';
      q.run('UPDATE email_accounts SET address=?, username=COALESCE(NULLIF(username,\'\'),?), last_error=NULL WHERE id=?', address, address, acct.id);
      logins.set(acct.id, { status: 'done', message: `Signed in as ${address || 'your Microsoft account'}` });
      return;
    }
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { interval += 5; continue; }
    logins.set(acct.id, { status: 'failed', message: `Sign-in failed: ${errText(j)}` });
    return;
  }
  logins.set(acct.id, { status: 'failed', message: 'The sign-in code expired — press Sign in again.' });
}

function store(id, j) {
  tokens.set(id, { token: j.access_token, expires: Date.now() + ((Number(j.expires_in) || 3600) - 120) * 1000 });
  if (j.refresh_token) q.run('UPDATE email_accounts SET graph_refresh_token=? WHERE id=?', require('../../core/secrets').encrypt(j.refresh_token), id);
}

async function accessToken(id) {
  const t = tokens.get(id);
  if (t && t.expires > Date.now()) return t.token;
  const a = q.get('SELECT * FROM email_accounts WHERE id=?', id);
  if (!a?.graph_refresh_token) throw new Error('Not signed in to Microsoft yet — press Sign in with Microsoft');
  const { ok, j } = await post(`${authority(a)}/token`, { grant_type: 'refresh_token', client_id: a.graph_client_id.trim(), refresh_token: require('../../core/secrets').decrypt(a.graph_refresh_token), scope: SCOPES });
  if (!ok) throw new Error(`Microsoft sign-in has expired — sign in again (${errText(j)})`);
  store(id, j);
  return tokens.get(id).token;
}

async function graph(id, pathOrUrl, { raw = false } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH()}${pathOrUrl}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken(id)}`, Prefer: 'outlook.timezone="UTC", IdType="ImmutableId"' }, signal: AbortSignal.timeout(60000) });
  if (raw) { if (!r.ok) throw new Error(`Microsoft Graph returned ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Microsoft Graph${j?.error ? `: ${errText(j)}` : ` returned ${r.status}`}`);
  return j;
}

async function* pages(id, path) {
  let next = path;
  while (next) { const j = await graph(id, next); for (const v of j.value || []) yield v; next = j['@odata.nextLink'] || null; }
}

async function folders(acct) {
  const out = [{ id: 'inbox', name: 'Inbox' }];
  for await (const f of pages(acct.id, '/me/mailFolders?$top=100&$select=id,displayName,childFolderCount')) {
    if (/^inbox$/i.test(f.displayName)) { out[0].id = 'inbox'; continue; }
    out.push({ id: f.id, name: f.displayName });
    if (f.childFolderCount) for await (const c of pages(acct.id, `/me/mailFolders/${f.id}/childFolders?$top=100&$select=id,displayName`)) out.push({ id: c.id, name: `${f.displayName}/${c.displayName}` });
  }
  return out;
}

async function test(acct) {
  const box = await graph(acct.id, '/me/mailFolders/inbox?$select=displayName,totalItemCount');
  return { folders: await folders(acct), message: `Connected — Inbox has ${box.totalItemCount} messages` };
}

// Fetch new mail from each chosen folder, pre-filter on headers, and pass the full MIME of likely receipts to the receipt reader
async function sync(acct, { full = false, looksLikely, processMessage }) {
  const state = full ? {} : JSON.parse(acct.state || '{}');
  const chosen = JSON.parse(acct.folders || '["inbox"]');
  let found = 0, scanned = 0;
  for (const folder of chosen) {
    const st = state[folder] || {};
    const since = st.last || new Date(Date.now() - (Number(acct.lookback_days) || 90) * 86400000).toISOString();
    const filter = encodeURIComponent(`receivedDateTime gt ${since.replace(/\.\d+Z$/, 'Z')}`);
    let last = st.last || since;
    for await (const m of pages(acct.id, `/me/mailFolders/${encodeURIComponent(folder)}/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=100&$select=id,internetMessageId,subject,from,receivedDateTime,hasAttachments`)) {
      scanned++;
      if (m.receivedDateTime > last) last = m.receivedDateTime;
      const from = m.from?.emailAddress || {};
      if (!looksLikely({ subject: m.subject || '', fromName: from.name || '', fromEmail: (from.address || '').toLowerCase(), hasDoc: !!m.hasAttachments })) continue;
      try {
        const mime = await graph(acct.id, `/me/messages/${encodeURIComponent(m.id)}/$value`, { raw: true });
        if (await processMessage(acct.household_id, acct, folder, null, mime)) found++;
      } catch (e) { log.warning('Graph receipt failed', e.message); }
    }
    state[folder] = { last };
  }
  return { found, scanned, state };
}

// Calendar events between two ISO dates (for Hearth's local calendar copy)
async function calendarEvents(acctId, start, end) {
  const out = [];
  for await (const e of pages(acctId, `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=200&$select=id,iCalUId,subject,start,end,isAllDay,location,bodyPreview,isCancelled`)) {
    if (e.isCancelled) continue;
    const parse = (x) => (e.isAllDay ? `${x.dateTime.slice(0, 10)}T12:00:00Z` : `${x.dateTime.replace(/\.\d+$/, '')}Z`);
    out.push({ uid: `${e.iCalUId || e.id}::${e.start.dateTime.slice(0, 16)}`, title: e.subject || '(untitled)', start: parse(e.start), end: e.end ? parse(e.end) : null, location: e.location?.displayName || '', description: e.bodyPreview || '' });
  }
  return out;
}

const loginStatus = (id) => logins.get(id) || null;
// Drop cached tokens and sign-in state (account removed or its app details changed)
const forget = (id) => { tokens.delete(Number(id)); logins.delete(Number(id)); };
const signedIn = (a) => !!a.graph_refresh_token;

module.exports = { forget, startLogin, loginStatus, test, sync, folders, calendarEvents, signedIn, SCOPES };
