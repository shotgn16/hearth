// Runtime configuration. Everything is set inside Hearth (Settings → App settings / Local AI) and stored in its database.
// Environment variables give the starting values for standalone installs; /data/options.json from older add-on
// versions is read once so existing installs keep their choices.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
let opts = {};
try { opts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8')); } catch { /* not running as an add-on */ }

const isAddon = !!process.env.SUPERVISOR_TOKEN;
const config = {
  isAddon,
  dataDir: DATA_DIR,
  port: Number(process.env.PORT) || 8484,
  timezone: opts.timezone || process.env.TZ || 'Europe/London',
  ollama: {
    url: opts.ollama_url || process.env.OLLAMA_URL || 'http://localhost:11434',
    model: opts.ollama_model || process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct',
    fastModel: opts.ollama_fast_model || process.env.OLLAMA_FAST_MODEL || '',
    visionModel: opts.ollama_vision_model || process.env.OLLAMA_VISION_MODEL || '',
  },
  autoCreateHaUsers: !!opts.auto_create_ha_users,
  publishSensors: opts.publish_sensors !== false,
  logLevel: opts.log_level || process.env.LOG_LEVEL || 'info',
  legacyOptions: opts,
};
if (isAddon && !opts.ollama_url && !process.env.OLLAMA_URL) config.ollama.url = 'http://homeassistant.local:11434';
process.env.TZ = config.timezone;

// App-wide settings saved in Hearth (Settings → App settings)
const SYSTEM_DEFAULTS = () => ({ timezone: config.timezone, auto_create_ha_users: config.autoCreateHaUsers, publish_sensors: config.publishSensors, log_level: config.logLevel });
function applySystem(s = {}) {
  if (s.timezone) { config.timezone = s.timezone; process.env.TZ = s.timezone; }
  if (s.auto_create_ha_users !== undefined) config.autoCreateHaUsers = !!s.auto_create_ha_users;
  if (s.publish_sensors !== undefined) config.publishSensors = !!s.publish_sensors;
  if (['debug', 'info', 'warning', 'error'].includes(s.log_level)) config.logLevel = s.log_level;
}
config.applySystem = applySystem;
config.systemDefaults = SYSTEM_DEFAULTS;

const LEVELS = { debug: 0, info: 1, warning: 2, error: 3 };
const log = Object.fromEntries(Object.keys(LEVELS).map((l) => [l, (...a) => { if (LEVELS[l] >= LEVELS[config.logLevel]) console[l === 'warning' ? 'warn' : l === 'debug' ? 'log' : l](`[${l}]`, ...a); }]));

module.exports = { config, log };
