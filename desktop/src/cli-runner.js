// Runs "hearth-server" commands with the bundled Node runtime — normally, or with administrator rights
// (macOS password prompt, Windows UAC, Linux pkexec) for installing the household service.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const parseLine = (line) => { try { return JSON.parse(line); } catch { return line.trim() ? { type: 'info', message: line.trim() } : null; } };

/** Run a CLI command, calling onEvent for each progress line. Resolves with the "result" data. */
function runCli({ node, cli }, args, { onEvent = () => {}, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [cli, ...args, '--json'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ...env }, windowsHide: true });
    let buf = ''; let result = null; let error = null;
    const handle = (e) => { if (!e) return; if (e.type === 'result') result = e.data; else if (e.type === 'error') error = e.message; else onEvent(e); };
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { handle(parseLine(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => { handle(parseLine(buf)); if (code === 0 && !error) resolve(result); else reject(new Error(error || stderr.trim() || `hearth-server exited with ${code}`)); });
  });
}

// ---- administrator rights ----
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;                      // POSIX shell quoting
const winq = (s) => `"${String(s).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`; // Windows argv quoting
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;                         // PowerShell single quotes

function elevatedCommand(node, cli, args, logFile) {
  const full = [node, cli, ...args, '--log-file', logFile];
  if (process.platform === 'darwin') {
    const sh = full.map(shq).join(' ');
    return ['osascript', ['-e', `do shell script ${JSON.stringify(sh)} with prompt "Hearth needs your password to set up the household server." with administrator privileges`]];
  }
  if (process.platform === 'win32') {
    const argLine = full.slice(1).map(winq).join(' ');
    const ps = `$p = Start-Process -FilePath ${psq(node)} -ArgumentList ${psq(argLine)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`;
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]];
  }
  return ['pkexec', full];
}

// An AppImage is mounted where only you can read it, so administrator commands can't run from inside it.
// Copy the runtime and server somewhere root can read first.
function stageForRoot({ node, cli }) {
  if (process.platform !== 'linux' || !process.env.APPIMAGE) return { node, cli };
  const serverDir = path.resolve(path.dirname(cli), '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-setup-'));
  fs.chmodSync(dir, 0o755);
  fs.copyFileSync(node, path.join(dir, 'node')); fs.chmodSync(path.join(dir, 'node'), 0o755);
  fs.cpSync(serverDir, path.join(dir, 'server'), { recursive: true });
  return { node: path.join(dir, 'node'), cli: path.join(dir, 'server', 'bin', 'hearth-server.js'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Run a CLI command as administrator. Progress is read back from a log file while it runs. */
function runCliElevated(paths, args, { onEvent = () => {} } = {}) {
  const staged = stageForRoot(paths);
  const { node, cli } = staged;
  const logFile = path.join(os.tmpdir(), `hearth-setup-${process.pid}-${Date.now()}.log`);
  fs.writeFileSync(logFile, '');
  const [cmd, cmdArgs] = elevatedCommand(node, cli, args, logFile);
  return new Promise((resolve, reject) => {
    let seen = 0; let result = null; let error = null;
    const poll = () => {
      let text = ''; try { text = fs.readFileSync(logFile, 'utf8'); } catch { return; }
      const lines = text.split('\n'); const complete = lines.slice(0, -1);
      for (const l of complete.slice(seen)) { const e = parseLine(l); if (!e) continue; if (e.type === 'result') result = e.data; else if (e.type === 'error') error = e.message; else onEvent(e); }
      seen = complete.length;
    };
    const timer = setInterval(poll, 300);
    const child = spawn(cmd, cmdArgs, { windowsHide: true });
    let stderr = ''; child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearInterval(timer); reject(e.code === 'ENOENT' && cmd === 'pkexec' ? new Error('pkexec is not available, so Hearth can\'t ask for administrator rights. Run the command shown in the manual with sudo instead.') : e); });
    child.on('close', (code) => {
      clearInterval(timer); poll(); fs.rmSync(logFile, { force: true }); staged.cleanup?.();
      if (code === 0 && !error) return resolve(result);
      const cancelled = /User canceled|-128|canceled by the user|dismissed|Request dismissed|Not authorized/i.test(stderr) || (process.platform === 'linux' && code === 126);
      reject(new Error(cancelled ? 'Administrator permission was not given, so nothing was changed.' : error || stderr.trim() || `Setup failed (exit code ${code})`));
    });
  });
}

module.exports = { runCli, runCliElevated, elevatedCommand, stageForRoot, shq, winq, psq };
