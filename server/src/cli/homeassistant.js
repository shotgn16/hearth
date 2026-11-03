// Install Hearth as a Home Assistant add-on, remotely: adds this repository to the add-on store, installs the
// add-on, turns on "Show in sidebar" and starts it. Talks to Home Assistant's WebSocket API with a long-lived
// access token from an administrator (HA → your profile → Security → Long-lived access tokens).
const crypto = require('crypto');
const { CliError } = require('./util');

const REPOSITORY = process.env.HEARTH_ADDON_REPOSITORY || 'https://github.com/shotgn16/hearth';
const ADDON = 'hearth';
// The Supervisor names third-party add-ons <first 8 hex of sha1(repository url)>_<slug>
const expectedSlug = (repo = REPOSITORY) => `${crypto.createHash('sha1').update(repo.toLowerCase()).digest('hex').slice(0, 8)}_${ADDON}`;
// One-click link that opens "Add repository" in the person's own Home Assistant
const myLink = (repo = REPOSITORY) => `https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=${encodeURIComponent(repo)}`;

function normaliseUrl(u) {
  let url = String(u || '').trim().replace(/\/+$/, '');
  if (!url) throw new CliError('Enter the address of your Home Assistant, e.g. http://homeassistant.local:8123');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/:\d+$/.test(new URL(url).host) && url.startsWith('http://')) url = `${url}:8123`;
  return url;
}

/** A tiny Home Assistant WebSocket client: connect(), call(msg), close() */
async function connect(haUrl, token, { timeoutMs = 15000 } = {}) {
  const wsUrl = `${haUrl.replace(/^http/i, 'ws')}/api/websocket`;
  const ws = new WebSocket(wsUrl);
  let nextId = 1; const waiting = new Map();
  const opened = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new CliError(`Couldn't reach Home Assistant at ${haUrl} — check the address and that this computer is on the same network.`)), timeoutMs);
    ws.addEventListener('error', () => { clearTimeout(t); reject(new CliError(`Couldn't connect to Home Assistant at ${haUrl}.`)); });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (m.type === 'auth_ok') { clearTimeout(t); resolve(m.ha_version); }
      else if (m.type === 'auth_invalid') { clearTimeout(t); reject(new CliError('Home Assistant rejected the access token. Create a new long-lived access token and paste all of it.')); }
      else if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.success === false ? w.reject(m.error || {}) : w.resolve(m.result); }
    });
    ws.addEventListener('close', () => { for (const w of waiting.values()) w.reject({ message: 'Home Assistant closed the connection' }); });
  });
  const version = await opened.catch((e) => { try { ws.close(); } catch { /* already closed */ } throw e; });
  const call = (msg) => new Promise((resolve, reject) => { const id = nextId++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, ...msg })); });
  // Supervisor API through Home Assistant (admin only); timeout null = wait as long as it takes
  const supervisor = (endpoint, method = 'get', data, timeout = 60) => call({ type: 'supervisor/api', endpoint, method, ...(data ? { data } : {}), timeout });
  return { version, call, supervisor, close: () => ws.close() };
}

function explain(e) {
  const msg = e?.message || String(e);
  if (e?.code === 'unknown_command') return new CliError('This Home Assistant has no add-on store (it\'s a Container or Core install). Choose Docker instead, then connect Hearth to Home Assistant from Settings → Integrations.');
  if (e?.code === 'unauthorized') return new CliError('The access token must belong to a Home Assistant administrator.');
  return new CliError(msg);
}

async function install(o, r) {
  const haUrl = normaliseUrl(o.url);
  if (!o.token || o.token === true) throw new CliError('A long-lived access token is needed: in Home Assistant open your profile → Security → Long-lived access tokens → Create token.');
  r.step(`Connecting to Home Assistant at ${haUrl}`);
  const ha = await connect(haUrl, String(o.token).trim());
  try {
    r.ok(`Connected to Home Assistant ${ha.version}`);
    r.step('Adding the Hearth repository to the add-on store');
    try { await ha.supervisor('/store/repositories', 'post', { repository: REPOSITORY }); }
    catch (e) { if (!/already|exist/i.test(e?.message || '')) throw explain(e); }
    await ha.supervisor('/store/reload', 'post').catch(() => {});

    const store = await ha.supervisor('/store/addons').catch(() => null);
    const found = store?.addons?.find((a) => a.slug === expectedSlug() || (a.slug.endsWith(`_${ADDON}`) && /hearth/i.test(a.repository || a.url || '')));
    const slug = found?.slug || expectedSlug();
    if (!found?.installed) {
      r.step('Installing the Hearth add-on (Home Assistant downloads it — a few minutes on a Raspberry Pi)');
      await ha.supervisor(`/store/addons/${slug}/install`, 'post', undefined, null).catch((e) => { throw explain(e); });
    } else r.ok('The Hearth add-on is already installed');
    r.step('Turning on "Start on boot", the watchdog and "Show in sidebar"');
    await ha.supervisor(`/addons/${slug}/options`, 'post', { boot: 'auto', watchdog: true, ingress_panel: true }).catch((e) => r.warn(`Couldn't change the add-on options: ${e.message}`));
    r.step('Starting Hearth');
    await ha.supervisor(`/addons/${slug}/start`, 'post', undefined, 120).catch((e) => { if (!/already running/i.test(e?.message || '')) throw explain(e); });
    const info = await ha.supervisor(`/addons/${slug}/info`).catch(() => ({}));
    const panelUrl = `${haUrl}/${slug}`;
    r.ok(`Hearth is running in Home Assistant${info.version ? ` (version ${info.version})` : ''}. Open it from the Home Assistant sidebar.`);
    return { slug, haUrl, panelUrl, addonPage: `${haUrl}/hassio/addon/${slug}/info`, version: info.version };
  } finally { ha.close(); }
}

/** Check the URL and token without changing anything (used by the desktop wizard's "Test" button). */
async function test(o) {
  const haUrl = normaliseUrl(o.url);
  const ha = await connect(haUrl, String(o.token || '').trim());
  try {
    const sup = await ha.supervisor('/supervisor/info').then(() => true).catch((e) => (e?.code === 'unknown_command' ? false : null));
    return { haUrl, version: ha.version, addons: sup };
  } finally { ha.close(); }
}

module.exports = { install, test, connect, expectedSlug, myLink, normaliseUrl, REPOSITORY };
