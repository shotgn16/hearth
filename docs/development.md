# Development

[← Documentation](../README.md#documentation)

## Stack

- **Server:** Node.js 22.13+ (built-in `node:sqlite`, no native modules), Express 5, `node-ical`, `imapflow` + `mailparser` (IMAP mailboxes), `unpdf` (PDF receipts), `httpntlm` (Exchange EWS).
- **Client:** plain ES modules, no build step, no external CDNs or fonts. Hand-written SVG charts.
- **Storage:** one SQLite file with additive migrations on start-up. Secrets and receipt files encrypted with AES-256-GCM (`secrets.js`).
- **Security headers:** a strict Content Security Policy (`script-src 'self'`) — no inline `<script>` or `onclick=` handlers in the client; use `data-*` attributes and listeners (see `data-go` in `app.js`). API responses are sent with `Cache-Control: no-store`.

## Layout

The full map of folders and how to add or remove features is in [Customising Hearth](customising.md). In short:

```
server/                    the server and web app (used by every kind of install)
  src/app.js               builds the app from the feature modules
  src/core/                database, sign-in, encryption, settings, HTTP helpers, ingress
  src/modules/<feature>/   one folder per feature: its routes, tables and background job
  src/jobs/scheduler.js    background jobs every 15 minutes
  src/cli/                 hearth-server: start, service, docker, homeassistant, users, doctor
  web/                     the web app (index.html, styles.css, js/<screen>.js)
  test/                    API, CLI and module tests (npm test)
  Dockerfile               the one Docker image (Docker, desktop "Install in Docker", Home Assistant)
desktop/                   Electron app + installers (see docs/building.md)
mobile/                    Capacitor phone/tablet app: www/ (connect screen), android/, ios/
hearth/                    Home Assistant add-on: config.yaml, DOCS.md, CHANGELOG.md, translations/
repository.yaml            Home Assistant add-on repository manifest
tools/                     make-icons.js, set-version.js
.github/workflows/         release.yml (every download), images.yml (Docker images)
```

## Running locally

```bash
cd server
npm ci
npm run demo            # seeds ./demo-data and serves on :8485
npm test
```

Point it at Ollama with `OLLAMA_URL=http://<ip>:11434`. The demo signs in as `alex@demo.local` / `demo1234` (or `sam@demo.local`). Delete `demo-data` to start again.

## How the assistant works

`ai.assistant()` builds a system prompt (house rules + a short snapshot), adds the thread history, and calls Ollama's `/api/chat` with `stream: true` and the tool definitions from `aitools.js`. Tool calls are executed against the database and returned as `role: "tool"` messages; the loop runs up to six rounds. `propose_*` tools create rows in `ai_actions` instead of changing anything; the client shows them as cards and `POST /api/ai/actions/:id/confirm` executes them. If Ollama rejects the tools, the turn is retried without tools and with a larger data summary.

`POST /api/ai/chat` streams newline-delimited JSON events: `thread`, `tool`, `notice`, `token`, `action`, `done`, `error`.

## Ingress

Home Assistant serves the panel under `/api/hassio_ingress/<token>/`. The server injects `<base href="${X-Ingress-Path}/">` into `index.html`, and every asset and API call in the client is relative. Identity headers (`X-Remote-User-*`) are trusted only from `172.30.32.2` (override with `INGRESS_PROXY_IP` for local testing only). The service worker is skipped inside ingress.

`GET /internal/checkpoint` (localhost only) folds the SQLite write-ahead log into the database; `backup_pre` in `config.yaml` calls it before every Home Assistant backup.

## Images, installers and releases

Home Assistant doesn't build Hearth: it downloads `ghcr.io/shotgn16/hearth-{arch}:<version>` (set by `image:` in `hearth/config.yaml`). Docker users and the desktop app's **Install in Docker** use the multi-arch `ghcr.io/shotgn16/hearth`. Both come from `server/Dockerfile` via `.github/workflows/images.yml`.

Every download (desktop installers, Hearth Server, Android, iPhone/iPad) is built and tested by `.github/workflows/release.yml`. How to release, sign and build things yourself: [Building the apps yourself](building.md).
