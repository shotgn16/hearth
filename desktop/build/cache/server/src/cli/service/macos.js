// macOS: a launchd service. System scope is a LaunchDaemon (starts at boot, before anyone logs in) running as
// the chosen user; user scope is a LaunchAgent (starts when you log in).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../util');
const { xml } = require('./index');

const LABEL = 'com.shotgn16.hearth.server';
const plistPath = (opt) => (opt.scope === 'user' ? path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`) : `/Library/LaunchDaemons/${LABEL}.plist`);
const logDir = (opt) => (opt.scope === 'user' ? path.join(os.homedir(), 'Library', 'Logs', 'Hearth') : '/Library/Logs/Hearth');
const domain = (opt) => (opt.scope === 'user' ? `gui/${process.getuid()}` : 'system');

function plist(opt, user) {
  const env = { DATA_DIR: opt.dataDir, PORT: String(opt.port), HOST: opt.host, TZ: opt.timezone, NODE_ENV: 'production', ...(opt.ollamaUrl ? { OLLAMA_URL: opt.ollamaUrl } : {}) };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Hearth household money manager — installed by "hearth-server service install" -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(opt.nodePath)}</string>
    <string>${xml(path.join(opt.serverDir, 'src', 'index.js'))}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`).join('\n')}
  </dict>
${opt.scope === 'system' ? `  <key>UserName</key><string>${xml(user)}</string>\n` : ''}  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logDir(opt), 'hearth.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir(opt), 'hearth.log'))}</string>
</dict>
</plist>
`;
}

async function install(opt, r) {
  const user = opt.scope === 'system' ? (opt.user || process.env.SUDO_USER || os.userInfo().username) : os.userInfo().username;
  if (opt.scope === 'system' && user === 'root') r.warn('The service will run as root. Pass --user <your account name> to run it as you instead.');
  if (!opt.dryRun) {
    fs.mkdirSync(opt.dataDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(logDir(opt), { recursive: true });
    if (opt.scope === 'system') { run('chown', ['-R', `${user}:staff`, opt.dataDir]); run('chown', ['-R', `${user}:staff`, logDir(opt)]); }
    fs.chmodSync(opt.dataDir, 0o700);
  }
  const file = plistPath(opt);
  r.step(`Writing ${file}`);
  if (opt.dryRun) r.info(plist(opt, user));
  else {
    run('launchctl', ['bootout', `${domain(opt)}/${LABEL}`], { allowFail: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, plist(opt, user));
    if (opt.scope === 'system') { run('chown', ['root:wheel', file]); fs.chmodSync(file, 0o644); }
  }
  run('launchctl', ['bootstrap', domain(opt), file], { dryRun: opt.dryRun, r });
  run('launchctl', ['enable', `${domain(opt)}/${LABEL}`], { allowFail: true, dryRun: opt.dryRun, r });
  // If the macOS firewall is on, let the bundled Node accept connections from phones
  if (opt.host !== '127.0.0.1') {
    const fw = '/usr/libexec/ApplicationFirewall/socketfilterfw';
    if (fs.existsSync(fw) && opt.scope === 'system') { run(fw, ['--add', opt.nodePath], { allowFail: true, dryRun: opt.dryRun, r }); run(fw, ['--unblockapp', opt.nodePath], { allowFail: true, dryRun: opt.dryRun, r }); }
  }
  r.ok(`Hearth is installed as a service and starts ${opt.scope === 'user' ? 'when you log in' : 'with the Mac'} (logs: ${path.join(logDir(opt), 'hearth.log')})`);
  return { manager: 'launchd', plist: file, logs: path.join(logDir(opt), 'hearth.log') };
}

async function uninstall(opt, r) {
  r.step('Stopping and removing the Hearth service');
  run('launchctl', ['bootout', `${domain(opt)}/${LABEL}`], { allowFail: true, dryRun: opt.dryRun, r });
  const file = plistPath(opt);
  if (!opt.dryRun && fs.existsSync(file)) fs.rmSync(file);
}

function status(opt) {
  const installed = fs.existsSync(plistPath(opt));
  const p = installed ? run('launchctl', ['print', `${domain(opt)}/${LABEL}`], { allowFail: true }) : { ok: false, stdout: '' };
  return { installed, running: p.ok && /state = running/.test(p.stdout), manager: 'launchd', plist: plistPath(opt) };
}

function control(action, opt, r) {
  r.step(`${action[0].toUpperCase()}${action.slice(1)}ing Hearth`);
  if (action === 'stop') run('launchctl', ['kill', 'SIGTERM', `${domain(opt)}/${LABEL}`], { dryRun: opt.dryRun, r });
  else run('launchctl', ['kickstart', '-k', `${domain(opt)}/${LABEL}`], { dryRun: opt.dryRun, r });
}

module.exports = { install, uninstall, status, control, plist, LABEL };
