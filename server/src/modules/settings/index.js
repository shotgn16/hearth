// Settings — Household settings, app-wide settings and "sync everything now".
// Each module adds its API routes here; see docs/customising.md.
const { q, getSetting, setSetting } = require('../../core/db');
const { config } = require('../../core/config');
const { encrypt } = require('../../core/secrets');
const scheduler = require('../../jobs/scheduler');
const { wrap, err, MASK, SECRET_SETTINGS } = require('../../core/http');

const SETTING_KEYS = ['ollama', 'hass_sensors', 'tracker', 'email_check_minutes', 'homeassistant', 'ntfy', 'integrations', 'large_tx_threshold', 'bank_sync_hours', 'price_check_hours', 'digest', 'theme'];

// Routes for signed-in users
function routes(api) {
  // App-wide settings (formerly the add-on's Configuration tab)
  api.get('/system', (req, res) => res.json({ ...config.systemDefaults(), ...(getSetting(0, 'system') || {}), addon: config.isAddon, timezones: Intl.supportedValuesOf('timeZone') }));
  api.put('/system', (req, res) => {
    if (req.user.role !== 'admin') throw err('Only an admin can change app settings', 403);
    const b = req.body, cur = getSetting(0, 'system') || config.systemDefaults(), next = { ...cur };
    if (b.timezone !== undefined) { if (!Intl.supportedValuesOf('timeZone').includes(b.timezone) && b.timezone !== 'UTC') throw err('Unknown time zone'); next.timezone = b.timezone; }
    for (const k of ['auto_create_ha_users', 'publish_sensors']) if (b[k] !== undefined) next[k] = !!b[k];
    if (b.log_level !== undefined) { if (!['debug', 'info', 'warning', 'error'].includes(b.log_level)) throw err('Unknown log level'); next.log_level = b.log_level; }
    setSetting(0, 'system', next); config.applySystem(next);
    res.json({ ok: true });
  });
  api.get('/settings', (req, res) => {
    const out = {}; for (const k of SETTING_KEYS) out[k] = getSetting(req.hid, k);
    for (const k of SECRET_SETTINGS) if (out[k]?.token) out[k] = { ...out[k], token: MASK };
    res.json(out);
  });
  api.put('/settings', (req, res) => {
    for (const k of SETTING_KEYS) if (req.body[k] !== undefined) {
      let v = req.body[k];
      if (SECRET_SETTINGS.includes(k) && v && typeof v === 'object') v = { ...v, token: v.token === MASK ? getSetting(req.hid, k)?.token : encrypt(v.token || '') || '' };
      setSetting(req.hid, k, v);
    }
    if (req.body.household_name) q.run('UPDATE households SET name=? WHERE id=?', req.body.household_name, req.hid);
    res.json({ ok: true });
  });
  api.post('/sync-all', wrap(async (req, res) => { await scheduler.tick(); res.json({ ok: true }); }));
}

module.exports = { name: 'settings', title: 'Settings', routes };
