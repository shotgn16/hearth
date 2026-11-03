// Run Hearth in Docker on this computer: writes a compose file, starts it, and waits until Hearth answers.
const fs = require('fs');
const path = require('path');
const { run, has, waitForHearth, paths, CliError } = require('./util');

const IMAGE = process.env.HEARTH_IMAGE || 'ghcr.io/shotgn16/hearth:latest';

function compose(opt) {
  return `# Hearth household money manager — created by the Hearth installer.
# Start:  docker compose up -d      Stop: docker compose down      Update: docker compose pull && docker compose up -d
# Your data (including the encryption key hearth.key) is in ./data — back up this whole folder.
services:
  hearth:
    image: ${opt.image}
    container_name: ${opt.name}
    restart: unless-stopped
    ports:
      - "${opt.host === '127.0.0.1' ? '127.0.0.1:' : ''}${opt.port}:8484"
    volumes:
      - ./data:/data
    environment:
      TZ: ${opt.timezone}
      OLLAMA_URL: ${opt.ollamaUrl}
    extra_hosts:
      - "host.docker.internal:host-gateway"
`;
}

/** Is Docker installed and running? Returns { ok, version, compose, problem } */
function check() {
  if (!has('docker')) return { ok: false, problem: 'Docker is not installed. Install Docker Desktop (Windows, macOS) or Docker Engine (Linux), then try again.' };
  const v = run('docker', ['version', '--format', '{{.Server.Version}}'], { allowFail: true });
  if (!v.ok) return { ok: false, problem: 'Docker is installed but not running. Start Docker Desktop (or the docker service) and try again.' };
  const c = run('docker', ['compose', 'version', '--short'], { allowFail: true });
  if (!c.ok) return { ok: false, version: v.stdout, problem: 'Docker Compose is missing. Update Docker, or install the docker-compose-plugin package.' };
  return { ok: true, version: v.stdout, compose: c.stdout };
}

async function install(o, r) {
  const opt = {
    dir: path.resolve(o.dir && o.dir !== true ? o.dir : paths.dockerDir()),
    port: Number(o.port) || 8484,
    host: o.host === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0',
    image: o.image || IMAGE,
    name: o.name || 'hearth',
    timezone: o.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    ollamaUrl: o.ollamaUrl || 'http://host.docker.internal:11434',
  };
  r.step('Checking Docker');
  const d = check();
  if (!d.ok) throw new CliError(d.problem);
  r.ok(`Docker ${d.version} with Compose ${d.compose}`);
  const file = path.join(opt.dir, 'compose.yaml');
  r.step(`Writing ${file}`);
  if (o.dryRun) { r.info(compose(opt)); return { dir: opt.dir, url: `http://localhost:${opt.port}` }; }
  fs.mkdirSync(path.join(opt.dir, 'data'), { recursive: true });
  fs.writeFileSync(file, compose(opt));
  r.step(`Downloading Hearth (${opt.image}) — this can take a minute the first time`);
  run('docker', ['compose', 'pull'], { cwd: opt.dir });
  r.step('Starting Hearth');
  run('docker', ['compose', 'up', '-d'], { cwd: opt.dir });
  const url = `http://localhost:${opt.port}`;
  r.step('Waiting for Hearth to start');
  await waitForHearth(url, { timeoutMs: 120000 });
  r.ok(`Hearth is running in Docker at ${url}. It restarts automatically with Docker.`);
  return { dir: opt.dir, url, composeFile: file };
}

async function uninstall(o, r) {
  const dir = path.resolve(o.dir && o.dir !== true ? o.dir : paths.dockerDir());
  if (!fs.existsSync(path.join(dir, 'compose.yaml'))) throw new CliError(`No Hearth Docker setup found in ${dir}`);
  r.step('Stopping and removing the Hearth container');
  run('docker', ['compose', 'down'], { cwd: dir, dryRun: o.dryRun, r });
  r.ok(`Removed. Your data is still in ${path.join(dir, 'data')}.`);
}

module.exports = { install, uninstall, check, compose, IMAGE };
