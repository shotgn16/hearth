// "hearth-server doctor": a quick health check of this computer for running Hearth.
const fs = require('fs');
const path = require('path');
const { portFree } = require('./network');

async function run(a, r) {
  const checks = [];
  const add = (name, ok, detail) => { checks.push({ name, ok, detail }); (ok === false ? r.warn : ok ? r.ok : r.info)(`${name}: ${detail}`); };

  const [maj, min] = process.versions.node.split('.').map(Number);
  add('Node.js', maj > 22 || (maj === 22 && min >= 13), `${process.versions.node}${maj > 22 || (maj === 22 && min >= 13) ? '' : ' — Hearth needs 22.13 or newer'}`);

  const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.accessSync(dataDir, fs.constants.W_OK); add('Data folder', true, `${dataDir} (writable)`); }
  catch (e) { add('Data folder', false, `${dataDir} is not writable (${e.code})`); }
  if (fs.existsSync(path.join(dataDir, 'hearth.db')) && !fs.existsSync(path.join(dataDir, 'hearth.key')) && !process.env.HEARTH_SECRET_KEY) {
    add('Encryption key', false, 'hearth.db exists but hearth.key is missing — saved bank and mailbox logins will need reconnecting');
  }

  const port = Number(a.port || process.env.PORT) || 8484;
  if (await portFree(port)) add('Port', true, `${port} is free`);
  else {
    const s = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(2000) }).then((x) => x.json()).catch(() => null);
    add('Port', s ? true : false, s ? `${port}: Hearth ${s.version} is already running here` : `${port} is used by another program — choose another with --port`);
  }

  const ollama = process.env.OLLAMA_URL || 'http://localhost:11434';
  const o = await fetch(`${ollama}/api/version`, { signal: AbortSignal.timeout(2000) }).then((x) => x.json()).catch(() => null);
  add('Ollama (local AI)', o ? true : null, o ? `${o.version} at ${ollama}` : `not found at ${ollama} — optional; Hearth works without it`);

  const d = require('./docker').check();
  add('Docker', d.ok ? true : null, d.ok ? `${d.version}` : `${d.problem} (only needed for Docker installs)`);
  return checks;
}

module.exports = { run };
