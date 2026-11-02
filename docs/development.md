# Development

[← Documentation](../README.md#documentation)

## Stack

- **Server:** Node.js 22.13+ (built-in `node:sqlite`, no native modules), Express 5, `node-ical`, `imapflow` + `mailparser` (IMAP mailboxes), `unpdf` (PDF receipts), `httpntlm` (Exchange EWS).
- **Client:** plain ES modules, no build step, no external CDNs or fonts. Hand-written SVG charts.
- **Storage:** one SQLite file with additive migrations on start-up. Secrets and receipt files encrypted with AES-256-GCM (`secrets.js`).
- **Security headers:** a strict Content Security Policy (`script-src 'self'`) — no inline `<script>` or `onclick=` handlers in the client; use `data-*` attributes and listeners (see `data-go` in `app.js`). API responses are sent with `Cache-Control: no-store`.

## Layout

```
repository.yaml            Home Assistant add-on repository manifest
.github/workflows/         addon-image.yml builds the ready-made images
.github/docker/            Dockerfile.addon used for those images
hearth/
  config.yaml              add-on manifest (version, image, ingress, permissions, optional port; options/schema are empty)
  Dockerfile               plain Docker build (node:22-alpine) used by docker compose
  translations/en.yaml     label for the optional network port in the HA UI
  CHANGELOG.md             shown by Home Assistant when an update is offered
  DOCS.md                  shown on the add-on's Documentation tab
  server/
    index.js               HTTP API, ingress sign-in, static files with <base href> injection
    config.js              env-var defaults; app-wide settings live in the database (Settings → App settings & security)
    db.js                  schema + migrations
    auth.js                passwords (scrypt) and sessions (stored as keyed hashes, 30-day sliding expiry)
    secrets.js             encryption at rest (hearth.key / HEARTH_SECRET_KEY), passphrase-locked backups, token hashing
    ingest.js              single entry point for transactions; CSV/OFX/QIF parsers
    categorize.js          merchant clean-up, UK patterns, learned merchant map
    subscriptions.js       recurring payment detection
    rules.js               workflow engine
    analytics.js           budgets, goals, insights, forecast, pivot, planner, inbox
    banks.js               SimpleFIN + generic JSON bank feeds
    calendar.js            ICS + HA calendar sync, event cost history
    tracker.js             subscription & bill tracker (due dates, paid/overdue, history)
    expenses.js            unexpected costs and work expense claims
    email.js               mailbox checks (IMAP, Graph, EWS), receipt reading, matching and approval
    microsoft.js           Microsoft sign-in (device code) and Graph mail + calendar
    ews.js                 on-premises Exchange Web Services (NTLM / Basic)
    ha.js                  Home Assistant client (Supervisor proxy or URL + token)
    notify.js              in-app inbox, HA notify services, ntfy
    ai.js                  Ollama: assistant loop, streaming, features
    aitools.js             tools the assistant can call + confirmable actions
    notes.js               quick-note parser
    prices.js              price watching
    scheduler.js           syncs, alerts, morning summary, AI jobs, sensors
  public/                  the app
  scripts/seed-demo.js     demo household
```

## Running locally

```bash
cd hearth
npm ci
npm run demo            # seeds ./demo-data and serves on :8485
```

Point it at Ollama with `OLLAMA_URL=http://<ip>:11434`. The demo signs in as `alex@demo.local` / `demo1234` (or `sam@demo.local`). Delete `demo-data` to start again.

## How the assistant works

`ai.assistant()` builds a system prompt (house rules + a short snapshot), adds the thread history, and calls Ollama's `/api/chat` with `stream: true` and the tool definitions from `aitools.js`. Tool calls are executed against the database and returned as `role: "tool"` messages; the loop runs up to six rounds. `propose_*` tools create rows in `ai_actions` instead of changing anything; the client shows them as cards and `POST /api/ai/actions/:id/confirm` executes them. If Ollama rejects the tools, the turn is retried without tools and with a larger data summary.

`POST /api/ai/chat` streams newline-delimited JSON events: `thread`, `tool`, `notice`, `token`, `action`, `done`, `error`.

## Ingress

Home Assistant serves the panel under `/api/hassio_ingress/<token>/`. The server injects `<base href="${X-Ingress-Path}/">` into `index.html`, and every asset and API call in the client is relative. Identity headers (`X-Remote-User-*`) are trusted only from `172.30.32.2` (override with `INGRESS_PROXY_IP` for local testing only). The service worker is skipped inside ingress.

`GET /internal/checkpoint` (localhost only) folds the SQLite write-ahead log into the database; `backup_pre` in `config.yaml` calls it before every Home Assistant backup.

## Ready-made add-on images

Home Assistant doesn't build Hearth — it downloads `ghcr.io/shotgn16/hearth-{arch}:<version>` (set by `image:` in `hearth/config.yaml`).

`.github/workflows/addon-image.yml` builds those images on every push to `main`, for `amd64` and `aarch64`, using `.github/docker/Dockerfile.addon`. It skips versions that already exist, runs a quick start-up check on the amd64 image, and warns if a package isn't public (Home Assistant pulls without signing in). It can also be run by hand from the Actions tab.

`hearth/Dockerfile` is the plain Docker build used by `docker compose`.

## Releasing

1. Bump `version` in `hearth/config.yaml`.
2. Bump the fallback version in `hearth/Dockerfile` (`BUILD_VERSION`) and in the `/api/status` handler in `hearth/server/index.js` — the add-on image sets `HEARTH_VERSION` itself, but plain Docker and `npm start` use these.
3. Add a section to `hearth/CHANGELOG.md`, and update the guides in `docs/` (and `hearth/DOCS.md`, the add-on's Documentation tab) for anything users will notice.
4. Commit and push to `main`. The workflow builds `ghcr.io/shotgn16/hearth-amd64:<version>` and `…-aarch64:<version>` (a few minutes), then Home Assistant offers the update.

The first time the images are published, set both packages to **Public**: GitHub → your profile → **Packages** → `hearth-amd64` / `hearth-aarch64` → **Package settings** → **Change visibility** → **Public**.
