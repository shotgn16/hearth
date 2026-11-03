// Home Assistant ingress: who is signed in to HA, when Hearth runs as an add-on.
// Identity headers are only trusted when the request really comes from the Supervisor's ingress proxy.
const { config } = require('./config');

const SUPERVISOR_IP = process.env.INGRESS_PROXY_IP || '172.30.32.2'; // override only for local testing

function haIdentity(req) {
  if (!config.isAddon) return null;
  const ip = String(req.socket.remoteAddress || '').replace('::ffff:', '');
  if (ip !== SUPERVISOR_IP || !req.headers['x-remote-user-id']) return null;
  return { id: String(req.headers['x-remote-user-id']), name: String(req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || 'Home Assistant user'),
    username: String(req.headers['x-remote-user-name'] || '') };
}

module.exports = { haIdentity, SUPERVISOR_IP };
