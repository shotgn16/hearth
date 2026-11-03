// Home Assistant — Connection status, notify services and calendars from Home Assistant.
// Each module adds its API routes here; see docs/customising.md.
const { config } = require('../../core/config');
const ha = require('./ha');
const { wrap } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  api.get('/homeassistant/status', wrap(async (req, res) => {
    const t = ha.target(req.hid);
    if (!t) return res.json({ connected: false, addon: config.isAddon });
    try { const c = await ha.call(req.hid, 'GET', '/config'); res.json({ connected: true, via: t.via, version: c.version, location: c.location_name, addon: config.isAddon }); }
    catch (e) { res.json({ connected: false, via: t.via, error: e.message, addon: config.isAddon }); }
  }));
  api.get('/homeassistant/services', wrap(async (req, res) => res.json(await ha.notifyServices(req.hid))));
  api.get('/homeassistant/calendars', wrap(async (req, res) => res.json(await ha.calendars(req.hid))));
}

module.exports = { name: 'homeassistant', title: 'Home Assistant', routes };
