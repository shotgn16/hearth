// Home Assistant link. As an add-on this goes through the Supervisor proxy with no setup.
// Standalone, it uses the URL + long-lived token entered in Settings → Integrations.
const { getSetting } = require('./db');
const { config, log } = require('./config');

function target(hid) {
  const manual = getSetting(hid, 'homeassistant') || {};
  const tok = require('./secrets').decrypt(manual.token);
  if (manual.url && tok) return { base: `${manual.url.replace(/\/$/, '')}/api`, token: tok, via: 'manual' };
  if (process.env.SUPERVISOR_TOKEN) return { base: 'http://supervisor/core/api', token: process.env.SUPERVISOR_TOKEN, via: 'supervisor' };
  return null;
}

async function call(hid, method, path, body) {
  const t = target(hid);
  if (!t) throw new Error('Home Assistant is not connected');
  const r = await fetch(`${t.base}${path}`, {
    method, headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Home Assistant returned ${r.status} for ${path}`);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

const available = (hid) => !!target(hid);

async function notifyServices(hid) {
  const domains = await call(hid, 'GET', '/services');
  return Object.keys(domains.find((d) => d.domain === 'notify')?.services || {}).map((s) => `notify.${s}`);
}

// The sidebar panel's path (e.g. /hassio/ingress/abc123_hearth), so tapping a phone notification opens Hearth
let panelPath = null;
async function panel() {
  if (panelPath || !process.env.SUPERVISOR_TOKEN) return panelPath;
  try {
    const r = await fetch('http://supervisor/addons/self/info', { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` }, signal: AbortSignal.timeout(5000) });
    const j = await r.json(); if (j.data?.slug) panelPath = `/hassio/ingress/${j.data.slug}`;
  } catch (e) { log.debug('addon info unavailable', e.message); }
  return panelPath;
}

async function sendNotify(hid, services, title, message, url) {
  const open = (await panel()) || (getSetting(hid, 'homeassistant') || {}).panel_path || null;
  for (const svc of services) {
    const name = svc.replace(/^notify\./, '');
    // mobile_app notifications open Hearth's panel when tapped
    const data = name.startsWith('mobile_app_') ? { data: { group: 'hearth', ...(open ? { url: open, clickAction: open } : {}) } } : {};
    try { await call(hid, 'POST', `/services/notify/${name}`, { title, message, ...data }); } catch (e) { log.warning('HA notify failed', svc, e.message); }
  }
}

async function calendars(hid) { return call(hid, 'GET', '/calendars'); }
async function calendarEvents(hid, entityId, start, end) {
  return call(hid, 'GET', `/calendars/${encodeURIComponent(entityId)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
}

async function setState(hid, entityId, state, attributes) { return call(hid, 'POST', `/states/${entityId}`, { state, attributes }); }
async function fireEvent(hid, eventType, data) { return call(hid, 'POST', `/events/${eventType}`, data); }

// Publish a handful of sensors so HA dashboards/automations can use Hearth's numbers
async function publishSensors(hid, s) {
  if (!config.publishSensors || !available(hid)) return;
  const money = (v, name, icon, extra = {}) => ({ unit_of_measurement: 'GBP', device_class: 'monetary', friendly_name: name, icon, ...extra });
  const items = [
    ['sensor.hearth_free_to_spend', s.free, money(null, 'Hearth free to spend', 'mdi:wallet-outline', { until: s.until, payday: s.payday, committed: s.committed })],
    ['sensor.hearth_spent_this_month', s.monthSpend, money(null, 'Hearth spent this month', 'mdi:cart-outline')],
    ['sensor.hearth_balance', s.balance, money(null, 'Hearth total balance', 'mdi:bank-outline')],
    ['sensor.hearth_needs_attention', s.inbox, { friendly_name: 'Hearth things to check', icon: 'mdi:inbox-outline' }],
    ['sensor.hearth_next_payment', s.next?.date || 'none', { friendly_name: 'Hearth next payment', icon: 'mdi:calendar-clock', device_class: s.next ? 'date' : undefined, merchant: s.next?.merchant, amount: s.next?.amount }],
  ];
  for (const [id, state, attrs] of items) { try { await setState(hid, id, state, attrs); } catch (e) { log.debug('sensor publish failed', id, e.message); return; } }
}

module.exports = { panel, available, target, call, notifyServices, sendNotify, calendars, calendarEvents, setState, fireEvent, publishSensors };
