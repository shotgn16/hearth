// Checks for the hearth-server command-line tool: service files, Docker compose file, Home Assistant installer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { parseArgs } = require('../src/cli/util');
const service = require('../src/cli/service');

const quiet = { step() {}, ok() {}, warn() {}, info() {}, result() {} };

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['service', 'install', '--port', '9000', '--host=127.0.0.1', '--dry-run', '--copy-to', '/opt/x']),
    { _: ['service', 'install'], port: '9000', host: '127.0.0.1', dryRun: true, copyTo: '/opt/x' });
});

test('service options have safe defaults', () => {
  const o = service.resolveOptions({});
  assert.equal(o.port, 8484);
  assert.equal(o.host, '0.0.0.0');
  assert.equal(o.scope, 'system');
  const u = service.resolveOptions({ scope: 'user', host: '127.0.0.1', port: '9001' });
  assert.equal(u.scope, 'user');
  assert.equal(u.port, 9001);
});

const opt = { ...service.resolveOptions({ port: 8484 }), nodePath: '/opt/hearth-server/runtime/node', serverDir: '/opt/hearth-server/server', dataDir: '/var/lib/hearth', timezone: 'Europe/London' };

test('systemd unit runs as its own user with hardening', () => {
  const u = require('../src/cli/service/linux').unit(opt, 'hearth');
  assert.match(u, /^User=hearth$/m);
  assert.match(u, /ExecStart="\/opt\/hearth-server\/runtime\/node" "\/opt\/hearth-server\/server\/src\/index.js"/);
  assert.match(u, /Environment="DATA_DIR=\/var\/lib\/hearth"/);
  assert.match(u, /ProtectSystem=strict/);
  assert.match(u, /ReadWritePaths=\/var\/lib\/hearth/);
  assert.match(u, /WantedBy=multi-user.target/);
  const user = require('../src/cli/service/linux').unit({ ...opt, scope: 'user', dataDir: '/home/a/.local/share/hearth' }, 'a');
  assert.doesNotMatch(user, /^User=/m);
  assert.match(user, /WantedBy=default.target/);
});

test('launchd plist is valid XML with escaped values', () => {
  const p = require('../src/cli/service/macos').plist({ ...opt, dataDir: '/Library/Application Support/Hearth & Co' }, 'jack');
  assert.match(p, /<key>UserName<\/key><string>jack<\/string>/);
  assert.match(p, /Hearth &amp; Co/);
  assert.match(p, /<key>KeepAlive<\/key><true\/>/);
});

test('Windows service config for WinSW', () => {
  const x = require('../src/cli/service/windows').config({ ...opt, nodePath: 'C:\\Program Files\\Hearth Server\\runtime\\node.exe', serverDir: 'C:\\Program Files\\Hearth Server\\server', dataDir: 'C:\\ProgramData\\Hearth' });
  assert.match(x, /<id>Hearth<\/id>/);
  assert.match(x, /<startmode>Automatic<\/startmode>/);
  assert.match(x, /<env name="DATA_DIR" value="C:\\ProgramData\\Hearth"\/>/);
});

test('Docker compose file keeps data in ./data and can stay private', () => {
  const { compose } = require('../src/cli/docker');
  const c = compose({ image: 'ghcr.io/shotgn16/hearth:latest', name: 'hearth', host: '127.0.0.1', port: 9000, timezone: 'Europe/London', ollamaUrl: 'http://host.docker.internal:11434' });
  assert.match(c, /- "127\.0\.0\.1:9000:8484"/);
  assert.match(c, /- \.\/data:\/data/);
  assert.match(c, /restart: unless-stopped/);
});

test('Home Assistant address is normalised', () => {
  const { normaliseUrl, expectedSlug } = require('../src/cli/homeassistant');
  assert.equal(normaliseUrl('homeassistant.local'), 'http://homeassistant.local:8123');
  assert.equal(normaliseUrl('https://my.ui.nabu.casa/'), 'https://my.ui.nabu.casa');
  assert.equal(normaliseUrl('http://192.168.1.5:8123/'), 'http://192.168.1.5:8123');
  assert.match(expectedSlug(), /^[0-9a-f]{8}_hearth$/);
});

// A pretend Home Assistant that speaks just enough of the WebSocket API
function fakeHomeAssistant({ token = 'good', supervisor = true } = {}) {
  const calls = [];
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.10.1' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'auth') return ws.send(JSON.stringify(m.access_token === token ? { type: 'auth_ok', ha_version: '2026.10.1' } : { type: 'auth_invalid', message: 'Invalid access token' }));
      if (m.type !== 'supervisor/api') return ws.send(JSON.stringify({ id: m.id, type: 'result', success: false, error: { code: 'unknown_command' } }));
      if (!supervisor) return ws.send(JSON.stringify({ id: m.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } }));
      calls.push(`${m.method} ${m.endpoint}`);
      const { expectedSlug } = require('../src/cli/homeassistant');
      const results = { '/store/addons': { addons: [{ slug: expectedSlug(), name: 'Hearth', installed: false, repository: 'x' }] }, [`/addons/${expectedSlug()}/info`]: { version: '1.6.0' } };
      ws.send(JSON.stringify({ id: m.id, type: 'result', success: true, result: results[m.endpoint] ?? {} }));
    });
  });
  return new Promise((resolve) => wss.on('listening', () => resolve({ url: `http://127.0.0.1:${wss.address().port}`, calls, close: () => { for (const c of wss.clients) c.terminate(); wss.close(); } })));
}

test('Home Assistant install: adds repository, installs, enables sidebar, starts', async () => {
  const ha = await fakeHomeAssistant();
  try {
    const { install, expectedSlug } = require('../src/cli/homeassistant');
    const res = await install({ url: ha.url, token: 'good' }, quiet);
    const slug = expectedSlug();
    assert.deepEqual(ha.calls, ['post /store/repositories', 'post /store/reload', 'get /store/addons', `post /store/addons/${slug}/install`,
      `post /addons/${slug}/options`, `post /addons/${slug}/start`, `get /addons/${slug}/info`]);
    assert.equal(res.panelUrl, `${ha.url}/${slug}`);
    assert.equal(res.version, '1.6.0');
  } finally { ha.close(); }
});

test('Home Assistant install explains a bad token and a Container install', async () => {
  const { install } = require('../src/cli/homeassistant');
  const ha = await fakeHomeAssistant();
  try { await assert.rejects(install({ url: ha.url, token: 'bad' }, quiet), /rejected the access token/); } finally { ha.close(); }
  const core = await fakeHomeAssistant({ supervisor: false });
  try { await assert.rejects(install({ url: core.url, token: 'good' }, quiet), /no add-on store/); } finally { core.close(); }
});

test('addresses lists this computer\'s network addresses', () => {
  const list = require('../src/cli/network').lanAddresses(8484);
  assert.ok(Array.isArray(list));
  for (const a of list) assert.match(a.url, /^http:\/\/.+:8484$/);
});
