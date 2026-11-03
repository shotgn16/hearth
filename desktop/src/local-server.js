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
    await this.spawn();
    return this.waitReady();
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
    this.child.once('exit', (code, signal) => {
      fs.closeSync(log);
      this.child = null;
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
