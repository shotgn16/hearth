// Linux: a systemd service. System scope runs as its own "hearth" user from boot; user scope runs as you.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, has } = require('../util');

const NAME = 'hearth';
const unitPath = (opt) => (opt.scope === 'user' ? path.join(os.homedir(), '.config', 'systemd', 'user', `${NAME}.service`) : `/etc/systemd/system/${NAME}.service`);
const ctl = (opt, ...args) => (opt.scope === 'user' ? ['systemctl', ['--user', ...args]] : ['systemctl', args]);

function unit(opt, user) {
  const env = { DATA_DIR: opt.dataDir, PORT: opt.port, HOST: opt.host, TZ: opt.timezone, NODE_ENV: 'production', ...(opt.ollamaUrl ? { OLLAMA_URL: opt.ollamaUrl } : {}) };
  const underHome = opt.dataDir.startsWith('/home/') || opt.dataDir.startsWith('/root');
  return `# Hearth household money manager — installed by "hearth-server service install"
[Unit]
Description=Hearth household money manager
Documentation=https://github.com/shotgn16/hearth
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${opt.scope === 'system' ? `User=${user}\nGroup=${user}\n` : ''}${Object.entries(env).map(([k, v]) => `Environment="${k}=${v}"`).join('\n')}
ExecStart="${opt.nodePath}" "${path.join(opt.serverDir, 'src', 'index.js')}"
Restart=on-failure
RestartSec=5
${opt.scope === 'system' ? `NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
${underHome ? '' : 'ProtectHome=true\n'}ReadWritePaths=${opt.dataDir}
UMask=0077
` : ''}
[Install]
WantedBy=${opt.scope === 'user' ? 'default.target' : 'multi-user.target'}
`;
}

function ensureUser(opt, r) {
  const user = opt.user || NAME;
  if (run('id', ['-u', user], { allowFail: true }).ok) return user;
  r.step(`Creating the "${user}" system account`);
  const nologin = ['/usr/sbin/nologin', '/sbin/nologin', '/bin/false'].find((p) => fs.existsSync(p)) || '/bin/false';
  if (has('useradd')) run('useradd', ['--system', '--user-group', '--home-dir', opt.dataDir, '--no-create-home', '--shell', nologin, user], { dryRun: opt.dryRun, r });
  else run('adduser', ['-S', '-D', '-H', '-h', opt.dataDir, '-s', nologin, user], { dryRun: opt.dryRun, r }); // Alpine
  return user;
}

function openFirewall(opt, r) {
  if (opt.host === '127.0.0.1' || opt.scope !== 'system') return;
  if (has('ufw') && /Status: active/.test(run('ufw', ['status'], { allowFail: true }).stdout)) {
    r.step(`Allowing port ${opt.port} through the firewall (ufw)`); run('ufw', ['allow', `${opt.port}/tcp`], { allowFail: true, dryRun: opt.dryRun, r });
  } else if (has('firewall-cmd') && run('firewall-cmd', ['--state'], { allowFail: true }).ok) {
    r.step(`Allowing port ${opt.port} through the firewall (firewalld)`);
    run('firewall-cmd', ['--permanent', `--add-port=${opt.port}/tcp`], { allowFail: true, dryRun: opt.dryRun, r });
    run('firewall-cmd', ['--reload'], { allowFail: true, dryRun: opt.dryRun, r });
  }
}

async function install(opt, r) {
  if (!has('systemctl')) throw new Error('systemd was not found. Run Hearth with Docker instead, or start it yourself with "hearth-server start".');
  const user = opt.scope === 'system' ? ensureUser(opt, r) : os.userInfo().username;
  if (!opt.dryRun) {
    fs.mkdirSync(opt.dataDir, { recursive: true, mode: 0o700 });
    if (opt.scope === 'system') run('chown', ['-R', `${user}:${user}`, opt.dataDir]);
    fs.chmodSync(opt.dataDir, 0o700);
  }
  const file = unitPath(opt);
  r.step(`Writing ${file}`);
  if (opt.dryRun) r.info(unit(opt, user));
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, unit(opt, user)); }
  run(...ctl(opt, 'daemon-reload'), { dryRun: opt.dryRun, r });
  run(...ctl(opt, 'enable', '--now', NAME), { dryRun: opt.dryRun, r });
  if (opt.scope === 'user') run('loginctl', ['enable-linger', user], { allowFail: true, dryRun: opt.dryRun, r }); // keep running after you log out
  openFirewall(opt, r);
  r.ok(`Hearth is installed as a service and starts with the computer (systemctl ${opt.scope === 'user' ? '--user ' : ''}status ${NAME})`);
  return { manager: 'systemd', unit: file, logs: `journalctl ${opt.scope === 'user' ? '--user ' : ''}-u ${NAME} -f` };
}

async function uninstall(opt, r) {
  r.step('Stopping and removing the Hearth service');
  run(...ctl(opt, 'disable', '--now', NAME), { allowFail: true, dryRun: opt.dryRun, r });
  const file = unitPath(opt);
  if (!opt.dryRun && fs.existsSync(file)) fs.rmSync(file);
  run(...ctl(opt, 'daemon-reload'), { allowFail: true, dryRun: opt.dryRun, r });
}

function status(opt) {
  const installed = fs.existsSync(unitPath(opt));
  const active = installed && run(...ctl(opt, 'is-active', NAME), { allowFail: true }).stdout === 'active';
  return { installed, running: active, manager: 'systemd', unit: unitPath(opt) };
}

function control(action, opt, r) {
  r.step(`${action[0].toUpperCase()}${action.slice(1)}ing Hearth`);
  run(...ctl(opt, action, NAME), { dryRun: opt.dryRun, r });
}

module.exports = { install, uninstall, status, control, unit };
