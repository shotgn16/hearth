// Runs the bundled Hearth server as a child process for the "this computer" setups, restarting it if it stops
// unexpectedly, and keeping its output in a log file.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class LocalServer extends EventEmitter {
  constructor({ node, serverEntry, logs }) {
    super();
    Object.assign(this, { node, serverEntry, logs });
    this.child = null; this.wanted = false; this.restarts = []; this.opts = null;
  }

  get url() { return this.opts ? `http://127.0.0.1:${this.opts.port}` : null; }

  async start(opts) {
    this.opts = opts; this.wanted = true;
    if (!this.child) { fs.mkdirSync(this.logs, { recursive: true }); await this.stopLeftover(); }
    await this.spawn();
    return this.waitReady();
  }

  get pidFile() { return path.join(this.logs, 'server.pid'); }

  // A server left behind when the app was force-closed would hold the port and the data — stop it first.
  // Only if Hearth really answers on the port it used (process IDs get reused, especially on Windows).
  async stopLeftover() {
    let old; try { old = JSON.parse(fs.readFileSync(this.pidFile, 'utf8')); } catch { return; }
    fs.rmSync(this.pidFile, { force: true });
    if (!old?.pid || !old.port) return;
    try { const r = await fetch(`http://127.0.0.1:${old.port}/api/status`, { signal: AbortSignal.timeout(1500) }); if (!r.ok) return; } catch { return; }
    try { process.kill(old.pid, 'SIGTERM'); } catch { return; }
    for (let i = 0; i < 20; i++) { try { process.kill(old.pid, 0); } catch { return; } await new Promise((r) => setTimeout(r, 200)); }
  }

  spawn() {
    fs.mkdirSync(this.logs, { recursive: true });
    fs.mkdirSync(this.opts.dataDir, { recursive: true });
    const log = fs.openSync(path.join(this.logs, 'server.log'), 'a');
    const env = {
      ...process.env,
      DATA_DIR: this.opts.dataDir,
      PORT: String(this.opts.port),
      HOST: this.opts.host,
      HEARTH_MODE: 'desktop',
      TZ: this.opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '', // the bundled runtime is a real Node.js, not Electron
      ...(this.opts.ollamaUrl ? { OLLAMA_URL: this.opts.ollamaUrl } : {}),
    };
    this.child = spawn(this.node, [this.serverEntry], { env, stdio: ['ignore', log, log], windowsHide: true });
    try { fs.writeFileSync(this.pidFile, JSON.stringify({ pid: this.child.pid, port: this.opts.port })); } catch { /* not important */ }
    this.child.once('exit', (code, signal) => {
      fs.closeSync(log);
      this.child = null;
      fs.rmSync(this.pidFile, { force: true });
      this.emit('exit', { code, signal });
      if (!this.wanted) return;
      // Restart after an unexpected stop, but give up if it keeps failing (5 times in 2 minutes)
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 120000).concat(now);
      if (this.restarts.length > 5) { this.emit('failed', this.lastLines()); return; }
      setTimeout(() => { if (this.wanted && !this.child) this.spawn(); }, 2000);
    });
  }

  async waitReady(timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      try { const r = await fetch(`${this.url}/api/status`, { signal: AbortSignal.timeout(2000) }); if (r.ok) return r.json(); } catch { /* not yet */ }
      if (!this.child && !this.wanted) break;
      await new Promise((res) => setTimeout(res, 400));
    }
    throw new Error(`Hearth didn't start. ${this.lastLines()}`);
  }

  stop() {
    this.wanted = false;
    const c = this.child;
    if (!c) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 4000);
      c.once('exit', () => { clearTimeout(t); resolve(); });
      try { c.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
    });
  }

  lastLines(n = 8) {
    try { return fs.readFileSync(path.join(this.logs, 'server.log'), 'utf8').trim().split('\n').slice(-n).join('\n'); } catch { return ''; }
  }
}

module.exports = { LocalServer };
