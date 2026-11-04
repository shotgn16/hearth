// Start Hearth when you log in. macOS and Windows use Electron's login items; Linux uses an XDG autostart entry.
const fs = require('fs');
const os = require('os');
const path = require('path');

const linuxFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'hearth.desktop');

function setStartAtLogin(app, enabled) {
  if (process.platform === 'linux') {
    const exe = process.env.APPIMAGE || process.execPath;
    if (enabled) {
      fs.mkdirSync(path.dirname(linuxFile()), { recursive: true });
      fs.writeFileSync(linuxFile(), `[Desktop Entry]\nType=Application\nName=Hearth\nComment=Household money manager\nExec="${exe}" --hidden\nIcon=hearth\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`);
    } else fs.rmSync(linuxFile(), { force: true });
    return;
  }
  app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: true, args: ['--hidden'] });
}

function getStartAtLogin(app) {
  if (process.platform === 'linux') return fs.existsSync(linuxFile());
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
}

module.exports = { setStartAtLogin, getStartAtLogin };
