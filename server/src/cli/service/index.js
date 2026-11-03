// Run Hearth as a background service that starts with the computer — systemd (Linux), launchd (macOS)
// or a Windows service (WinSW). Used by the desktop app's "household server" setup and the server installers.
const fs = require('fs');
const path = require('path');
const { paths, isRoot, CliError } = require('../util');

const SERVER_ROOT = path.resolve(__dirname, '..', '..', '..'); // the folder with src/, web/, node_modules/
const platform = () => ({ linux: require('./linux'), darwin: require('./macos'), win32: require('./windows') })[process.platform]
  || (() => { throw new CliError(`Services aren't supported on ${process.platform}`); })();

/** Fill in defaults so every platform gets the same, complete set of options. */
function resolveOptions(o = {}) {
  const scope = o.scope === 'user' ? 'user' : 'system';
  return {
    scope,
    port: Number(o.port) || 8484,
    host: o.host === undefined || o.host === true ? '0.0.0.0' : String(o.host),
    dataDir: path.resolve(o.data || o.dataDir || (scope === 'user' ? paths.homeData() : paths.systemData())),
    nodePath: path.resolve(o.node || process.execPath),
    serverDir: path.resolve(o.serverDir || SERVER_ROOT),
    copyTo: o.copyTo ? path.resolve(o.copyTo === true ? paths.systemInstall() : o.copyTo) : null,
    user: o.user && o.user !== true ? String(o.user) : null,
    winsw: o.winsw || process.env.HEARTH_WINSW || null,
    timezone: o.timezone || process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    ollamaUrl: o.ollamaUrl || null,
    dryRun: !!o.dryRun,
  };
}

/**
 * Copy the Node runtime and the server into a fixed folder, so the service keeps working when the desktop
 * app is updated or moved. Returns the new node and server paths.
 */
function copyRuntime(opt, r) {
  const dest = opt.copyTo;
  const nodeDest = path.join(dest, 'runtime', path.basename(opt.nodePath));
  const serverDest = path.join(dest, 'server');
  r.step(`Copying Hearth to ${dest}`);
  if (opt.dryRun) return { nodePath: nodeDest, serverDir: serverDest };
  fs.mkdirSync(path.dirname(nodeDest), { recursive: true });
  fs.copyFileSync(opt.nodePath, nodeDest);
  if (process.platform !== 'win32') fs.chmodSync(nodeDest, 0o755);
  fs.rmSync(serverDest, { recursive: true, force: true });
  const skip = new Set(['data', 'demo-data', 'test', '.git']);
  fs.cpSync(opt.serverDir, serverDest, { recursive: true, filter: (src) => !skip.has(path.relative(opt.serverDir, src).split(path.sep)[0]) });
  // A "hearth-server" command beside it, for managing the service later (see docs/install)
  if (process.platform === 'win32') fs.writeFileSync(path.join(dest, 'hearth-server.cmd'), '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0server\\bin\\hearth-server.js" %*\r\n');
  else fs.writeFileSync(path.join(dest, 'hearth-server'), '#!/bin/sh\nhere=$(cd "$(dirname "$0")" && pwd)\nexec "$here/runtime/node" "$here/server/bin/hearth-server.js" "$@"\n', { mode: 0o755 });
  // WinSW (Windows) travels with the runtime
  const winsw = findWinsw(opt);
  if (winsw) { fs.mkdirSync(path.join(dest, 'winsw'), { recursive: true }); fs.copyFileSync(winsw, path.join(dest, 'winsw', 'WinSW.exe')); }
  return { nodePath: nodeDest, serverDir: serverDest, winsw: winsw ? path.join(dest, 'winsw', 'WinSW.exe') : null };
}

// Moving from "just this computer" to a household server: bring the existing data (and its key) along
function importData(from, opt, r) {
  if (!fs.existsSync(path.join(from, 'hearth.db'))) { r.info(`No Hearth data in ${from} to bring across`); return; }
  if (fs.existsSync(path.join(opt.dataDir, 'hearth.db'))) { r.warn(`${opt.dataDir} already has Hearth data — keeping it, not copying ${from}`); return; }
  r.step(`Copying your data from ${from}`);
  if (opt.dryRun) return;
  fs.cpSync(from, opt.dataDir, { recursive: true, filter: (src) => !/\.(log)$/.test(src) && path.basename(src) !== 'logs' });
}

function findWinsw(opt) {
  const candidates = [opt.winsw, path.join(path.dirname(opt.nodePath), '..', 'winsw', 'WinSW.exe'), path.join(opt.serverDir, '..', 'winsw', 'WinSW.exe'),
    path.join(path.dirname(opt.nodePath), 'WinSW.exe')].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function needAdmin(opt) {
  if (opt.scope === 'system' && !opt.dryRun && !isRoot()) {
    throw new CliError(process.platform === 'win32' ? 'Installing a Windows service needs administrator rights — run this from an administrator terminal.'
      : 'Installing a system service needs administrator rights — run it again with sudo.');
  }
}

async function install(o, r) {
  const opt = resolveOptions(o);
  if (process.platform === 'win32') opt.scope = 'system';
  needAdmin(opt);
  if (opt.copyTo) Object.assign(opt, copyRuntime(opt, r));
  if (!opt.dryRun) fs.mkdirSync(opt.dataDir, { recursive: true });
  if (o.importData && o.importData !== true) importData(path.resolve(o.importData), opt, r);
  const res = await platform().install(opt, r);
  return { ...res, port: opt.port, dataDir: opt.dataDir, scope: opt.scope };
}

async function uninstall(o, r) {
  const opt = resolveOptions(o);
  if (process.platform === 'win32') opt.scope = 'system';
  needAdmin(opt);
  // Installed with --copy-to: the service runs the copied runtime (and on Windows its helper sits beside it)
  if (opt.copyTo) opt.nodePath = path.join(opt.copyTo, 'runtime', path.basename(opt.nodePath));
  await platform().uninstall(opt, r);
  if (opt.copyTo && !opt.dryRun && fs.existsSync(opt.copyTo)) { r.step(`Removing ${opt.copyTo}`); fs.rmSync(opt.copyTo, { recursive: true, force: true }); }
  r.ok(`Service removed. Your data is still in ${opt.dataDir} — delete that folder yourself if you no longer need it.`);
}

const status = (o) => platform().status(resolveOptions(o));
const control = (action, o, r) => platform().control(action, resolveOptions(o), r);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

module.exports = { install, uninstall, status, control, resolveOptions, findWinsw, xml, SERVER_ROOT };
