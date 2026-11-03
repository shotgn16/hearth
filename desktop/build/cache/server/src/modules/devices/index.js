// Phones & devices — the addresses and QR codes for connecting the Hearth phone app or another computer.
const fs = require('fs');
const QR = require('qrcode');
const { config } = require('../../core/config');
const { lanAddresses } = require('../../cli/network');
const { wrap } = require('../../core/http');

const RELEASES = 'https://github.com/shotgn16/hearth/releases/latest';
const deepLink = (url) => `hearth://connect?url=${encodeURIComponent(url)}`;
const isLocal = (h) => /^(localhost|127\.|\[?::1\]?$)/.test(h);

// Where is this Hearth running? Set HEARTH_MODE=desktop|service from the desktop app or service installer.
function context() {
  if (config.isAddon) return 'addon';
  if (process.env.HEARTH_MODE) return process.env.HEARTH_MODE;
  if (fs.existsSync('/.dockerenv')) return 'docker';
  return 'server';
}

// As a Home Assistant add-on: which host port (if any) is mapped to Hearth's 8484 on the add-on's Network settings
let addonPortCache;
async function addonPort() {
  if (addonPortCache !== undefined) return addonPortCache;
  try {
    const r = await fetch('http://supervisor/addons/self/info', { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` }, signal: AbortSignal.timeout(5000) });
    const j = await r.json(); addonPortCache = j.data?.network?.['8484/tcp'] || null;
  } catch { addonPortCache = null; }
  setTimeout(() => { addonPortCache = undefined; }, 60000).unref();
  return addonPortCache;
}

async function addresses(req) {
  const ctx = context();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const hostname = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0];
  const out = [];
  const add = (url, label) => { if (url && !out.some((x) => x.url === url)) out.push({ url, label }); };
  const info = { context: ctx, localOnly: config.host === '127.0.0.1' };

  if (ctx === 'addon') {
    info.addonPort = await addonPort();
    if (info.addonPort && hostname && !isLocal(hostname)) add(`http://${hostname}:${info.addonPort}`, 'Home Assistant computer');
    return { ...info, addresses: out };
  }
  // The address this browser used, if it isn't "localhost" (e.g. an HTTPS reverse proxy, or this computer's IP)
  if (hostname && !isLocal(hostname) && !req.headers['x-ingress-path']) add(`${proto}://${hostHeader}`, proto === 'https' ? 'secure address' : 'the address you are using');
  if (ctx !== 'docker' && !info.localOnly) for (const a of lanAddresses(config.port)) add(a.url, a.label);
  return { ...info, addresses: out };
}

function routes(api) {
  api.get('/devices', wrap(async (req, res) => {
    const info = await addresses(req);
    for (const a of info.addresses) {
      a.qr_app = await QR.toString(deepLink(a.url), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      a.qr_web = await QR.toString(a.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      a.deep_link = deepLink(a.url);
    }
    res.json({ ...info, downloads: RELEASES });
  }));
}

module.exports = { name: 'devices', title: 'Phones & devices', routes, deepLink };
