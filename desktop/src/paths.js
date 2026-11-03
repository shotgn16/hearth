// Where the bundled pieces live. Packaged apps carry their own Node.js runtime and the Hearth server in
// resources/; while developing ("npm start") the repository's server/ folder and your own Node are used.
const fs = require('fs');
const os = require('os');
const path = require('path');

function resolvePaths({ isPackaged, resourcesPath, userData }) {
  const devResources = path.join(__dirname, '..', 'build', 'resources', `${process.platform}-${process.arch}`);
  const res = isPackaged ? resourcesPath : devResources;
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  const bundledNode = path.join(res, 'runtime', exe);
  const serverDir = isPackaged ? path.join(res, 'server') : (fs.existsSync(path.join(res, 'server')) ? path.join(res, 'server') : path.join(__dirname, '..', '..', 'server'));
  return {
    node: fs.existsSync(bundledNode) ? bundledNode : (process.env.HEARTH_NODE || 'node'),
    serverDir,
    serverEntry: path.join(serverDir, 'src', 'index.js'),
    cli: path.join(serverDir, 'bin', 'hearth-server.js'),
    winsw: path.join(res, 'winsw', 'WinSW.exe'),
    userData,
    localData: path.join(userData, 'data'),
    logs: path.join(userData, 'logs'),
    settingsFile: path.join(userData, 'hearth-desktop.json'),
    // Folders used by the other setups (shown in the wizard)
    systemData: process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'Hearth')
      : process.platform === 'darwin' ? '/Library/Application Support/Hearth' : '/var/lib/hearth',
    systemInstall: process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Hearth Server')
      : process.platform === 'darwin' ? '/usr/local/hearth-server' : '/opt/hearth-server',
    dockerDir: path.join(os.homedir(), process.platform === 'win32' ? 'Hearth Docker' : 'hearth-docker'),
  };
}

/** Version of the bundled server (package.json), e.g. "1.6.0" */
function bundledVersion(serverDir) {
  try { return JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')).version; } catch { return null; }
}

module.exports = { resolvePaths, bundledVersion };
