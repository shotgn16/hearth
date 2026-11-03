// Test helpers: start Hearth on a free port with an empty data folder, and call its API.
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-test-'));
  process.env.DATA_DIR = dir;
  process.env.TZ = 'Europe/London';
  delete process.env.SUPERVISOR_TOKEN;
  return dir;
}

async function startServer() {
  const dir = freshDataDir();
  const { createApp } = require('../src/app');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token = null;
  async function call(method, p, body, headers = {}) {
    const r = await fetch(base + p, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, headers: r.headers, json, text };
  }
  return { dir, base, call, server, setToken: (t) => { token = t; }, stop: () => new Promise((r) => server.close(r)) };
}

module.exports = { startServer, freshDataDir };
