// Windows: a real Windows service (visible in services.msc), using the WinSW service wrapper.
const fs = require('fs');
const path = require('path');
const { run, CliError } = require('../util');
const { xml, findWinsw } = require('./index');

const ID = 'Hearth';

function config(opt) {
  const env = { DATA_DIR: opt.dataDir, PORT: String(opt.port), HOST: opt.host, TZ: opt.timezone, NODE_ENV: 'production', ...(opt.ollamaUrl ? { OLLAMA_URL: opt.ollamaUrl } : {}) };
  return `<!-- Hearth household money manager — installed by "hearth-server service install" -->
<service>
  <id>${ID}</id>
  <name>Hearth</name>
  <description>Hearth household money manager (https://github.com/shotgn16/hearth)</description>
  <executable>${xml(opt.nodePath)}</executable>
  <arguments>"${xml(path.join(opt.serverDir, 'src', 'index.js'))}"</arguments>
  <workingdirectory>${xml(opt.serverDir)}</workingdirectory>
${Object.entries(env).map(([k, v]) => `  <env name="${k}" value="${xml(v)}"/>`).join('\n')}
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <logpath>${xml(path.join(opt.dataDir, 'logs'))}</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
`;
}

// The wrapper lives next to the runtime as hearth-service.exe with hearth-service.xml beside it
const wrapperPaths = (opt) => {
  const dir = path.dirname(path.dirname(opt.nodePath)); // …\runtime\node.exe → install folder
  return { exe: path.join(dir, 'hearth-service.exe'), xml: path.join(dir, 'hearth-service.xml') };
};

const exists = () => run('sc', ['query', ID], { allowFail: true }).ok;

async function install(opt, r) {
  const winsw = opt.winsw || findWinsw(opt);
  if (!winsw && !opt.dryRun) throw new CliError('The Windows service helper (WinSW.exe) is missing from this download. Reinstall Hearth, or run "hearth-server start" yourself.');
  const w = wrapperPaths(opt);
  if (exists()) {
    r.step('Replacing the existing Hearth service');
    run(w.exe, ['stop'], { allowFail: true, dryRun: opt.dryRun, r });
    run(w.exe, ['uninstall'], { allowFail: true, dryRun: opt.dryRun, r });
  }
  r.step(`Writing ${w.xml}`);
  if (opt.dryRun) r.info(config(opt));
  else {
    fs.mkdirSync(path.join(opt.dataDir, 'logs'), { recursive: true });
    // Only the service (SYSTEM) and administrators can read Hearth's data, key and logs
    run('icacls', [opt.dataDir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { allowFail: true });
    if (path.resolve(winsw) !== path.resolve(w.exe)) fs.copyFileSync(winsw, w.exe);
    fs.writeFileSync(w.xml, config(opt));
  }
  run(w.exe, ['install'], { dryRun: opt.dryRun, r });
  run(w.exe, ['start'], { dryRun: opt.dryRun, r });
  if (opt.host !== '127.0.0.1') {
    r.step(`Allowing port ${opt.port} through Windows Firewall (private networks)`);
    run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${ID}`], { allowFail: true, dryRun: opt.dryRun, r });
    run('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=${ID}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${opt.port}`, 'profile=private,domain'], { allowFail: true, dryRun: opt.dryRun, r });
  }
  r.ok('Hearth is installed as a Windows service and starts with the computer (see Services → Hearth)');
  return { manager: 'windows-service', config: w.xml, logs: path.join(opt.dataDir, 'logs') };
}

async function uninstall(opt, r) {
  const w = wrapperPaths(opt);
  r.step('Stopping and removing the Hearth service');
  if (fs.existsSync(w.exe)) { run(w.exe, ['stop'], { allowFail: true, dryRun: opt.dryRun, r }); run(w.exe, ['uninstall'], { allowFail: true, dryRun: opt.dryRun, r }); }
  else { run('sc', ['stop', ID], { allowFail: true, dryRun: opt.dryRun, r }); run('sc', ['delete', ID], { allowFail: true, dryRun: opt.dryRun, r }); }
  run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${ID}`], { allowFail: true, dryRun: opt.dryRun, r });
}

function status() {
  const q = run('sc', ['query', ID], { allowFail: true });
  return { installed: q.ok, running: q.ok && /RUNNING/.test(q.stdout), manager: 'windows-service' };
}

function control(action, opt, r) {
  r.step(`${action[0].toUpperCase()}${action.slice(1)}ing Hearth`);
  if (action === 'restart') { run('sc', ['stop', ID], { allowFail: true, dryRun: opt.dryRun, r }); run('powershell', ['-NoProfile', '-Command', `Start-Sleep 3; Start-Service ${ID}`], { dryRun: opt.dryRun, r }); }
  else run('sc', [action, ID], { dryRun: opt.dryRun, r });
}

module.exports = { install, uninstall, status, control, config };
