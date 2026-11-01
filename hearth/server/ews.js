// On-premises Exchange (2013 or newer) through Exchange Web Services, with NTLM (or Basic) sign-in.
// EWS URL is usually https://mail.yourdomain.com/EWS/Exchange.asmx.
// For Exchange Online / Microsoft 365 use the Microsoft account type instead (Microsoft has retired EWS there).
const { log } = require('./config');

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const envelope = (body) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Header><t:RequestServerVersion Version="Exchange2013" /></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;

function ntlmPost(acct, xml) {
  const httpntlm = require('httpntlm');
  return new Promise((resolve, reject) => {
    httpntlm.post({ url: acct.ews_url, username: acct.username, password: require('./secrets').decrypt(acct.password), domain: acct.ews_domain || '', workstation: '',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body: xml, rejectUnauthorized: !acct.allow_self_signed, timeout: 60000 },
    (err, res) => (err ? reject(err) : resolve({ status: res.statusCode, text: res.body })));
  });
}

async function basicPost(acct, xml) {
  const user = acct.ews_domain ? `${acct.ews_domain}\\${acct.username}` : acct.username;
  const r = await fetch(acct.ews_url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', Authorization: `Basic ${Buffer.from(`${user}:${require('./secrets').decrypt(acct.password)}`).toString('base64')}` }, body: xml, signal: AbortSignal.timeout(60000) });
  return { status: r.status, text: await r.text() };
}

async function send(acct, body) {
  if (!acct.ews_url) throw new Error('Enter the EWS URL, e.g. https://mail.yourdomain.com/EWS/Exchange.asmx');
  const xml = envelope(body);
  let res;
  try { res = await ntlmPost(acct, xml); } catch (e) { log.debug('NTLM failed, trying Basic', e.message); res = null; }
  if (!res || res.status === 401) res = await basicPost(acct, xml);
  if (res.status === 401) throw new Error('Exchange: sign-in failed — check username, domain and password');
  const text = String(res.text || '');
  const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
  if (fault) throw new Error(`Exchange: ${fault[1]}`);
  const errCode = text.match(/ResponseClass="Error"[\s\S]*?<m:ResponseCode>([^<]+)<\/m:ResponseCode>(?:[\s\S]*?<m:MessageText>([^<]+))?/);
  if (errCode) throw new Error(`Exchange ${errCode[1]}${errCode[2] ? `: ${errCode[2]}` : ''}`);
  if (res.status >= 400) throw new Error(`Exchange returned ${res.status}`);
  return text;
}

const tag = (xml, name) => [...xml.matchAll(new RegExp(`<t:${name}[^>]*>([\\s\\S]*?)</t:${name}>`, 'g'))].map((m) => m[1]);
const attr = (xml, name, a) => [...xml.matchAll(new RegExp(`<t:${name}[^>]*\\b${a}="([^"]+)"`, 'g'))].map((m) => m[1]);
const folderXml = (f) => (f === 'inbox' ? '<t:DistinguishedFolderId Id="inbox" />' : `<t:FolderId Id="${esc(f)}" />`);

async function folders(acct) {
  const xml = await send(acct, `<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape>
    <m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot" /></m:ParentFolderIds></m:FindFolder>`);
  const out = [{ id: 'inbox', name: 'Inbox' }];
  for (const f of xml.split('<t:Folder>').slice(1)) {
    const id = attr(f, 'FolderId', 'Id')[0]; const name = tag(f, 'DisplayName')[0];
    if (id && name && !/^inbox$/i.test(name)) out.push({ id, name });
  }
  return out;
}

async function test(acct) { const f = await folders(acct); return { folders: f, message: `Connected — ${f.length} folders` }; }

async function sync(acct, { full = false, looksLikely, processMessage }) {
  const state = full ? {} : JSON.parse(acct.state || '{}');
  let found = 0, scanned = 0;
  for (const folder of JSON.parse(acct.folders || '["inbox"]')) {
    const st = state[folder] || {};
    const since = st.last || new Date(Date.now() - (Number(acct.lookback_days) || 90) * 86400000).toISOString();
    let last = since;
    for (let offset = 0; offset < 20000; offset += 100) {
      const xml = await send(acct, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>
          <t:FieldURI FieldURI="item:Subject" /><t:FieldURI FieldURI="message:From" /><t:FieldURI FieldURI="item:DateTimeReceived" /><t:FieldURI FieldURI="item:HasAttachments" /></t:AdditionalProperties></m:ItemShape>
        <m:IndexedPageItemView MaxEntriesReturned="100" Offset="${offset}" BasePoint="Beginning" />
        <m:Restriction><t:IsGreaterThan><t:FieldURI FieldURI="item:DateTimeReceived" /><t:FieldURIOrConstant><t:Constant Value="${esc(since)}" /></t:FieldURIOrConstant></t:IsGreaterThan></m:Restriction>
        <m:SortOrder><t:FieldOrder Order="Ascending"><t:FieldURI FieldURI="item:DateTimeReceived" /></t:FieldOrder></m:SortOrder>
        <m:ParentFolderIds>${folderXml(folder)}</m:ParentFolderIds></m:FindItem>`);
      const items = xml.split('<t:Message>').slice(1);
      for (const it of items) {
        scanned++;
        const id = attr(it, 'ItemId', 'Id')[0]; const received = tag(it, 'DateTimeReceived')[0] || '';
        if (received > last) last = received;
        const likely = looksLikely({ subject: tag(it, 'Subject')[0] || '', fromName: tag(it, 'Name')[0] || '', fromEmail: (tag(it, 'EmailAddress')[0] || '').toLowerCase(), hasDoc: tag(it, 'HasAttachments')[0] === 'true' });
        if (!likely || !id) continue;
        try {
          const g = await send(acct, `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:IncludeMimeContent>true</t:IncludeMimeContent></m:ItemShape><m:ItemIds><t:ItemId Id="${esc(id)}" /></m:ItemIds></m:GetItem>`);
          const mime = tag(g, 'MimeContent')[0];
          if (mime && await processMessage(acct.household_id, acct, folder, null, Buffer.from(mime, 'base64'))) found++;
        } catch (e) { log.warning('EWS receipt failed', e.message); }
      }
      if (!/IncludesLastItemInRange="false"/.test(xml) || !items.length) break;
    }
    state[folder] = { last };
  }
  return { found, scanned, state };
}

module.exports = { test, sync, folders };
