# Development

[← Documentation](../README.md#documentation)

## Stack

- **Server:** Node.js 22 (built-in `node:sqlite`, no native modules), Express 5, `node-ical`.
- **Client:** plain ES modules, no build step, no external CDNs or fonts. Hand-written SVG charts.
- **Storage:** one SQLite file with additive migrations on start-up.

## Layout

```
repository.yaml            Home Assistant add-on repository manifest
hearth/
  config.yaml              add-on manifest (ingress, options/schema, permissions)
  Dockerfile               node:22-alpine, amd64 + aarch64
  translations/en.yaml     option labels in the HA UI
  DOCS.md                  shown on the add-on's Documentation tab
  server/
    index.js               HTTP API, ingress sign-in, static files with <base href> injection
    config.js              add-on options (/data/options.json) / env vars
    db.js                  schema + migrations
    auth.js                passwords and sessions
    ingest.js              single entry point for transactions; CSV/OFX/QIF parsers
    categorize.js          merchant clean-up, UK patterns, learned merchant map
    subscriptions.js       recurring payment detection
    rules.js               workflow engine
    analytics.js           budgets, goals, insights, forecast, pivot, planner, inbox
    banks.js               SimpleFIN + generic JSON bank feeds
    calendar.js            ICS + HA calendar sync, event cost history
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

Point it at Ollama with `OLLAMA_URL=http://<ip>:11434`.

## How the assistant works

`ai.assistant()` builds a system prompt (house rules + a short snapshot), adds the thread history, and calls Ollama's `/api/chat` with `stream: true` and the tool definitions from `aitools.js`. Tool calls are executed against the database and returned as `role: "tool"` messages; the loop runs up to six rounds. `propose_*` tools create rows in `ai_actions` instead of changing anything; the client shows them as cards and `POST /api/ai/actions/:id/confirm` executes them. If Ollama rejects the tools, the turn is retried without tools and with a larger data summary.

`POST /api/ai/chat` streams newline-delimited JSON events: `thread`, `tool`, `notice`, `token`, `action`, `done`, `error`.

## Ingress

Home Assistant serves the panel under `/api/hassio_ingress/<token>/`. The server injects `<base href="${X-Ingress-Path}/">` into `index.html`, and every asset and API call in the client is relative. Identity headers (`X-Remote-User-*`) are trusted only from `172.30.32.2`. The service worker is skipped inside ingress.

## Releasing

1. Bump `version` in `hearth/config.yaml` (and `BUILD_VERSION` in the Dockerfile).
2. Add a section to `hearth/CHANGELOG.md`.
3. Commit and push to `main`. Home Assistant offers the update.

To ship prebuilt images instead of building on each device, publish multi-arch images to GHCR and add `image: ghcr.io/shotgn16/hearth-{arch}` to `config.yaml`.
