#!/usr/bin/env node
// Gathers everything the desktop installers carry, so people don't have to install anything first:
//   build/resources/<platform>-<arch>/runtime/node[.exe]   the Node.js runtime (official build, checksum-verified)
//   build/resources/<platform>-<arch>/server/              the Hearth server with its packages (pure JavaScript)
//   build/resources/win32-x64/winsw/WinSW.exe              runs Hearth as a Windows service (checksum-verified)
//
//   node scripts/prepare-resources.mjs                         this computer's platform (macOS & Linux: x64 + arm64)
//   node scripts/prepare-resources.mjs --platform win32 --arch x64
//   node scripts/prepare-resources.mjs --local-node            use the Node.js running this script (quick local test)
//
// Environment: HEARTH_NODE_VERSION (default: newest 22.x), NODE_MIRROR (default https://nodejs.org/dist)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, '..');
const REPO = path.resolve(DESKTOP, '..');
const SERVER = path.join(REPO, 'server');
const OUT = path.join(DESKTOP, 'build', 'resources');
const CACHE = path.join(DESKTOP, 'build', 'cache');

const NODE_MAJOR = 22; // the server needs 22.13+ (built-in node:sqlite)
const MIRROR = (process.env.NODE_MIRROR || 'https://nodejs.org/dist').replace(/\/$/, '');
const WINSW = { version: '2.12.0', url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe',
  sha256: '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da' };
// Files from server/ that make up the running server (tests and local data stay behind)
const SERVER_FILES = ['package.json', 'package-lock.json', 'bin', 'src', 'web', 'scripts'];

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
const platform = opt('platform', process.platform);
const defaultArchs = { darwin: ['x64', 'arm64'], linux: ['x64', 'arm64'], win32: ['x64'] }[platform];
if (!defaultArchs) throw new Error(`Unsupported platform ${platform}`);
const archs = opt('arch', null)?.split(',') || defaultArchs;
const localNode = argv.includes('--local-node');

const log = (...a) => console.log('•', ...a);
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function download(url, dest) {
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  log(`Downloading ${url}`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Download failed (${r.status}) ${url}`);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  fs.renameSync(tmp, dest);
  return dest;
}

// ---------------------------------------------------------------- Node.js runtime
async function nodeVersion() {
  if (process.env.HEARTH_NODE_VERSION) return process.env.HEARTH_NODE_VERSION.replace(/^v/, '');
  const list = await (await fetch(`${MIRROR}/index.json`)).json();
  return list.find((r) => r.version.startsWith(`v${NODE_MAJOR}.`)).version.slice(1);
}

async function nodeRuntime(version, plat, arch, destDir) {
  const exe = plat === 'win32' ? 'node.exe' : 'node';
  fs.mkdirSync(destDir, { recursive: true });
  if (localNode) {
    if (plat !== process.platform || arch !== process.arch) throw new Error('--local-node only works for this computer\'s own platform');
    fs.copyFileSync(process.execPath, path.join(destDir, exe));
    return process.version.slice(1);
  }
  const osName = { darwin: 'darwin', linux: 'linux', win32: 'win' }[plat];
  const base = `node-v${version}-${osName}-${arch}`;
  const file = plat === 'win32' ? `${base}.zip` : `${base}.tar.gz`;
  const sums = await download(`${MIRROR}/v${version}/SHASUMS256.txt`, path.join(CACHE, `node-v${version}-SHASUMS256.txt`));
  const expected = fs.readFileSync(sums, 'utf8').split('\n').find((l) => l.endsWith(`  ${file}`))?.split(' ')[0];
  if (!expected) throw new Error(`${file} is not listed in SHASUMS256.txt`);
  const archive = await download(`${MIRROR}/v${version}/${file}`, path.join(CACHE, file));
  if (sha256(archive) !== expected) { fs.rmSync(archive); throw new Error(`Checksum mismatch for ${file} — download removed, try again`); }
  // tar reads .zip too on Windows and macOS (bsdtar); only the node binary itself is extracted
  const inner = plat === 'win32' ? `${base}/node.exe` : `${base}/bin/node`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-node-'));
  if (plat === 'win32' && process.platform !== 'win32' && process.platform !== 'darwin') execFileSync('unzip', ['-q', archive, inner, '-d', tmp]);
  // On Windows use the system's own tar (bsdtar): Git Bash's GNU tar reads "D:\\…" as a network address
  else execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', archive, '-C', tmp, inner]);
  fs.copyFileSync(path.join(tmp, inner), path.join(destDir, exe));
  fs.chmodSync(path.join(destDir, exe), 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
  // Licence notice for the bundled runtime
  fs.writeFileSync(path.join(destDir, 'NODE-LICENSE.txt'), `Node.js ${version} — https://github.com/nodejs/node/blob/v${version}/LICENSE\n`);
  return version;
}

// ---------------------------------------------------------------- the server
function stageServer() {
  const staged = path.join(CACHE, 'server');
  fs.rmSync(staged, { recursive: true, force: true });
  fs.mkdirSync(staged, { recursive: true });
  for (const f of SERVER_FILES) fs.cpSync(path.join(SERVER, f), path.join(staged, f), { recursive: true });
  log('Installing the server\'s packages');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: staged, stdio: 'inherit', shell: process.platform === 'win32' });
  // npm's command shortcuts (node_modules/.bin) aren't needed, and copying them turns their links into absolute paths
  // pointing at this build machine — which breaks the macOS signature and dangles everywhere else
  fs.rmSync(path.join(staged, 'node_modules', '.bin'), { recursive: true, force: true });
  const links = [];
  const findLinks = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isSymbolicLink()) links.push(p); else if (e.isDirectory()) findLinks(p); } };
  findLinks(staged);
  if (links.length) throw new Error(`Symbolic links found — the bundled server must be plain files:\n${links.join('\n')}`);
  // Nothing native may sneak in: the same files must work on every platform
  const native = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.node$/.test(e.name)) native.push(p); } };
  walk(path.join(staged, 'node_modules'));
  if (native.length) throw new Error(`Native modules found — the bundled server must be pure JavaScript:\n${native.join('\n')}`);
  return staged;
}

// ---------------------------------------------------------------- the stand-alone server download
// The same folder doubles as "Hearth Server" for computers without a screen: unpack it and run ./hearth-server
function writeLaunchers(dir, plat) {
  if (plat === 'win32') {
    fs.writeFileSync(path.join(dir, 'hearth-server.cmd'), '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0server\\bin\\hearth-server.js" %*\r\n');
  } else {
    fs.writeFileSync(path.join(dir, 'hearth-server'), '#!/bin/sh\n# Hearth server — see README.txt\nhere=$(cd "$(dirname "$0")" && pwd)\nexec "$here/runtime/node" "$here/server/bin/hearth-server.js" "$@"\n', { mode: 0o755 });
  }
  const run = plat === 'win32' ? 'hearth-server' : './hearth-server';
  const folder = plat === 'win32' ? 'C:\\Program Files\\Hearth Server' : '/opt/hearth-server';
  fs.writeFileSync(path.join(dir, 'README.txt'), `Hearth Server — everything needed to run Hearth, with no desktop app.
Includes its own Node.js runtime: nothing else to install.

Try it:              ${run} start            then open http://<this computer>:8484
Start with the computer (as administrator${plat === 'win32' ? '' : ' / with sudo'}):
                     ${run} service install
Everything else:     ${run} help

Keep this folder where it is once the service is installed (for example ${folder}).
Guide: https://github.com/shotgn16/hearth/blob/main/docs/install/server-only.md
`.replace(/\n/g, plat === 'win32' ? '\r\n' : '\n'));
}

// ---------------------------------------------------------------- main
const version = localNode ? process.version.slice(1) : await nodeVersion();
if (Number(version.split('.')[0]) < NODE_MAJOR) throw new Error(`Node.js ${version} is too old — Hearth needs ${NODE_MAJOR}.13 or newer`);
log(`Hearth server ${JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8')).version} · Node.js ${version} · ${platform} ${archs.join(', ')}`);
const staged = stageServer();
for (const arch of archs) {
  const dir = path.join(OUT, `${platform}-${arch}`);
  fs.rmSync(dir, { recursive: true, force: true });
  await nodeRuntime(version, platform, arch, path.join(dir, 'runtime'));
  fs.cpSync(staged, path.join(dir, 'server'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'winsw'), { recursive: true }); // electron-builder expects the folder on every platform
  if (platform === 'win32') {
    const exe = await download(WINSW.url, path.join(CACHE, `WinSW-${WINSW.version}-x64.exe`));
    if (sha256(exe) !== WINSW.sha256) { fs.rmSync(exe); throw new Error('Checksum mismatch for WinSW — download removed, try again'); }
    fs.copyFileSync(exe, path.join(dir, 'winsw', 'WinSW.exe'));
    fs.writeFileSync(path.join(dir, 'winsw', 'LICENSE.txt'), `WinSW ${WINSW.version} — MIT licence — https://github.com/winsw/winsw\n`);
  }
  writeLaunchers(dir, platform);
  log(`Ready: ${path.relative(DESKTOP, dir)}`);
}
