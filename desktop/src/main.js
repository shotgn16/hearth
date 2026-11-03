// Hearth desktop app: the setup wizard, the Hearth window, the tray icon, and the bundled server.
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, Notification, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolvePaths, bundledVersion } = require('./paths');
const { Store } = require('./store');
const { LocalServer } = require('./local-server');
const { runCli, runCliElevated } = require('./cli-runner');
const { Setup } = require('./setup');
const { setStartAtLogin, getStartAtLogin } = require('./autostart');

const SMOKE = process.argv.includes('--smoke-test');
const HIDDEN = process.argv.includes('--hidden');
const BUILD = path.join(__dirname, '..', 'build');

app.setName('Hearth');
if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
if (!SMOKE) app.setAsDefaultProtocolClient('hearth');

let paths, store, server, setup, tray, mainWin, wizardWin, quitting = false, pendingLink = null;

// ------------------------------------------------------------------ start-up
app.whenReady().then(async () => {
  paths = resolvePaths({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, userData: app.getPath('userData') });
  store = new Store(paths.settingsFile);
  server = new LocalServer(paths);
  setup = new Setup({
    paths, store, localServer: server, username: os.userInfo().username,
    runCli: (args, o) => runCli(paths, args, o),
    runCliElevated: (args, o) => runCliElevated(paths, args, o),
    confirm: async (message, detail) => (await dialog.showMessageBox(wizardWin || mainWin, { type: 'question', buttons: ['Remove', 'Keep'], defaultId: 0, cancelId: 1, message, detail })).response === 0,
  });
  if (!SMOKE) server.on('failed', (lines) => dialog.showErrorBox('Hearth stopped', `Hearth stopped unexpectedly and couldn't restart.\n\n${lines}\n\nThe full log is in ${path.join(paths.logs, 'server.log')}`));

  if (SMOKE) return smokeTest();
  lockDownSessions();
  buildMenu();
  if (!store.get('setupDone')) return openWizard();
  createTray();
  await openHearth({ show: !HIDDEN });
  checkForUpdates(false);
  offerServiceUpdate();
});

app.on('second-instance', (e, argv) => { const link = argv.find((a) => a.startsWith('hearth://')); if (link) handleLink(link); else showMain(); });
app.on('open-url', (e, url) => { e.preventDefault(); if (app.isReady()) handleLink(url); else pendingLink = url; });
app.on('activate', () => { if (store?.get('setupDone')) showMain(); else if (!wizardWin) openWizard(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', (e) => { if (server?.child) { e.preventDefault(); server.stop().finally(() => app.exit(0)); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !keepRunning()) app.quit(); });

// Phone setup and household server keep Hearth's tray icon alive with no window open
const keepRunning = () => store?.get('mode') === 'local-phone';

// "hearth://connect?url=…" (the QR code on another Hearth's Phones & devices screen) — set this app up to use it
function handleLink(link) {
  try {
    const u = new URL(link);
    if (u.host === 'connect' && u.searchParams.get('url')) openWizard({ mode: 'remote', url: u.searchParams.get('url') });
  } catch { /* ignore malformed links */ }
}

// ------------------------------------------------------------------ security for loaded pages
function lockDownSessions() {
  // Hearth doesn't need camera, microphone, location or notifications from the browser engine
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen'].includes(permission)));
  app.on('web-contents-created', (e, wc) => {
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    wc.on('will-navigate', (ev, url) => {
      // Buttons on the "can't reach Hearth" page
      if (url.startsWith('hearth-action:')) { ev.preventDefault(); if (url === 'hearth-action:retry') openHearth({ show: true }); else openWizard(); return; }
      if (wc === wizardWin?.webContents) { if (!url.startsWith('file:')) ev.preventDefault(); return; }
      const allowed = [store.get('url'), store.get('haUrl')].filter(Boolean).map((x) => new URL(x).origin);
      try { if (!allowed.includes(new URL(url).origin)) { ev.preventDefault(); shell.openExternal(url); } } catch { ev.preventDefault(); }
    });
  });
}

// ------------------------------------------------------------------ the Hearth window
async function openHearth({ show = true, path: hash = '' } = {}) {
  const started = await setup.startCurrent();
  if (!mainWin) {
    const b = store.get('window') || {};
    mainWin = new BrowserWindow({
      width: b.width || 1280, height: b.height || 860, x: b.x, y: b.y, minWidth: 380, minHeight: 560, show: false,
      title: 'Hearth', icon: path.join(BUILD, 'icon.png'), backgroundColor: '#f3f5f1', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
    });
    mainWin.webContents.setUserAgent(`${mainWin.webContents.getUserAgent()} HearthDesktop/${app.getVersion()}`);
    const save = () => { if (!mainWin.isMaximized() && !mainWin.isMinimized()) store.set({ window: mainWin.getBounds() }); };
    mainWin.on('resize', save); mainWin.on('move', save);
    mainWin.on('close', (e) => {
      if (quitting) return;
      if (process.platform === 'darwin' || keepRunning()) {
        e.preventDefault(); mainWin.hide();
        if (keepRunning() && !store.get('trayHintShown') && Notification.isSupported()) {
          new Notification({ title: 'Hearth is still running', body: 'So your phone can keep using it. Quit from the Hearth icon in the menu bar / system tray.' }).show();
          store.set({ trayHintShown: true });
        }
      }
    });
    mainWin.on('closed', () => { mainWin = null; });
    mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) showOffline(desc); });
  }
  if (started.ok) await mainWin.loadURL(`${started.url}${hash}`).catch(() => {});
  else showOffline(started.error);
  if (show) { mainWin.show(); mainWin.focus(); }
  if (pendingLink) { handleLink(pendingLink); pendingLink = null; }
}

function showOffline(reason) {
  const q = new URLSearchParams({ reason: String(reason || ''), url: store.get('url') || '', mode: store.get('mode') || '' });
  mainWin?.loadFile(path.join(__dirname, 'pages', 'offline.html'), { search: q.toString() });
}

function showMain(hash) {
  if (!store?.get('setupDone')) return openWizard();
  if (!mainWin) return openHearth({ path: hash });
  if (hash) mainWin.loadURL(`${store.get('url')}${hash}`);
  mainWin.show(); mainWin.focus();
}

// ------------------------------------------------------------------ setup wizard
function openWizard(prefill = null) {
  if (wizardWin) { wizardWin.show(); wizardWin.focus(); if (prefill) wizardWin.webContents.send('wizard:prefill', prefill); return; }
  wizardWin = new BrowserWindow({
    width: 900, height: 700, minWidth: 720, minHeight: 600, title: 'Set up Hearth', icon: path.join(BUILD, 'icon.png'), backgroundColor: '#f3f5f1', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'wizard', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  wizardWin.loadFile(path.join(__dirname, 'wizard', 'index.html'), prefill ? { search: new URLSearchParams(prefill).toString() } : undefined);
  wizardWin.once('ready-to-show', () => wizardWin.show());
  wizardWin.on('closed', () => { wizardWin = null; if (!store.get('setupDone') && !quitting) app.quit(); });
}

ipcMain.handle('wizard:state', () => ({
  store: store.all(), platform: process.platform, arch: process.arch, version: app.getVersion(), serverVersion: bundledVersion(paths.serverDir),
  defaults: { port: 8484, localData: paths.localData, systemData: paths.systemData, dockerDir: paths.dockerDir, systemInstall: paths.systemInstall },
  username: os.userInfo().username, hostname: os.hostname(), appImage: !!process.env.APPIMAGE,
  hasLocalData: fs.existsSync(path.join(store.get('dataDir') || paths.localData, 'hearth.db')),
  startAtLogin: getStartAtLogin(app),
}));
ipcMain.handle('wizard:detect-ollama', () => setup.detectOllama());
ipcMain.handle('wizard:docker-check', () => setup.dockerCheck());
ipcMain.handle('wizard:test-remote', (e, url) => setup.testRemote(url));
ipcMain.handle('wizard:test-ha', (e, url, token) => setup.testHomeAssistant(url, token));
ipcMain.handle('wizard:choose-folder', async (e, current) => {
  const r = await dialog.showOpenDialog(wizardWin, { defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('wizard:open-external', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('wizard:apply', async (e, cfg) => {
  const progress = (ev) => { if (!e.sender.isDestroyed()) e.sender.send('wizard:progress', ev); };
  try {
    const res = await setup.apply(cfg, progress);
    try { setStartAtLogin(app, store.get('startAtLogin')); } catch (err) { progress({ type: 'warn', message: `Couldn't set "start at login": ${err.message}` }); }
    return { ok: true, ...res };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('wizard:finish', async () => {
  wizardWin?.hide();
  createTray(); buildMenu();
  if (mainWin) { mainWin.destroy(); mainWin = null; }
  await openHearth({ show: true });
  wizardWin?.destroy();
});
ipcMain.handle('wizard:cancel', () => { if (store.get('setupDone')) wizardWin?.close(); else app.quit(); });

// ------------------------------------------------------------------ tray and menus
function createTray() {
  if (tray) { tray.setContextMenu(trayMenu()); return; }
  const icon = process.platform === 'darwin' ? nativeImage.createFromPath(path.join(BUILD, 'trayTemplate.png')) : nativeImage.createFromPath(path.join(BUILD, 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Hearth');
  tray.setContextMenu(trayMenu());
  if (process.platform !== 'darwin') tray.on('click', () => showMain());
}

const MODE_NAMES = { local: 'On this computer', 'local-phone': 'On this computer and your phone', server: 'Household server', remote: 'Connected to another Hearth', docker: 'Running in Docker', homeassistant: 'In Home Assistant' };

function trayMenu() {
  const mode = store.get('mode');
  return Menu.buildFromTemplate([
    { label: `Hearth — ${MODE_NAMES[mode] || 'not set up'}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Hearth', click: () => showMain() },
    { label: 'Connect a phone…', visible: mode !== 'homeassistant', click: () => showMain('/#/settings/devices') },
    { type: 'separator' },
    { label: 'Change setup…', click: () => openWizard() },
    { label: 'Open data folder', visible: mode === 'local' || mode === 'local-phone', click: () => shell.openPath(store.get('dataDir') || paths.localData) },
    { label: 'Open log folder', click: () => shell.openPath(paths.logs) },
    { label: 'Start Hearth when I log in', type: 'checkbox', checked: getStartAtLogin(app), click: (i) => { setStartAtLogin(app, i.checked); store.set({ startAtLogin: i.checked }); } },
    { label: 'Check for updates…', click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Quit Hearth', click: () => { quitting = true; app.quit(); } },
  ]);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: 'Hearth', submenu: [{ role: 'about' }, { label: 'Check for updates…', click: () => checkForUpdates(true) }, { type: 'separator' },
      { label: 'Change setup…', click: () => openWizard() }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: 'Quit Hearth' }] }] : []),
    { label: 'File', submenu: [{ label: 'Connect a phone…', click: () => showMain('/#/settings/devices') }, { label: 'Change setup…', click: () => openWizard() }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit', label: 'Quit Hearth' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Hearth manual', click: () => shell.openExternal('https://github.com/shotgn16/hearth/tree/main/docs') }, { label: 'Report a problem', click: () => shell.openExternal('https://github.com/shotgn16/hearth/issues') }, { label: 'Open log folder', click: () => shell.openPath(paths.logs) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ updates
function checkForUpdates(manual) {
  let updater;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { if (manual) shell.openExternal('https://github.com/shotgn16/hearth/releases/latest'); return; }
  updater.autoDownload = true;
  updater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox({ type: 'info', buttons: ['Restart now', 'Later'], message: `Hearth ${info.version} is ready`, detail: 'Restart Hearth to finish updating. Your data is kept.' });
    if (r.response === 0) { quitting = true; updater.quitAndInstall(); }
  });
  if (manual) {
    updater.once('update-not-available', () => dialog.showMessageBox({ message: 'Hearth is up to date', detail: `You have version ${app.getVersion()}.` }));
    updater.once('error', () => shell.openExternal('https://github.com/shotgn16/hearth/releases/latest'));
  }
  updater.checkForUpdates().catch(() => {});
}

// After the app updates, a household server or Docker container may still run the older Hearth
async function offerServiceUpdate() {
  const o = await setup.outdated(bundledVersion(paths.serverDir)).catch(() => null);
  if (!o) return;
  const r = await dialog.showMessageBox(mainWin, { type: 'question', buttons: ['Update now', 'Not now'], message: `Update the ${store.get('mode') === 'docker' ? 'Docker container' : 'household server'} to Hearth ${o.bundled}?`,
    detail: `It's running Hearth ${o.running}. Updating takes a minute; your data is kept.${store.get('mode') === 'server' ? ' You will be asked for an administrator password.' : ''}` });
  if (r.response !== 0) return;
  try { await setup.updateService(); mainWin?.reload(); } catch (e) { dialog.showErrorBox('Update failed', e.message); }
}

// ------------------------------------------------------------------ smoke test (used by the build pipeline)
// Starts the bundled server in a temporary folder, checks it answers, and exits 0 — proves the installer's
// runtime and server work on this operating system.
async function smokeTest() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-smoke-'));
  try {
    const port = await setup.net.findFreePort(18484, '127.0.0.1');
    const st = await server.start({ port, host: '127.0.0.1', dataDir, timezone: 'UTC' });
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    if (!/<base href="\/">/.test(page)) throw new Error('web app missing');
    console.log(`SMOKE OK: Hearth ${st.version} on ${process.platform}-${process.arch} (node ${paths.node})`);
    await server.stop();
    app.exit(0);
  } catch (e) {
    console.error(`SMOKE FAILED: ${e.message}`);
    await server.stop();
    app.exit(1);
  }
}
