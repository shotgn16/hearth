// Notifications: in-app inbox, Web Push to recognised devices, Home Assistant notify services, and self-hosted ntfy.
const webpush = require('web-push');
const { q, getSetting, setSetting } = require('./db');

function vapid() {
  let keys = getSetting(0, 'vapid');
  if (!keys) { keys = webpush.generateVAPIDKeys(); setSetting(0, 'vapid', keys); }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@hearth.local', keys.publicKey, keys.privateKey);
  return keys;
}

async function pushToDevice(device, payload) {
  if (!device.push_subscription || !device.notify_enabled) return false;
  vapid();
  try {
    await webpush.sendNotification(JSON.parse(device.push_subscription), JSON.stringify(payload));
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) q.run('UPDATE devices SET push_subscription=NULL WHERE id=?', device.id);
    return false;
  }
}

async function homeAssistant(hid, services, title, message, url) {
  const ha = require('./ha');
  if (!ha.available(hid) || !services?.length) return;
  await ha.sendNotify(hid, services, title, message, url);
}

async function ntfy(hid, title, message) {
  const cfg = getSetting(hid, 'ntfy');
  if (!cfg?.url || !cfg?.topic) return;
  try {
    await fetch(`${cfg.url.replace(/\/$/, '')}/${cfg.topic}`, {
      method: 'POST', headers: { Title: title, ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) }, body: message,
    });
  } catch (e) { console.warn('ntfy failed', e.message); }
}

/**
 * Send a notification.
 * target: { userIds?: number[], deviceIds?: number[], haServices?: string[], ntfy?: boolean }
 * With no explicit target, every member of the household gets it on every enabled device.
 */
async function notify(hid, { title, body, url = '/' }, target = {}) {
  let users = target.userIds?.length ? target.userIds : q.all('SELECT id FROM users WHERE household_id=?', hid).map((u) => u.id);
  if (target.deviceIds?.length) {
    users = [...new Set(q.all(`SELECT user_id FROM devices WHERE id IN (${target.deviceIds.map(() => '?').join(',')})`, ...target.deviceIds).map((d) => d.user_id))];
  }
  for (const uid of users) q.run('INSERT INTO notifications(household_id,user_id,title,body,url) VALUES(?,?,?,?,?)', hid, uid, title, body, url);

  const devices = target.deviceIds?.length
    ? q.all(`SELECT * FROM devices WHERE id IN (${target.deviceIds.map(() => '?').join(',')})`, ...target.deviceIds)
    : users.length ? q.all(`SELECT * FROM devices WHERE user_id IN (${users.map(() => '?').join(',')})`, ...users) : [];
  await Promise.all(devices.map((d) => pushToDevice(d, { title, body, url })));

  const ha = target.haServices ?? getSetting(hid, 'homeassistant')?.default_services ?? [];
  if (ha.length) await homeAssistant(hid, ha, title, body, url);
  if (target.ntfy !== false && getSetting(hid, 'ntfy')?.enabled) await ntfy(hid, title, body);
}

module.exports = { notify, vapid, homeAssistant };
