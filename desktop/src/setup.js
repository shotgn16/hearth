// The six ways to set Hearth up, and switching between them. Used by the setup wizard and at start-up.
//
//   local          Just me, on this computer          server runs inside the app, private (127.0.0.1)
//   local-phone    This computer and my phone         server runs inside the app, reachable on the home network
//   server         Household server                   a system service that starts with the computer
//   remote         Connect to an existing Hearth      the window opens another Hearth's address
//   docker         Docker on this computer            "hearth-server docker install"
//   homeassistant  Home Assistant add-on               "hearth-server homeassistant install"
const fs = require('fs');
const path = require('path');

const MODES = ['local', 'local-phone', 'server', 'remote', 'docker', 'homeassistant'];
const TZ = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const normaliseUrl = (u) => { let s = String(u || '').trim().replace(/\/+$/, ''); if (s && !/^https?:\/\//i.test(s)) s = `http://${s}`; return s; };

async function hearthStatus(url, timeoutMs = 4000) {
  const r = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (typeof j.needsSetup !== 'boolean') throw new Error('not a Hearth server');
  return j;
}

class Setup {
  /**
   * deps: { paths, store, localServer, runCli, runCliElevated, confirm(message, detail) → Promise<boolean>, username }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.net = require(path.join(this.paths.serverDir, 'src', 'cli', 'network.js'));
  }

  // ---------- checks the wizard runs before applying ----------
  async testRemote(url) {
    const u = normaliseUrl(url);
    if (!u) return { ok: false, error: 'Enter the address, for example http://192.168.1.20:8484' };
    if (/\/hassio\/ingress\/|:8123$/.test(u)) return { ok: false, error: 'That looks like Home Assistant itself. Use the Hearth add-on\'s own port (set it on the add-on\'s Configuration tab → Network), e.g. http://homeassistant.local:8484' };
    try { const s = await hearthStatus(u); return { ok: true, url: u, version: s.version, needsSetup: s.needsSetup }; }
    catch (e) { return { ok: false, error: `No Hearth found at ${u} (${e.cause?.code || e.message}). Check the address and that both devices are on the same network.` }; }
  }

  async detectOllama() {
    for (const url of ['http://127.0.0.1:11434', 'http://localhost:11434']) {
      try { const r = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return { found: true, url: 'http://localhost:11434', version: (await r.json()).version }; } catch { /* not here */ }
    }
    return { found: false };
  }

  dockerCheck() { return this.runCli(['docker', 'check']).catch((e) => ({ ok: false, problem: e.message })); }
  testHomeAssistant(url, token) { return this.runCli(['homeassistant', 'test', '--url', url, '--token', token]).then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: e.message })); }
  lanAddresses(port) { return this.net.lanAddresses(port); }

  // ---------- apply a setup ----------
  async apply(cfg, progress = () => {}) {
    if (!MODES.includes(cfg.mode)) throw new Error(`Unknown setup "${cfg.mode}"`);
    const prev = this.store.get('setupDone') ? this.store.get('mode') : null;
    const port = Number(cfg.port) || 8484;
    await this.leave(prev, cfg.mode, progress);
    const handler = { local: 'applyLocal', 'local-phone': 'applyLocal', server: 'applyServer', remote: 'applyRemote', docker: 'applyDocker', homeassistant: 'applyHomeAssistant' }[cfg.mode];
    const res = await this[handler]({ ...cfg, port }, progress);
    this.store.set({ setupDone: true, mode: cfg.mode, startAtLogin: cfg.mode === 'local-phone' ? cfg.startAtLogin !== false : !!cfg.startAtLogin, ollamaUrl: cfg.ollamaUrl || '', ...res.save });
    return { url: this.store.get('url'), ...res.info };
  }

  // Tidy up the previous setup when switching to a different one
  async leave(prev, next, progress) {
    if (!prev || prev === next) { if (prev?.startsWith('local')) await this.localServer.stop(); return; }
    if (prev.startsWith('local')) { progress({ type: 'step', message: 'Stopping Hearth on this computer' }); await this.localServer.stop(); }
    if (prev === 'server' && next !== 'remote') {
      const yes = await this.confirm('Remove the Hearth service from this computer?', 'Hearth is currently set up as a household server. Removing the service stops it starting with the computer. Your data stays where it is.');
      if (yes) {
        progress({ type: 'step', message: 'Removing the household service (you may be asked for your password)' });
        await this.runCliElevated(['service', 'uninstall', '--copy-to', this.paths.systemInstall, '--data', this.store.get('serverDataDir') || this.paths.systemData], { onEvent: progress });
      }
    }
    if (prev === 'docker' && next !== 'docker') {
      const yes = await this.confirm('Stop the Hearth Docker container?', 'Your data stays in the Docker folder, so you can start it again later.');
      if (yes) await this.runCli(['docker', 'uninstall', '--dir', this.store.get('dockerDir') || this.paths.dockerDir], { onEvent: progress }).catch((e) => progress({ type: 'warn', message: e.message }));
    }
  }

  async applyLocal(cfg, progress) {
    const phone = cfg.mode === 'local-phone';
    const host = phone ? '0.0.0.0' : '127.0.0.1';
    const dataDir = cfg.dataDir || this.store.get('dataDir') || this.paths.localData;
    let port = cfg.port;
    if (!(await this.net.portFree(port))) {
      const existing = await hearthStatus(`http://127.0.0.1:${port}`, 1500).catch(() => null);
      if (existing) throw new Error(`Another Hearth (${existing.version}) is already running on port ${port} — perhaps a household server or Docker. Choose "Connect to an existing Hearth", or another port.`);
      if (phone) throw new Error(`Port ${port} is used by another program. Choose a different port under "More options".`);
      port = await this.net.findFreePort(port + 1);
      progress({ type: 'info', message: `Port ${cfg.port} is busy, so Hearth will use ${port}` });
    }
    progress({ type: 'step', message: 'Starting Hearth on this computer' });
    const status = await this.localServer.start({ port, host, dataDir, ollamaUrl: cfg.ollamaUrl, timezone: TZ() });
    progress({ type: 'ok', message: `Hearth ${status.version} is running` });
    const addresses = phone ? this.net.lanAddresses(port) : [];
    return { save: { port, dataDir, url: `http://127.0.0.1:${port}` }, info: { addresses, needsSetup: status.needsSetup } };
  }

  async applyServer(cfg, progress) {
    const dataDir = cfg.serverDataDir || this.paths.systemData;
    const args = ['service', 'install', '--scope', 'system', '--port', String(cfg.port), '--host', '0.0.0.0', '--data', dataDir,
      '--copy-to', this.paths.systemInstall, '--timezone', TZ()]; // the bundled runtime running the command is the one copied
    if (process.platform === 'win32' && fs.existsSync(this.paths.winsw)) args.push('--winsw', this.paths.winsw);
    if (process.platform === 'darwin' && this.username) args.push('--user', this.username);
    if (cfg.ollamaUrl) args.push('--ollama-url', cfg.ollamaUrl);
    // Bring along data from "just me on this computer", if there is any
    const local = this.store.get('dataDir') || this.paths.localData;
    if (cfg.importLocal !== false && fs.existsSync(path.join(local, 'hearth.db'))) args.push('--import-data', local);
    progress({ type: 'step', message: 'Installing the household service — your computer will ask for an administrator password' });
    await this.runCliElevated(args, { onEvent: progress });
    const url = `http://127.0.0.1:${cfg.port}`;
    progress({ type: 'step', message: 'Waiting for Hearth to start' });
    const status = await this.waitFor(url, 60000);
    progress({ type: 'ok', message: `The household server is running (Hearth ${status.version})` });
    return { save: { url, port: cfg.port, serverDataDir: dataDir }, info: { addresses: this.net.lanAddresses(cfg.port), needsSetup: status.needsSetup } };
  }

  async applyRemote(cfg) {
    const t = await this.testRemote(cfg.url);
    if (!t.ok) throw new Error(t.error);
    return { save: { url: t.url }, info: { needsSetup: t.needsSetup } };
  }

  async applyDocker(cfg, progress) {
    const dir = cfg.dockerDir || this.paths.dockerDir;
    const args = ['docker', 'install', '--dir', dir, '--port', String(cfg.port), '--timezone', TZ()];
    if (cfg.ollamaUrl) args.push('--ollama-url', cfg.ollamaUrl.replace(/localhost|127\.0\.0\.1/, 'host.docker.internal'));
    const res = await this.runCli(args, { onEvent: progress });
    const status = await hearthStatus(res.url).catch(() => ({}));
    return { save: { url: res.url, port: cfg.port, dockerDir: dir }, info: { addresses: this.net.lanAddresses(cfg.port), needsSetup: status.needsSetup } };
  }

  async applyHomeAssistant(cfg, progress) {
    const res = await this.runCli(['homeassistant', 'install', '--url', cfg.haUrl, '--token', cfg.haToken], { onEvent: progress });
    // The token is used once and not kept
    return { save: { url: res.panelUrl, haUrl: res.haUrl, panelUrl: res.panelUrl }, info: { haUrl: res.haUrl } };
  }

  async waitFor(url, timeoutMs) {
    const until = Date.now() + timeoutMs; let last;
    while (Date.now() < until) { try { return await hearthStatus(url, 2000); } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 1000)); }
    throw new Error(`Hearth didn't answer at ${url} (${last?.cause?.code || last?.message}).`);
  }

  // ---------- at start-up ----------
  /** Make sure Hearth is available for the saved setup. Returns { url, ok, error } */
  async startCurrent() {
    const s = this.store.all();
    if (s.mode === 'local' || s.mode === 'local-phone') {
      try {
        if (!(await this.net.portFree(s.port))) {
          const other = await hearthStatus(`http://127.0.0.1:${s.port}`, 1500).catch(() => null);
          if (!other) throw new Error(`Port ${s.port} is being used by another program. Use "Change setup…" to pick another port.`);
        }
        await this.localServer.start({ port: s.port, host: s.mode === 'local-phone' ? '0.0.0.0' : '127.0.0.1', dataDir: s.dataDir || this.paths.localData, ollamaUrl: s.ollamaUrl, timezone: TZ() });
        return { ok: true, url: s.url };
      } catch (e) { return { ok: false, url: s.url, error: e.message }; }
    }
    if (s.mode === 'homeassistant') return { ok: true, url: s.panelUrl || s.url };
    try { const st = await hearthStatus(s.url, 5000); return { ok: true, url: s.url, version: st.version }; }
    catch (e) { return { ok: false, url: s.url, error: e.cause?.code || e.message }; }
  }

  /** Household server / Docker running an older Hearth than this app carries? */
  async outdated(bundled) {
    const s = this.store.all();
    if (!['server', 'docker'].includes(s.mode) || !bundled) return null;
    const st = await hearthStatus(s.url, 3000).catch(() => null);
    if (!st?.version) return null;
    const n = (v) => v.split('.').map(Number); const [a, b] = [n(st.version), n(bundled)];
    for (let i = 0; i < 3; i++) { if ((a[i] || 0) < (b[i] || 0)) return { running: st.version, bundled }; if ((a[i] || 0) > (b[i] || 0)) return null; }
    return null;
  }

  async updateService(progress = () => {}) {
    const s = this.store.all();
    if (s.mode === 'server') return this.applyServer({ mode: 'server', port: s.port, serverDataDir: s.serverDataDir, ollamaUrl: s.ollamaUrl, importLocal: false }, progress);
    if (s.mode === 'docker') return this.applyDocker({ mode: 'docker', port: s.port, dockerDir: s.dockerDir, ollamaUrl: s.ollamaUrl }, progress);
    return null;
  }
}

module.exports = { Setup, MODES, normaliseUrl, hearthStatus };
