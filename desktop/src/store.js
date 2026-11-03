// The desktop app's own settings (which setup you chose, ports, addresses, window size), kept as JSON in the
// app's data folder. Hearth's financial data is never stored here — that lives in the server's data folder.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  setupDone: false,
  mode: null,           // local | local-phone | server | remote | docker | homeassistant
  port: 8484,
  dataDir: null,        // local modes: where Hearth keeps its data (default: <app data>/data)
  url: null,            // the Hearth address the window opens
  ollamaUrl: '',
  startAtLogin: false,
  dockerDir: null,
  haUrl: null,
  panelUrl: null,
  serverDataDir: null,  // household server: its data folder
  window: null,         // { width, height, x, y }
  trayHintShown: false,
};

class Store {
  constructor(file) { this.file = file; this.data = { ...DEFAULTS, ...this.read() }; }
  read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  get(k) { return this.data[k]; }
  set(patch) {
    this.data = { ...this.data, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file); // never leave a half-written file
    return this.data;
  }
  all() { return { ...this.data }; }
}

module.exports = { Store, DEFAULTS };
