// Starts the Hearth server.  node src/index.js   (or: hearth-server start)
// Settings come from environment variables first (PORT, HOST, DATA_DIR, …) — see docs/standalone-docker.md.
process.removeAllListeners('warning'); // silence node:sqlite experimental notice
const { config, log } = require('./core/config');
const { DATA_DIR } = require('./core/db');
const { runUpgrades } = require('./core/upgrade');
const { createApp } = require('./app');
const scheduler = require('./jobs/scheduler');

function start({ port = config.port, host = config.host } = {}) {
  // A single failed background task must never take the whole app down
  process.on('unhandledRejection', (e) => log.error('Unexpected error (Hearth keeps running):', e?.stack || e));
  process.on('uncaughtException', (e) => log.error('Unexpected error (Hearth keeps running):', e?.stack || e));
  runUpgrades();
  const app = createApp();
  const server = app.listen(port, host, () => {
    log.info(`Hearth ${config.isAddon ? 'add-on ' : ''}${config.version} running on ${!host || host === '0.0.0.0' || host === '::' ? 'port ' : `${host}:`}${port} · data in ${DATA_DIR}`);
    scheduler.start();
  });
  server.on('error', (e) => {
    log.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use — is Hearth already running? Choose another port with PORT=…` : e.message);
    process.exit(1);
  });
  // Stop cleanly when a service manager or the desktop app asks
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { log.info('Stopping Hearth'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
  return server;
}

if (require.main === module) start();
module.exports = { start };
