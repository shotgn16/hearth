// Helpers for the command-line tool: argument parsing, running commands, output, waiting for Hearth to start.
const { spawnSync } = require('child_process');
const os = require('os');

// --port 8484 --host=0.0.0.0 --yes  →  { port: '8484', host: '0.0.0.0', yes: true, _: [...] }
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (v !== undefined) out[key] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

class CliError extends Error {}

/**
 * Reporter: prints friendly lines, or JSON lines when --json is used (the desktop app reads those).
 *   r.step('Installing the service')   r.ok('Done')   r.warn('…')   r.result({ url })
 */
function reporter(json, logFile) {
  const fs = require('fs');
  const emit = (type, msg, extra = {}) => {
    // --log-file: also write JSON lines to a file (the desktop app reads it after an administrator prompt)
    if (logFile) try { fs.appendFileSync(logFile, `${JSON.stringify({ type, message: msg, ...extra })}\n`); } catch { /* ignore */ }
    if (json) process.stdout.write(`${JSON.stringify({ type, message: msg, ...extra })}\n`);
    else if (type === 'result') { /* printed by the command */ } else {
      const icon = { step: '→', ok: '✓', warn: '!', info: ' ' }[type] || '';
      (type === 'warn' ? process.stderr : process.stdout).write(`${icon} ${msg}\n`);
    }
  };
  return { json, step: (m) => emit('step', m), ok: (m) => emit('ok', m), warn: (m) => emit('warn', m), info: (m) => emit('info', m), result: (data) => emit('result', '', { data }) };
}

/** Run a program and return its output; throws a readable error when it fails (unless allowFail). */
function run(cmd, args = [], { allowFail = false, input, cwd, env, dryRun, r } = {}) {
  if (dryRun) { (r?.info || console.log)(`would run: ${[cmd, ...args].join(' ')}`); return { ok: true, stdout: '', stderr: '' }; }
  const p = spawnSync(cmd, args, { encoding: 'utf8', input, cwd, env: env ? { ...process.env, ...env } : process.env, windowsHide: true, shell: false });
  const res = { ok: p.status === 0, code: p.status, stdout: (p.stdout || '').trim(), stderr: (p.stderr || '').trim(), error: p.error };
  if (!res.ok && !allowFail) {
    const why = p.error?.code === 'ENOENT' ? `${cmd} was not found` : res.stderr || res.stdout || `exit code ${p.status}`;
    throw new CliError(`${[cmd, ...args].join(' ')} failed: ${why}`);
  }
  return res;
}

const has = (cmd) => run(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? [cmd] : ['-c', `command -v ${cmd}`], { allowFail: true }).ok;

const isRoot = () => (process.platform === 'win32' ? run('net', ['session'], { allowFail: true }).ok : process.getuid?.() === 0);

/** Wait until a Hearth server answers /api/status. */
async function waitForHearth(url, { timeoutMs = 60000 } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url.replace(/\/$/, '')}/api/status`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return await r.json();
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.cause?.code || e.message; }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new CliError(`Hearth didn't answer at ${url} (${last}).`);
}

// Sensible default folders for each platform
const paths = {
  homeData: () => (process.platform === 'win32' ? `${process.env.APPDATA || os.homedir()}\\Hearth`
    : process.platform === 'darwin' ? `${os.homedir()}/Library/Application Support/Hearth` : `${process.env.XDG_DATA_HOME || `${os.homedir()}/.local/share`}/hearth`),
  systemData: () => (process.platform === 'win32' ? `${process.env.ProgramData || 'C:\\ProgramData'}\\Hearth`
    : process.platform === 'darwin' ? '/Library/Application Support/Hearth' : '/var/lib/hearth'),
  systemInstall: () => (process.platform === 'win32' ? `${process.env.ProgramFiles || 'C:\\Program Files'}\\Hearth Server`
    : process.platform === 'darwin' ? '/usr/local/hearth-server' : '/opt/hearth-server'),
  dockerDir: () => (process.platform === 'win32' ? `${os.homedir()}\\Hearth Docker` : `${os.homedir()}/hearth-docker`),
};

module.exports = { parseArgs, reporter, run, has, isRoot, waitForHearth, paths, CliError };
