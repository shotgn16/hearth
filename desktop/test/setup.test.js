// The desktop app's setup logic, without Electron: each way of setting Hearth up, with the real bundled server
// for "this computer" and stand-ins for the commands that need administrator rights, Docker or Home Assistant.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Setup, normaliseUrl } = require('../src/setup');
const { Store } = require('../src/store');
const { LocalServer } = require('../src/local-server');
const { resolvePaths } = require('../src/paths');

const SERVER_DIR = path.join(__dirname, '..', '..', 'server');

function harness({ runCli, runCliElevated, confirm = async () => true } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-desktop-test-'));
  const paths = { ...resolvePaths({ isPackaged: false, resourcesPath: '', userData }), node: process.execPath, serverDir: SERVER_DIR,
    serverEntry: path.join(SERVER_DIR, 'src', 'index.js'), cli: path.join(SERVER_DIR, 'bin', 'hearth-server.js') };
  const store = new Store(paths.settingsFile);
  const localServer = new LocalServer(paths);
  const calls = [];
  const setup = new Setup({
    paths, store, localServer, username: 'tester', confirm,
    runCli: runCli || (async (args) => { calls.push(['cli', ...args]); return {}; }),
    runCliElevated: runCliElevated || (async (args) => { calls.push(['admin', ...args]); return {}; }),
  });
  return { setup, store, localServer, paths, calls, userData };
}

// A pretend Hearth server answering /api/status
function fakeHearth(version = '9.9.9') {
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ needsSetup: false, version })); }
    else { res.statusCode = 404; res.end(); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}`, port: srv.address().port })));
}

test('addresses are tidied up', () => {
  assert.strictEqual(normaliseUrl(' 192.168.1.20:8484/ '), 'http://192.168.1.20:8484');
  assert.strictEqual(normaliseUrl('https://hearth.example.com'), 'https://hearth.example.com');
});

test('"Just me, on this computer" starts a private server and saves the setup', async () => {
  const h = harness();
  const port = await h.setup.net.findFreePort(19484);
  const events = [];
  try {
    const res = await h.setup.apply({ mode: 'local', port }, (e) => events.push(e));
    assert.strictEqual(res.url, `http://127.0.0.1:${port}`);
    assert.strictEqual(res.needsSetup, true);
    assert.deepStrictEqual(res.addresses, []);
    assert.strictEqual(h.store.get('mode'), 'local');
    assert.strictEqual(h.store.get('setupDone'), true);
    assert.ok(events.some((e) => e.type === 'ok' && /running/.test(e.message)));
    assert.ok(fs.existsSync(path.join(h.paths.localData, 'hearth.db')), 'data is kept in the app data folder');
    // private: only reachable on 127.0.0.1
    const st = await (await fetch(`${res.url}/api/status`)).json();
    assert.strictEqual(typeof st.version, 'string');
  } finally { await h.localServer.stop(); }
});

test('a server left behind by a force-closed app is stopped on the next start', async () => {
  const h = harness();
  const port = await h.setup.net.findFreePort(19584);
  try {
    await h.setup.apply({ mode: 'local', port });
    const orphan = h.localServer.child.pid;
    // Forget about the child without stopping it — as if the app had crashed
    h.localServer.child.removeAllListeners('exit'); h.localServer.child = null; h.localServer.wanted = false;
    const again = new LocalServer(h.paths);
    const h2 = new Setup({ ...h.setup, localServer: again });
    const st = await h2.startCurrent();
    assert.ok(st.ok, st.error);
    assert.notStrictEqual(again.child.pid, orphan);
    assert.throws(() => process.kill(orphan, 0), 'the old server is gone');
    await again.stop();
  } finally { await h.localServer.stop(); }
});

test('a busy port is skipped for "Just me", but explained for the phone setup', async () => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  const port = blocker.address().port;
  const h = harness();
  try {
    await assert.rejects(h.setup.apply({ mode: 'local-phone', port }), /used by another program/);
    const res = await h.setup.apply({ mode: 'local', port });
    assert.notStrictEqual(h.store.get('port'), port);
    assert.ok(res.url.endsWith(`:${h.store.get('port')}`));
  } finally { await h.localServer.stop(); blocker.close(); }
});

test('another Hearth already on the port is pointed out', async () => {
  const f = await fakeHearth('1.2.3');
  const h = harness();
  try {
    await assert.rejects(h.setup.apply({ mode: 'local', port: f.port }), /Another Hearth \(1\.2\.3\)/);
  } finally { f.srv.close(); }
});

test('household server installs the service with administrator rights and brings local data along', async () => {
  const f = await fakeHearth('1.6.0');
  const h = harness();
  fs.mkdirSync(h.paths.localData, { recursive: true });
  fs.writeFileSync(path.join(h.paths.localData, 'hearth.db'), '');
  h.setup.waitFor = async () => ({ version: '1.6.0', needsSetup: false });
  try {
    const res = await h.setup.apply({ mode: 'server', port: f.port, ollamaUrl: 'http://10.0.0.5:11434' });
    const admin = h.calls.find((c) => c[0] === 'admin');
    assert.ok(admin, 'ran with administrator rights');
    const args = admin.slice(1);
    assert.deepStrictEqual(args.slice(0, 2), ['service', 'install']);
    for (const [flag, value] of [['--scope', 'system'], ['--host', '0.0.0.0'], ['--port', String(f.port)], ['--import-data', h.paths.localData], ['--ollama-url', 'http://10.0.0.5:11434']]) {
      assert.strictEqual(args[args.indexOf(flag) + 1], value, flag);
    }
    assert.strictEqual(h.store.get('mode'), 'server');
    assert.strictEqual(res.url, `http://127.0.0.1:${f.port}`);
  } finally { f.srv.close(); }
});

test('connecting to an existing Hearth checks it first', async () => {
  const f = await fakeHearth('1.6.0');
  const h = harness();
  try {
    const bad = await h.setup.testRemote('http://127.0.0.1:1');
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error, /No Hearth found/);
    assert.match((await h.setup.testRemote('http://homeassistant.local:8123')).error, /Home Assistant itself/);
    const res = await h.setup.apply({ mode: 'remote', url: f.url.replace('http://', '') });
    assert.strictEqual(res.url, f.url);
    assert.strictEqual(h.store.get('mode'), 'remote');
    const st = await h.setup.startCurrent();
    assert.strictEqual(st.ok, true);
    assert.strictEqual(st.version, '1.6.0');
  } finally { f.srv.close(); }
});

test('Docker and Home Assistant run the matching hearth-server commands', async () => {
  const f = await fakeHearth();
  const calls = [];
  const h = harness({ runCli: async (args) => {
    calls.push(args);
    if (args[0] === 'docker') return { url: f.url };
    if (args[0] === 'homeassistant') return { haUrl: 'http://ha.local:8123', panelUrl: 'http://ha.local:8123/hassio/ingress/abc_hearth' };
    return {};
  } });
  try {
    await h.setup.apply({ mode: 'docker', port: 8484, ollamaUrl: 'http://localhost:11434' });
    const d = calls.find((c) => c[0] === 'docker');
    assert.strictEqual(d[d.indexOf('--ollama-url') + 1], 'http://host.docker.internal:11434', 'Ollama on this computer is reached from inside Docker');
    assert.strictEqual(h.store.get('mode'), 'docker');

    const res = await h.setup.apply({ mode: 'homeassistant', haUrl: 'ha.local', haToken: 'secret-token' });
    assert.ok(calls.some((c) => c[0] === 'docker' && c[1] === 'uninstall'), 'leaving Docker offers to stop the container');
    assert.strictEqual(res.url, 'http://ha.local:8123/hassio/ingress/abc_hearth');
    assert.ok(!JSON.stringify(h.store.all()).includes('secret-token'), 'the Home Assistant token is not kept');
  } finally { f.srv.close(); }
});

test('leaving the household server asks before removing the service', async () => {
  const h = harness({ confirm: async () => false });
  h.store.set({ setupDone: true, mode: 'server', port: 8484 });
  await h.setup.leave('server', 'local', () => {});
  assert.strictEqual(h.calls.length, 0, 'nothing removed when the person says Keep');
  const h2 = harness({ confirm: async () => true });
  h2.store.set({ setupDone: true, mode: 'server' });
  await h2.setup.leave('server', 'docker', () => {});
  assert.deepStrictEqual(h2.calls[0].slice(0, 3), ['admin', 'service', 'uninstall']);
});

test('an older household server is offered an update', async () => {
  const f = await fakeHearth('1.5.0');
  const h = harness();
  h.store.set({ setupDone: true, mode: 'server', url: f.url });
  try {
    assert.deepStrictEqual(await h.setup.outdated('1.6.0'), { running: '1.5.0', bundled: '1.6.0' });
    assert.strictEqual(await h.setup.outdated('1.5.0'), null);
    assert.strictEqual(await h.setup.outdated('1.4.9'), null);
  } finally { f.srv.close(); }
});
