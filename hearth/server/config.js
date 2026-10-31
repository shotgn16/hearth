// Runtime configuration. As a Home Assistant add-on, options come from /data/options.json (written by the Supervisor).
// Standalone, the same values come from environment variables. Values saved in Hearth's own Settings screen win over both.
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
};
process.env.TZ = config.timezone;

const LEVELS = { debug: 0, info: 1, warning: 2, error: 3 };
const log = Object.fromEntries(Object.keys(LEVELS).map((l) => [l, (...a) => { if (LEVELS[l] >= LEVELS[config.logLevel]) console[l === 'warning' ? 'warn' : l === 'debug' ? 'log' : l](`[${l}]`, ...a); }]));

module.exports = { config, log };
