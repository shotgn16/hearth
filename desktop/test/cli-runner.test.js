// Running hearth-server commands: progress lines, results, errors, and the quoting used for administrator prompts.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { runCli, elevatedCommand, shq, winq, psq } = require('../src/cli-runner');

const paths = { node: process.execPath, cli: path.join(__dirname, '..', '..', 'server', 'bin', 'hearth-server.js') };

test('runCli passes progress through and resolves with the result', async () => {
  const events = [];
  const res = await runCli(paths, ['service', 'install', '--dry-run', '--scope', 'user', '--data', path.join(require('os').tmpdir(), 'hearth-x')], { onEvent: (e) => events.push(e) });
  assert.ok(events.length > 0, 'progress lines arrived');
  assert.ok(res && typeof res === 'object');
});

test('runCli rejects with the command\'s own message', async () => {
  await assert.rejects(runCli(paths, ['no-such-command']), (e) => e.message.length > 0 && !/exited with/.test(e.message));
});

test('quoting survives spaces and quotes in folder names', () => {
  assert.strictEqual(shq("/Users/o'brien/Hearth data"), "'/Users/o'\\''brien/Hearth data'");
  assert.strictEqual(winq('C:\\Program Files\\Hearth Server\\'), '"C:\\Program Files\\Hearth Server\\\\"');
  assert.strictEqual(winq('say "hi"'), '"say \\"hi\\""');
  assert.strictEqual(psq("it's"), "'it''s'");
});

test('administrator commands use the right tool for each system', () => {
  const [cmd, args] = elevatedCommand('/opt/node', '/opt/cli.js', ['service', 'install'], '/tmp/log');
  if (process.platform === 'darwin') { assert.strictEqual(cmd, 'osascript'); assert.match(args[1], /with administrator privileges/); }
  else if (process.platform === 'win32') { assert.strictEqual(cmd, 'powershell.exe'); assert.match(args.at(-1), /-Verb RunAs/); }
  else { assert.strictEqual(cmd, 'pkexec'); assert.deepStrictEqual(args, ['/opt/node', '/opt/cli.js', 'service', 'install', '--log-file', '/tmp/log']); }
});
