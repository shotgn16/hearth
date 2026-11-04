// Notifications: Hearth's in-app inbox, Home Assistant notify services (your phones via the HA app), and self-hosted ntfy.
const { q, getSetting } = require('../../core/db');

async function homeAssistant(hid, services, title, message, url) {
  const ha = require('../homeassistant/ha');
  if (!ha.available(hid) || !services?.length) return;
  await ha.sendNotify(hid, services, title, message, url);
}

async function ntfy(hid, title, message) {
  const cfg = getSetting(hid, 'ntfy');
  if (!cfg?.url || !cfg?.topic) return;
  try {
    await fetch(`${cfg.url.replace(/\/$/, '')}/${cfg.topic}`, {
      method: 'POST', headers: { Title: title, ...(cfg.token ? { Authorization: `Bearer ${require('../../core/secrets').decrypt(cfg.token)}` } : {}) }, body: message,
    });
  } catch (e) { console.warn('ntfy failed', e.message); }
}

/**
 * Send a notification.
 * target: { userIds?: number[] (whose in-app inbox), haServices?: string[], ntfy?: boolean }
 * Without haServices, the services chosen in Settings → Integrations are used.
 */
async function notify(hid, { title, body, url = '/' }, target = {}) {
  const users = target.userIds?.length ? target.userIds : q.all('SELECT id FROM users WHERE household_id=?', hid).map((u) => u.id);
  for (const uid of users) q.run('INSERT INTO notifications(household_id,user_id,title,body,url) VALUES(?,?,?,?,?)', hid, uid, title, body, url);
  const services = target.haServices?.length ? target.haServices : getSetting(hid, 'homeassistant')?.default_services ?? [];
  if (services.length) await homeAssistant(hid, services, title, body, url);
  if (target.ntfy !== false && getSetting(hid, 'ntfy')?.enabled) await ntfy(hid, title, body);
}

module.exports = { notify, homeAssistant };
