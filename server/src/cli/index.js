// hearth-server — run Hearth and set it up. The desktop app's setup wizard and the server installers use these
// same commands, so whatever they can do, you can do from a terminal.
const path = require('path');
const { parseArgs, reporter, CliError } = require('./util');

const HELP = `Hearth server

Usage: hearth-server <command> [options]

Run
  start                      Start Hearth (the default). Options: --port 8484  --host 0.0.0.0  --data <folder>
  addresses                  Show the addresses phones and other computers can use to reach this one
  doctor                     Check this computer: Node, data folder, port, Ollama, Docker

Install
  service install            Start Hearth with the computer (systemd / launchd / Windows service)
                               --port 8484 --host 0.0.0.0 --data <folder> --scope system|user
                               --user <account> (macOS/Linux) --copy-to <folder> --ollama-url <url>
  service uninstall | status | start | stop | restart
  docker install             Run Hearth in Docker here.  --dir <folder> --port 8484 --image <image>
  docker uninstall           Stop and remove the container (keeps your data).  --dir <folder>
  homeassistant install      Install the Home Assistant add-on.  --url http://homeassistant.local:8123 --token <token>
  homeassistant test         Check the address and token without changing anything

Accounts
  users                      List the people who can sign in
  reset-password             Set a new password.  --email you@example.com [--password <new>]

Common options
  --json                     Machine-readable output (one JSON object per line)
  --dry-run                  Show what would happen without changing anything
  --version                  Show the version
`;

async function main(argv) {
  const a = parseArgs(argv);
  const [cmd = 'start', sub] = a._;
  const r = reporter(!!a.json);
  if (a.data && a.data !== true) process.env.DATA_DIR = path.resolve(a.data);
  if (a.version || cmd === 'version') { console.log(require('../../package.json').version); return; }
  if (a.help || cmd === 'help') { console.log(HELP); return; }

  try {
    let result;
    switch (cmd) {
      case 'start': {
        if (a.port) process.env.PORT = String(a.port);
        if (a.host && a.host !== true) process.env.HOST = String(a.host);
        require('../index').start();
        return; // keeps running
      }
      case 'addresses': {
        const list = require('./network').lanAddresses(Number(a.port) || 8484);
        result = list;
        if (!a.json) { if (!list.length) console.log('This computer has no network connection.'); for (const x of list) console.log(`${x.url.padEnd(32)} ${x.label} (${x.interface})`); }
        break;
      }
      case 'doctor': result = await require('./doctor').run(a, r); break;
      case 'service': {
        const s = require('./service');
        if (sub === 'install') result = await s.install(a, r);
        else if (sub === 'uninstall') result = await s.uninstall(a, r);
        else if (sub === 'status' || !sub) { result = s.status(a); if (!a.json) console.log(result.installed ? `Installed (${result.manager}) — ${result.running ? 'running' : 'not running'}` : 'Not installed'); }
        else if (['start', 'stop', 'restart'].includes(sub)) result = s.control(sub, a, r);
        else throw new CliError(`Unknown: service ${sub}`);
        break;
      }
      case 'docker': {
        const d = require('./docker');
        if (sub === 'install') result = await d.install(a, r);
        else if (sub === 'uninstall') result = await d.uninstall(a, r);
        else if (sub === 'check' || !sub) { result = d.check(); if (!a.json) console.log(result.ok ? `Docker ${result.version} is ready` : result.problem); }
        else throw new CliError(`Unknown: docker ${sub}`);
        break;
      }
      case 'homeassistant': case 'ha': {
        const h = require('./homeassistant');
        if (sub === 'install') result = await h.install(a, r);
        else if (sub === 'test') { result = await h.test(a); if (!a.json) console.log(`Home Assistant ${result.version} — ${result.addons ? 'add-ons supported' : result.addons === false ? 'no add-on store (Container/Core install)' : 'connected'}`); }
        else throw new CliError(`Unknown: homeassistant ${sub}`);
        break;
      }
      case 'users': { result = require('./users').list(); if (!a.json) for (const u of result) console.log(`${u.email.padEnd(32)} ${u.name} (${u.role})`); break; }
      case 'reset-password': result = require('./users').resetPassword(a, r); break;
      default: throw new CliError(`Unknown command "${cmd}". Run "hearth-server help" for the list.`);
    }
    if (a.json) r.result(result ?? null);
  } catch (e) {
    if (a.json) process.stdout.write(`${JSON.stringify({ type: 'error', message: e.message })}\n`);
    else console.error(`✗ ${e.message}`);
    if (!(e instanceof CliError) && process.env.HEARTH_DEBUG) console.error(e.stack);
    process.exitCode = 1;
  }
}

module.exports = { main, HELP };
