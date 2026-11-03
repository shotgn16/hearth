// The Hearth servers this phone knows about, and how addresses and QR codes are read.
// Plain functions with no phone-specific code, so they can be tested on a computer (see test/).

/** Tidy what someone typed into a Hearth address: "192.168.1.20:8484" → "http://192.168.1.20:8484" */
export function normaliseAddress(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (!u.hostname) return '';
  // A pasted page link (…/#/money) still means the server itself
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '').replace(/\/index\.html$/, '')}`;
}

/** What a scanned QR code or opened link points at: hearth://connect?url=… or a plain Hearth address */
export function addressFromLink(text) {
  const s = String(text || '').trim();
  if (/^hearth:/i.test(s)) {
    try {
      const u = new URL(s.replace(/^hearth:\/\//i, 'https://hearth.invalid/'));
      return normaliseAddress(u.searchParams.get('url'));
    } catch { return ''; }
  }
  if (/^https?:\/\//i.test(s)) return normaliseAddress(s);
  return '';
}

/** Explain why a Hearth couldn't be reached, in plain words */
export function explainFailure(err, address) {
  const msg = String(err?.message || err || '');
  if (/not a hearth/i.test(msg)) return `${address} answered, but it isn't Hearth. Check the port number (usually 8484).`;
  if (/timed? ?out|abort/i.test(msg)) return `No answer from ${address}. Is the computer running Hearth switched on, and is this phone on the same Wi-Fi (or VPN)?`;
  if (/:8123\b/.test(address)) return 'That is Home Assistant itself. Use the Hearth add-on\'s own port (set it on the add-on\'s Configuration tab → Network), e.g. :8484.';
  return `Couldn't reach ${address}. Check the address, and that this phone is on the same Wi-Fi (or VPN) as Hearth.`;
}

/** Ask a Hearth server who it is. Resolves { version, needsSetup } or throws. */
export async function checkServer(address, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${address}/api/status`, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`Not a Hearth server (HTTP ${r.status})`);
    const j = await r.json().catch(() => ({}));
    if (typeof j.needsSetup !== 'boolean') throw new Error('Not a Hearth server');
    return { version: j.version, needsSetup: j.needsSetup };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timed out');
    throw e;
  } finally { clearTimeout(t); }
}

/** The saved list, newest first: [{ url, name, lastUsed }] */
export class ServerList {
  constructor(storage, key = 'hearth.servers') { this.storage = storage; this.key = key; }
  all() {
    try { const v = JSON.parse(this.storage.getItem(this.key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  save(list) { try { this.storage.setItem(this.key, JSON.stringify(list.slice(0, 12))); } catch { /* storage full or blocked */ } }
  remember(url, name) {
    const list = this.all().filter((s) => s.url !== url);
    list.unshift({ url, name: name || new URL(url).host, lastUsed: Date.now() });
    this.save(list);
  }
  forget(url) { this.save(this.all().filter((s) => s.url !== url)); }
  last() { return this.all()[0] || null; }
}
