// Network helpers: the addresses phones can use to reach this computer, and whether a port is free.
const os = require('os');
const net = require('net');

/** Addresses on the local network, best first: e.g. [{ url: 'http://192.168.1.20:8484', label: 'Wi-Fi' }] */
function lanAddresses(port = 8484) {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // no network (self-assigned)
      const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|tailscale|zt|lo)/i.test(name) || a.address.startsWith('172.17.');
      const vpn = /^(tailscale|utun|wg|zt)/i.test(name) || a.address.startsWith('100.');
      out.push({ url: `http://${a.address}:${port}`, address: a.address, interface: name, label: vpn ? 'VPN (e.g. Tailscale)' : virtual ? 'virtual network' : 'home network', rank: vpn ? 1 : virtual ? 2 : 0 });
    }
  }
  out.sort((a, b) => a.rank - b.rank || (/^192\.168\./.test(a.address) ? -1 : 1));
  const host = os.hostname().replace(/\.local$/, '');
  if (host && process.platform === 'darwin') out.push({ url: `http://${host}.local:${port}`, address: `${host}.local`, interface: 'bonjour', label: 'computer name', rank: 3 });
  return out.map(({ rank, ...a }) => a);
}

/** Resolves true if nothing is listening on the port. */
function portFree(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

/** Find a free port starting at `start`. */
async function findFreePort(start = 8484, host) {
  for (let p = start; p < start + 50; p++) if (await portFree(p, host)) return p;
  throw new Error(`No free port between ${start} and ${start + 49}`);
}

module.exports = { lanAddresses, portFree, findFreePort };
