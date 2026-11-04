// End-to-end checks of the main API flows. Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;
before(async () => { h = await startServer(); });
after(async () => { await h.stop(); });

const CSV = 'Date,Description,Amount\n01/09/2026,TESCO STORES 3021,-23.40\n02/08/2026,NETFLIX.COM,-10.99\n02/09/2026,NETFLIX.COM,-10.99\n02/10/2026,NETFLIX.COM,-10.99\n15/09/2026,SALARY ACME LTD,2500.00\n20/09/2026,SHELL PETROL,-48.00\n';

test('first run: status, setup once, sign in', async () => {
  let r = await h.call('GET', '/api/status');
  assert.equal(r.status, 200);
  assert.equal(r.json.needsSetup, true);
  assert.match(r.json.version, /^\d+\.\d+\.\d+/);

  r = await h.call('POST', '/api/setup', { household: 'Test', name: 'Alex', email: 'Alex@X.test', password: 'short' });
  assert.equal(r.status, 400, 'password under 8 characters is refused');

  r = await h.call('POST', '/api/setup', { household: 'Test', name: 'Alex', email: 'Alex@X.test', password: 'password1' });
  assert.equal(r.status, 200);
  assert.match(r.json.token, /^[a-f0-9]{64}$/);
  h.setToken(r.json.token);
  await h.call('PUT', '/api/settings', { ollama: { enabled: false } }); // no Ollama in tests

  r = await h.call('POST', '/api/setup', { household: 'Again', name: 'X', email: 'x@x.test', password: 'password1' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'Already set up');

  r = await h.call('POST', '/api/login', { email: 'alex@x.test', password: 'wrong' });
  assert.equal(r.status, 401);
  r = await h.call('POST', '/api/login', { email: 'alex@x.test', password: 'password1' });
  assert.equal(r.status, 200);

  r = await h.call('GET', '/api/me');
  assert.equal(r.json.user.email, 'alex@x.test');
  assert.equal(r.json.user.role, 'admin');
});

test('signed-out requests are refused', async () => {
  const r = await fetch(`${h.base}/api/me`);
  assert.equal(r.status, 401);
});

test('import a CSV statement, duplicates skipped', async () => {
  const accounts = (await h.call('GET', '/api/accounts')).json;
  let r = await h.call('POST', '/api/import/preview', { text: CSV });
  assert.equal(r.json.format, 'csv');
  assert.equal(r.json.count, 6);
  assert.deepEqual(r.json.range, ['2026-08-02', '2026-10-02']);

  r = await h.call('POST', '/api/import/commit', { text: CSV, account_id: accounts[0].id });
  assert.deepEqual(r.json, { added: 6, skipped: 0 });
  r = await h.call('POST', '/api/import/commit', { text: CSV, account_id: accounts[0].id });
  assert.deepEqual(r.json, { added: 0, skipped: 6 });

  r = await h.call('GET', '/api/transactions?sort=date&dir=asc');
  assert.equal(r.json.totals.n, 6);
  assert.equal(r.json.rows.find((t) => /TESCO/.test(t.description)).merchant, 'Tesco Stores');
});

test('regular payments are detected and tracked', async () => {
  const subs = (await h.call('GET', '/api/subscriptions')).json;
  assert.ok(subs.some((s) => s.merchant === 'Netflix' && s.cadence === 'monthly'));
  const month = (await h.call('GET', '/api/tracker/month?month=2026-09')).json;
  assert.equal(month.items.find((i) => i.subscription.merchant === 'Netflix').status, 'paid');
  const r = await h.call('POST', '/api/subscriptions', { name: 'Window cleaner', amount: 15, due_day: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.json.display, 'Window cleaner');
});

test('editing a category teaches every transaction from that merchant', async () => {
  const cats = (await h.call('GET', '/api/categories')).json;
  const fuel = cats.find((c) => c.name === 'Fuel');
  const tx = (await h.call('GET', '/api/transactions?q=SHELL')).json.rows[0];
  const r = await h.call('PATCH', `/api/transactions/${tx.id}`, { category_id: fuel.id });
  assert.equal(r.json.ok, true);
  const again = (await h.call('GET', `/api/transactions?id=${tx.id}`)).json.rows[0];
  assert.equal(again.category_id, fuel.id);
  assert.equal(again.categorised_by, 'user');
});

test('budgets, goals and planner', async () => {
  const cats = (await h.call('GET', '/api/categories')).json;
  const b = await h.call('POST', '/api/budgets', { name: 'Food', amount: 300, period: 'monthly', category_ids: [cats.find((c) => c.name === 'Supermarkets').id] });
  assert.equal(b.status, 200);
  const st = (await h.call('GET', '/api/budgets/status?date=2026-09-20')).json[0];
  assert.equal(st.spent, 23.4);
  const g = (await h.call('POST', '/api/goals', { name: 'Holiday', target_amount: 1000 })).json;
  await h.call('POST', `/api/goals/${g.id}/contribute`, { amount: 50 });
  assert.equal((await h.call('GET', '/api/goals/status')).json[0].current_amount, 50);
  assert.equal((await h.call('GET', '/api/planner?year=2026')).status, 200);
});

test('workflows preview and apply', async () => {
  const rule = (await h.call('POST', '/api/rules', { name: 'Fuel', conditions: [{ field: 'merchant', op: 'contains', value: 'Shell' }], actions: [{ type: 'set_kind', value: 'one_off' }] })).json;
  assert.equal((await h.call('POST', '/api/rules/preview', { conditions: [{ field: 'merchant', op: 'contains', value: 'Shell' }] })).json.count, 1);
  assert.equal((await h.call('POST', `/api/rules/${rule.id}/apply`, {})).json.applied, 1);
});

test('quick notes are understood without AI', async () => {
  const r = await h.call('POST', '/api/notes', { text: '£12 lunch with Sam yesterday', use_ai: false });
  assert.equal(r.json.parsed.type, 'spend');
  assert.equal(r.json.parsed.amount, -12);
});

test('insights, forecast, pivot and inbox respond', async () => {
  for (const p of ['/api/dashboard', '/api/insights', '/api/yearly', '/api/forecast?months=2&years=1', '/api/inbox', '/api/expenses/unexpected', '/api/expenses/work']) {
    const r = await h.call('GET', p);
    assert.equal(r.status, 200, p);
  }
  const p = await h.call('POST', '/api/pivot', { rows: 'category', cols: 'month', measure: 'spend' });
  assert.ok(p.json.rows.length > 0);
});

test('secrets are stored encrypted and masked', async () => {
  await h.call('PUT', '/api/settings', { ntfy: { enabled: false, url: 'https://ntfy.example', topic: 't', token: 'supersecret' } });
  const s = (await h.call('GET', '/api/settings')).json;
  assert.equal(s.ntfy.token, '••••••');
  const { q } = require('../src/core/db');
  const raw = q.get("SELECT value FROM settings WHERE key='ntfy'").value;
  assert.ok(!raw.includes('supersecret'));
  assert.ok(raw.includes('enc:v1:'));
});

test('backups need a passphrase and round-trip', async () => {
  assert.equal((await h.call('POST', '/api/backup', {})).status, 400);
  const r = await h.call('POST', '/api/backup', { passphrase: 'correct horse' });
  assert.equal(r.status, 200);
  const bad = await h.call('POST', '/api/backup/decrypt', { file: r.text, passphrase: 'wrong pass' });
  assert.equal(bad.status, 400);
  const ok = await h.call('POST', '/api/backup/decrypt', { file: r.text, passphrase: 'correct horse' });
  assert.equal(ok.json.transactions.length, 7); // 6 imported + the jotted lunch
});

test('security headers and caching', async () => {
  const r = await h.call('GET', '/api/me');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await h.call('GET', '/api/does-not-exist')).status, 404);
});

test('web app gets a base href for Home Assistant ingress', async () => {
  const r = await fetch(`${h.base}/`, { headers: { 'X-Ingress-Path': '/api/hassio_ingress/abc' } });
  assert.match(await r.text(), /<base href="\/api\/hassio_ingress\/abc\/">/);
  const plain = await (await fetch(`${h.base}/money`)).text();
  assert.match(plain, /<base href="\/">/);
});

test('users: admin adds, member cannot', async () => {
  const r = await h.call('POST', '/api/users', { name: 'Sam', email: 'sam@x.test', password: 'password2' });
  assert.equal(r.status, 200);
  const login = await h.call('POST', '/api/login', { email: 'sam@x.test', password: 'password2' });
  const asSam = login.json.token;
  const res = await fetch(`${h.base}/api/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${asSam}` }, body: JSON.stringify({ name: 'Eve', email: 'e@x.test', password: 'password3' }) });
  assert.equal(res.status, 403);
});

test('phones & devices: addresses with QR codes', async () => {
  const r = await h.call('GET', '/api/devices', undefined, { 'X-Forwarded-Host': '192.168.1.20:8484' });
  assert.equal(r.status, 200);
  const first = r.json.addresses[0];
  assert.equal(first.url, 'http://192.168.1.20:8484');
  assert.match(first.deep_link, /^hearth:\/\/connect\?url=http%3A%2F%2F192\.168\.1\.20%3A8484$/);
  assert.match(first.qr_app, /^<svg/);
});

test('the phone app may check /api/status, and nothing else', async () => {
  for (const origin of ['capacitor://localhost', 'http://localhost']) {
    const r = await h.call('GET', '/api/status', undefined, { Origin: origin });
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
  }
  const other = await h.call('GET', '/api/status', undefined, { Origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const me = await h.call('GET', '/api/me', undefined, { Origin: 'capacitor://localhost' });
  assert.equal(me.headers.get('access-control-allow-origin'), null, 'signed-in data is never shared with other origins');
});

test('a feature module can add its own table and routes', async () => {
  const { createApp } = require('../src/app');
  const { q } = require('../src/core/db');
  const extra = { name: 'pets', title: 'Pets', schema: 'CREATE TABLE IF NOT EXISTS pets (id INTEGER PRIMARY KEY, household_id INTEGER, name TEXT)',
    routes: (api) => { api.get('/pets', (req, res) => res.json(q.all('SELECT * FROM pets WHERE household_id=?', req.hid))); } };
  const srv = createApp({ modules: [...require('../src/modules'), extra] }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  try {
    const login = await h.call('POST', '/api/login', { email: 'alex@x.test', password: 'password1' });
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/pets`, { headers: { Authorization: `Bearer ${login.json.token}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  } finally { srv.close(); }
});

test('sign out ends the session', async () => {
  assert.equal((await h.call('POST', '/api/logout', {})).status, 200);
  assert.equal((await h.call('GET', '/api/me')).status, 401);
});
